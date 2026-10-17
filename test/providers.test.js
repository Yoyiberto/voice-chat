const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveLlm, describeProvider } = require('../lib/providers');
const { runPipeline } = require('../lib/pipeline');
const { transcribeAudio, transcribeRequest } = require('../lib/transcription');

function response(body, ok = true, status = 200) {
  return { ok, status, json: async () => body };
}

const openaiReply = { choices: [{ message: { content: 'hola desde el proveedor' } }] };

test('resolveLlm reads explicit providers, prefixes and bare OpenRouter ids', () => {
  assert.deepEqual(resolveLlm({ model: 'deepseek/deepseek-v4.1-flash' }), { provider: 'openrouter', model: 'deepseek/deepseek-v4.1-flash' });
  assert.deepEqual(resolveLlm({ model: 'anthropic:claude-sonnet-5-5' }), { provider: 'anthropic', model: 'claude-sonnet-5-5' });
  assert.deepEqual(resolveLlm({ llmProvider: 'groq', model: 'openai/gpt-oss-120b' }), { provider: 'groq', model: 'openai/gpt-oss-120b' });
  assert.deepEqual(resolveLlm({ model: 'meta-llama/llama-4:free' }), { provider: 'openrouter', model: 'meta-llama/llama-4:free' });
  assert.equal(resolveLlm({}, { OPENROUTER_TEXT_MODEL: 'x/y' }).model, 'x/y');
});

test('pipeline sends Anthropic requests in the Messages API shape', async () => {
  const calls = [];
  const result = await runPipeline({
    body: { sessionId: 'anthropic', message: 'hola', systemPrompt: 'Sé breve', llmProvider: 'anthropic', model: 'claude-sonnet-5-5', anthropicApiKey: 'sk-ant-browser' },
    sessions: {},
    env: {},
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return response({ stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: 'respuesta claude' }] });
    },
  });
  assert.equal(result.reply, 'respuesta claude');
  assert.equal(result.provider.completion, 'Anthropic');
  assert.equal(calls[0].url, 'https://api.anthropic.com/v1/messages');
  assert.equal(calls[0].init.headers['x-api-key'], 'sk-ant-browser');
  assert.equal(calls[0].init.headers['anthropic-version'], '2023-06-01');
  assert.equal(calls[0].init.headers['anthropic-beta'], 'server-side-fallback-2026-07-01');
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.system, 'Sé breve');
  assert.deepEqual(body.messages, [{ role: 'user', content: 'hola' }]);
  assert.equal(body.fallbacks, 'default');
  assert.deepEqual(body.output_config, { effort: 'low' });
  assert.equal('temperature' in body, false);
});

test('Anthropic refusals surface as an error and roll back the turn', async () => {
  const sessions = {};
  await assert.rejects(runPipeline({
    body: { sessionId: 'refusal', message: 'x', model: 'anthropic:claude-haiku-5-5', anthropicApiKey: 'sk-ant-r' },
    sessions,
    env: {},
    fetchImpl: async (url, init) => {
      const body = JSON.parse(init.body);
      assert.equal('fallbacks' in body, false); // Haiku 5.5 has no server-side fallback
      return response({ stop_reason: 'refusal', content: [] });
    },
  }), /rechazó/);
  assert.deepEqual(sessions.refusal, []);
});

