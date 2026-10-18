const test = require('node:test');
const assert = require('node:assert/strict');
const memory = require('../lib/memory');
const { runPipeline } = require('../lib/pipeline');

const DAY = 86_400_000;
const NOW = Date.parse('2026-10-17T12:00:00Z');
const iso = (daysAgo) => new Date(NOW - daysAgo * DAY).toISOString();

test('close command detects short "cierra" phrases only', () => {
  for (const text of ['cierra', 'Cierra.', 'Ok, cierra.', 'Bueno, ciérralo por favor', 'cierra la conversación', 'Cerremos aquí.']) {
    assert.equal(memory.isCloseCommand(text), true, text);
  }
  for (const text of ['', 'cierra la puerta del garaje antes de salir', 'no sé si la tienda cierra a las ocho', 'hola', 'quiero cerrar el trato con Ana mañana temprano']) {
    assert.equal(memory.isCloseCommand(text), false, text);
  }
});

test('memory block is capped at 6 items and 100 words', () => {
  const items = Array.from({ length: 40 }, (_, i) => ({ id: `m${i}`, kind: 'paso', text: 'uno dos tres cuatro cinco seis siete ocho nueve diez once doce', created_at: iso(i) }));
  const { block, ids } = memory.buildMemoryContext({ memory: items, query: '', now: NOW });
  assert.ok(ids.length > 0 && ids.length <= memory.MAX_BLOCK_ITEMS);
  const itemWords = block.split('\n').filter((line) => line.startsWith('- [')).map((line) => line.replace(/^- \[[^\]]+\] /, '')).join(' ').split(/\s+/).length;
  assert.ok(itemWords <= memory.MAX_BLOCK_WORDS, `words=${itemWords}`);
  assert.match(block, /solo cuando aporte/);
});

test('memory selection prefers relevant and recent open loops, ignores bad input', () => {
  const items = [
    { id: 'old', kind: 'patron', text: 'Se dispersa entre muchos proyectos', created_at: iso(60) },
    { id: 'ana', kind: 'paso', text: 'Hablar con Ana del presupuesto del viaje', created_at: iso(7) },
    { id: 'bad', kind: 'otro', text: 'no debe entrar' },
    { id: 'empty', kind: 'paso', text: '   ' },
  ];
  const { block, ids } = memory.buildMemoryContext({ memory: items, query: 'Hoy pensé otra vez en el presupuesto', now: NOW });
  assert.deepEqual(ids, ['ana']);
  assert.match(block, /\[paso prometido, hace 7 días\] Hablar con Ana/);
  assert.equal(memory.buildMemoryContext({ memory: items, query: 'Me disperso entre proyectos', now: NOW }).ids.join(), 'old,ana');
  assert.doesNotMatch(block, /no debe entrar/);
  assert.equal(memory.buildMemoryContext({ memory: 'nope', query: 'x' }).block, '');
});

test('extraction output is parsed, normalized and bounded', () => {
  const content = '```json\n{"items":[{"tipo":"Decisión","texto":"Programar máximo una hora"},{"tipo":"pregunta abierta","texto":"¿Dejar el trabajo fijo?"},{"tipo":"patrón","texto":"Programar máximo una hora"},{"tipo":"nada","texto":"x"},{"tipo":"paso","texto":"a"},{"tipo":"paso","texto":"b"},{"tipo":"paso","texto":"c"},{"tipo":"paso","texto":"d"}],"resueltos":["m1","inventado"]}\n```';
  const result = memory.parseExtraction(content, new Set(['m1']));
  assert.equal(result.items.length, 5);
  assert.deepEqual(result.items[0], { kind: 'decision', text: 'Programar máximo una hora' });
  assert.equal(result.items[1].kind, 'pregunta');
  assert.deepEqual(result.resolved, ['m1']);
});

test('extractMemory uses the fixed server model and a bounded transcript', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push(JSON.parse(init.body));
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '{"items":[{"tipo":"paso","texto":"Llamar a Luis el lunes"}],"resueltos":[]}' } }] }) };
  };
  const messages = [{ role: 'user', text: 'x'.repeat(20_000) }, { role: 'model', text: 'Llama a Luis el lunes.' }];
  const result = await memory.extractMemory({ body: { messages, model: 'openai/gpt-expensive', existing: [] }, env: { OPENROUTER_API_KEY: 'k' }, fetchImpl });
  assert.equal(calls[0].model, memory.MEMORY_MODEL);
  assert.ok(calls[0].messages[1].content.length < 15_000);
  assert.ok(calls[0].max_tokens <= 600);
  assert.deepEqual(result.items, [{ kind: 'paso', text: 'Llamar a Luis el lunes' }]);
  await assert.rejects(memory.extractMemory({ body: { messages: [] }, env: { OPENROUTER_API_KEY: 'k' }, fetchImpl }), /vacía/);
});

test('pipeline appends memory and close instruction to the system prompt', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push(JSON.parse(init.body));
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'ok' } }] }) };
  };
  const result = await runPipeline({
    body: { sessionId: 'mem', message: 'Ok, cierra.', systemPrompt: 'Base', profile: 'Ingeniero de robótica en Lima', memory: [{ id: 'm1', kind: 'paso', text: 'Hablar con Ana', created_at: new Date().toISOString() }] },
    sessions: {},
    env: { OPENROUTER_API_KEY: 'k' },
    fetchImpl,
  });
  const system = calls[0].messages[0].content;
  assert.match(system, /^Base\n\nContexto sobre mí/);
  assert.match(system, /Perfil:\n- Ingeniero de robótica en Lima\nMemoria relacionada/);
  assert.match(system, /\[paso prometido, hoy\] Hablar con Ana/);
  assert.match(system, /decir «cierra»/);
  assert.equal(result.closeCommand, true);
  assert.deepEqual(result.memory.ids, ['m1']);

  calls.length = 0;
  const plain = await runPipeline({ body: { sessionId: 'plain', message: 'hola', systemPrompt: 'Base' }, sessions: {}, env: { OPENROUTER_API_KEY: 'k' }, fetchImpl });
  assert.equal(calls[0].messages[0].content, 'Base');
  assert.equal(plain.closeCommand, false);
});

