const MODEL = 'gemini-3.1-flash-lite-preview';

// In-memory sessions (resets on cold start, acceptable for personal use)
const sessions = {};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  if (!GEMINI_API_KEY) {
    return res.status(500).json({ error: 'GEMINI_API_KEY not configured' });
  }

  const { sessionId, message, audioBase64, audioMimeType, systemPrompt } = req.body;

  if (!sessionId) return res.status(400).json({ error: 'sessionId required' });

  if (!sessions[sessionId]) sessions[sessionId] = [];

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
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GEMINI_API_KEY}`,
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

export const config = { api: { bodyParser: { sizeLimit: '50mb' } } };
