const { describeProvider } = require('../lib/providers');

// Settings screen: model catalog + key check for one provider.
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const body = req.body || {};
    return res.json(await describeProvider({ provider: body.provider, body }));
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || 'Models error' });
  }
};

module.exports.config = { api: { bodyParser: { sizeLimit: '1mb' } } };
