# Voice Chat AI — resumen de trabajo (23 ago 2026)

Proyecto de chat por voz (Whisper + GPT/Gemini) con sincronización ligera, labs de prueba y despliegue en Vercel.

**Producción:** `https://voice-chat-rust.vercel.app`
**Local:** `npm start`

---

## 1. Transcripción larga (hablar 5+ minutos)

- **Antes:** el mic principal subía un solo audio y el pipeline limitaba a 90 s.
- **Ahora:** grabación por segmentos de 25 s con transcripción incremental a Groq mientras hablas.
- En **Whisper + Luna (pipeline)** el botón `🎤` de la app principal usa este flujo por defecto. Con **Gemini/OpenRouter directo** se mantiene el flujo antiguo.
- El botón `∞` abre `chat-long.html` (chat completo: historial, system prompt, respuestas del modelo, sincronización).
- `public/long-record.js`: recorder compartido usado por la app y chat-long.
- Fix del "doble clic" en móvil: un solo toque detiene/envía (`Enviar transcripción`), el botón nunca queda deshabilitado, y se muestra progreso `TRANSCRIBIENDO (n/m)`.

## 2. Mejora del audio de entrada (móvil)

- `public/normalize-audio.js`: normaliza cada segmento a **mono WAV 16 kHz** subiendo el nivel (pico ~0.85) antes de Groq.
- **`audio-lab.html`** (`▲`): página para grabar y comparar 5 variantes (crudo, WAV 16 kHz, ganancia ×2, normalizado pico, normalizado intenso) con la transcripción de cada una, para elegir la mejor config en cada dispositivo.

## 3. Voz de salida (lab y opciones gratis)

- `public/tts-lab.html` (`♪`): compara voces en español:
  - **Sistema** (Web Speech): Microsoft/Google/Apple.
  - **Microsoft Edge neural** (`/tts`, sin API key): Alvaro, Elvira, Ximena, Abril, Dalia, Jorge…
  - **Piper** (local WASM, offline, modelos es_ES).
  - Slider de **volumen de salida**.
- Endpoint `/tts` en `server.js` y `api/tts.js` (Vercel), usando `msedge-tts`.

## 4. Sincronización simple por username

- Se retiró el Magic Link (daba errores); ahora es un **username compartido** (no hay autenticación real).
- Los chats viven en Supabase bajo `device_id = username`; botones `Subir`/`Bajar`.
- Políticas RLS abiertas para anónimo en `supabase_schema.sql` (aceptado a propósito para 1-5 personas).

## 5. Web search (laboratorio aparte)

- `web-search-lab.html`: comparación del mismo prompt con y sin `openrouter:web_search`.
- El modelo decide si buscar (pregunta actual → citas; pregunta atemporal → sin búsquedas).
- No está activo en la app principal (por ahora).

## 6. Limpieza de markdown

- `public/markdown.js`: quita `**`, `*`, `_`, backticks, headings y links de las respuestas para que se lean bien en móvil.

## 7. System prompt

- Nuevo default (chats nuevos): máximo 100 palabras, tres preguntas cortas, y **anti-eco**: no repetir al usuario; si repite, aportar claridad real o un insight concreto.
- Se guarda por chat (`localStorage` + Supabase `system_prompt`) y se envía en cada petición.

## 8. Despliegue y limpieza

- Vercel: borrados `voice-chat-r8jv` y `deploy-app-v2-bhzj`; queda solo `voice-chat`.
- Variables de producción: `GROQ_API_KEY`, `OPENROUTER_API_KEY`, `GEMINI_API_KEY`, `PUBLIC_APP_URL`.
- Supabase: proyecto reactivado (estaba pausado), `chats`/`folders` vaciados, schema creado.
- Deploy: `npm test && vercel --prod --yes`.

## Pruebas (23 en verde)

- `test/*.test.js`: pipeline (transcripción + completion), web search, claves (env vs navegador), markdown.
- Browser (Playwright + fake mic de Chromium): mic-larga en app y chat-long, marca limpia, Gemini flujo corto, labs.

## Pendiente / próximo

- Elegir **voz de salida** del lab y dejarla como voz de respuestas en la app.
- Migrar el system prompt nuevo también a los chats existentes (si se desea).
- Bajar la latencia/peso de Piper sirviendo modelos desde este servidor.