export default function handler(_req, res) {
  res.json({
    ok: true,
    mode: 'simple-username-sync',
    pipeline: {
      groqConfigured: !!process.env.GROQ_API_KEY,
      openrouterConfigured: !!process.env.OPENROUTER_API_KEY,
      defaultModel: process.env.OPENROUTER_TEXT_MODEL || 'openai/gpt-5.6-luna',
    },
  });
}