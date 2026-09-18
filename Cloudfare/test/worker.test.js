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
