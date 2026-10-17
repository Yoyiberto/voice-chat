// Vercel serverless proxy for Microsoft Edge neural TTS (free, no API key).
import { MsEdgeTTS } from 'msedge-tts';
import { pipeline } from 'stream';

const FORMATS = {
  mp3: 'audio-24khz-48kbitrate-mono-mp3',
  webm: 'webm-24khz-16bit-mono-opus',
};

export default async function handler(req, res) {
  const text = String(req.query.text || '').slice(0, 800);
  const voice = String(req.query.voice || 'es-ES-AlvaroNeural');
  const format = String(req.query.format || '');
  if (!text) {
    res.status(400).json({ error: 'text required' });
    return;
  }
  try {
    // FORMATS values are OUTPUT_FORMAT values (the enum is not keyed by them).
    const chosen = FORMATS[format] || FORMATS.webm;
    const t = new MsEdgeTTS();
    await t.setMetadata(voice, chosen);
    const { audioStream } = await t.toStream(text);
    res.setHeader('Content-Type', format === 'mp3' ? 'audio/mpeg' : 'audio/webm');
    res.setHeader('Cache-Control', 'no-store');
    // pipeline ends the response on stream errors; close() drops the Edge socket.
    pipeline(audioStream, res, () => t.close());
  } catch (err) {
    res.status(502).json({ error: 'TTS failed: ' + err.message });
  }
}