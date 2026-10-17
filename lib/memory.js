// Cross-chat memory for the voice thinking partner.
// The server never stores memory: items live in D1 (Cloudflare worker) and the
// browser sends them with each request. This module only bounds, ranks and
// formats them, and extracts new items when a chat is closed.

const MEMORY_MODEL = 'deepseek/deepseek-v4.1-flash';
const MEMORY_MODEL_PARAMS = { reasoning: { enabled: false }, provider: { order: ['deepseek', 'fireworks', 'baseten'], allow_fallbacks: true } };
const KINDS = ['decision', 'paso', 'pregunta', 'patron'];
const KIND_LABELS = { decision: 'decisión', paso: 'paso prometido', pregunta: 'pregunta abierta', patron: 'patrón' };
const MAX_CANDIDATES = 40;
const MAX_ITEM_CHARS = 240;
const MAX_BLOCK_ITEMS = 10;
const MAX_BLOCK_WORDS = 150;
const MAX_EXTRACT_ITEMS = 5;
const MAX_TRANSCRIPT_CHARS = 14_000;
const MAX_EXISTING_FOR_EXTRACT = 30;
const DAY_MS = 86_400_000;

function fold(text) {
  return String(text || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function words(text) {
  return String(text || '').trim().split(/\s+/).filter(Boolean);
}

// "cierra", "ok, cierra", "ciérralo por favor", "cierra la conversación".
const CLOSE_VERBS = new Set(['cierra', 'cierralo', 'cerremos', 'cerramos']);
const CLOSE_FILLER = new Set(['ok', 'okay', 'vale', 'bueno', 'listo', 'ya', 'entonces', 'y', 'por', 'favor', 'porfa', 'gracias', 'la', 'el', 'esta', 'esto', 'aqui', 'conversacion', 'chat', 'sesion', 'charla']);

function isCloseCommand(text) {
  const tokens = fold(text).replace(/[^a-z0-9ñ\s]/g, ' ').split(/\s+/).filter(Boolean);
  if (!tokens.length || tokens.length > 7) return false;
  return tokens.some((t) => CLOSE_VERBS.has(t)) && tokens.every((t) => CLOSE_VERBS.has(t) || CLOSE_FILLER.has(t));
}

const CLOSE_INSTRUCTION = 'El usuario acaba de decir «cierra»: quiere terminar la conversación. Responde en exactamente tres frases de prosa, sin preguntas adicionales: qué quedó claro, cuál es el siguiente paso concreto y cuál es la pregunta que sigue abierta.';

function sanitizeMemoryItems(items) {
  if (!Array.isArray(items)) return [];
  const out = [];
  for (const item of items.slice(0, MAX_CANDIDATES)) {
    if (!item || typeof item !== 'object' || !KINDS.includes(item.kind)) continue;
    const text = String(item.text || '').replace(/\s+/g, ' ').trim().slice(0, MAX_ITEM_CHARS);
    if (!text) continue;
    const created = Date.parse(item.created_at);
    out.push({
      id: String(item.id || '').slice(0, 120),
      kind: item.kind,
      text,
      status: item.status === 'done' ? 'done' : 'active',
      createdAt: Number.isNaN(created) ? null : created,
    });
  }
  return out;
}

const STOPWORDS = new Set(['para', 'pero', 'porque', 'como', 'esta', 'este', 'esto', 'estos', 'estas', 'esas', 'esos', 'tengo', 'tiene', 'hacer', 'algo', 'cosa', 'cosas', 'todo', 'todos', 'muy', 'mas', 'menos', 'cuando', 'donde', 'sobre', 'entre', 'desde', 'hasta', 'tambien', 'entonces', 'digamos', 'bueno', 'creo', 'quiero', 'puedo', 'estoy', 'eso', 'ese', 'esa', 'solo', 'cada', 'otra', 'otro', 'mismo', 'misma', 'hoy', 'dia']);

function keywords(text) {
  return new Set(fold(text).replace(/[^a-z0-9ñ\s]/g, ' ').split(/\s+/).filter((w) => w.length >= 4 && !STOPWORDS.has(w)));
}

// Rank by kind (open loops first), recency and word overlap with the current
// message, then keep at most 10 items / 150 words.
function selectMemory(items, query = '', now = Date.now()) {
  const queryWords = keywords(query);
  const kindWeight = { paso: 3, pregunta: 2.5, decision: 2, patron: 2 };
  const scored = items.map((item) => {
    const ageDays = item.createdAt == null ? 30 : Math.max(0, (now - item.createdAt) / DAY_MS);
    let overlap = 0;
    for (const w of keywords(item.text)) if (queryWords.has(w)) overlap += 1;
    return { item, score: kindWeight[item.kind] + 3 * Math.exp(-ageDays / 14) + Math.min(overlap, 3) * 2 };
  }).sort((a, b) => b.score - a.score);
  const chosen = [];
  let total = 0;
  for (const { item } of scored) {
    if (chosen.length >= MAX_BLOCK_ITEMS) break;
    const n = words(item.text).length;
    if (total + n > MAX_BLOCK_WORDS) continue;
    chosen.push(item);
    total += n;
  }
  // Oldest first so the block reads like a timeline and stays stable for the chat.
  return chosen.sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0) || a.id.localeCompare(b.id));
}

