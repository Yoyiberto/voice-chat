const test = require('node:test');
const assert = require('node:assert/strict');
const { runPipeline } = require('../lib/pipeline');

function response(body, ok = true, status = 200) {
  return { ok, status, json: async () => body };
}

function fakeFetch(calls, options = {}) {
  return async (url, init) => {
    calls.push({ url, init });
    if (url.includes('groq.com')) return response(options.groq || { text: 'transcripción de prueba' }, options.groqOk !== false, options.groqStatus || 200);
    return response(options.openrouter || { choices: [{ message: { content: 'respuesta de prueba' } }] }, options.openrouterOk !== false, options.openrouterStatus || 200);
  };
}

test('pipeline transcribes audio and sends text-only history to OpenRouter', async () => {
  const calls = [];
  const sessions = {};
  const result = await runPipeline({
    body: { sessionId: 'one', audioBase64: Buffer.from('audio').toString('base64'), audioMimeType: 'audio/webm', audioDuration: 2, model: 'openai/gpt-5.6-luna' },
    sessions,
    env: { GROQ_API_KEY: 'gsk_test', OPENROUTER_API_KEY: 'or_test' },
    fetchImpl: fakeFetch(calls),
  });
  assert.equal(result.transcript, 'transcripción de prueba');
  assert.equal(result.reply, 'respuesta de prueba');
  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /groq\.com/);
  const openrouterBody = JSON.parse(calls[1].init.body);
  assert.equal(openrouterBody.messages.at(-1).content, 'transcripción de prueba');
  assert.equal(openrouterBody.model, 'openai/gpt-5.6-luna');
  assert.equal(typeof openrouterBody.messages.at(-1).content, 'string');
  assert.equal(sessions.one[0].parts[0].text, 'transcripción de prueba');
});

test('text-only pipeline skips Groq', async () => {
  const calls = [];
  const result = await runPipeline({
    body: { sessionId: 'two', message: 'hola' },
    sessions: {},
    env: { OPENROUTER_API_KEY: 'or_test' },
    fetchImpl: fakeFetch(calls),
  });
  assert.equal(result.transcript, 'hola');
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /openrouter/);
});

test('web search is disabled by default and sends no tools', async () => {
  const calls = [];
  await runPipeline({
    body: { sessionId: 'no-search', message: 'hello' },
    sessions: {},
    env: { OPENROUTER_API_KEY: 'or_test' },
    fetchImpl: fakeFetch(calls),
  });
  const request = JSON.parse(calls[0].init.body);
  assert.equal('tools' in request, false);
  assert.equal('max_tool_calls' in request, false);
});

test('web search sends the server tool and provider metadata', async () => {
  const calls = [];
  const annotations = [{ type: 'url_citation', url_citation: { url: 'https://example.com' } }];
  const usage = { input_tokens: 10, output_tokens: 20, server_tool_use: { web_search_requests: 2 } };
  const result = await runPipeline({
    body: {
      sessionId: 'search',
      message: 'latest news',
      webSearch: true,
      webSearchOptions: {
        engine: 'exa', max_results: 3, max_uses: 2, max_total_results: 5,
        allowed_domains: ['example.com'], excluded_domains: ['ads.example.com'],
      },
    },
    sessions: {},
    env: { OPENROUTER_API_KEY: 'or_test' },
    fetchImpl: fakeFetch(calls, {
      openrouter: {
        choices: [{ message: { content: 'grounded answer', annotations } }],
        usage,
      },
    }),
  });
  const request = JSON.parse(calls[0].init.body);
  assert.deepEqual(request.tools, [{
    type: 'openrouter:web_search',
    parameters: {
      engine: 'exa', max_results: 3, max_uses: 2, max_total_results: 5,
      allowed_domains: ['example.com'], excluded_domains: ['ads.example.com'],
    },
  }]);
  assert.equal(request.max_tool_calls, 2);
  assert.equal(result.provider.webSearch, true);
  assert.equal(result.provider.model, 'openai/gpt-5.6-luna');
  assert.equal(result.provider.searchRequests, 2);
  assert.deepEqual(result.provider.citations, [{
    type: 'url_citation',
    url: 'https://example.com',
    title: 'https://example.com',
    content: '',
    startIndex: null,
    endIndex: null,
  }]);
  assert.deepEqual(result.provider.usage, usage);
});

test('uses API keys supplied by the web app', async () => {
  const calls = [];
  await runPipeline({
    body: {
      sessionId: 'keys',
      message: 'key test',
      groqApiKey: 'gsk_from_browser',
      openrouterApiKey: 'or_from_browser',
    },
    sessions: {},
    env: {},
    fetchImpl: fakeFetch(calls),
  });
  assert.equal(calls[0].url.includes('groq.com'), false);
  assert.equal(calls[0].init.headers.Authorization, 'Bearer or_from_browser');
});

test('prefers server environment keys over stale browser keys', async () => {
  const calls = [];
  await runPipeline({
    body: {
      sessionId: 'server-key-wins',
      message: 'server key test',
      groqApiKey: 'stale_browser_groq',
      openrouterApiKey: 'stale_browser_openrouter',
    },
    sessions: {},
    env: { OPENROUTER_API_KEY: 'server_openrouter' },
    fetchImpl: fakeFetch(calls),
  });
  assert.equal(calls[0].init.headers.Authorization, 'Bearer server_openrouter');
});

test('rejects recordings over 90 seconds before calling providers', async () => {
  await assert.rejects(
    runPipeline({ body: { sessionId: 'three', audioBase64: 'YQ==', audioDuration: 91 }, sessions: {}, fetchImpl: fakeFetch([]) }),
    /90 seconds/,
  );
});

test('rolls back the user turn when OpenRouter fails', async () => {
  const sessions = {};
  await assert.rejects(runPipeline({
    body: { sessionId: 'four', message: 'rollback' },
    sessions,
    env: { OPENROUTER_API_KEY: 'or_test' },
    fetchImpl: fakeFetch([], { openrouterOk: false, openrouter: { error: { message: 'provider down' } }, openrouterStatus: 503 }),
  }), /provider down/);
  assert.deepEqual(sessions.four, []);
});
