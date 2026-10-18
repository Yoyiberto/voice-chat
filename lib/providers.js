// Provider registry for the STT + LLM pipeline.
//
// Keys: the server env key is tried first (a stale browser key must not shadow
// a working .env key), then the key typed in the web app. A 401/403 falls
// through to the next key, so an expired key on either side no longer breaks
// the app; keys that failed auth are skipped for a while to avoid paying the
// extra round trip on every audio segment.

const PROVIDERS = {
  openrouter: { label: 'OpenRouter', envKey: 'OPENROUTER_API_KEY', bodyKey: 'openrouterApiKey' },
  openai: { label: 'OpenAI', envKey: 'OPENAI_API_KEY', bodyKey: 'openaiApiKey' },
  anthropic: { label: 'Anthropic', envKey: 'ANTHROPIC_API_KEY', bodyKey: 'anthropicApiKey' },
  groq: { label: 'Groq', envKey: 'GROQ_API_KEY', bodyKey: 'groqApiKey' },
  google: { label: 'Google', envKey: 'GEMINI_API_KEY', bodyKey: 'geminiApiKey' },
};

const DEFAULT_LLM_MODELS = {
  openrouter: 'deepseek/deepseek-v4.1-flash',
  openai: 'gpt-5.6-luna',
  anthropic: 'claude-sonnet-5-5',
  groq: 'openai/gpt-oss-120b',
  google: 'gemini-3.1-flash-lite',
};

const CHAT_URLS = {
  openrouter: 'https://openrouter.ai/api/v1/chat/completions',
  openai: 'https://api.openai.com/v1/chat/completions',
  groq: 'https://api.groq.com/openai/v1/chat/completions',
  google: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
};

const PROVIDER_PREFIX = /^(openrouter|openai|anthropic|groq|google):(.+)$/;
const BAD_KEY_TTL_MS = 10 * 60 * 1000;
const badKeys = new Map();

function httpError(message, status) {
  return Object.assign(new Error(message), { status });
}

function errorMessage(data, fallback) {
  return data?.error?.message || (typeof data?.error === 'string' ? data.error : '') || data?.message || fallback;
}

function candidateKeys(provider, env = {}, body = {}) {
  const spec = PROVIDERS[provider];
  if (!spec) return [];
  const keys = [env[spec.envKey], body?.[spec.bodyKey]]
    .map((key) => String(key || '').trim())
    .filter(Boolean);
  return [...new Set(keys)];
}

function keySource(provider, env = {}, body = {}, key) {
  const spec = PROVIDERS[provider];
  if (key && key === String(env[spec.envKey] || '').trim()) return 'server';
  if (key && key === String(body?.[spec.bodyKey] || '').trim()) return 'browser';
  return null;
}

/** Runs `run(key)` with each candidate key until one passes authentication. */
async function withProviderKey(provider, env, body, run) {
  const spec = PROVIDERS[provider];
  if (!spec) throw httpError(`Proveedor desconocido: ${provider}`, 400);
  const all = candidateKeys(provider, env, body);
  if (!all.length) throw httpError(`Falta la clave de ${spec.label} (${spec.envKey})`, 401);
  const now = Date.now();
  const fresh = all.filter((key) => !(badKeys.get(key) > now));
  const keys = fresh.length ? fresh : all;
  let lastError;
  for (const key of keys) {
    try {
      return await run(key);
    } catch (error) {
      lastError = error;
      if (error.status !== 401 && error.status !== 403) throw error;
      badKeys.set(key, Date.now() + BAD_KEY_TTL_MS);
    }
  }
  lastError.message = `${spec.label}: ${lastError.message}`;
  throw lastError;
}

/**
 * Accepts the explicit `llmProvider` field, or a provider prefix on the model
 * ("anthropic:claude-sonnet-5-5"). Bare ids are OpenRouter ids, as before.
 */
function resolveLlm({ llmProvider, model } = {}, env = {}) {
  let provider = llmProvider;
  let id = String(model || '').trim();
  const prefixed = id.match(PROVIDER_PREFIX);
  if (prefixed) {
    provider = provider || prefixed[1];
    id = prefixed[2];
  }
  if (!PROVIDERS[provider]) provider = 'openrouter';
  if (!id) id = provider === 'openrouter' ? (env.OPENROUTER_TEXT_MODEL || DEFAULT_LLM_MODELS.openrouter) : DEFAULT_LLM_MODELS[provider];
  return { provider, model: id };
}

