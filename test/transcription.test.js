const test = require('node:test');
const assert = require('node:assert/strict');
const { transcribeAudio, MAX_AUDIO_BYTES } = require('../lib/transcription');

function response(body, ok = true, status = 200) {
  return { ok, status, json: async () => body };
}

test('transcribes a non-empty audio chunk through Groq', async () => {
  const calls = [];
  const transcript = await transcribeAudio({
    audioBase64: Buffer.from('audio chunk').toString('base64'),
    audioMimeType: 'audio/webm;codecs=opus',
    apiKey: 'gsk_test',
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return response({ text: ' hello world ' });
    },
  });

  assert.equal(transcript, 'hello world');
  assert.equal(calls[0].url, 'https://api.groq.com/openai/v1/audio/transcriptions');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer gsk_test');
  assert.equal(calls[0].init.body.get('model'), 'whisper-large-v3-turbo');
  assert.equal(calls[0].init.body.get('response_format'), 'json');
});

test('rejects empty audio before calling Groq', async () => {
  await assert.rejects(
    transcribeAudio({ audioBase64: '', apiKey: 'gsk_test', fetchImpl: async () => { throw new Error('called'); } }),
    (error) => error.status === 400 && error.message === 'Audio is required',
  );
});

test('rejects oversized audio before calling Groq', async () => {
  const audioBase64 = Buffer.alloc(MAX_AUDIO_BYTES + 1).toString('base64');
  await assert.rejects(
    transcribeAudio({ audioBase64, apiKey: 'gsk_test', fetchImpl: async () => { throw new Error('called'); } }),
    (error) => error.status === 413 && /12 MB/.test(error.message),
  );
});