function relativeDay(createdAt, now = Date.now()) {
  if (createdAt == null) return 'fecha desconocida';
  const days = Math.floor((now - createdAt) / DAY_MS);
  if (days <= 0) return 'hoy';
  if (days === 1) return 'ayer';
  if (days < 14) return `hace ${days} días`;
  if (days < 60) return `hace ${Math.round(days / 7)} semanas`;
  return `hace ${Math.round(days / 30)} meses`;
}

// Stable profile: at most 5 short lines / 80 words, whatever the browser sends.
const MAX_PROFILE_LINES = 5;
const MAX_PROFILE_WORDS = 80;

function sanitizeProfile(text) {
  const lines = [];
  let total = 0;
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.replace(/^\s*[-*•]\s*/, '').replace(/\s+/g, ' ').trim().slice(0, 200);
    if (!line) continue;
    const n = words(line).length;
    if (lines.length >= MAX_PROFILE_LINES || total + n > MAX_PROFILE_WORDS) break;
    lines.push(line);
    total += n;
  }
  return lines;
}

// "Contexto sobre mí" = stable profile + recent memory (the v3 prompt refers to this block).
function formatMemoryBlock(items, now = Date.now(), profileLines = []) {
  if (!items.length && !profileLines.length) return '';
  const out = ['Contexto sobre mí (úsalo solo cuando aporte a lo que digo ahora; si no viene al caso, ignóralo y no lo menciones; nunca lo recites).'];
  if (profileLines.length) out.push('Perfil:', ...profileLines.map((line) => `- ${line}`));
  if (items.length) {
    out.push('Memoria reciente (de chats anteriores; si un paso prometido o una pregunta abierta conecta con lo que cuento, pregúntame por ello en una frase, por ejemplo: «hace una semana dijiste que hablarías con X; ¿pasó?»):');
    out.push(...items.map((item) => `- [${KIND_LABELS[item.kind]}, ${relativeDay(item.createdAt, now)}] ${item.text}`));
  }
  return out.join('\n');
}

// Builds the system-prompt suffix for one /pipeline request.
function buildMemoryContext({ memory, profile, query, now = Date.now() }) {
  const active = sanitizeMemoryItems(memory).filter((item) => item.status === 'active');
  const items = selectMemory(active, query, now);
  return { block: formatMemoryBlock(items, now, sanitizeProfile(profile)), ids: items.map((item) => item.id) };
}

const EXTRACT_PROMPT = `Extraes memoria útil de una conversación de reflexión por voz entre el usuario y su compañero de pensamiento. Los mensajes del usuario son transcripciones automáticas con errores: interpreta el sentido y escribe bien los nombres propios.

Devuelve solo JSON con esta forma: {"items":[{"tipo":"decision|paso|pregunta|patron","texto":"..."}],"resueltos":["id"]}

Tipos:
- decision: algo que el usuario decidió.
- paso: algo concreto que dijo que haría (con quién o cuándo, si lo dijo).
- pregunta: una duda importante que quedó sin resolver.
- patron: un tema, bloqueo o hábito que se repite, en esta conversación o respecto a la memoria existente.

Reglas:
- Entre 1 y 5 ítems: solo lo que valga la pena recordar dentro de una semana. Mejor dos buenos que cinco flojos.
- "texto": una frase corta de nota, sin sujeto, máximo 20 palabras, concreta y específica. Ejemplos: "Hablar con Ana del presupuesto antes del viernes", "Programar como máximo una hora al día", "¿Vale la pena dejar el trabajo fijo este año?", "Se sobreestimula programando de noche y pierde el sueño".
- No repitas lo que ya está en la memoria existente salvo que haya cambiado. Si un tema de la memoria vuelve a aparecer, regístralo como patron.
- "resueltos": ids de la memoria existente (pasos o preguntas) que esta conversación muestra como hechos o resueltos. Si no hay, [].
- No inventes nada que no se haya dicho.`;

