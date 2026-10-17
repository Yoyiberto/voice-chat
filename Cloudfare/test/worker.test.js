import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';

function fakeDb() {
  const rows = { chats: new Map(), folders: new Map() };
  return {
    rows,
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async all() {
              const table = sql.includes('FROM chats') ? 'chats' : 'folders';
              return { results: [...rows[table].values()].filter((r) => r.owner_id === args[0]).sort((a, b) => b.updated_at.localeCompare(a.updated_at)) };
            },
            async first() {
              const table = sql.includes('FROM chats') ? 'chats' : 'folders';
              return [...rows[table].values()].find((r) => r.id === args[0] && r.owner_id === args[1]) || null;
            },
            async run() {
              const table = sql.includes('chats') ? 'chats' : 'folders';
              if (sql.startsWith('DELETE')) {
                rows[table].delete(args[0]);
              } else {
                const old = rows[table].get(args[0]);
                const values = table === 'chats'
                  ? ['id', 'owner_id', 'folder_id', 'emoji', 'name', 'system_prompt', 'messages_json', 'created_at', 'updated_at']
                  : ['id', 'owner_id', 'emoji', 'name', 'system_prompt', 'created_at', 'updated_at'];
                rows[table].set(args[0], Object.fromEntries(values.map((key, index) => [key, args[index]])));
                if (old) rows[table].get(args[0]).created_at = old.created_at;
              }
              return { success: true };
            },
          };
        },
      };
    },
  };
}

const env = () => ({ DB: fakeDb(), D1_TEST_OWNER: 'alice' });
const req = (path, method = 'GET', body) => new Request(`https://example.test${path}`, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });

test('health endpoint works', async () => { const response = await worker.fetch(req('/health'), env()); assert.equal(response.status, 200); assert.equal((await response.json()).ok, true); });
test('chat and folder CRUD is owner-scoped', async () => {
  const e = env();
  let response = await worker.fetch(req('/folders/f1', 'PUT', { name: 'Ideas' }), e); assert.equal(response.status, 200);
  response = await worker.fetch(req('/chats/c1', 'PUT', { name: 'Test chat', messages: [{ role: 'user', text: 'Hola' }], folder_id: 'f1' }), e); assert.equal((await response.json()).messages.length, 1);
  response = await worker.fetch(req('/chats'), e); const list = await response.json(); assert.equal(list.chats.length, 1); assert.equal(list.chats[0].folder_id, 'f1');
  response = await worker.fetch(req('/chats/c1', 'DELETE'), e); assert.equal((await response.json()).ok, true);
  response = await worker.fetch(req('/chats'), e); assert.equal((await response.json()).chats.length, 0);
});
test('invalid identifiers and oversized messages are rejected', async () => { const e = env(); assert.equal((await worker.fetch(req('/chats/not valid', 'PUT', { name: 'x' }), e)).status, 400); assert.equal((await worker.fetch(req('/chats/c2', 'PUT', { name: 'x', messages: ['x'.repeat(900001)] }), e)).status, 400); });

function fakeMemoryDb() {
  const rows = new Map();
  const cols = ['id', 'owner_id', 'kind', 'text', 'status', 'source_chat_id', 'source_chat_name', 'created_at', 'updated_at'];
  return {
    rows,
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async all() { return { results: [...rows.values()].filter((r) => r.owner_id === args[0]).sort((a, b) => b.created_at.localeCompare(a.created_at)) }; },
            async first() { return [...rows.values()].find((r) => r.id === args[0] && r.owner_id === args[1]) || null; },
            async run() {
              if (sql.startsWith('DELETE')) {
                if (rows.get(args[0])?.owner_id === args[1]) rows.delete(args[0]);
                return { success: true };
              }
              const next = Object.fromEntries(cols.map((key, index) => [key, args[index]]));
              const old = rows.get(args[0]);
              if (!old) rows.set(args[0], next);
              else if (old.owner_id === next.owner_id) Object.assign(old, { kind: next.kind, text: next.text, status: next.status, updated_at: next.updated_at });
              return { success: true };
            },
          };
        },
      };
    },
  };
}

test('memory items CRUD is owner-scoped and validated', async () => {
  const db = fakeMemoryDb();
  const alice = { DB: db, D1_TEST_OWNER: 'alice' };
  const bob = { DB: db, D1_TEST_OWNER: 'bob' };
  let response = await worker.fetch(req('/memory/m1', 'PUT', { kind: 'paso', text: ' Hablar con Ana ', source_chat_id: 'chat_1', source_chat_name: 'Chat 1', created_at: '2026-10-10T10:00:00.000Z' }), alice);
  assert.equal(response.status, 200);
  const saved = await response.json();
  assert.equal(saved.text, 'Hablar con Ana');
  assert.equal(saved.status, 'active');
  assert.equal(saved.created_at, '2026-10-10T10:00:00.000Z');
  response = await worker.fetch(req('/memory/m1', 'PUT', { kind: 'paso', text: 'Hablar con Ana', status: 'done', created_at: '2030-01-01T00:00:00.000Z' }), alice);
  assert.equal((await response.json()).created_at, '2026-10-10T10:00:00.000Z');
  assert.equal(db.rows.get('m1').status, 'done');
  // Another owner can neither read, overwrite nor delete it.
  assert.equal((await (await worker.fetch(req('/memory'), bob)).json()).memory.length, 0);
  assert.equal((await worker.fetch(req('/memory/m1', 'PUT', { kind: 'paso', text: 'hack' }), bob)).status, 400);
  await worker.fetch(req('/memory/m1', 'DELETE'), bob);
  assert.equal(db.rows.get('m1').text, 'Hablar con Ana');
  assert.equal((await worker.fetch(req('/memory/m2', 'PUT', { kind: 'otro', text: 'x' }), alice)).status, 400);
  assert.equal((await worker.fetch(req('/memory/m2', 'PUT', { kind: 'paso', text: '   ' }), alice)).status, 400);
  assert.equal((await worker.fetch(req('/memory/m2', 'PUT', { kind: 'paso', text: 'x'.repeat(401) }), alice)).status, 400);
  response = await worker.fetch(req('/memory'), alice);
  assert.equal((await response.json()).memory.length, 1);
  await worker.fetch(req('/memory/m1', 'DELETE'), alice);
  assert.equal(db.rows.size, 0);
});

test('profile is one short row per owner', async () => {
  const rows = new Map();
  const DB = {
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async first() { return rows.get(args[0]) || null; },
            async run() { rows.set(args[0], { text: args[1], updated_at: args[2] }); return { success: true }; },
          };
        },
      };
    },
  };
  const alice = { DB, D1_TEST_OWNER: 'alice' };
  assert.equal((await (await worker.fetch(req('/profile'), alice)).json()).profile, null);
  let response = await worker.fetch(req('/profile', 'PUT', { text: ' Ingeniero en Lima \n\n Le importa dormir bien ' }), alice);
  assert.equal((await response.json()).profile.text, 'Ingeniero en Lima\nLe importa dormir bien');
  assert.equal((await (await worker.fetch(req('/profile'), { DB, D1_TEST_OWNER: 'bob' })).json()).profile, null);
  response = await worker.fetch(req('/profile', 'PUT', { text: '1\n2\n3\n4\n5\n6' }), alice);
  assert.equal(response.status, 400);
  assert.equal(rows.get('alice').text, 'Ingeniero en Lima\nLe importa dormir bien');
});
