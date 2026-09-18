(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const sampleEl = $('sample');
  const volumeEl = $('volume');
  const volumeVal = $('volumeVal');
  const errorEl = $('error');
  const nativeList = $('nativeList');
  const edgeList = $('edgeList');
  const piperList = $('piperList');
  const nativeBadge = $('nativeBadge');
  const edgeBadge = $('edgeBadge');
  const piperBadge = $('piperBadge');

  const EDGE_VOICES = [
    ['es-ES-AlvaroNeural', 'Alvaro (España)'],
    ['es-ES-ElviraNeural', 'Elvira (España)'],
    ['es-ES-XimenaNeural', 'Ximena (España)'],
    ['es-ES-AbrilNeural', 'Abril (España)'],
    ['es-MX-DaliaNeural', 'Dalia (México)'],
    ['es-MX-JorgeNeural', 'Jorge (México)'],
    ['es-AR-ElenaNeural', 'Elena (Argentina)'],
    ['es-CL-CatalinaNeural', 'Catalina (Chile)'],
    ['es-CO-GonzaloNeural', 'Gonzalo (Colombia)'],
  ];
  const PIPER_SAMPLES = [
    { name: 'es_ES-carlfm-x_low', url: 'piper/es_ES-carlfm-x_low.onnx', cfg: 'piper/es_ES-carlfm-x_low.onnx.json' },
    { name: 'es_ES-davefx-medium', url: 'https://huggingface.co/rhasspy/piper-voices/resolve/main/es/es_ES/davefx/medium/es_ES-davefx-medium.onnx', cfg: 'https://huggingface.co/rhasspy/piper-voices/resolve/main/es/es_ES/davefx/medium/es_ES-davefx-medium.onnx.json' },
  ];

  let current = null;
  const synth = window.speechSynthesis;
  let edgeAudio = null;
  let piperApi = null;
  let piperEngine = null;
  let piperAudioContext = null;
  let piperConfigFile = null;

  function setError(msg) { errorEl.textContent = msg || ''; }
  function text() { return (sampleEl.value || '').trim(); }
  function vol() { return Math.max(0, Math.min(1, Number(volumeEl.value))); }
  volumeEl.addEventListener('input', () => {
    volumeVal.textContent = Math.round(vol() * 100) + '%';
    if (edgeAudio) edgeAudio.volume = vol();
    if (current && current.setVolume) current.setVolume(vol());
  });

  function speak(state) {
    stopAll(false);
    current = state;
    state.render();
  }
  function stopAll(clear = true) {
    if (synth) { try { synth.cancel(); } catch {} }
    if (edgeAudio) { try { edgeAudio.pause(); } catch {} }
    if (current) { try { current.stop(); } catch {} }
    if (clear) current = null;
    document.querySelectorAll('.voice.speaking').forEach((el) => el.classList.remove('speaking'));
  }
  $('stopAllBtn').addEventListener('click', () => stopAll());

  // ── Web Speech (system voices: Microsoft, Google, Apple) ──
  const nativeVoices = [];
  function refreshVoices() {
    nativeVoices.length = 0;
    if (!synth) return;
    (synth.getVoices() || []).filter((v) => /^es/i.test(v.lang || '')).forEach((v) => {
      if (!nativeVoices.some((x) => x.name === v.name)) nativeVoices.push(v);
    });
    renderNative();
  }
  function renderNative() {
    if (!nativeVoices.length) {
      nativeList.innerHTML = '<span class="empty">Cargando voces del sistema… (iOS tarda; usa un recuadro táctil)</span>';
      return;
    }
    nativeBadge.textContent = nativeVoices.length + ' voces';
    nativeList.innerHTML = '';
    nativeVoices.forEach((v) => {
      const row = document.createElement('div');
      row.className = 'voice';
      row.innerHTML = `<span class="vname">${v.name.replace(/[<>]/g, '')}</span><span class="vlang">${v.lang} · ${v.localService ? 'local' : 'red'}</span>`;
      const btn = document.createElement('button');
      btn.textContent = 'Hablar';
      btn.onclick = () => {
        if (current && current.el === row) { stopAll(); return; }
         stopAll();
         const u = new SpeechSynthesisUtterance(text() || 'Hola');
         u.voice = v; u.lang = v.lang; u.rate = 1.05; u.pitch = 1; u.volume = vol();
        u.onstart = () => { row.classList.add('speaking'); btn.textContent = 'Detener'; };
        u.onend = u.onerror = () => { row.classList.remove('speaking'); btn.textContent = 'Hablar'; };
        row.classList.add('speaking');
         current = { el: row, stop: () => synth.cancel(), setVolume: (value) => { u.volume = value; } };
          try { synth.resume(); } catch {}
          synth.speak(u);
      };
      row.appendChild(btn);
      nativeList.appendChild(row);
    });
  }
  if (synth) {
    synth.addEventListener('voiceschanged', refreshVoices);
    refreshVoices();
    setTimeout(refreshVoices, 300);
  } else {
    nativeBadge.textContent = 'no soportado';
    nativeList.innerHTML = '<span class="empty">Este navegador no expone la API de voz.</span>';
  }
  if (nativeVoices.length) renderNative();

  // ── Microsoft Edge neural (via server) ──
  function renderEdge() {
    edgeBadge.textContent = EDGE_VOICES.length + ' voces';
    edgeList.innerHTML = '';
    EDGE_VOICES.forEach(([id, label]) => {
      const row = document.createElement('div');
      row.className = 'voice';
      const name = document.createElement('span');
      name.className = 'vname';
      name.textContent = label;
      const lang = document.createElement('span');
      lang.className = 'vlang';
      lang.textContent = id;
      const btn = document.createElement('button');
      btn.textContent = 'Hablar';
      btn.onclick = () => {
        const t = () => text();
         if (!t()) { setError('Escribe algo para escuchar.'); return; }
         if (current && current.el === row) { stopAll(); return; }
         stopAll();
         row.classList.add('speaking');
        btn.textContent = 'Cargando…';
        const url = '/tts?voice=' + encodeURIComponent(id) + '&format=webm&text=' + encodeURIComponent(t());
        const au = new Audio(url);
        au.volume = vol();
         au.oncanplay = () => { btn.textContent = 'Detener'; };
         au.onended = () => { row.classList.remove('speaking'); btn.textContent = 'Hablar'; if (edgeAudio === au) edgeAudio = null; };
         au.onpause = () => { if (au.ended) return; };
        au.onerror = () => { row.classList.remove('speaking'); btn.textContent = 'Hablar'; setError('Edge TTS falló en el servidor. Revisa el endpoint /tts.'); };
        edgeAudio = au;
         current = { el: row, stop: () => { au.pause(); }, setVolume: (value) => { au.volume = value; } };
         au.play().catch(() => setError('El navegador bloqueó el audio. Pulsa Hablar de nuevo.'));
      };
      row.append(name, lang, btn);
      edgeList.appendChild(row);
    });
  }
  renderEdge();

  // ── Piper (local WASM) ──
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error('No se pudo cargar ' + src));
      document.head.appendChild(s);
    });
  }
  const PIPER_RUNTIME = 'piper-runtime/piper-tts-web.js';

  let piperReady = false;
  async function ensurePiper() {
    if (piperEngine) return piperEngine;
    piperBadge.textContent = 'cargando…';
    piperBadge.classList.add('warn');
    try {
      const mod = await import('./' + PIPER_RUNTIME);
      piperEngine = new mod.PiperWebEngine({
        voiceProvider: {
          fetch: async (voice) => {
            const entry = PIPER_SAMPLES.find((item) => item.name === voice);
            if (!entry) throw new Error('Voz Piper no encontrada');
            const [config, model] = await Promise.all([
              fetch(entry.cfg).then((r) => { if (!r.ok) throw new Error('No se pudo cargar la configuración'); return r.json(); }),
              fetch(entry.url).then((r) => { if (!r.ok) throw new Error('No se pudo cargar el modelo'); return r.arrayBuffer(); }),
            ]);
            return [config, model];
          },
          destroy() {},
        },
      });
      piperReady = true;
      piperBadge.textContent = 'listo';
      piperBadge.classList.remove('warn');
      return piperEngine;
    } catch (e) {
      piperBadge.textContent = 'no disponible';
      piperBadge.classList.add('warn');
      setError('Piper no pudo cargar: ' + e.message);
      return null;
    }
  }

  function getPiperAudioContext() {
    if (!piperAudioContext) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) throw new Error('Este navegador no soporta audio local.');
      piperAudioContext = new AudioContext();
    }
    return piperAudioContext;
  }

  function addPiperVoice(label, modelUrl, cfgUrl) {
    const row = document.createElement('div');
    row.className = 'voice';
    const name = document.createElement('span');
    name.className = 'vname';
    name.textContent = label;
    const btn = document.createElement('button');
    btn.textContent = 'Hablar';
    btn.onclick = async () => {
      try {
         if (current && current.el === row) { stopAll(); return; }
         stopAll();
         row.classList.add('speaking');
         btn.textContent = 'Preparando…';
         // Create/resume the output context during the click gesture. Mobile
         // browsers reject an audible start if the context is created later.
         const ctx = getPiperAudioContext();
         const resumePromise = ctx.resume();
         const api = await ensurePiper();
        if (!api) { row.classList.remove('speaking'); btn.textContent = 'Hablar'; return; }
         btn.textContent = 'Hablando…';
         const entry = { name: label.replace(' (local)', '').replace(' (archivo)', ''), url: modelUrl, cfg: cfgUrl };
         if (!PIPER_SAMPLES.some((item) => item.name === entry.name)) PIPER_SAMPLES.push(entry);
         const response = await api.generate(text() || 'Hola', entry.name);
         const blob = response.file;
         await resumePromise;
         const buffer = await ctx.decodeAudioData(await blob.arrayBuffer());
         const source = ctx.createBufferSource();
         const gain = ctx.createGain();
         source.buffer = buffer;
         gain.gain.value = vol();
         source.connect(gain).connect(ctx.destination);
         const finish = () => {
           row.classList.remove('speaking');
           btn.textContent = 'Hablar';
           if (current && current.el === row) current = null;
         };
         source.onended = finish;
         current = { el: row, stop: () => { try { source.stop(); } catch {} }, setVolume: (value) => { gain.gain.value = value; } };
         source.start();
      } catch (e) {
        row.classList.remove('speaking');
        btn.textContent = 'Hablar';
        setError('Piper: ' + e.message);
      }
    };
    row.append(name, btn);
    piperList.appendChild(row);
  }

  function renderPiper() {
    piperList.innerHTML = '';
    if (piperReady || piperApi) addPiperVoice('Piper es_ES (muestras)', PIPER_SAMPLES[0].url, PIPER_SAMPLES[0].cfg);
    $('loadPiperDemo').addEventListener('click', async () => {
      try {
        await ensurePiper();
        piperList.innerHTML = '';
        PIPER_SAMPLES.forEach((p) => addPiperVoice(p.name, p.url, p.cfg));
      } catch (e) { setError('Piper: ' + e.message); }
    });
    $('piperOnnx').addEventListener('change', (e) => {
      const f = e.target.files[0];
      if (!f) return;
      piperOnnxFile = f;
      piperBadge.textContent = piperConfigFile ? 'archivos listos' : 'falta config .json';
      if (piperConfigFile) addLocalPiperVoice();
    });
    $('piperJson').addEventListener('change', (e) => {
      const f = e.target.files[0];
      if (!f) return;
      piperConfigFile = f;
      piperBadge.textContent = piperOnnxFile ? 'archivos listos' : 'falta modelo .onnx';
      if (piperOnnxFile) addLocalPiperVoice();
    });
  }
  let piperOnnxFile = null;
  function addLocalPiperVoice() {
    const name = piperOnnxFile.name.replace(/\.onnx$/i, '');
    addPiperVoice(name + ' (archivo)', URL.createObjectURL(piperOnnxFile), URL.createObjectURL(piperConfigFile));
    piperBadge.textContent = 'archivo añadido';
  }
  renderPiper();

  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') stopAll(); });
})();