function kindFromLabel(label) {
  const value = fold(label);
  if (value.startsWith('decis')) return 'decision';
  if (value.startsWith('paso')) return 'paso';
  if (value.startsWith('pregunta')) return 'pregunta';
  if (value.startsWith('patr')) return 'patron';
  return null;
}

function parseJsonObject(text) {
  const raw = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '');
  try { return JSON.parse(raw); } catch { /* fall through */ }
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try { return JSON.parse(raw.slice(start, end + 1)); } catch { return null; }
}

function parseExtraction(content, existingIds) {
  const data = parseJsonObject(content) || {};
  const seen = new Set();
  const items = [];
  for (const item of Array.isArray(data.items) ? data.items : []) {
    const kind = kindFromLabel(item?.tipo ?? item?.kind);
    const text = String(item?.texto ?? item?.text ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_ITEM_CHARS);
    if (!kind || !text || seen.has(fold(text))) continue;
    seen.add(fold(text));
    items.push({ kind, text });
    if (items.length >= MAX_EXTRACT_ITEMS) break;
  }
  const resolved = (Array.isArray(data.resueltos) ? data.resueltos : []).map(String).filter((id) => existingIds.has(id));
  return { items, resolved: [...new Set(resolved)] };
}

function transcriptFromMessages(messages) {
  const lines = [];
  for (const msg of Array.isArray(messages) ? messages.slice(-200) : []) {
    const text = String(msg?.text || '').trim();
    if (!text) continue;
    lines.push(`${msg.role === 'model' ? 'Compañero' : 'Usuario'}: ${text}`);
  }
  const transcript = lines.join('\n\n');
  // Keep the end of long chats: that is where decisions and the close summary are.
  return transcript.length > MAX_TRANSCRIPT_CHARS ? transcript.slice(-MAX_TRANSCRIPT_CHARS) : transcript;
}

const IMPORT_PROMPT = `Destilas memorias exportadas de otro asistente (Claude Code, ChatGPT, Perplexity…) para un compañero de reflexión por voz. El objetivo es POCA memoria de alto valor: una memoria excesiva vuelve al asistente más lento y peor.

Devuelve solo JSON con esta forma: {"perfil":["línea"],"items":[{"tipo":"decision|paso|pregunta|patron","texto":"..."}]}

- "perfil": el perfil estable del usuario en 2 a 5 líneas cortas (máximo 16 palabras cada una): a qué se dedica, sus proyectos o metas grandes de ahora, cómo prefiere que le hablen, y valores o luchas personales que se repiten. Sale de las memorias exportadas y del perfil actual: fusiónalos sin perder lo importante del actual. Nada de detalles técnicos: herramientas, versiones, rutas, puertos, configuraciones ni nombres de archivos.
- "items": como máximo 8, y solo lo que diga la fuente exportada y siga vigente: decisiones de fondo, pasos pendientes importantes, preguntas abiertas, patrones personales. Mejor 3 buenos que 8 flojos; si la fuente solo describe proyectos y preferencias, eso va al perfil y "items" puede quedar vacío. Antes de devolver, borra de "items" todo lo que ya diga tu "perfil" (por ejemplo, si el perfil dice que prefiere voces latinas, ningún ítem habla de voces). Frase corta de nota, sin sujeto, máximo 20 palabras.
- La "memoria existente" se muestra solo para no duplicarla: nunca la uses como fuente ni la reescribas como ítem nuevo, y omite cualquier ítem que ya esté ahí aunque sea con otras palabras.
- No supongas datos que la fuente no diga explícitamente (nacionalidad, edad, género, ciudad, profesión exacta).
- Nunca incluyas contraseñas, claves, tokens, correos, números de cuenta ni identificadores.
- Si la fuente no aporta nada útil, devuelve "items" vacío y el perfil actual.`;

