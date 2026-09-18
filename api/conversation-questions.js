const { generateConversationQuestions } = require('../lib/pipeline');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const body = req.body || {};
    const questions = await generateConversationQuestions({ message: body.message, model: body.model, apiKey: process.env.OPENROUTER_API_KEY || body.openrouterApiKey, referer: process.env.PUBLIC_APP_URL });
    return res.json({ questions });
  } catch (error) { return res.status(error.status || 500).json({ error: error.message || 'Questions error' }); }
};

module.exports.config = { api: { bodyParser: { sizeLimit: '1mb' } } };
