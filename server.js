require('dotenv').config();
const express = require('express');
const path = require('path');
const { runPipeline, generateConversationQuestions } = require('./lib/pipeline');
const { transcribeAudio } = require('./lib/transcription');

const PORT = process.env.PORT || 3001;
const DEFAULT_MODEL = 'google:gemini-3.1-flash-lite-preview';
const sessions = {};
const WEB_SEARCH_OPTIONS = ['engine', 'max_results', 'max_uses', 'max_total_results', 'allowed_domains', 'excluded_domains'];

function webSearchRequest(enabled, options) {
  if (enabled !== true) return {};
  const parameters = {};
  for (const key of WEB_SEARCH_OPTIONS) {
    if (options?.[key] !== undefined) parameters[key] = options[key];
  }
  return {
    tools: [{ type: 'openrouter:web_search', parameters }],
    max_tool_calls: Number.isInteger(parameters.max_uses) ? parameters.max_uses : 1,
  };
}

const app = express();
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json({ limit: '50mb' }));

app.post('/chat', async (req, res) => {
  const { sessionId, message, audioBase64, audioMimeType, systemPrompt, model, openrouterApiKey, webSearch, webSearchOptions } = req.body;
  if (!sessionId) return res.status(400).json({ error: 'sessionId required' });

  const [provider, ...modelParts] = (model || DEFAULT_MODEL).split(':');
  const modelId = modelParts.join(':');
  if (!sessions[sessionId]) sessions[sessionId] = [];

  if (provider === 'google') {
    const key = process.env.GEMINI_API_KEY;
    if (!key) return res.status(500).json({ error: 'GEMINI_API_KEY not configured' });

    const userParts = [];
    if (audioBase64 && audioMimeType) {
      userParts.push({ inlineData: { mimeType: audioMimeType, data: audioBase64 } });
    }
    if (message?.trim()) userParts.push({ text: message.trim() });
    if (!userParts.length) return res.status(400).json({ error: 'No content' });

    sessions[sessionId].push({ role: 'user', parts: userParts });
    const body = {
      contents: sessions[sessionId],
      generationConfig: { temperature: 1, maxOutputTokens: 2048 }
    };
    if (systemPrompt?.trim()) {
      body.systemInstruction = { parts: [{ text: systemPrompt.trim() }] };
    }

    try {
      const apiRes = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${key}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
      );
      const data = await apiRes.json();
      if (!apiRes.ok) {
        sessions[sessionId].pop();
        return res.status(apiRes.status).json({ error: data.error?.message || 'Gemini error' });
      }
      const replyText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      if (!replyText) {
        sessions[sessionId].pop();
        return res.status(500).json({ error: 'Empty response' });
      }
      sessions[sessionId].push({ role: 'model', parts: [{ text: replyText }] });
      return res.json({ reply: replyText });
    } catch (err) {
      sessions[sessionId].pop();
      return res.status(500).json({ error: err.message });
    }
  }

  if (provider === 'openrouter') {
    const key = process.env.OPENROUTER_API_KEY || openrouterApiKey;
    if (!key) return res.status(500).json({ error: 'OPENROUTER_API_KEY not configured' });
    if (!message && !audioBase64) return res.status(400).json({ error: 'No content' });

    const messages = [];
    if (systemPrompt?.trim()) messages.push({ role: 'system', content: systemPrompt.trim() });
    for (const turn of sessions[sessionId]) {
      const role = turn.role === 'model' ? 'assistant' : 'user';
      const content = turn.parts?.map(p => p.text || '').filter(Boolean).join('') || '';
      if (content) messages.push({ role, content });
    }

    const userContent = [];
    if (audioBase64 && audioMimeType) {
      const fmt = audioMimeType.split(';')[0].split('/')[1] || 'webm';
      userContent.push({ type: 'input_audio', input_audio: { data: audioBase64, format: fmt } });
    }
    if (message?.trim()) userContent.push({ type: 'text', text: message.trim() });
    messages.push(
      userContent.length === 1 && userContent[0].type === 'text'
        ? { role: 'user', content: userContent[0].text }
        : { role: 'user', content: userContent }
    );

    sessions[sessionId].push({ role: 'user', parts: [{ text: message?.trim() || '[audio]' }] });

    try {
      const apiRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`,
          'HTTP-Referer': 'http://localhost:3001',
          'X-Title': 'Voice Chat'
        },
        body: JSON.stringify({
          model: modelId, messages, temperature: 1, max_tokens: 2048,
          ...webSearchRequest(webSearch, webSearchOptions),
        })
      });
      const data = await apiRes.json();
      if (!apiRes.ok) {
        sessions[sessionId].pop();
        return res.status(apiRes.status).json({ error: data.error?.message || 'OpenRouter error' });
      }
      const replyText = data.choices?.[0]?.message?.content || '';
      if (!replyText) {
        sessions[sessionId].pop();
        return res.status(500).json({ error: 'Empty response' });
      }
      sessions[sessionId].push({ role: 'model', parts: [{ text: replyText }] });
      return res.json({
        reply: replyText,
        provider: {
          completion: 'OpenRouter',
          model: modelId,
          webSearch: webSearch === true,
          searchRequests: data.usage?.server_tool_use?.web_search_requests || 0,
          citations: data.choices?.[0]?.message?.annotations || [],
          usage: data.usage || null,
          rawResponse: data,
        },
      });
    } catch (err) {
      sessions[sessionId].pop();
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(400).json({ error: `Unknown provider: ${provider}` });
});

app.post('/clear', (req, res) => {
  const { sessionId } = req.body;
  if (sessionId && sessions[sessionId]) delete sessions[sessionId];
  res.json({ ok: true });
});

app.post('/pipeline', async (req, res) => {
  try {
    const result = await runPipeline({ body: req.body, sessions });
    return res.json(result);
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message || 'Pipeline error' });
  }
});

app.post('/conversation-questions', async (req, res) => {
  try {
    const { message, model, openrouterApiKey } = req.body || {};
    const questions = await generateConversationQuestions({ message, model, apiKey: process.env.OPENROUTER_API_KEY || openrouterApiKey, referer: process.env.PUBLIC_APP_URL });
    return res.json({ questions });
  } catch (err) { return res.status(err.status || 500).json({ error: err.message || 'Questions error' }); }
});

app.post('/transcribe', async (req, res) => {
  const { audioBase64, audioMimeType, groqApiKey, model } = req.body || {};
  try {
    const transcript = await transcribeAudio({
      audioBase64,
      audioMimeType,
      apiKey: groqApiKey || process.env.GROQ_API_KEY,
      model: model || process.env.GROQ_TRANSCRIPTION_MODEL,
    });
    return res.json({ transcript });
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message || 'Transcription error' });
  }
});

// Free neural TTS (Microsoft Edge voices) proxied from the server. Requires
// network to Microsoft and has no API key. Used by the voice lab to compare
// output voices for Spanish on mobile.
app.get('/tts', async (req, res) => {
  const text = String(req.query.text || '').slice(0, 800);
  const voice = String(req.query.voice || 'es-ES-AlvaroNeural');
  const format = String(req.query.format || '');
  const FORMATS = {
    mp3: 'audio-24khz-48kbitrate-mono-mp3',
    webm: 'webm-24khz-16bit-mono-opus',
  };
  if (!text) return res.status(400).json({ error: 'text required' });
  const MsEdgeTTS = require('msedge-tts').MsEdgeTTS;
  const OUTPUT_FORMAT = require('msedge-tts').OUTPUT_FORMAT;
  const chosen = OUTPUT_FORMAT[FORMATS[format] || FORMATS.webm] || OUTPUT_FORMAT.WEBM_24KHZ_16BIT_MONO_OPUS;
  const t = new MsEdgeTTS();
  try {
    await t.setMetadata(voice, chosen);
    const { audioStream } = await t.toStream(text);
    const contentType = format === 'mp3' ? 'audio/mpeg' : 'audio/webm';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'no-store');
    audioStream.pipe(res);
  } catch (err) {
    res.status(502).json({ error: 'TTS failed: ' + err.message });
  }
});

app.get('/health', (req, res) => {
  res.json({
    ok: true,
    mode: 'simple-username-sync',
    pipeline: {
      groqConfigured: !!process.env.GROQ_API_KEY,
      openrouterConfigured: !!process.env.OPENROUTER_API_KEY,
      defaultModel: process.env.OPENROUTER_TEXT_MODEL || 'openai/gpt-5.6-luna',
    },
  });
});

if (require.main === module) app.listen(PORT, () => {
  console.log(`Voice chat at http://localhost:${PORT}`);
  if (!process.env.GEMINI_API_KEY) console.warn('WARNING: GEMINI_API_KEY not set');
  if (!process.env.OPENROUTER_API_KEY) console.warn('WARNING: OPENROUTER_API_KEY not set');
  if (!process.env.GROQ_API_KEY) console.warn('WARNING: GROQ_API_KEY not set (needed for audio pipeline)');
});

module.exports = app;
