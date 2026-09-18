// Vercel serverless proxy for Microsoft Edge neural TTS (free, no API key).
import { MsEdgeTTS } from 'msedge-tts';

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
    const { OUTPUT_FORMAT } = await import('msedge-tts');
    const chosen = OUTPUT_FORMAT[FORMATS[format] || FORMATS.webm] || OUTPUT_FORMAT.WEBM_24KHZ_16BIT_MONO_OPUS;
    const t = new MsEdgeTTS();
    await t.setMetadata(voice, chosen);
    const { audioStream } = await t.toStream(text);
    res.setHeader('Content-Type', format === 'mp3' ? 'audio/mpeg' : 'audio/webm');
    res.setHeader('Cache-Control', 'no-store');
    audioStream.pipe(res);
  } catch (err) {
    res.status(502).json({ error: 'TTS failed: ' + err.message });
  }
}