const CONSOLIDATE_PROMPT = `Revisas la memoria de un compañero de reflexión por voz para que siga siendo pequeña y útil: una memoria excesiva lo vuelve más lento y peor.

Devuelve solo JSON con esta forma: {"fusionar":[{"ids":["id1","id2"],"tipo":"decision|paso|pregunta|patron","texto":"..."}],"borrar":[{"id":"id","motivo":"..."}]}

- "fusionar": grupos de 2 o más ítems que dicen lo mismo o casi lo mismo. Escribe un solo texto que los resuma (frase corta sin sujeto, máximo 20 palabras).
- "borrar": ítems que ya no aportan: resueltos antiguos, pasos con fecha pasada que ya no importan, lo que contradice un ítem más reciente o lo que ya dice el perfil. "motivo" en 3 a 8 palabras.
- No toques lo que siga vigente y sea distinto. Usa solo ids de la lista; cada id en una sola acción. Si todo está bien, devuelve listas vacías.`;

const MAX_IMPORT_CHARS = 20_000;
const MAX_IMPORT_ITEMS = 8;
const MAX_CONSOLIDATE_ITEMS = 120;
const PRUNE_DONE_AFTER_DAYS = 21;

function memoryList(items) {
  return items.length
    ? items.map((item) => `- id=${item.id} [${KIND_LABELS[item.kind]}${item.status === 'done' ? ', hecho' : ''}, ${relativeDay(item.createdAt)}] ${item.text}`).join('\n')
    : '(vacía)';
}

function parseItems(list, max) {
  const seen = new Set();
  const items = [];
  for (const item of Array.isArray(list) ? list : []) {
    const kind = kindFromLabel(item?.tipo ?? item?.kind);
    const text = String(item?.texto ?? item?.text ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_ITEM_CHARS);
    if (!kind || !text || seen.has(fold(text))) continue;
    seen.add(fold(text));
    items.push({ kind, text });
    if (items.length >= max) break;
  }
  return items;
}

function parseImport(content) {
  const data = parseJsonObject(content) || {};
  const profile = sanitizeProfile((Array.isArray(data.perfil) ? data.perfil : [data.perfil]).filter(Boolean).join('\n'));
  return { profile, items: parseItems(data.items, MAX_IMPORT_ITEMS) };
}

// Merges and deletions proposed by the model, restricted to known ids, plus a
// deterministic rule: items marked done more than 3 weeks ago are pruned.
function parseConsolidation(content, items, now = Date.now()) {
  const data = parseJsonObject(content) || {};
  const byId = new Map(items.map((item) => [item.id, item]));
  const used = new Set();
  const merge = [];
  for (const group of Array.isArray(data.fusionar) ? data.fusionar : []) {
    const ids = [...new Set((Array.isArray(group?.ids) ? group.ids : []).map(String))].filter((id) => byId.has(id) && !used.has(id));
    const [parsed] = parseItems([group], 1);
    if (ids.length < 2 || !parsed) continue;
    ids.forEach((id) => used.add(id));
    merge.push({ ids, kind: parsed.kind, text: parsed.text });
  }
  const remove = [];
  for (const entry of Array.isArray(data.borrar) ? data.borrar : []) {
    const id = String(entry?.id ?? entry);
    if (!byId.has(id) || used.has(id)) continue;
    used.add(id);
    remove.push({ id, reason: String(entry?.motivo || 'Ya no aporta').slice(0, 80) });
  }
  for (const item of items) {
    if (used.has(item.id) || item.status !== 'done' || item.createdAt == null) continue;
    if ((now - item.createdAt) / DAY_MS > PRUNE_DONE_AFTER_DAYS) remove.push({ id: item.id, reason: 'Hecho hace más de 3 semanas' });
  }
  return { merge, remove };
}

