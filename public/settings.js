// Global settings: speech-to-text provider, response model provider, voice
// and API keys. Owns the settings sheet UI and exposes window.VoiceSettings so
// app.js / long-record.js can build request bodies.
//
// Storage (localStorage, this browser only):
//   selectedModel  "pipeline:<openrouter id>" or "pipeline:<provider>:<model id>"
//   sttProvider / sttModel
//   <provider>ApiKey  groqApiKey, openrouterApiKey, openaiApiKey, anthropicApiKey, geminiApiKey
//   llmCustomModels   [{ provider, id, name }]
(() => {
  'use strict';

  const LLM_PROVIDERS = {
    openrouter: { label: 'OpenRouter', hint: 'Cientos de modelos con una clave', keyName: 'openrouterApiKey', placeholder: 'sk-or-v1-…', keyUrl: 'https://openrouter.ai/keys' },
    anthropic: { label: 'Anthropic', hint: 'Claude directo', keyName: 'anthropicApiKey', placeholder: 'sk-ant-…', keyUrl: 'https://console.anthropic.com/settings/keys' },
    openai: { label: 'OpenAI', hint: 'GPT directo', keyName: 'openaiApiKey', placeholder: 'sk-…', keyUrl: 'https://platform.openai.com/api-keys' },
    groq: { label: 'Groq', hint: 'Respuestas ultrarrápidas', keyName: 'groqApiKey', placeholder: 'gsk_…', keyUrl: 'https://console.groq.com/keys' },
    google: { label: 'Google', hint: 'Gemini directo', keyName: 'geminiApiKey', placeholder: 'AIza…', keyUrl: 'https://aistudio.google.com/apikey' },
  };

  // Notes come from llm_voice_bench (2026-10, v2 prompt, 54 real turns).
  const LLM_PRESETS = {
    openrouter: [
      { id: 'deepseek/deepseek-v4.1-flash', name: 'DeepSeek V4.1 Flash', note: 'Bench 74 · ~$0.22 por 1.000 respuestas', badge: 'Recomendado' },
      { id: 'anthropic/claude-sonnet-5.5', name: 'Claude Sonnet 5.5', note: 'Bench 82 · máxima calidad, ~30× costo' },
      { id: 'openai/gpt-5.6-luna', name: 'GPT-5.6 Luna', note: 'Bench 79' },
      { id: 'openai/gpt-6-luna', name: 'GPT-6 Luna', note: 'Bench 74' },
      { id: 'z-ai/glm-5.3-flash', name: 'GLM 5.3 Flash', note: 'Bench 72 · rápido' },
      { id: 'google/gemini-3.5-flash', name: 'Gemini 3.5 Flash', note: '' },
    ],
    anthropic: [
      { id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5', note: 'El mejor del benchmark', badge: 'Recomendado' },
      { id: 'claude-haiku-5-5', name: 'Claude Haiku 5.5', note: 'Rápido y muy barato' },
      { id: 'claude-opus-5-5', name: 'Claude Opus 5.5', note: 'Máxima inteligencia, más lento' },
    ],
    openai: [
      { id: 'gpt-5.6-luna', name: 'GPT-5.6 Luna', note: 'Bench 79', badge: 'Recomendado' },
      { id: 'gpt-6-luna', name: 'GPT-6 Luna', note: 'Bench 74' },
      { id: 'gpt-5.4-mini', name: 'GPT-5.4 mini', note: 'Barato' },
    ],
    groq: [
      { id: 'openai/gpt-oss-120b', name: 'GPT-OSS 120B', note: 'Abierto, muy rápido', badge: 'Recomendado' },
      { id: 'openai/gpt-oss-20b', name: 'GPT-OSS 20B', note: 'El más rápido' },
      { id: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B', note: '' },
    ],
    google: [
      { id: 'gemini-3.5-flash', name: 'Gemini 3.5 Flash', note: 'Equilibrado', badge: 'Recomendado' },
      { id: 'gemini-3.1-flash-lite', name: 'Gemini 3.1 Flash Lite', note: 'El más rápido' },
      { id: 'gemini-3.1-pro-preview', name: 'Gemini 3.1 Pro', note: 'Más inteligente, más lento' },
    ],
  };

  const STT_PROVIDERS = {
    groq: { label: 'Groq', sub: 'Whisper', keyName: 'groqApiKey', placeholder: 'gsk_…', keyUrl: 'https://console.groq.com/keys' },
    google: { label: 'Google', sub: 'Gemini', keyName: 'geminiApiKey', placeholder: 'AIza…', keyUrl: 'https://aistudio.google.com/apikey' },
    openai: { label: 'OpenAI', sub: 'GPT-4o', keyName: 'openaiApiKey', placeholder: 'sk-…', keyUrl: 'https://platform.openai.com/api-keys' },
  };

  const STT_PRESETS = {
    groq: [
      { id: 'whisper-large-v3-turbo', name: 'Whisper turbo', note: 'whisper-large-v3-turbo · rápido y barato', badge: 'Recomendado' },
      { id: 'whisper-large-v3', name: 'Whisper v3', note: 'whisper-large-v3 · un poco más preciso' },
    ],
    google: [
      { id: 'gemini-3.1-flash-lite', name: 'Gemini Flash Lite', note: 'Rápido, buen límite gratuito', badge: 'Recomendado' },
      { id: 'gemini-3.5-transcribe', name: 'Gemini Transcribe', note: 'Dedicado · gratis solo 3 por minuto (usa fragmentos de 30 s)' },
    ],
    openai: [
      { id: 'gpt-4o-mini-transcribe', name: 'GPT-4o mini transcribe', note: 'Barato', badge: 'Recomendado' },
      { id: 'gpt-4o-transcribe', name: 'GPT-4o transcribe', note: 'Más preciso' },
      { id: 'whisper-1', name: 'Whisper 1', note: 'Clásico' },
    ],
  };

  const VOICES = [
    { id: 'es-MX-JorgeNeural', name: 'Jorge', note: 'México · Edge' },
    { id: 'es-MX-DaliaNeural', name: 'Dalia', note: 'México · Edge' },
    { id: 'es-ES-AlvaroNeural', name: 'Álvaro', note: 'España · Edge' },
    { id: 'es-ES-ElviraNeural', name: 'Elvira', note: 'España · Edge' },
    { id: 'es-ES-XimenaNeural', name: 'Ximena', note: 'España · Edge' },
    { id: 'system', name: 'Voz del sistema', note: 'Sin conexión, la del navegador' },
  ];
  const DEFAULT_VOICE = 'es-MX-JorgeNeural';
  const CHUNK_OPTIONS = [5000, 10000, 15000, 20000, 30000];
  const DEFAULT_LLM = { provider: 'openrouter', model: 'deepseek/deepseek-v4.1-flash' };
  const ALL_KEYS = [
    ['openrouter', 'OpenRouter'], ['groq', 'Groq'], ['google', 'Google Gemini'], ['anthropic', 'Anthropic'], ['openai', 'OpenAI'],
  ];
  const PROVIDER_PREFIX = /^(openrouter|openai|anthropic|groq|google):(.+)$/;

  // ── Storage helpers ──
  const store = {
    get(key, fallback = '') { try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; } },
    set(key, value) { try { localStorage.setItem(key, value); } catch { /* private mode */ } },
  };
  const keyNameFor = (provider) => (LLM_PROVIDERS[provider] || STT_PROVIDERS[provider]).keyName;
  const getKey = (provider) => store.get(keyNameFor(provider)).trim();

  function parseSelected(value) {
    let v = String(value || '');
    if (v.startsWith('pipeline:')) v = v.slice('pipeline:'.length);
    else if (v.startsWith('openrouter:')) return { provider: 'openrouter', model: v.slice('openrouter:'.length) };
    else if (v.startsWith('google:')) return { provider: 'google', model: v.slice('google:'.length) };
    const m = v.match(PROVIDER_PREFIX);
    if (m) return { provider: m[1], model: m[2] };
    return v ? { provider: 'openrouter', model: v } : { ...DEFAULT_LLM };
  }
  function encodeSelected({ provider, model }) {
    return provider === 'openrouter' ? `pipeline:${model}` : `pipeline:${provider}:${model}`;
  }

  // One-time migrations: legacy direct values become pipeline values; old custom list moves over.
  (function migrate() {
    const raw = store.get('selectedModel');
    if (raw && !raw.startsWith('pipeline:')) store.set('selectedModel', encodeSelected(parseSelected(raw)));
    if (!store.get('llmCustomModels') && store.get('customModels')) {
      try {
        const old = JSON.parse(store.get('customModels')) || [];
        const migrated = old.map((m) => ({ ...parseSelected(m.value), name: m.name }))
          .map((m) => ({ provider: m.provider, id: m.model, name: m.name || m.model }));
        store.set('llmCustomModels', JSON.stringify(migrated));
      } catch { /* ignore broken legacy data */ }
    }
  })();

  function llm() {
    const sel = parseSelected(store.get('selectedModel'));
    return LLM_PROVIDERS[sel.provider] ? sel : { ...DEFAULT_LLM };
  }
  function stt() {
    const provider = STT_PROVIDERS[store.get('sttProvider')] ? store.get('sttProvider') : 'groq';
    const model = store.get('sttModel') || STT_PRESETS[provider][0].id;
    return { provider, model };
  }
  function customModels() {
    try { return JSON.parse(store.get('llmCustomModels', '[]')) || []; } catch { return []; }
  }
  function saveCustomModels(list) { store.set('llmCustomModels', JSON.stringify(list)); }

  function modelName(provider, id, presets = LLM_PRESETS) {
    const preset = (presets[provider] || []).find((m) => m.id === id);
    if (preset) return preset.name;
    const custom = customModels().find((m) => m.provider === provider && m.id === id);
    if (custom?.name && custom.name !== id) return custom.name;
    const bare = id.split('/').pop() || id;
    return bare.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }
  const voiceName = (id) => (VOICES.find((v) => v.id === id) || VOICES[0]).name;

  /** Request fields for /pipeline (LLM) and, optionally, the STT provider. */
  function requestFields({ withStt = false } = {}) {
    const { provider, model } = llm();
    const fields = { llmProvider: provider, model };
    const key = getKey(provider);
    if (key) fields[keyNameFor(provider)] = key;
    if (withStt) Object.assign(fields, sttFields());
    return fields;
  }
  /** Request fields for /transcribe. */
  function sttFields() {
    const { provider, model } = stt();
    const fields = { sttProvider: provider, sttModel: model };
    const key = getKey(provider);
    if (key) fields[keyNameFor(provider)] = key;
    return fields;
  }
  function summary() {
    const l = llm();
    const s = stt();
    return {
      llm: { ...l, label: LLM_PROVIDERS[l.provider].label, name: modelName(l.provider, l.model) },
      stt: { ...s, label: STT_PROVIDERS[s.provider].label, name: modelName(s.provider, s.model, STT_PRESETS) },
      voice: voiceName(store.get('ttsVoice') || DEFAULT_VOICE),
    };
  }

  function emitChange() {
    renderChips();
    window.dispatchEvent(new CustomEvent('voice-settings-change', { detail: summary() }));
  }

  // ── Provider status (POST /models): key validity, credit and catalog ──
  const statusCache = new Map();
  function statusFor(provider, force = false) {
    const key = getKey(provider);
    const cacheKey = provider + '|' + key;
    if (!force && statusCache.has(cacheKey)) return statusCache.get(cacheKey);
    const body = { provider };
    if (key) body[keyNameFor(provider)] = key;
    const promise = fetch('/models', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then((r) => r.json().then((data) => (r.ok ? data : { key: { ok: false, error: data.error || `HTTP ${r.status}` }, models: [] })))
      .catch((error) => ({ key: { ok: false, error: 'Sin conexión: ' + error.message }, models: [] }));
    statusCache.set(cacheKey, promise);
    return promise;
  }

  // ── DOM helpers ──
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const icon = {
    mic: '<path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2z"/>',
    spark: '<path d="M12 2l1.9 5.6L19.5 9.5l-5.6 1.9L12 17l-1.9-5.6L4.5 9.5l5.6-1.9L12 2zm7 11l.9 2.6 2.6.9-2.6.9L19 21l-.9-2.6-2.6-.9 2.6-.9L19 13z"/>',
    speaker: '<path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 7.97v8.05A4.5 4.5 0 0 0 16.5 12z"/>',
    key: '<path d="M12.65 10A6 6 0 1 0 7 18a6 6 0 0 0 5.65-4H17v4h4v-4h2v-4H12.65zM7 14a2 2 0 1 1 0-4 2 2 0 0 1 0 4z"/>',
    check: '<path d="M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>',
    eye: '<path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17a5 5 0 1 1 0-10 5 5 0 0 1 0 10zm0-8a3 3 0 1 0 0 6 3 3 0 0 0 0-6z"/>',
    chevron: '<path d="M9.29 6.71 10.7 5.3 17.41 12l-6.71 6.7-1.41-1.41L14.59 12z"/>',
    search: '<path d="M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0A4.5 4.5 0 1 1 14 9.5 4.49 4.49 0 0 1 9.5 14z"/>',
    play: '<path d="M8 5v14l11-7z"/>',
    close: '<path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>',
  };
  const svg = (name, size = 18) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="currentColor" aria-hidden="true">${icon[name]}</svg>`;

  // ── Sheet skeleton ──
  const root = document.createElement('div');
  root.className = 'st-overlay';
  root.id = 'settingsSheet';
  root.setAttribute('aria-hidden', 'true');
  root.innerHTML = `
    <section class="st-sheet" role="dialog" aria-modal="true" aria-labelledby="stTitle">
      <header class="st-head">
        <h2 id="stTitle">Ajustes</h2>
        <button type="button" class="st-done" data-close>Listo</button>
      </header>
      <div class="st-body" id="stBody">
        <nav class="st-flow" aria-label="Resumen: tu voz pasa por estos tres pasos">
          <button type="button" class="st-flow-step" data-jump="stt"><span class="st-flow-icon">${svg('mic', 16)}</span><span class="st-flow-text"><small>1 · Transcripción</small><b data-sum="stt"></b></span>${svg('chevron', 16)}</button>
          <button type="button" class="st-flow-step" data-jump="llm"><span class="st-flow-icon">${svg('spark', 16)}</span><span class="st-flow-text"><small>2 · Respuesta</small><b data-sum="llm"></b></span>${svg('chevron', 16)}</button>
          <button type="button" class="st-flow-step" data-jump="voice"><span class="st-flow-icon">${svg('speaker', 16)}</span><span class="st-flow-text"><small>3 · Voz</small><b data-sum="voice"></b></span>${svg('chevron', 16)}</button>
        </nav>

        <section class="st-section" id="st-stt">
          <div class="st-section-head"><span class="st-num">1</span><div><h3>Transcripción</h3><p>Convierte tu voz en texto mientras hablas.</p></div></div>
          <div class="st-seg" role="radiogroup" aria-label="Proveedor de transcripción" data-role="stt-providers"></div>
          <div class="st-cards" role="radiogroup" aria-label="Modelo de transcripción" data-role="stt-models"></div>
          <div data-role="stt-key"></div>
          <div class="st-field">
            <div class="st-field-label">Enviar audio cada</div>
            <div class="st-seg st-seg-small" role="radiogroup" aria-label="Duración de cada fragmento" data-role="chunks"></div>
            <p class="st-hint">Fragmentos más cortos muestran el texto antes; más largos dan un poco más de contexto a la transcripción.</p>
          </div>
        </section>

        <section class="st-section" id="st-llm">
          <div class="st-section-head"><span class="st-num">2</span><div><h3>Modelo de respuesta</h3><p>La IA que lee tu transcripción y te responde.</p></div></div>
          <div class="st-chips" role="radiogroup" aria-label="Proveedor del modelo" data-role="llm-providers"></div>
          <div class="st-cards" role="radiogroup" aria-label="Modelo" data-role="llm-models"></div>
          <div class="st-browse" data-role="browse">
            <button type="button" class="st-browse-toggle" data-role="browse-toggle">${svg('search', 16)}<span>Buscar otro modelo</span></button>
            <div class="st-browse-panel" data-role="browse-panel" hidden>
              <input type="search" class="st-input" data-role="browse-search" placeholder="Busca por nombre o pega un ID…" autocomplete="off" autocapitalize="off" spellcheck="false" />
              <div class="st-browse-list" data-role="browse-list"></div>
            </div>
          </div>
          <div data-role="llm-key"></div>
        </section>

        <section class="st-section" id="st-voice">
          <div class="st-section-head"><span class="st-num">3</span><div><h3>Voz de respuestas</h3><p>Cómo suena la IA cuando lee en voz alta.</p></div></div>
          <div class="st-cards st-cards-compact" role="radiogroup" aria-label="Voz" data-role="voices"></div>
          <div class="st-row">
            <label class="st-switch"><input type="checkbox" data-role="auto-tts" /><span class="st-switch-ui"></span><span>Leer cada respuesta automáticamente</span></label>
            <button type="button" class="st-ghost" data-role="voice-test">${svg('play', 14)} Probar</button>
          </div>
        </section>

        <section class="st-section" id="st-keys">
          <div class="st-section-head"><span class="st-num">${svg('key', 14)}</span><div><h3>Claves API</h3><p>Se guardan solo en este navegador. Si el servidor tiene una clave válida se usa esa; la tuya sirve de respaldo.</p></div></div>
          <div class="st-keylist" data-role="all-keys"></div>
        </section>
      </div>
    </section>`;
  document.body.appendChild(root);
  const $ = (role) => root.querySelector(`[data-role="${role}"]`);
  let browseProvider = null;

  // ── Renderers ──
  function radioCard({ name, group, value, title, note, badge, checked, removable }) {
    return `
      <label class="st-card${checked ? ' is-on' : ''}">
        <input type="radio" name="${group}" value="${esc(value)}" ${checked ? 'checked' : ''} />
        <span class="st-card-main"><span class="st-card-title">${esc(title)}${badge ? ` <em class="st-badge">${esc(badge)}</em>` : ''}</span>${note ? `<span class="st-card-note">${esc(note)}</span>` : ''}</span>
        ${removable ? `<button type="button" class="st-card-remove" data-remove="${esc(value)}" aria-label="Quitar ${esc(title)}">${svg('close', 14)}</button>` : `<span class="st-card-check">${svg('check', 16)}</span>`}
      </label>`;
  }

  function renderStt() {
    const cur = stt();
    $('stt-providers').innerHTML = Object.entries(STT_PROVIDERS).map(([id, p]) => `
      <button type="button" role="radio" aria-checked="${id === cur.provider}" class="st-seg-btn${id === cur.provider ? ' is-on' : ''}" data-stt-provider="${id}">
        <b>${p.label}</b><small>${p.sub}</small>
      </button>`).join('');
    $('stt-models').innerHTML = STT_PRESETS[cur.provider].map((m) => radioCard({
      group: 'sttModel', value: m.id, title: m.name, note: m.note, badge: m.badge, checked: m.id === cur.model,
    })).join('');
    renderKeyBox($('stt-key'), cur.provider, STT_PROVIDERS[cur.provider]);
    const chunk = Number(store.get('voiceChunkMs')) || 10000;
    $('chunks').innerHTML = CHUNK_OPTIONS.map((ms) => `
      <button type="button" role="radio" aria-checked="${ms === chunk}" class="st-seg-btn${ms === chunk ? ' is-on' : ''}" data-chunk="${ms}"><b>${ms / 1000} s</b></button>`).join('');
  }

  function renderLlm() {
    const cur = llm();
    $('llm-providers').innerHTML = Object.entries(LLM_PROVIDERS).map(([id, p]) => `
      <button type="button" role="radio" aria-checked="${id === cur.provider}" class="st-chip${id === cur.provider ? ' is-on' : ''}" data-llm-provider="${id}">${p.label}</button>`).join('');
    const presets = LLM_PRESETS[cur.provider] || [];
    const customs = customModels().filter((m) => m.provider === cur.provider && !presets.some((p) => p.id === m.id));
    // A selected model that is neither preset nor custom (e.g. typed elsewhere) still gets a card.
    if (!presets.some((p) => p.id === cur.model) && !customs.some((c) => c.id === cur.model)) {
      customs.unshift({ provider: cur.provider, id: cur.model, name: modelName(cur.provider, cur.model) });
    }
    $('llm-models').innerHTML = [
      ...presets.map((m) => radioCard({ group: 'llmModel', value: m.id, title: m.name, note: m.note, badge: m.badge, checked: m.id === cur.model })),
      ...customs.map((m) => radioCard({ group: 'llmModel', value: m.id, title: m.name || m.id, note: m.id !== m.name ? m.id : 'Personalizado', checked: m.id === cur.model, removable: true })),
    ].join('');
    root.querySelector('[data-role="browse-toggle"] span').textContent = `Buscar otro modelo de ${LLM_PROVIDERS[cur.provider].label}`;
    if (browseProvider && browseProvider !== cur.provider) closeBrowse();
    renderKeyBox($('llm-key'), cur.provider, LLM_PROVIDERS[cur.provider]);
  }

  function renderVoices() {
    const cur = store.get('ttsVoice') || DEFAULT_VOICE;
    $('voices').innerHTML = VOICES.map((v) => radioCard({ group: 'ttsVoice', value: v.id, title: v.name, note: v.note, checked: v.id === cur })).join('');
    $('auto-tts').checked = store.get('autoTts') === 'true';
  }

  function renderAllKeys() {
    $('all-keys').innerHTML = ALL_KEYS.map(([provider, label]) => `
      <details class="st-keyitem" data-provider="${provider}">
        <summary><span>${label}</span><span class="st-status" data-status-for="${provider}">…</span>${svg('chevron', 16)}</summary>
        <div class="st-keyitem-body"></div>
      </details>`).join('');
    $('all-keys').querySelectorAll('.st-keyitem').forEach((item) => {
      const provider = item.dataset.provider;
      renderKeyBox(item.querySelector('.st-keyitem-body'), provider, LLM_PROVIDERS[provider], { compact: true });
      refreshStatus(provider);
    });
  }

  function renderKeyBox(container, provider, spec, { compact = false } = {}) {
    const value = getKey(provider);
    container.innerHTML = `
      <div class="st-key${compact ? ' st-key-compact' : ''}" data-key-provider="${provider}">
        ${compact ? '' : `<div class="st-key-top"><span class="st-field-label">Clave de ${esc(LLM_PROVIDERS[provider].label)}</span><span class="st-status" data-status-for="${provider}">…</span></div>`}
        <div class="st-key-row">
          <input type="password" class="st-input" data-key-input="${provider}" value="${esc(value)}" placeholder="${esc(spec.placeholder)}" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="Clave API de ${esc(LLM_PROVIDERS[provider].label)}" />
          <button type="button" class="st-icon-btn" data-key-reveal aria-label="Mostrar u ocultar">${svg('eye', 16)}</button>
        </div>
        <div class="st-key-foot">
          <a href="${spec.keyUrl}" target="_blank" rel="noopener">Conseguir una clave</a>
          <span class="st-key-detail" data-detail-for="${provider}"></span>
        </div>
      </div>`;
    refreshStatus(provider);
  }

  async function refreshStatus(provider, force = false) {
    const badges = () => root.querySelectorAll(`[data-status-for="${provider}"]`);
    const details = () => root.querySelectorAll(`[data-detail-for="${provider}"]`);
    badges().forEach((b) => { b.className = 'st-status is-busy'; b.textContent = 'Comprobando…'; });
    const data = await statusFor(provider, force);
    let cls = 'is-bad';
    let text = 'Falta clave';
    let detail = '';
    if (data.key?.ok) {
      cls = 'is-ok';
      text = data.key.source === 'browser' ? '✓ Tu clave' : '✓ Clave del servidor';
    } else if (data.keys?.server || data.keys?.browser || getKey(provider)) {
      text = 'Clave inválida';
      detail = data.key?.error || '';
    }
    if (data.credit && data.credit.remaining != null) {
      detail = `Saldo: $${Number(data.credit.remaining).toFixed(2)}${data.credit.limit ? ` de $${data.credit.limit}` : ''}`;
    }
    badges().forEach((b) => { b.className = 'st-status ' + cls; b.textContent = text; });
    details().forEach((d) => { d.textContent = detail; d.classList.toggle('is-bad', cls === 'is-bad'); });
    return data;
  }

  function renderSummary() {
    const s = summary();
    root.querySelector('[data-sum="stt"]').textContent = `${s.stt.name} · ${s.stt.label}`;
    root.querySelector('[data-sum="llm"]').textContent = `${s.llm.name} · ${s.llm.label}`;
    root.querySelector('[data-sum="voice"]').textContent = s.voice;
  }

  function renderAll() {
    renderSummary();
    renderStt();
    renderLlm();
    renderVoices();
    renderAllKeys();
  }

  // ── Model browser (live catalog) ──
  function closeBrowse() {
    browseProvider = null;
    $('browse-panel').hidden = true;
    $('browse').classList.remove('is-open');
  }
  async function openBrowse() {
    const provider = llm().provider;
    browseProvider = provider;
    $('browse-panel').hidden = false;
    $('browse').classList.add('is-open');
    $('browse-list').innerHTML = '<div class="st-empty">Cargando modelos…</div>';
    const data = await statusFor(provider);
    if (browseProvider !== provider) return;
    renderBrowse(data);
    $('browse-search').focus({ preventScroll: true });
  }
  function renderBrowse(data) {
    const list = $('browse-list');
    const q = $('browse-search').value.trim().toLowerCase();
    const models = data?.models || [];
    if (!models.length) {
      list.innerHTML = `<div class="st-empty">${esc(data?.key?.ok === false ? 'No se pudo cargar la lista: ' + (data.key.error || 'revisa la clave') : 'Sin modelos')}. Puedes escribir el ID exacto arriba y pulsar Enter.</div>`;
      return;
    }
    const hits = models.filter((m) => !q || m.id.toLowerCase().includes(q) || (m.name || '').toLowerCase().includes(q)).slice(0, 60);
    const fmt = (n) => (n < 0.1 ? n.toFixed(3) : n.toFixed(2));
    list.innerHTML = hits.map((m) => `
      <button type="button" class="st-browse-item" data-pick="${esc(m.id)}" data-name="${esc(m.name || m.id)}">
        <span class="st-browse-name">${esc(m.name || m.id)}</span>
        <span class="st-browse-meta">${esc(m.id)}${m.price && Number.isFinite(m.price.input) ? ` · $${fmt(m.price.input)} / $${fmt(m.price.output)} por M` : ''}</span>
      </button>`).join('') || `<div class="st-empty">Nada coincide. Pulsa Enter para usar “${esc(q)}” como ID.</div>`;
  }
  function pickModel(provider, id, name) {
    id = id.trim().replace(/^models\//, '');
    if (!id) return;
    const presets = LLM_PRESETS[provider] || [];
    if (!presets.some((p) => p.id === id)) {
      const list = customModels().filter((m) => !(m.provider === provider && m.id === id));
      list.push({ provider, id, name: name || id });
      saveCustomModels(list);
    }
    store.set('selectedModel', encodeSelected({ provider, model: id }));
    closeBrowse();
    $('browse-search').value = '';
    renderLlm();
    renderSummary();
    emitChange();
  }

  // ── Events ──
  root.addEventListener('click', (e) => {
    const t = e.target;
    if (t === root || t.closest('[data-close]')) return close();
    const jump = t.closest('[data-jump]');
    if (jump) {
      root.querySelector('#st-' + jump.dataset.jump)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    const sttBtn = t.closest('[data-stt-provider]');
    if (sttBtn) {
      const provider = sttBtn.dataset.sttProvider;
      if (provider !== stt().provider) {
        store.set('sttProvider', provider);
        store.set('sttModel', STT_PRESETS[provider][0].id);
        renderStt(); renderSummary(); emitChange();
      }
      return;
    }
    const llmBtn = t.closest('[data-llm-provider]');
    if (llmBtn) {
      const provider = llmBtn.dataset.llmProvider;
      if (provider !== llm().provider) {
        // Remember the last model per provider so switching back restores it.
        const prev = llm();
        store.set('lastModel:' + prev.provider, prev.model);
        const model = store.get('lastModel:' + provider) || LLM_PRESETS[provider][0].id;
        store.set('selectedModel', encodeSelected({ provider, model }));
        renderLlm(); renderSummary(); emitChange();
      }
      return;
    }
    const chunk = t.closest('[data-chunk]');
    if (chunk) {
      store.set('voiceChunkMs', chunk.dataset.chunk);
      renderStt();
      return;
    }
    const remove = t.closest('[data-remove]');
    if (remove) {
      e.preventDefault();
      const { provider, model } = llm();
      const id = remove.dataset.remove;
      saveCustomModels(customModels().filter((m) => !(m.provider === provider && m.id === id)));
      if (model === id) store.set('selectedModel', encodeSelected({ provider, model: LLM_PRESETS[provider][0].id }));
      renderLlm(); renderSummary(); emitChange();
      return;
    }
    if (t.closest('[data-role="browse-toggle"]')) {
      if (browseProvider) closeBrowse(); else openBrowse();
      return;
    }
    const pick = t.closest('[data-pick]');
    if (pick) return pickModel(llm().provider, pick.dataset.pick, pick.dataset.name);
    const reveal = t.closest('[data-key-reveal]');
    if (reveal) {
      const input = reveal.parentElement.querySelector('input');
      input.type = input.type === 'password' ? 'text' : 'password';
      return;
    }
    if (t.closest('[data-role="voice-test"]')) testVoice();
  });

  root.addEventListener('change', (e) => {
    const t = e.target;
    if (t.name === 'sttModel') { store.set('sttModel', t.value); renderStt(); renderSummary(); emitChange(); }
    if (t.name === 'llmModel') {
      store.set('selectedModel', encodeSelected({ provider: llm().provider, model: t.value }));
      renderLlm(); renderSummary(); emitChange();
    }
    if (t.name === 'ttsVoice') { store.set('ttsVoice', t.value); renderVoices(); renderSummary(); emitChange(); }
    if (t.dataset.role === 'auto-tts') { store.set('autoTts', String(t.checked)); emitChange(); }
    if (t.dataset.keyInput) commitKey(t.dataset.keyInput, t.value);
  });

  let keyTimer = null;
  root.addEventListener('input', (e) => {
    const t = e.target;
    if (t.dataset.role === 'browse-search') {
      statusFor(llm().provider).then(renderBrowse);
      return;
    }
    if (t.dataset.keyInput) {
      // Mirror the value into the other box for the same provider, save after a pause.
      root.querySelectorAll(`[data-key-input="${t.dataset.keyInput}"]`).forEach((other) => { if (other !== t) other.value = t.value; });
      clearTimeout(keyTimer);
      keyTimer = setTimeout(() => commitKey(t.dataset.keyInput, t.value), 700);
    }
  });

  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); close(); }
    if (e.key === 'Enter' && e.target.dataset.role === 'browse-search') {
      e.preventDefault();
      const first = $('browse-list').querySelector('[data-pick]');
      const q = e.target.value.trim();
      if (first && !q.includes('/') && !q.includes('-')) pickModel(llm().provider, first.dataset.pick, first.dataset.name);
      else if (q) pickModel(llm().provider, q, q);
    }
  });

  function commitKey(provider, value) {
    clearTimeout(keyTimer);
    const clean = String(value || '').trim();
    if (clean === getKey(provider)) return;
    store.set(keyNameFor(provider), clean);
    refreshStatus(provider, true);
  }

  let testAudio = null;
  function testVoice() {
    const voice = store.get('ttsVoice') || DEFAULT_VOICE;
    const text = 'Hola. Así sonarán mis respuestas cuando las lea en voz alta.';
    if (testAudio) { testAudio.pause(); testAudio = null; }
    window.speechSynthesis?.cancel();
    const speakSystem = () => {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'es-MX';
      window.speechSynthesis?.speak(u);
    };
    if (voice === 'system') return speakSystem();
    testAudio = new Audio('/tts?voice=' + encodeURIComponent(voice) + '&format=mp3&text=' + encodeURIComponent(text));
    testAudio.onerror = () => { testAudio = null; flash('La voz de Edge no respondió; uso la del sistema.'); speakSystem(); };
    testAudio.play().catch(() => {});
  }

  function flash(message) {
    if (typeof window.showToast === 'function') window.showToast(message, false);
  }

  // ── Open / close ──
  let lastFocus = null;
  function open(section) {
    lastFocus = document.activeElement;
    renderAll();
    root.classList.add('open');
    root.setAttribute('aria-hidden', 'false');
    const body = root.querySelector('#stBody');
    body.scrollTop = 0;
    if (section) requestAnimationFrame(() => root.querySelector('#st-' + section)?.scrollIntoView({ block: 'start' }));
    root.querySelector('.st-done').focus({ preventScroll: true });
  }
  function close() {
    if (!root.classList.contains('open')) return;
    const active = document.activeElement;
    if (active?.dataset?.keyInput) commitKey(active.dataset.keyInput, active.value);
    root.classList.remove('open');
    root.setAttribute('aria-hidden', 'true');
    closeBrowse();
    emitChange();
    lastFocus?.focus?.({ preventScroll: true });
  }

  // ── Topbar chip ──
  function renderChips() {
    const s = summary();
    document.querySelectorAll('[data-settings-chip]').forEach((chip) => {
      chip.textContent = s.llm.name;
      chip.title = `Respuesta: ${s.llm.label} · ${s.llm.model}\nTranscripción: ${s.stt.label} · ${s.stt.model}`;
    });
  }

  document.addEventListener('click', (e) => {
    const opener = e.target.closest('[data-open-settings]');
    if (!opener) return;
    e.preventDefault();
    open(opener.dataset.openSettings || undefined);
  });
  renderChips();

  window.VoiceSettings = {
    open, close, llm, stt, summary, requestFields, sttFields,
    modelLabel: (provider, id) => modelName(provider, id),
    providerLabel: (provider) => LLM_PROVIDERS[provider]?.label || provider,
  };
})();
