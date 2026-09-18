import pipeline from '../lib/pipeline.js';

const { runPipeline } = pipeline;

const sessions = {};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const result = await runPipeline({ body: req.body, sessions });
    return res.json(result);
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || 'Pipeline error' });
  }
}

export const config = { api: { bodyParser: { sizeLimit: '15mb' } } };