// Claude models that accept output_config.effort, and the ones with server-side
// refusal fallbacks (Claude Haiku 5.5 has none).
const ANTHROPIC_EFFORT = /^claude-(fable|mythos|opus|sonnet|haiku)-[5-9]|^claude-opus-4-[5-9]|^claude-sonnet-4-[6-9]/;
const ANTHROPIC_FALLBACK = /^claude-(fable-5|opus-5|sonnet-5-5)/;

async function anthropicCompletion({ model, messages, apiKey, fetchImpl }) {
  const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
  const turns = messages.filter((m) => m.role !== 'system').map((m) => ({ role: m.role, content: m.content }));
  const body = { model, max_tokens: 4096, messages: turns };
  if (system) body.system = system;
  // Voice replies are short; low effort keeps the first word fast.
  if (ANTHROPIC_EFFORT.test(model)) body.output_config = { effort: 'low' };
  const headers = {
    'Content-Type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
  };
  if (ANTHROPIC_FALLBACK.test(model)) {
    body.fallbacks = 'default';
    headers['anthropic-beta'] = 'server-side-fallback-2026-07-01';
  }
  const response = await fetchImpl('https://api.anthropic.com/v1/messages', { method: 'POST', headers, body: JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw httpError(errorMessage(data, 'Anthropic request failed'), response.status);
  if (data.stop_reason === 'refusal') {
    throw httpError('Anthropic rechazó la solicitud (filtro de seguridad). Prueba otro modelo o reformula.', 422);
  }
  const reply = (data.content || []).filter((block) => block.type === 'text').map((block) => block.text).join('').trim();
  if (!reply) throw httpError('Anthropic returned an empty response', 502);
  return { reply, usage: data.usage || null, annotations: [], rawResponse: data };
}

/**
 * One chat completion. `extra` carries provider-specific body fields
 * (OpenRouter params, web search tools) and is only sent to OpenRouter.
 */
async function chatCompletion({ provider, model, messages, apiKey, fetchImpl = fetch, referer, extra = {} }) {
  if (provider === 'anthropic') return anthropicCompletion({ model, messages, apiKey, fetchImpl });
  const url = CHAT_URLS[provider];
  if (!url) throw httpError(`Proveedor desconocido: ${provider}`, 400);
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` };
  let body;
  if (provider === 'openrouter') {
    headers['HTTP-Referer'] = referer || 'http://localhost:3001';
    headers['X-Title'] = 'Parlo';
    body = { model, messages, temperature: 1, max_tokens: 2048, ...extra };
  } else if (provider === 'openai') {
    // GPT-5+ only accept the default temperature, and reasoning tokens count here.
    body = { model, messages, max_completion_tokens: 4096 };
  } else {
    body = { model, messages, temperature: 1, max_tokens: 4096 };
  }
  const response = await fetchImpl(url, { method: 'POST', headers, body: JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  const label = PROVIDERS[provider].label;
  if (!response.ok) throw httpError(errorMessage(data, `${label} request failed`), response.status);
  const message = data.choices?.[0]?.message || {};
  const content = Array.isArray(message.content)
    ? message.content.map((part) => part.text || '').join('')
    : message.content;
  const reply = String(content || '').trim();
  if (!reply) throw httpError(`${label} returned an empty response`, 502);
  return { reply, usage: data.usage || null, annotations: message.annotations || [], rawResponse: data };
}

// ── Model catalogs (for the settings screen) ──
const HIDE_LLM = /(whisper|tts|transcribe|audio|realtime|image|embed|moderation|guard|search|dall-e|davinci|babbage|robotics|computer-use|lyria|banana|antigravity|deep-research|veo|imagen|aqa|playai|orpheus|:batch$)/i;

async function getJson(fetchImpl, url, init) {
  const response = await fetchImpl(url, init);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw httpError(errorMessage(data, `HTTP ${response.status}`), response.status);
  return data;
}

async function listModels({ provider, apiKey, fetchImpl = fetch }) {
  const bearer = { Authorization: `Bearer ${apiKey}` };
  if (provider === 'openrouter') {
    const data = await getJson(fetchImpl, 'https://openrouter.ai/api/v1/models');
    return (data.data || [])
      .filter((m) => !HIDE_LLM.test(m.id) && (m.architecture?.output_modalities || ['text']).includes('text'))
      .map((m) => ({
        id: m.id,
        name: m.name || m.id,
        price: m.pricing ? { input: Number(m.pricing.prompt) * 1e6, output: Number(m.pricing.completion) * 1e6 } : null,
        context: m.context_length || null,
      }));
  }
  if (provider === 'openai') {
    const data = await getJson(fetchImpl, 'https://api.openai.com/v1/models', { headers: bearer });
    return (data.data || [])
      .filter((m) => /^(gpt|o\d|chatgpt)/.test(m.id) && !HIDE_LLM.test(m.id))
      .map((m) => ({ id: m.id, name: m.id, created: m.created || 0 }))
      .sort((a, b) => b.created - a.created);
  }
  if (provider === 'groq') {
    const data = await getJson(fetchImpl, 'https://api.groq.com/openai/v1/models', { headers: bearer });
    return (data.data || [])
      .filter((m) => !HIDE_LLM.test(m.id) && m.active !== false)
      .map((m) => ({ id: m.id, name: m.id, context: m.context_window || null }));
  }
  if (provider === 'anthropic') {
    const data = await getJson(fetchImpl, 'https://api.anthropic.com/v1/models?limit=100', {
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    });
    return (data.data || []).map((m) => ({ id: m.id, name: m.display_name || m.id }));
  }
  if (provider === 'google') {
    const data = await getJson(fetchImpl, `https://generativelanguage.googleapis.com/v1beta/models?pageSize=200&key=${encodeURIComponent(apiKey)}`);
    return (data.models || [])
      .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
      .map((m) => ({ id: m.name.replace(/^models\//, ''), name: m.displayName || m.name }))
      .filter((m) => /^(gemini|gemma)/.test(m.id) && !HIDE_LLM.test(m.id));
  }
  throw httpError(`Proveedor desconocido: ${provider}`, 400);
}

/** OpenRouter has a free key endpoint with the remaining credit. */
async function openrouterCredit({ apiKey, fetchImpl = fetch }) {
  const data = await getJson(fetchImpl, 'https://openrouter.ai/api/v1/key', { headers: { Authorization: `Bearer ${apiKey}` } });
  const info = data.data || {};
  return { limit: info.limit ?? null, usage: info.usage ?? null, remaining: info.limit_remaining ?? null };
}

/**
 * Settings helper: lists models and validates the key in one call.
 * Returns which key worked (server or browser) without ever returning it.
 */
async function describeProvider({ provider, body = {}, env = process.env, fetchImpl = fetch }) {
  if (!PROVIDERS[provider]) throw httpError(`Proveedor desconocido: ${provider}`, 400);
  const keys = candidateKeys(provider, env, body);
  const result = { provider, keys: { server: !!env[PROVIDERS[provider].envKey], browser: !!body[PROVIDERS[provider].bodyKey] }, key: null, models: [] };
  if (!keys.length) {
    if (provider === 'openrouter') result.models = await listModels({ provider, fetchImpl });
    result.key = { ok: false, error: `Falta la clave de ${PROVIDERS[provider].label}` };
    return result;
  }
  try {
    await withProviderKey(provider, env, body, async (apiKey) => {
      if (provider === 'openrouter') {
        result.credit = await openrouterCredit({ apiKey, fetchImpl });
        result.models = await listModels({ provider, fetchImpl });
      } else {
        result.models = await listModels({ provider, apiKey, fetchImpl });
      }
      result.key = { ok: true, source: keySource(provider, env, body, apiKey) };
    });
  } catch (error) {
    result.key = { ok: false, error: error.message };
    if (provider === 'openrouter' && !result.models.length) {
      result.models = await listModels({ provider, fetchImpl }).catch(() => []);
    }
  }
  return result;
}

function keyStatus(env = process.env) {
  return Object.fromEntries(Object.entries(PROVIDERS).map(([id, spec]) => [id, !!env[spec.envKey]]));
}

module.exports = {
  PROVIDERS,
  DEFAULT_LLM_MODELS,
  candidateKeys,
  withProviderKey,
  resolveLlm,
  chatCompletion,
  listModels,
  describeProvider,
  keyStatus,
  errorMessage,
  _badKeys: badKeys,
};
