const { transcribeRequest } = require('../lib/transcription');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const body = req.body || {};
  try {
    const transcript = await transcribeRequest({ body, model: body.model });
    return res.json({ transcript });
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || 'Transcription error', retryAfterMs: error.retryAfterMs });
  }
};

module.exports.config = { api: { bodyParser: { sizeLimit: '17mb' } } };
