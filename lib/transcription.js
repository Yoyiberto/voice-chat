const DEFAULT_TRANSCRIPTION_MODEL = 'whisper-large-v3-turbo';
const MAX_AUDIO_BYTES = 12 * 1024 * 1024;

function errorMessage(data, fallback) {
  return data?.error?.message || data?.error || data?.message || fallback;
}

async function transcribeAudio({
  audioBase64,
  audioMimeType,
  apiKey,
  model,
  fetchImpl = fetch,
}) {
  if (!apiKey) throw Object.assign(new Error('GROQ_API_KEY not configured'), { status: 500 });
  if (!audioBase64) throw Object.assign(new Error('Audio is required'), { status: 400 });

  const bytes = Buffer.from(audioBase64, 'base64');
  if (!bytes.length) {
    throw Object.assign(new Error('Audio is empty'), { status: 400 });
  }
  if (bytes.length > MAX_AUDIO_BYTES) {
    throw Object.assign(new Error('Audio exceeds the 12 MB limit'), { status: 413 });
  }

  const mime = (audioMimeType || 'audio/webm').split(';')[0];
  const extension = mime.split('/')[1] || 'webm';
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: mime }), `recording.${extension}`);
  form.append('model', model || DEFAULT_TRANSCRIPTION_MODEL);
  form.append('response_format', 'json');

  const response = await fetchImpl('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw Object.assign(new Error(errorMessage(data, 'Groq transcription failed')), { status: response.status });
  }

  const transcript = data.text?.trim();
  if (!transcript) {
    throw Object.assign(new Error('Groq returned an empty transcription'), { status: 502 });
  }
  return transcript;
}

transcribeAudio.DEFAULT_TRANSCRIPTION_MODEL = DEFAULT_TRANSCRIPTION_MODEL;
transcribeAudio.MAX_AUDIO_BYTES = MAX_AUDIO_BYTES;
module.exports = { transcribeAudio, DEFAULT_TRANSCRIPTION_MODEL, MAX_AUDIO_BYTES };
