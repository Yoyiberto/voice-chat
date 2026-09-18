# voice-chat-ai
Usually, live audio AIs are too clumsy. You can’t really have an insightful or reflective conversation with them.

However, they are great for audio dumps. You can mix in words from other languages or use complex vocabulary, and they still understand context well.

The core idea is to leverage native audio models like Gemini or a optimized STT + LLM pipeline to increase intelligence and flexibility. This makes audio chats far more meaningful and engaging.

Future Enhancements:
- Memory settings
- Fast web search

## Audio pipeline

The app supports two audio paths:

- Gemini multimodal sends audio directly to Gemini.
- `Whisper large turbo + GPT-5.6 Luna` transcribes with Groq's `whisper-large-v3-turbo` and then sends text to OpenRouter's `openai/gpt-5.6-luna`.

The normal chat pipeline still has a hard 90-second recording limit. Browser recordings use `audio/webm;codecs=opus` when available to reduce upload size, with mono 16 kHz WAV as a fallback.

For 5+ minute conversations the microphone uses a shared segmented recorder (`public/long-record.js`): continuous 25-second segments are transcribed incrementally through `/transcribe` while you speak, accumulated into an editable preview, and on `Enviar transcripción` only the text is sent to the pipeline. This becomes the default mic flow in the main app whenever the model is `pipeline:` (Whisper + Luna); Gemini/OpenRouter-direct keep the original immediate audio flow. Chat-long stays available at `/chat-long.html` (button `∞`). Each segment is normalized client-side to a quiet-phone-friendly mono 16 kHz WAV before Groq (see `public/normalize-audio.js`), and model replies are cleaned to plain text so markdown markers do not show on mobile (`public/markdown.js`).

## Audio lab

Open `http://localhost:3001/audio-lab.html` (sidebar `▲`) to record on any device and compare Groq transcriptions across variants: raw WebM, WAV 16 kHz, gain x2, normalised peak, and strong normalisation. Use it from your phone to tune `normalize-audio.js` gain/target before baking the chosen settings into the app.

## Voice lab (TTS)

Open `http://localhost:3001/tts-lab.html` (sidebar `♪`) to compare free Spanish output voices: Web Speech system voices (Microsoft/Google), Microsoft Edge neural voices proxied through the server's `/tts` (no API key; requires network), and Piper running locally in the browser (WASM, es_ES models). The default app TTS uses the browser's `speechSynthesis` with `es-ES`; this lab lets you pick the voice you like best before wiring a chosen voice into the app.

The recommended production setup is to set these server-side environment variables:

```text
GROQ_API_KEY=...
OPENROUTER_API_KEY=...
```

Optional variables are `GROQ_TRANSCRIPTION_MODEL`, `OPENROUTER_TEXT_MODEL`, and `PUBLIC_APP_URL`.

For personal testing, the global settings modal also accepts both keys. They are stored in the browser's `localStorage` and sent with requests; they are not bundled into the frontend, but anyone with access to that browser profile can read them. Do not use browser-entered keys on a shared or public computer. A browser-entered key is used for that request; if the field is empty, the server environment variable is used.

Run the local app with `npm start`, then choose `Whisper large turbo + GPT-5.6 Luna` in the global model settings. The pipeline returns the transcript and timing data so its two stages can be tested independently.

## Web search lab

Open `http://localhost:3001/web-search-lab.html` to compare the same prompt with and without OpenRouter's `openrouter:web_search` server tool. The lab can transcribe a short microphone prompt with Groq, runs matched requests through Whisper + Luna, and displays citations, search-request count, usage, timings, and raw diagnostic JSON. Search is not enabled in the main application. With the server tool enabled, Luna decides whether to search; a timeless question may produce zero searches while a current-news question usually produces citations.

## Simple sync

The app uses a deliberately simple shared username instead of authentication. Choose the same username on each device in `Vincular`; chats are stored in Supabase under that value. This is not security: anyone who knows the username can read or modify its chats. The Supabase publishable/anon key is safe to expose in the HTML; `SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_ACCESS_TOKEN` must never be placed there.

### Local setup

1. Copy `.env.example` to `.env` and fill `GROQ_API_KEY` if you want audio transcription. `OPENROUTER_API_KEY` and `GEMINI_API_KEY` are read server-side when present.
2. Start the app with `npm start`.
3. Open `http://localhost:3001`, click `Vincular`, and enter the same username on every device.
4. Use `Subir` and `Bajar` for manual synchronization.