test('profile is capped at 5 lines / 80 words and can stand alone', () => {
  const profile = memory.sanitizeProfile('- uno\n\n* dos\n• tres\ncuatro\ncinco\nseis');
  assert.deepEqual(profile, ['uno', 'dos', 'tres', 'cuatro', 'cinco']);
  const long = Array.from({ length: 5 }, () => 'palabra '.repeat(30)).join('\n');
  assert.ok(memory.sanitizeProfile(long).join(' ').split(/\s+/).length <= 80);
  const { block, ids } = memory.buildMemoryContext({ memory: [], profile: 'Prefiere respuestas cortas', query: '' });
  assert.deepEqual(ids, []);
  assert.match(block, /^Contexto sobre mí/);
  assert.match(block, /Perfil:\n- Prefiere respuestas cortas$/);
  assert.doesNotMatch(block, /Memoria relacionada/);
  assert.equal(memory.buildMemoryContext({ memory: [{ id: 'x', kind: 'paso', text: 'Hecho ya', status: 'done' }], profile: '' }).block, '');
});

test('import output keeps a short profile and at most 8 items', () => {
  const items = Array.from({ length: 12 }, (_, i) => ({ tipo: 'patron', texto: `Patrón ${i}` }));
  const result = memory.parseImport(JSON.stringify({ perfil: ['Ingeniero en Lima', 'Habla en español neutro', '', 'a', 'b', 'c', 'd'], items }));
  assert.equal(result.profile.length, 5);
  assert.equal(result.items.length, 8);
});

test('consolidation only uses known ids, once each, and prunes old done items', () => {
  const items = memory.sanitizeMemoryItems([
    { id: 'a', kind: 'paso', text: 'Llamar a Luis', created_at: iso(2) },
    { id: 'b', kind: 'paso', text: 'Llamar a Luis el lunes', created_at: iso(1) },
    { id: 'c', kind: 'decision', text: 'Dormir antes de las 12', created_at: iso(5) },
    { id: 'old', kind: 'paso', text: 'Algo viejo', status: 'done', created_at: iso(40) },
    { id: 'recent', kind: 'paso', text: 'Algo hecho ayer', status: 'done', created_at: iso(1) },
  ]);
  const content = JSON.stringify({
    fusionar: [{ ids: ['a', 'b', 'zzz'], tipo: 'paso', texto: 'Llamar a Luis el lunes' }, { ids: ['c'], tipo: 'decision', texto: 'solo uno' }],
    borrar: [{ id: 'a', motivo: 'ya fusionado' }, { id: 'c', motivo: 'Contradicho' }, { id: 'nope' }],
  });
  const result = memory.parseConsolidation(content, items, NOW);
  assert.deepEqual(result.merge, [{ ids: ['a', 'b'], kind: 'paso', text: 'Llamar a Luis el lunes' }]);
  assert.deepEqual(result.remove.map((r) => r.id), ['c', 'old']);
  assert.equal(result.remove[1].reason, 'Hecho hace más de 3 semanas');
});

test('import mode uses the fixed model and bounded input', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push(JSON.parse(init.body));
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '{"perfil":["Ingeniero en Lima"],"items":[]}' } }] }) };
  };
  const result = await memory.extractMemory({ body: { mode: 'import', source: 'ChatGPT', text: 'y'.repeat(50_000), model: 'x/expensive' }, env: { OPENROUTER_API_KEY: 'k' }, fetchImpl });
  assert.equal(calls[0].model, memory.MEMORY_MODEL);
  assert.ok(calls[0].messages[1].content.length < 21_000);
  assert.deepEqual(result.profile, ['Ingeniero en Lima']);
  await assert.rejects(memory.extractMemory({ body: { mode: 'import', text: '  ' }, env: { OPENROUTER_API_KEY: 'k' }, fetchImpl }), /No hay texto/);
});

test('imported goals stay out unless the message touches them', () => {
  const items = [
    { id: 'b2', kind: 'paso', text: 'Obtener certificación oficial de francés B2 para el CV', created_at: iso(1), origin: 'import' },
    { id: 'phd', kind: 'decision', text: 'Empezar un doctorado como base para empresas de robótica', created_at: iso(1), origin: 'import' },
  ];
  assert.deepEqual(memory.buildMemoryContext({ memory: items, query: 'Dudo entre dos suscripciones de 20 o una de 100', now: NOW }).ids, []);
  const { block, ids } = memory.buildMemoryContext({ memory: items, query: 'Tengo que preparar el certificado de francés', now: NOW });
  assert.deepEqual(ids, ['b2']);
  assert.match(block, /\[objetivo de fondo\] Obtener certificación/);
  assert.doesNotMatch(block, /\[paso prometido/);
});

test('a pinned pick from the first turn is not filtered again', () => {
  const items = [{ id: 'phd', kind: 'decision', text: 'Empezar un doctorado en robótica', created_at: iso(3), origin: 'import' }];
  assert.deepEqual(memory.buildMemoryContext({ memory: items, query: 'otra cosa distinta', now: NOW }).ids, []);
  assert.deepEqual(memory.buildMemoryContext({ memory: items, query: 'otra cosa distinta', pinned: true, now: NOW }).ids, ['phd']);
});
