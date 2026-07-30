const express = require('express');
const path = require('path');

const PORT = process.env.PORT || 3001;
const DEFAULT_MODEL = 'google:gemini-3.1-flash-lite-preview';
const sessions = {};

const app = express();
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json({ limit: '50mb' }));

app.post('/chat', async (req, res) => {
  const { sessionId, message, audioBase64, audioMimeType, systemPrompt, model } = req.body;
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
    const key = process.env.OPENROUTER_API_KEY;
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
        body: JSON.stringify({ model: modelId, messages, temperature: 1, max_tokens: 2048 })
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
      return res.json({ reply: replyText });
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

app.listen(PORT, () => {
  console.log(`Voice chat at http://localhost:${PORT}`);
  if (!process.env.GEMINI_API_KEY) console.warn('WARNING: GEMINI_API_KEY not set');
  if (!process.env.OPENROUTER_API_KEY) console.warn('WARNING: OPENROUTER_API_KEY not set');
});
