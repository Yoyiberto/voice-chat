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
  return {
    'access-control-allow-origin': origin || '*',
    'access-control-allow-headers': 'content-type, authorization, x-device-id, x-owner-id',
    'access-control-allow-methods': 'GET, PUT, DELETE, OPTIONS',
    'vary': 'Origin'
  };
}

function fail(message, status = 400, headers = {}) { return json({ error: message }, status, headers); }

function ownerFromRequest(request, env) {
  const configured = env.D1_TEST_TOKEN;
  if (configured && request.headers.get('Authorization') !== `Bearer ${configured}`) return null;
  return request.headers.get('x-device-id') || request.headers.get('x-owner-id') || env.D1_TEST_OWNER || 'local-test-user';
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
    const row = chatRow(result);
    if (env.STORAGE) {
      try {
        await env.STORAGE.put(`chats/${owner}/${id}.json`, JSON.stringify(row, null, 2), {
          httpMetadata: { contentType: 'application/json' }
        });
      } catch (e) {
        console.error('R2 storage put error:', e);
      }
    }
    return row;
  }
  await env.DB.prepare(`INSERT INTO folders (id, owner_id, emoji, name, system_prompt, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET emoji=excluded.emoji, name=excluded.name, system_prompt=excluded.system_prompt, updated_at=excluded.updated_at WHERE folders.owner_id=excluded.owner_id`).bind(id, owner, emoji, name, prompt, timestamp, timestamp).run();
  const result = await env.DB.prepare('SELECT * FROM folders WHERE id = ? AND owner_id = ?').bind(id, owner).first();
  const row = folderRow(result);
  if (env.STORAGE) {
    try {
      await env.STORAGE.put(`folders/${owner}/${id}.json`, JSON.stringify(row, null, 2), {
        httpMetadata: { contentType: 'application/json' }
      });
    } catch (e) {
      console.error('R2 storage put error:', e);
    }
  }
  return row;
}

// ── Cross-chat memory (decisions, promised steps, open questions, patterns) ──
const MEMORY_KINDS = new Set(['decision', 'paso', 'pregunta', 'patron']);
const MEMORY_STATUSES = new Set(['active', 'done']);
const MEMORY_LIST_LIMIT = 300;

function memoryRow(row) {
  return { id: row.id, kind: row.kind, text: row.text, status: row.status, source_chat_id: row.source_chat_id, source_chat_name: row.source_chat_name, created_at: row.created_at, updated_at: row.updated_at };
}

function cleanDate(value) {
  if (typeof value !== 'string' || value.length > 40 || Number.isNaN(Date.parse(value))) return null;
  return new Date(value).toISOString();
}

async function listMemory(env, owner) {
  const result = await env.DB.prepare(`SELECT * FROM memory_items WHERE owner_id = ? ORDER BY created_at DESC LIMIT ${MEMORY_LIST_LIMIT}`).bind(owner).all();
  return result.results.map(memoryRow);
}

async function putMemory(env, id, owner, body) {
  requireId(id);
  if (!MEMORY_KINDS.has(body.kind)) throw new Error('Invalid kind');
  const text = cleanText(String(body.text ?? '').trim(), 'text', 400);
  if (!text) throw new Error('Invalid text');
  const status = body.status ?? 'active';
  if (!MEMORY_STATUSES.has(status)) throw new Error('Invalid status');
  const sourceChatId = body.source_chat_id ? requireId(body.source_chat_id) : null;
  const sourceChatName = cleanText(body.source_chat_name || '', 'source_chat_name', 300);
  const timestamp = now();
  const createdAt = cleanDate(body.created_at) || timestamp;
  // Source and creation date are fixed at insert; edits only change kind, text and status.
  await env.DB.prepare(`INSERT INTO memory_items (id, owner_id, kind, text, status, source_chat_id, source_chat_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET kind=excluded.kind, text=excluded.text, status=excluded.status, updated_at=excluded.updated_at WHERE memory_items.owner_id=excluded.owner_id`).bind(id, owner, body.kind, text, status, sourceChatId, sourceChatName, createdAt, timestamp).run();
  const row = await env.DB.prepare('SELECT * FROM memory_items WHERE id = ? AND owner_id = ?').bind(id, owner).first();
  if (!row) throw new Error('Invalid id');
  return memoryRow(row);
}

