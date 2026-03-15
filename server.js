const express = require('express');
const app = express();
const path = require('path');

const PORT = process.env.PORT || 3001;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const MODEL = 'gemini-3.1-flash-lite-preview';

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json({ limit: '50mb' }));

// In-memory conversation history per session (keyed by session ID)
const sessions = {};

app.post('/chat', async (req, res) => {
  if (!GEMINI_API_KEY) {
    return res.status(500).json({ error: 'GEMINI_API_KEY environment variable not set' });
  }

  const { sessionId, message, audioBase64, audioMimeType, systemPrompt } = req.body;

  if (!sessionId) {
    return res.status(400).json({ error: 'sessionId is required' });
  }

  // Initialize session history if needed
  if (!sessions[sessionId]) {
    sessions[sessionId] = [];
  }

  // Build the user parts for this turn
  const userParts = [];

  if (audioBase64 && audioMimeType) {
    userParts.push({
      inlineData: {
        mimeType: audioMimeType,
        data: audioBase64
      }
    });
  }

  if (message && message.trim()) {
    userParts.push({ text: message.trim() });
  }

  if (userParts.length === 0) {
    return res.status(400).json({ error: 'No message or audio provided' });
  }

  // Add user turn to history
  sessions[sessionId].push({
    role: 'user',
    parts: userParts
  });

  // Build the Gemini API request body
  const requestBody = {
    contents: sessions[sessionId],
    generationConfig: {
      temperature: 1,
      maxOutputTokens: 2048
    }
  };

  // Add system instruction if provided
  if (systemPrompt && systemPrompt.trim()) {
    requestBody.systemInstruction = {
      parts: [{ text: systemPrompt.trim() }]
    };
  }

  try {
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GEMINI_API_KEY}`;

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Gemini API error:', JSON.stringify(data, null, 2));
      // Remove last user turn since it failed
      sessions[sessionId].pop();
      return res.status(response.status).json({
        error: data.error?.message || 'Gemini API error'
      });
    }

    const candidate = data.candidates?.[0];
    const replyText = candidate?.content?.parts?.[0]?.text || '';

    if (!replyText) {
      sessions[sessionId].pop();
      return res.status(500).json({ error: 'Empty response from Gemini' });
    }

    // Add model response to history
    sessions[sessionId].push({
      role: 'model',
      parts: [{ text: replyText }]
    });

    res.json({ reply: replyText });

  } catch (err) {
    console.error('Server error:', err);
    sessions[sessionId].pop();
    res.status(500).json({ error: 'Internal server error: ' + err.message });
  }
});

// Clear conversation history for a session
app.post('/clear', (req, res) => {
  const { sessionId } = req.body;
  if (sessionId && sessions[sessionId]) {
    delete sessions[sessionId];
  }
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`Voice chat server running at http://localhost:${PORT}`);
  if (!GEMINI_API_KEY) {
    console.warn('WARNING: GEMINI_API_KEY is not set. Set it before using the app.');
  }
});
