import memory from '../lib/memory.js';

const { extractMemory } = memory;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    return res.json(await extractMemory({ body: req.body || {} }));
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || 'Memory extraction error' });
  }
}

export const config = { api: { bodyParser: { sizeLimit: '1mb' } } };