async function callMemoryModel({ system, user, maxTokens, env, fetchImpl }) {
  // Server key only: unlike /pipeline, this endpoint never accepts a browser key.
  const apiKey = env.OPENROUTER_API_KEY;
  if (!apiKey) throw Object.assign(new Error('OPENROUTER_API_KEY not configured'), { status: 500 });
  // The model is fixed on the server: this endpoint must not become a proxy for arbitrary models.
  const model = env.MEMORY_MODEL || MEMORY_MODEL;
  const started = Date.now();
  const response = await fetchImpl('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      'HTTP-Referer': env.PUBLIC_APP_URL || 'http://localhost:3001',
      'X-Title': 'Voice Chat',
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      max_tokens: maxTokens,
      response_format: { type: 'json_object' },
      ...(model === MEMORY_MODEL ? MEMORY_MODEL_PARAMS : {}),
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw Object.assign(new Error(data?.error?.message || data?.error || 'Memory request failed'), { status: response.status });
  }
  return { content: data.choices?.[0]?.message?.content, meta: { model, usage: data.usage || null, ms: Date.now() - started } };
}

// One endpoint, three bounded jobs: "chat" (extract on close), "import"
// (distill an export from another assistant) and "consolidate" (merge/prune).
async function extractMemory({ body, env = process.env, fetchImpl = fetch }) {
  const mode = body?.mode || 'chat';
  const profileLines = sanitizeProfile(body?.profile);
  const profileText = profileLines.length ? profileLines.join('\n') : '(vacío)';

  if (mode === 'import') {
    const source = String(body?.source || 'otro asistente').slice(0, 40);
    const text = String(body?.text || '').trim().slice(0, MAX_IMPORT_CHARS);
    if (!text) throw Object.assign(new Error('No hay texto para importar'), { status: 400 });
    const existing = sanitizeMemoryItems(body?.existing).slice(0, MAX_EXISTING_FOR_EXTRACT);
    const { content, meta } = await callMemoryModel({
      system: IMPORT_PROMPT,
      user: `Memorias exportadas de ${source} (la fuente):\n${text}\n\nPerfil actual:\n${profileText}\n\nMemoria existente (solo para no duplicar, no es fuente):\n${memoryList(existing)}`,
      maxTokens: 700, env, fetchImpl,
    });
    const result = parseImport(content);
    if (!result.profile.length && !result.items.length) throw Object.assign(new Error('No se pudo destilar esa fuente'), { status: 502 });
    return { ...result, ...meta };
  }

  if (mode === 'consolidate') {
    const items = (Array.isArray(body?.items) ? body.items : []).slice(0, MAX_CONSOLIDATE_ITEMS);
    const clean = [];
    for (let i = 0; i < items.length; i += MAX_CANDIDATES) clean.push(...sanitizeMemoryItems(items.slice(i, i + MAX_CANDIDATES)));
    if (clean.length < 2) return { merge: [], remove: [], model: null, usage: null, ms: 0 };
    const { content, meta } = await callMemoryModel({
      system: CONSOLIDATE_PROMPT,
      user: `Perfil:\n${profileText}\n\nMemoria (${clean.length} ítems):\n${memoryList(clean)}`,
      maxTokens: 900, env, fetchImpl,
    });
    return { ...parseConsolidation(content, clean), ...meta };
  }

  const transcript = transcriptFromMessages(body?.messages);
  if (!transcript) throw Object.assign(new Error('La conversación está vacía'), { status: 400 });
  const existing = sanitizeMemoryItems(body?.existing).slice(0, MAX_EXISTING_FOR_EXTRACT);
  const existingIds = new Set(existing.map((item) => item.id));
  const chatName = String(body?.chatName || '').slice(0, 120);
  const { content, meta } = await callMemoryModel({
    system: EXTRACT_PROMPT,
    user: `Memoria existente:\n${memoryList(existing)}\n\nConversación${chatName ? ` «${chatName}»` : ''}:\n${transcript}`,
    maxTokens: 600, env, fetchImpl,
  });
  const result = parseExtraction(content, existingIds);
  if (!result.items.length && !result.resolved.length) {
    throw Object.assign(new Error('No se pudo extraer memoria de esta conversación'), { status: 502 });
  }
  return { ...result, ...meta };
}

module.exports = {
  isCloseCommand,
  CLOSE_INSTRUCTION,
  sanitizeMemoryItems,
  sanitizeProfile,
  selectMemory,
  formatMemoryBlock,
  buildMemoryContext,
  parseExtraction,
  parseImport,
  parseConsolidation,
  transcriptFromMessages,
  extractMemory,
  MEMORY_MODEL,
  MAX_BLOCK_ITEMS,
  MAX_BLOCK_WORDS,
};
