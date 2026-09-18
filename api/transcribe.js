const { transcribeAudio } = require('../lib/transcription');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const body = req.body || {};
  try {
    const transcript = await transcribeAudio({
      audioBase64: body.audioBase64,
      audioMimeType: body.audioMimeType,
      apiKey: body.groqApiKey || process.env.GROQ_API_KEY,
      model: body.model || process.env.GROQ_TRANSCRIPTION_MODEL,
    });
    return res.json({ transcript });
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || 'Transcription error' });
  }
};

module.exports.config = { api: { bodyParser: { sizeLimit: '17mb' } } };
