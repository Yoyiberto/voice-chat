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

Optional variables are `GROQ_TRANSCRIPTION_MODEL`, `OPENROUTER_TEXT_MODEL`, `PUBLIC_APP_URL`, and the keys for the other providers: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`.

## Providers (settings sheet)

The settings sheet (sliders icon, or tap the model name under the chat title) splits the pipeline into its three steps:

1. **Transcripción (STT):** Groq Whisper (`whisper-large-v3-turbo`, `whisper-large-v3`), Google Gemini (`gemini-3.1-flash-lite`, `gemini-3.5-transcribe`) or OpenAI (`gpt-4o-mini-transcribe`, `gpt-4o-transcribe`, `whisper-1`), plus the segment length (5–30 s). Gemini's free tier allows very few requests per minute for `gemini-3.5-transcribe`; the recorder waits and retries on HTTP 429.
2. **Modelo de respuesta (LLM):** OpenRouter, Anthropic, OpenAI, Groq or Google. Each provider has recommended presets, a live catalog search (`POST /models`, which also validates the key and shows OpenRouter credit) and accepts any model ID.
3. **Voz:** Edge neural voice or the system voice, and auto-read.

Everything goes through `/pipeline`; the body carries `llmProvider` + `model` (and `sttProvider` + `sttModel` for audio). The stored value `selectedModel` is `pipeline:<openrouter id>` or `pipeline:<provider>:<model id>`. Provider routing lives in `lib/providers.js`.

For personal testing, the settings sheet also accepts a key per provider. They are stored in the browser's `localStorage` and sent with requests; they are not bundled into the frontend, but anyone with access to that browser profile can read them. Do not use browser-entered keys on a shared or public computer. The server key is tried first; if the provider rejects it (401/403, e.g. an expired key) the browser key is used, and the settings sheet shows which one works.

Run the local app with `npm start`, then choose `Whisper large turbo + GPT-5.6 Luna` in the global model settings. The pipeline returns the transcript and timing data so its two stages can be tested independently.

## Web search lab

Open `http://localhost:3001/web-search-lab.html` to compare the same prompt with and without OpenRouter's `openrouter:web_search` server tool. The lab can transcribe a short microphone prompt with Groq, runs matched requests through Whisper + Luna, and displays citations, search-request count, usage, timings, and raw diagnostic JSON. Search is not enabled in the main application. With the server tool enabled, Luna decides whether to search; a timeless question may produce zero searches while a current-news question usually produces citations.

## Cross-chat memory

The thinking partner remembers decisions, promised steps, open questions and recurring patterns between chats.

- **Extract.** Saying "cierra" (or "ok, cierra", "ciérralo") makes the pipeline answer in three sentences (what is clear, next step, open question); the browser then calls `/memory-extract`, which asks a fixed cheap model (`deepseek/deepseek-v4.1-flash`, override with `MEMORY_MODEL`) for 1–5 short items and the ids of old steps/questions that are now resolved. The "Cerrar y recordar" button at the end of a chat does the same without the voice command. The endpoint ignores any model or key sent by the browser and bounds input (last 14k characters) and output (600 tokens).
- **Store.** Items live in D1 table `memory_items` (`Cloudfare/migrations/0002_memory_items.sql`), served by the worker at `GET /memory`, `PUT /memory/:id`, `DELETE /memory/:id`. A separate one-row-per-user table `memory_profile` (`0003_memory_profile.sql`, `GET`/`PUT /profile`) holds the stable profile, at most 5 lines. Both use the same username scoping as chats. No R2 copies.
- **Inject.** Every `/pipeline` request carries the profile and, on the first turn of a chat, the active items; the server keeps at most 5 profile lines / 80 words and 10 items / 150 words (open loops, recency, word overlap with the message) and appends a "Contexto sobre mí" block (profile, then recent memory) to the system prompt with the instruction to use it only when it helps. Later turns resend the same pick so the prompt stays stable. The server keeps nothing.
- **View.** The lightbulb button opens the memory view: edit the profile, filter by type, edit text or type inline, mark as done (stops injection), delete, or add an item by hand. Above 25 active items it suggests consolidating.
- **Import.** "Importar…" distills memories exported from Claude Code, ChatGPT or Perplexity (pasted or loaded from a file, up to 20k characters) into a proposed profile and at most 8 items, shown as a preview with checkboxes; nothing is saved until you confirm. For Claude Code, `node scripts/claude-memory-digest.js --out digest.txt` builds a redacted digest (index plus user/feedback memories, no e-mails or keys).
- **Consolidate.** "Consolidar" proposes merges of near-duplicates and deletions of stale items (plus items marked done more than 3 weeks ago), again as a preview to confirm.

The extract, import and consolidate jobs all go through `/memory-extract` (`mode`: `chat`, `import`, `consolidate`) with fixed, bounded requests.

Local prototype: `npm run d1:migrate` and `npx wrangler dev --port 8811` in `Cloudfare/`, then `npm start` and, on `localhost` only, `localStorage.cfWorkerUrl = 'http://localhost:8811'` to point the app at the local worker. Production needs `npm run d1:migrate:remote`, a worker deploy and a Vercel deploy, in that order.

## Simple sync

The app uses a deliberately simple shared username instead of authentication. Choose the same username on each device in `Vincular`; chats are stored in Supabase under that value. This is not security: anyone who knows the username can read or modify its chats. The Supabase publishable/anon key is safe to expose in the HTML; `SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_ACCESS_TOKEN` must never be placed there.

### Local setup

1. Copy `.env.example` to `.env` and fill `GROQ_API_KEY` if you want audio transcription. `OPENROUTER_API_KEY` and `GEMINI_API_KEY` are read server-side when present.
2. Start the app with `npm start`.
3. Open `http://localhost:3001`, click `Vincular`, and enter the same username on every device.
4. Use `Subir` and `Bajar` for manual synchronization.
