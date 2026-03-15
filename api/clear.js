export default async function handler(req, res) {
  // Sessions are in-memory in chat.js; this endpoint is a no-op in Vercel
  // (server restarts clear sessions anyway). Kept for local server compatibility.
  return res.json({ ok: true });
}