async function handleMemory(request, env, owner, parts, headers) {
  try {
    if (request.method === 'GET' && parts.length === 1) return json({ memory: await listMemory(env, owner) }, 200, headers);
    if (request.method === 'PUT' && parts.length === 2) return json(await putMemory(env, parts[1], owner, await readBody(request)), 200, headers);
    if (request.method === 'DELETE' && parts.length === 2) {
      requireId(parts[1]);
      await env.DB.prepare('DELETE FROM memory_items WHERE id = ? AND owner_id = ?').bind(parts[1], owner).run();
      return json({ ok: true }, 200, headers);
    }
    return fail('Method not allowed', 405, headers);
  } catch (error) { return fail(error.message || 'D1 error', 400, headers); }
}

// "Contexto sobre mí": short stable profile, at most 5 lines.
const PROFILE_MAX_CHARS = 800;
const PROFILE_MAX_LINES = 5;

async function handleProfile(request, env, owner, parts, headers) {
  try {
    if (parts.length !== 1) return fail('Not found', 404, headers);
    if (request.method === 'GET') {
      const row = await env.DB.prepare('SELECT text, updated_at FROM memory_profile WHERE owner_id = ?').bind(owner).first();
      return json({ profile: row ? { text: row.text, updated_at: row.updated_at } : null }, 200, headers);
    }
    if (request.method === 'PUT') {
      const body = await readBody(request);
      const lines = String(body.text ?? '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      if (lines.length > PROFILE_MAX_LINES) throw new Error(`El perfil admite como máximo ${PROFILE_MAX_LINES} líneas`);
      const text = cleanText(lines.join('\n'), 'profile', PROFILE_MAX_CHARS);
      const timestamp = now();
      await env.DB.prepare('INSERT INTO memory_profile (owner_id, text, updated_at) VALUES (?, ?, ?) ON CONFLICT(owner_id) DO UPDATE SET text=excluded.text, updated_at=excluded.updated_at').bind(owner, text, timestamp).run();
      return json({ profile: { text, updated_at: timestamp } }, 200, headers);
    }
    return fail('Method not allowed', 405, headers);
  } catch (error) { return fail(error.message || 'D1 error', 400, headers); }
}

export default {
  async fetch(request, env) {
    const headers = corsHeaders(request, env);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    const url = new URL(request.url);
    if (url.pathname === '/health' && request.method === 'GET') return json({ ok: true, service: 'cloudflare-d1-r2-backend' }, 200, headers);
    const owner = ownerFromRequest(request, env);
    if (!owner) return fail('Unauthorized', 401);

    if (url.pathname === '/import' && request.method === 'POST') {
      try {
        const body = await readBody(request);
        const chats = Array.isArray(body.chats) ? body.chats : [];
        const folders = Array.isArray(body.folders) ? body.folders : [];
        for (const f of folders) {
          await put(env, 'folders', f.id, owner, f);
        }
        for (const c of chats) {
          await put(env, 'chats', c.id, owner, c);
        }
        if (env.STORAGE) {
          await env.STORAGE.put(`backups/${owner}/snapshot.json`, JSON.stringify({ owner, chats, folders, updated_at: now() }, null, 2), {
            httpMetadata: { contentType: 'application/json' }
          });
        }
        return json({ ok: true, importedChats: chats.length, importedFolders: folders.length }, 200, headers);
      } catch (err) {
        return fail(err.message || 'Import error', 400);
      }
    }

    const parts = url.pathname.split('/').filter(Boolean);
    if (parts[0] === 'memory') return handleMemory(request, env, owner, parts, headers);
    if (parts[0] === 'profile') return handleProfile(request, env, owner, parts, headers);
    if (parts.length < 1 || !['chats', 'folders'].includes(parts[0])) return fail('Not found', 404);
    const table = parts[0];
    try {
      if (request.method === 'GET' && parts.length === 1) return json({ [table]: await list(env, table, owner) }, 200, headers);
      if (request.method === 'PUT' && parts.length === 2) return json(await put(env, table, parts[1], owner, await readBody(request)), 200, headers);
      if (request.method === 'DELETE' && parts.length === 2) {
        requireId(parts[1]);
        await env.DB.prepare(`DELETE FROM ${table} WHERE id = ? AND owner_id = ?`).bind(parts[1], owner).run();
        if (env.STORAGE) {
          try {
            await env.STORAGE.delete(`${table}/${owner}/${parts[1]}.json`);
          } catch (e) {}
        }
        return json({ ok: true }, 200, headers);
      }
      return fail('Method not allowed', 405);
    } catch (error) { return fail(error.message || 'D1 error', error.message === 'Unauthorized' ? 401 : 400); }
  },
};

export { chatRow, folderRow, memoryRow, ownerFromRequest };
