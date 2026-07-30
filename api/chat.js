const DEFAULT_MODEL = 'google:gemini-3.1-flash-lite-preview';

// In-memory sessions (resets on cold start, acceptable for personal use)
const sessions = {};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { sessionId, message, audioBase64, audioMimeType, systemPrompt, model } = req.body;
  if (!sessionId) return res.status(400).json({ error: 'sessionId required' });

  // Parse "provider:modelId" — default to Google if omitted
  const [provider, ...modelParts] = (model || DEFAULT_MODEL).split(':');
  const modelId = modelParts.join(':');  // handles slashes in openrouter model ids

  if (!sessions[sessionId]) sessions[sessionId] = [];

  // ── Google Gemini ──────────────────────────────────────────────────────────
  if (provider === 'google') {
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    if (!GEMINI_API_KEY) return res.status(500).json({ error: 'GEMINI_API_KEY not configured' });

    const userParts = [];
    if (audioBase64 && audioMimeType) {
      userParts.push({ inlineData: { mimeType: audioMimeType, data: audioBase64 } });
    }
    if (message && message.trim()) {
      userParts.push({ text: message.trim() });
    }
    if (userParts.length === 0) return res.status(400).json({ error: 'No content' });

    sessions[sessionId].push({ role: 'user', parts: userParts });

    const requestBody = {
      contents: sessions[sessionId],
      generationConfig: { temperature: 1, maxOutputTokens: 2048 }
    };
    if (systemPrompt && systemPrompt.trim()) {
      requestBody.systemInstruction = { parts: [{ text: systemPrompt.trim() }] };
    }

    try {
      const apiRes = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${GEMINI_API_KEY}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(requestBody) }
      );
      const data = await apiRes.json();

      if (!apiRes.ok) {
        sessions[sessionId].pop();
        return res.status(apiRes.status).json({ error: data.error?.message || 'Gemini error' });
      }

      const replyText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      if (!replyText) { sessions[sessionId].pop(); return res.status(500).json({ error: 'Empty response' }); }

      sessions[sessionId].push({ role: 'model', parts: [{ text: replyText }] });
      return res.json({ reply: replyText });

    } catch (err) {
      sessions[sessionId].pop();
      return res.status(500).json({ error: err.message });
    }
  }

  // ── OpenRouter (OpenAI-compatible) ────────────────────────────────────────
  if (provider === 'openrouter') {
    const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
    if (!OPENROUTER_API_KEY) return res.status(500).json({ error: 'OPENROUTER_API_KEY not configured' });

    if (!message && !audioBase64) return res.status(400).json({ error: 'No content' });

    // Convert Gemini-style session history to OpenAI messages
    const messages = [];
    if (systemPrompt && systemPrompt.trim()) {
      messages.push({ role: 'system', content: systemPrompt.trim() });
    }
    // Replay history (text-only turns from previous exchanges)
    for (const turn of sessions[sessionId]) {
      const role    = turn.role === 'model' ? 'assistant' : 'user';
      const content = turn.parts?.map(p => p.text || '').filter(Boolean).join('') || '';
      if (content) messages.push({ role, content });
    }

    // Build current user content (may be text, audio, or both)
    const userContent = [];
    if (audioBase64 && audioMimeType) {
      // Derive a simple format string from the mime type (e.g. "audio/webm" → "webm")
      // OpenRouter accepts: wav, mp3, flac, m4a, ogg, aiff, aac, pcm16, pcm24, webm
      const fmt = audioMimeType.split(';')[0].split('/')[1] || 'webm';
      userContent.push({
        type: 'input_audio',
        input_audio: { data: audioBase64, format: fmt }
      });
    }
    if (message && message.trim()) {
      userContent.push({ type: 'text', text: message.trim() });
    }
    // If content array has only one text item, use the flat string form for compatibility
    const userMessage = userContent.length === 1 && userContent[0].type === 'text'
      ? { role: 'user', content: userContent[0].text }
      : { role: 'user', content: userContent };
    messages.push(userMessage);

    // Store in session history as text-only (audio not replayed in future turns)
    const storedText = message?.trim() || '[audio]';
    sessions[sessionId].push({ role: 'user', parts: [{ text: storedText }] });

    try {
      const apiRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
          'HTTP-Referer': 'https://voice-chat-r8jv.vercel.app',
          'X-Title': 'Voice Chat'
        },
        body: JSON.stringify({
          model: modelId,
          messages,
          temperature: 1,
          max_tokens: 2048
        })
      });
      const data = await apiRes.json();

      if (!apiRes.ok) {
        sessions[sessionId].pop();
        return res.status(apiRes.status).json({ error: data.error?.message || 'OpenRouter error' });
      }

      const replyText = data.choices?.[0]?.message?.content || '';
      if (!replyText) { sessions[sessionId].pop(); return res.status(500).json({ error: 'Empty response' }); }

      sessions[sessionId].push({ role: 'model', parts: [{ text: replyText }] });
      return res.json({ reply: replyText });

    } catch (err) {
      sessions[sessionId].pop();
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(400).json({ error: `Unknown provider: ${provider}` });
}

export const config = { api: { bodyParser: { sizeLimit: '50mb' } } };
