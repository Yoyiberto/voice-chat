const DEFAULT_TEXT_MODEL = 'openai/gpt-5.6-luna';
const MAX_RECORDING_SECONDS = 90;
const { transcribeAudio } = require('./transcription');

function errorMessage(data, fallback) {
  return data?.error?.message || data?.error || data?.message || fallback;
}

function toMessages(history, systemPrompt) {
  const messages = [];
  if (systemPrompt?.trim()) messages.push({ role: 'system', content: systemPrompt.trim() });
  for (const turn of history) {
    const content = turn.parts?.map((part) => part.text || '').filter(Boolean).join('') || '';
    if (content) messages.push({ role: turn.role === 'model' ? 'assistant' : 'user', content });
  }
  return messages;
}

const WEB_SEARCH_OPTIONS = [
  'engine',
  'max_results',
  'max_uses',
  'max_total_results',
  'allowed_domains',
  'excluded_domains',
];
const WEB_SEARCH_ENGINES = new Set(['auto', 'native', 'exa', 'firecrawl', 'parallel', 'perplexity']);

function validateWebSearchOptions(options = {}) {
  if (options.engine !== undefined && !WEB_SEARCH_ENGINES.has(options.engine)) {
    throw Object.assign(new Error(`Unsupported web search engine: ${options.engine}`), { status: 400 });
  }
  for (const key of ['max_results', 'max_uses', 'max_total_results']) {
    if (options[key] !== undefined && (!Number.isInteger(options[key]) || options[key] < 1)) {
      throw Object.assign(new Error(`${key} must be a positive integer`), { status: 400 });
    }
  }
  if (options.max_results !== undefined && options.max_results > 25) {
    throw Object.assign(new Error('max_results cannot exceed 25'), { status: 400 });
  }
  for (const key of ['allowed_domains', 'excluded_domains']) {
    if (options[key] !== undefined && (!Array.isArray(options[key]) || options[key].some((domain) => typeof domain !== 'string' || !domain.trim()))) {
      throw Object.assign(new Error(`${key} must be an array of non-empty strings`), { status: 400 });
    }
  }
}

function normalizeCitations(annotations = []) {
  return annotations.map((annotation) => {
    const citation = annotation?.url_citation || annotation;
    return {
      type: annotation?.type || 'url_citation',
      url: citation?.url || '',
      title: citation?.title || citation?.url || '',
      content: citation?.content || '',
      startIndex: citation?.start_index ?? null,
      endIndex: citation?.end_index ?? null,
    };
  }).filter((citation) => citation.url);
}

function webSearchRequest(webSearch, options) {
  if (webSearch !== true) return {};
  validateWebSearchOptions(options);
  const parameters = {};
  for (const key of WEB_SEARCH_OPTIONS) {
    if (options && options[key] !== undefined) parameters[key] = options[key];
  }
  return {
    tools: [{ type: 'openrouter:web_search', parameters }],
    // Keep the server-tool budget bounded while allowing the model to refine a search.
    max_tool_calls: Number.isInteger(parameters.max_uses) ? parameters.max_uses : 1,
  };
}

