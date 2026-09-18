const JSON_LIMIT = 900_000;
const ID_PATTERN = /^[A-Za-z0-9_-]{1,120}$/;

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  });
}

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin');
  const allowed = env.D1_TEST_ORIGIN || '';
  return origin && (!allowed || origin === allowed)
    ? { 'access-control-allow-origin': origin, 'access-control-allow-headers': 'content-type, authorization', 'access-control-allow-methods': 'GET, PUT, DELETE, OPTIONS', 'vary': 'Origin' }
    : {};
}

function fail(message, status = 400) { return json({ error: message }, status); }

function ownerFromRequest(request, env) {
  const configured = env.D1_TEST_TOKEN;
  if (configured && request.headers.get('Authorization') !== `Bearer ${configured}`) return null;
  return env.D1_TEST_OWNER || 'local-test-user';
}

function requireId(value) {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) throw new Error('Invalid id');
  return value;
}

function cleanText(value, field, max = 20_000) {
  if (typeof value !== 'string' || value.length > max) throw new Error(`Invalid ${field}`);
  return value;
}

function now() { return new Date().toISOString(); }

function folderRow(row) {
  return { id: row.id, owner_id: row.owner_id, emoji: row.emoji, name: row.name, system_prompt: row.system_prompt, created_at: row.created_at, updated_at: row.updated_at };
}

function chatRow(row) {
  return { id: row.id, owner_id: row.owner_id, folder_id: row.folder_id, emoji: row.emoji, name: row.name, system_prompt: row.system_prompt, messages: JSON.parse(row.messages_json || '[]'), created_at: row.created_at, updated_at: row.updated_at };
}

async function readBody(request) {
  const text = await request.text();
  if (text.length > JSON_LIMIT) throw new Error('Request body too large');
  try { return JSON.parse(text || '{}'); } catch { throw new Error('Invalid JSON'); }
}

async function list(env, table, owner) {
  const result = await env.DB.prepare(`SELECT * FROM ${table} WHERE owner_id = ? ORDER BY updated_at DESC`).bind(owner).all();
  return result.results.map(table === 'chats' ? chatRow : folderRow);
}

async function put(env, table, id, owner, body) {
  requireId(id);
  const timestamp = now();
  const name = cleanText(body.name || (table === 'chats' ? 'Nuevo chat' : 'Nueva carpeta'), 'name', 300);
  const emoji = cleanText(body.emoji || (table === 'chats' ? '💬' : '📁'), 'emoji', 20);
  const prompt = cleanText(body.system_prompt || '', 'system_prompt');
  if (table === 'chats') {
    const folderId = body.folder_id == null ? null : requireId(body.folder_id);
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const messagesJson = JSON.stringify(messages);
    if (messagesJson.length > JSON_LIMIT) throw new Error('messages too large');
    await env.DB.prepare(`INSERT INTO chats (id, owner_id, folder_id, emoji, name, system_prompt, messages_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET folder_id=excluded.folder_id, emoji=excluded.emoji, name=excluded.name, system_prompt=excluded.system_prompt, messages_json=excluded.messages_json, updated_at=excluded.updated_at WHERE chats.owner_id=excluded.owner_id`).bind(id, owner, folderId, emoji, name, prompt, messagesJson, timestamp, timestamp).run();
    const result = await env.DB.prepare('SELECT * FROM chats WHERE id = ? AND owner_id = ?').bind(id, owner).first();
    return chatRow(result);
  }
  await env.DB.prepare(`INSERT INTO folders (id, owner_id, emoji, name, system_prompt, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET emoji=excluded.emoji, name=excluded.name, system_prompt=excluded.system_prompt, updated_at=excluded.updated_at WHERE folders.owner_id=excluded.owner_id`).bind(id, owner, emoji, name, prompt, timestamp, timestamp).run();
  const result = await env.DB.prepare('SELECT * FROM folders WHERE id = ? AND owner_id = ?').bind(id, owner).first();
  return folderRow(result);
}

export default {
  async fetch(request, env) {
    const headers = corsHeaders(request, env);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    const url = new URL(request.url);
    if (url.pathname === '/health' && request.method === 'GET') return json({ ok: true, service: 'cloudflare-d1-lab' }, 200, headers);
    const owner = ownerFromRequest(request, env);
    if (!owner) return fail('Unauthorized', 401);
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length < 1 || !['chats', 'folders'].includes(parts[0])) return fail('Not found', 404);
    const table = parts[0];
    try {
      if (request.method === 'GET' && parts.length === 1) return json({ [table]: await list(env, table, owner) }, 200, headers);
      if (request.method === 'PUT' && parts.length === 2) return json(await put(env, table, parts[1], owner, await readBody(request)), 200, headers);
      if (request.method === 'DELETE' && parts.length === 2) {
        requireId(parts[1]);
        await env.DB.prepare(`DELETE FROM ${table} WHERE id = ? AND owner_id = ?`).bind(parts[1], owner).run();
        return json({ ok: true }, 200, headers);
      }
      return fail('Method not allowed', 405);
    } catch (error) { return fail(error.message || 'D1 error', error.message === 'Unauthorized' ? 401 : 400); }
  },
};

export { chatRow, folderRow, ownerFromRequest };