test('OpenAI, Groq and Google use their chat endpoints without OpenRouter params', async () => {
  const cases = [
    ['openai', 'gpt-5.6-luna', 'https://api.openai.com/v1/chat/completions', { OPENAI_API_KEY: 'k-openai' }],
    ['groq', 'openai/gpt-oss-120b', 'https://api.groq.com/openai/v1/chat/completions', { GROQ_API_KEY: 'k-groq' }],
    ['google', 'gemini-3.1-flash-lite', 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', { GEMINI_API_KEY: 'k-google' }],
  ];
  for (const [provider, model, url, env] of cases) {
    const calls = [];
    const result = await runPipeline({
      body: { sessionId: `p-${provider}`, message: 'hola', llmProvider: provider, model, webSearch: true },
      sessions: {},
      env,
      fetchImpl: async (u, init) => { calls.push({ url: u, init }); return response(openaiReply); },
    });
    assert.equal(calls[0].url, url, provider);
    const body = JSON.parse(calls[0].init.body);
    assert.equal(body.model, model);
    assert.equal('tools' in body, false, `${provider} must not get the OpenRouter web search tool`);
    assert.equal('reasoning' in body, false);
    assert.equal(result.provider.webSearch, false);
    if (provider === 'openai') {
      assert.equal(body.max_completion_tokens, 4096);
      assert.equal('temperature' in body, false);
    }
  }
});

test('an expired server key falls back to the browser key', async () => {
  const calls = [];
  const result = await runPipeline({
    body: { sessionId: 'fallback', message: 'hola', openrouterApiKey: 'or_browser_fresh' },
    sessions: {},
    env: { OPENROUTER_API_KEY: 'or_server_expired' },
    fetchImpl: async (url, init) => {
      calls.push(init.headers.Authorization);
      if (init.headers.Authorization === 'Bearer or_server_expired') return response({ error: { message: 'User not found' } }, false, 401);
      return response(openaiReply);
    },
  });
  assert.equal(result.reply, 'hola desde el proveedor');
  assert.deepEqual(calls, ['Bearer or_server_expired', 'Bearer or_browser_fresh']);
});

test('non-auth provider errors do not retry with another key', async () => {
  let count = 0;
  await assert.rejects(runPipeline({
    body: { sessionId: 'no-retry', message: 'hola', openrouterApiKey: 'or_b_503' },
    sessions: {},
    env: { OPENROUTER_API_KEY: 'or_s_503' },
    fetchImpl: async () => { count++; return response({ error: { message: 'provider down' } }, false, 503); },
  }), /provider down/);
  assert.equal(count, 1);
});

test('missing keys produce a clear 401', async () => {
  await assert.rejects(runPipeline({
    body: { sessionId: 'nokey', message: 'hola', llmProvider: 'anthropic' },
    sessions: {},
    env: {},
    fetchImpl: async () => { throw new Error('called'); },
  }), (error) => error.status === 401 && /Anthropic/.test(error.message));
});

test('OpenAI transcription uses the OpenAI endpoint and model', async () => {
  const calls = [];
  const text = await transcribeAudio({
    provider: 'openai',
    audioBase64: Buffer.from('a').toString('base64'),
    audioMimeType: 'audio/wav',
    apiKey: 'sk-openai',
    fetchImpl: async (url, init) => { calls.push({ url, init }); return response({ text: ' hola ' }); },
  });
  assert.equal(text, 'hola');
  assert.equal(calls[0].url, 'https://api.openai.com/v1/audio/transcriptions');
  assert.equal(calls[0].init.body.get('model'), 'gpt-4o-mini-transcribe');
});

test('Gemini transcription sends inline audio to generateContent', async () => {
  const calls = [];
  const text = await transcribeRequest({
    body: { sttProvider: 'google', sttModel: 'gemini-3.5-transcribe', audioBase64: Buffer.from('a').toString('base64'), audioMimeType: 'audio/wav' },
    env: { GEMINI_API_KEY: 'k-gem' },
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return response({ candidates: [{ content: { parts: [{ text: 'texto transcrito' }] } }] });
    },
  });
  assert.equal(text, 'texto transcrito');
  assert.match(calls[0].url, /models\/gemini-3\.5-transcribe:generateContent$/);
  assert.equal(calls[0].init.headers['x-goog-api-key'], 'k-gem');
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.contents[0].parts[0].inlineData.mimeType, 'audio/wav');
});

test('Gemini transcribe models answer with audioTranscription parts', async () => {
  const text = await transcribeAudio({
    provider: 'google',
    model: 'gemini-3.5-transcribe',
    audioBase64: Buffer.from('a').toString('base64'),
    audioMimeType: 'audio/wav',
    apiKey: 'k-gem-at',
    fetchImpl: async () => response({ candidates: [{ content: { parts: [{ audioTranscription: { text: ' hola mundo ' } }] } }] }),
  });
  assert.equal(text, 'hola mundo');
});

test('quota errors become a short message with the provider retry delay', async () => {
  await assert.rejects(transcribeAudio({
    provider: 'google',
    audioBase64: Buffer.from('a').toString('base64'),
    apiKey: 'k-gem-429',
    fetchImpl: async () => response({ error: { message: 'You exceeded your current quota ... Please retry in 4.53s.' } }, false, 429),
  }), (error) => error.status === 429 && error.retryAfterMs === 4530 && error.message.length < 80);
});

test('transcribeRequest falls back from an expired Groq env key to the browser key', async () => {
  const seen = [];
  const text = await transcribeRequest({
    body: { audioBase64: Buffer.from('a').toString('base64'), audioMimeType: 'audio/wav', groqApiKey: 'gsk_new_browser' },
    env: { GROQ_API_KEY: 'gsk_old_expired' },
    fetchImpl: async (url, init) => {
      seen.push(init.headers.Authorization);
      if (init.headers.Authorization === 'Bearer gsk_old_expired') return response({ error: { message: 'Invalid API Key' } }, false, 401);
      return response({ text: 'ok' });
    },
  });
  assert.equal(text, 'ok');
  assert.deepEqual(seen, ['Bearer gsk_old_expired', 'Bearer gsk_new_browser']);
});

test('describeProvider reports the working key source and never the key', async () => {
  const result = await describeProvider({
    provider: 'groq',
    body: { groqApiKey: 'gsk_desc_browser' },
    env: { GROQ_API_KEY: 'gsk_desc_server_bad' },
    fetchImpl: async (url, init) => {
      if (init.headers.Authorization === 'Bearer gsk_desc_server_bad') return response({ error: { message: 'Invalid API Key' } }, false, 401);
      return response({ data: [{ id: 'llama-4' }, { id: 'whisper-large-v3' }] });
    },
  });
  assert.deepEqual(result.key, { ok: true, source: 'browser' });
  assert.deepEqual(result.models.map((m) => m.id), ['llama-4']);
  assert.equal(JSON.stringify(result).includes('gsk_desc'), false);
});