async function completeText({ messages, apiKey, model, fetchImpl, referer, webSearch, webSearchOptions }) {
  if (!apiKey) throw Object.assign(new Error('OPENROUTER_API_KEY not configured'), { status: 500 });
  const response = await fetchImpl('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      'HTTP-Referer': referer || 'http://localhost:3001',
      'X-Title': 'Voice Chat',
    },
    body: JSON.stringify({
      model: model || DEFAULT_TEXT_MODEL,
      messages,
      temperature: 1,
      max_tokens: 2048,
      ...webSearchRequest(webSearch, webSearchOptions),
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(errorMessage(data, 'OpenRouter request failed')), { status: response.status });
  const assistantMessage = data.choices?.[0]?.message || {};
  const reply = assistantMessage.content?.trim();
  if (!reply) throw Object.assign(new Error('OpenRouter returned an empty response'), { status: 502 });
  return {
    reply,
    searchRequests: data.usage?.server_tool_use?.web_search_requests ?? null,
    citations: normalizeCitations(assistantMessage.annotations || []),
    usage: data.usage || null,
    // The provider response contains no request headers or API key.
    rawResponse: data,
  };
}

async function generateConversationQuestions({ message, apiKey, model, fetchImpl = fetch, referer }) {
  if (!message?.trim()) throw Object.assign(new Error('message required'), { status: 400 });
  const response = await fetchImpl('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}`, 'HTTP-Referer': referer || 'http://localhost:3001', 'X-Title': 'Voice Chat' },
    body: JSON.stringify({ model: model || DEFAULT_TEXT_MODEL, temperature: 0.4, max_tokens: 120, messages: [
      { role: 'system', content: 'Genera exactamente tres preguntas cortas, claras y relevantes para continuar la conversación. No respondas el tema. Una pregunta por línea, sin numeración, sin introducción y máximo 12 palabras por pregunta.' },
      { role: 'user', content: message.trim().slice(0, 4000) },
    ] }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(errorMessage(data, 'Questions request failed')), { status: response.status });
  const text = data.choices?.[0]?.message?.content?.trim() || '';
  const questions = text.split(/\r?\n/).map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim()).filter(Boolean).slice(0, 3);
  if (!questions.length) throw Object.assign(new Error('Questions response was empty'), { status: 502 });
  return questions;
}

async function runPipeline({ body, sessions, env = process.env, fetchImpl = fetch }) {
  const {
    sessionId, message, audioBase64, audioMimeType, audioDuration, systemPrompt, model,
    webSearch, webSearchOptions,
  } = body;
  // Prefer server-managed keys. A stale browser key must not override a valid
  // .env key and produce misleading provider errors such as "User not found".
  const groqApiKey = env.GROQ_API_KEY || body.groqApiKey;
  const openrouterApiKey = env.OPENROUTER_API_KEY || body.openrouterApiKey;
  if (!sessionId) throw Object.assign(new Error('sessionId required'), { status: 400 });
  if (!message?.trim() && !audioBase64) throw Object.assign(new Error('No content'), { status: 400 });
  if (audioBase64 && audioDuration == null) {
    throw Object.assign(new Error('audioDuration is required for audio messages'), { status: 400 });
  }
  if (audioDuration != null && (!Number.isFinite(Number(audioDuration)) || Number(audioDuration) > MAX_RECORDING_SECONDS)) {
    throw Object.assign(new Error(`Recording cannot exceed ${MAX_RECORDING_SECONDS} seconds`), { status: 413 });
  }

  const history = sessions[sessionId] || (sessions[sessionId] = []);
  let transcript = message?.trim() || '';
  const timings = {};
  if (audioBase64) {
    const started = Date.now();
    transcript = await transcribeAudio({
      audioBase64,
      audioMimeType,
      apiKey: groqApiKey,
      model: env.GROQ_TRANSCRIPTION_MODEL,
      fetchImpl,
    });
    timings.transcriptionMs = Date.now() - started;
  }

  const userText = [transcript, message?.trim() && audioBase64 ? message.trim() : ''].filter(Boolean).join('\n\n');
  history.push({ role: 'user', parts: [{ text: userText }] });
  try {
    const started = Date.now();
    const completion = await completeText({
      messages: [...toMessages(history.slice(0, -1), systemPrompt), { role: 'user', content: userText }],
      apiKey: openrouterApiKey,
      model: model || env.OPENROUTER_TEXT_MODEL,
      fetchImpl,
      referer: env.PUBLIC_APP_URL,
      webSearch,
      webSearchOptions,
    });
    timings.completionMs = Date.now() - started;
    history.push({ role: 'model', parts: [{ text: completion.reply }] });
    timings.totalMs = (timings.transcriptionMs || 0) + timings.completionMs;
    return {
      transcript,
      reply: completion.reply,
      timings,
      provider: {
        transcription: audioBase64 ? 'Groq Whisper' : null,
        completion: 'OpenRouter',
        model: model || env.OPENROUTER_TEXT_MODEL || DEFAULT_TEXT_MODEL,
        webSearch: webSearch === true,
         searchRequests: completion.searchRequests ?? (completion.citations.length ? 1 : 0),
        citations: completion.citations,
        usage: completion.usage,
        rawResponse: completion.rawResponse,
      },
    };
  } catch (error) {
    history.pop();
    throw error;
  }
}

runPipeline.MAX_RECORDING_SECONDS = MAX_RECORDING_SECONDS;
runPipeline.DEFAULT_TEXT_MODEL = DEFAULT_TEXT_MODEL;
module.exports = { runPipeline, generateConversationQuestions, MAX_RECORDING_SECONDS, DEFAULT_TEXT_MODEL };
module.exports.validateWebSearchOptions = validateWebSearchOptions;
module.exports.normalizeCitations = normalizeCitations;
