const DEFAULT_TRANSCRIPTION_MODEL = 'whisper-large-v3-turbo';
const MAX_AUDIO_BYTES = 12 * 1024 * 1024;

// Speech-to-text providers. Groq and OpenAI share the OpenAI transcription
// endpoint; Gemini transcribes through generateContent with inline audio.
const STT_PROVIDERS = {
  groq: { label: 'Groq', url: 'https://api.groq.com/openai/v1/audio/transcriptions', defaultModel: DEFAULT_TRANSCRIPTION_MODEL },
  openai: { label: 'OpenAI', url: 'https://api.openai.com/v1/audio/transcriptions', defaultModel: 'gpt-4o-mini-transcribe' },
  google: { label: 'Google', defaultModel: 'gemini-3.5-transcribe' },
};

const GEMINI_TRANSCRIBE_PROMPT = 'Transcribe this audio verbatim, in the language actually spoken (usually Spanish, sometimes mixed with English words). Output only the transcript text: no timestamps, speaker labels, translations or comments. If there is no speech, output nothing.';

function errorMessage(data, fallback) {
  return data?.error?.message || (typeof data?.error === 'string' ? data.error : '') || data?.message || fallback;
}

/** Provider error with a short message; 429s carry how long to wait. */
function providerError(label, data, status, fallback) {
  const raw = errorMessage(data, fallback);
  if (status !== 429) return Object.assign(new Error(raw), { status });
  const seconds = Number((raw.match(/retry in ([\d.]+)\s*s/i) || [])[1])
    || Number(String(data?.error?.details?.find?.((d) => d.retryDelay)?.retryDelay || '').replace('s', ''))
    || 5;
  return Object.assign(new Error(`${label}: límite de uso alcanzado, reintentando en ${Math.ceil(seconds)} s`), {
    status,
    retryAfterMs: Math.ceil(seconds * 1000),
  });
}

async function transcribeWithGemini({ bytes, mime, apiKey, model, fetchImpl }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ inlineData: { mimeType: mime, data: bytes.toString('base64') } }, { text: GEMINI_TRANSCRIBE_PROMPT }] }],
      generationConfig: { temperature: 0 },
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw providerError('Google', data, response.status, 'Gemini transcription failed');
  // Dedicated transcribe models answer with `audioTranscription` parts.
  return (data.candidates?.[0]?.content?.parts || [])
    .map((part) => part.audioTranscription?.text || part.text || '')
    .join('');
}

async function transcribeAudio({
  audioBase64,
  audioMimeType,
  apiKey,
  model,
  provider = 'groq',
  fetchImpl = fetch,
}) {
  const spec = STT_PROVIDERS[provider];
  if (!spec) throw Object.assign(new Error(`Unknown transcription provider: ${provider}`), { status: 400 });
  if (!apiKey) throw Object.assign(new Error(`${spec.label} API key not configured`), { status: 401 });
  if (!audioBase64) throw Object.assign(new Error('Audio is required'), { status: 400 });

  const bytes = Buffer.from(audioBase64, 'base64');
  if (!bytes.length) {
    throw Object.assign(new Error('Audio is empty'), { status: 400 });
  }
  if (bytes.length > MAX_AUDIO_BYTES) {
    throw Object.assign(new Error('Audio exceeds the 12 MB limit'), { status: 413 });
  }

  const mime = (audioMimeType || 'audio/webm').split(';')[0];
  const chosenModel = model || spec.defaultModel;
  let text;
  if (provider === 'google') {
    text = await transcribeWithGemini({ bytes, mime, apiKey, model: chosenModel, fetchImpl });
  } else {
    const extension = mime.split('/')[1] || 'webm';
    const form = new FormData();
    form.append('file', new Blob([bytes], { type: mime }), `recording.${extension}`);
    form.append('model', chosenModel);
    form.append('response_format', 'json');

    const response = await fetchImpl(spec.url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw providerError(spec.label, data, response.status, `${spec.label} transcription failed`);
    text = data.text;
  }

  const transcript = text?.trim();
  if (!transcript) {
    throw Object.assign(new Error(`${spec.label} returned an empty transcription`), { status: 502 });
  }
  return transcript;
}

/**
 * Transcribes a request body from the web app: picks the STT provider/model
 * (`sttProvider`, `sttModel`) and the server or browser key for it.
 */
function transcribeRequest({ body = {}, model, env = process.env, fetchImpl = fetch }) {
  const { withProviderKey } = require('./providers');
  const provider = STT_PROVIDERS[body.sttProvider] ? body.sttProvider : 'groq';
  const chosenModel = body.sttModel || model || (provider === 'groq' ? env.GROQ_TRANSCRIPTION_MODEL : undefined);
  return withProviderKey(provider, env, body, (apiKey) => transcribeAudio({
    audioBase64: body.audioBase64,
    audioMimeType: body.audioMimeType,
    apiKey,
    model: chosenModel,
    provider,
    fetchImpl,
  }));
}

transcribeAudio.DEFAULT_TRANSCRIPTION_MODEL = DEFAULT_TRANSCRIPTION_MODEL;
transcribeAudio.MAX_AUDIO_BYTES = MAX_AUDIO_BYTES;
module.exports = { transcribeAudio, transcribeRequest, DEFAULT_TRANSCRIPTION_MODEL, MAX_AUDIO_BYTES, STT_PROVIDERS };
