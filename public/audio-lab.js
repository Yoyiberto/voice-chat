(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const state = $('state');
  const recordBtn = $('recordBtn');
  const recordLabel = $('recordLabel');
  const timerEl = $('recordTimer');
  const metricsEl = $('metrics');
  const errorEl = $('error');
  const resultsEl = $('results');
  const runVariantsBtn = $('runVariantsBtn');

  const MAX_SECONDS = 30;

  let recorder = null;
  let stream = null;
  let chunks = [];
  let startedAt = 0;
  let timerInt = null;
  let rawBlob = null;

  const cleanMarkdown = (window.VoiceCleanMarkdown || {}).cleanMarkdown || ((t) => t);
  const VA = window.VoiceAudio || {};

  function setBusy(on, label) {
    state.textContent = label || (on ? 'RUNNING…' : 'READY');
    state.classList.toggle('busy', on);
    recordBtn.disabled = on;
    runVariantsBtn.disabled = on || !rawBlob;
  }
  function setError(msg) { errorEl.textContent = msg || ''; }

  function formatTime(s) { return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }
  function clock() {
    const secs = Math.floor((Date.now() - startedAt) / 1000);
    timerEl.textContent = formatTime(secs);
    if (secs >= MAX_SECONDS) stopRecording();
  }

  function mimeType() { return ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg'].find((t) => (window.MediaRecorder && window.MediaRecorder.isTypeSupported ? window.MediaRecorder.isTypeSupported(t) : false)) || ''; }

  async function startRecording() {
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) { setError('Este navegador no soporta grabación.'); return; }
    setError('');
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) { setError('No se pudo acceder al micrófono: ' + e.message); return; }
    chunks = [];
    const type = mimeType();
    recorder = new MediaRecorder(stream, type ? { mimeType: type } : {});
    recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    recorder.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      clearInterval(timerInt);
      recordBtn.classList.remove('active');
      recordLabel.textContent = 'Grabar';
      if (!chunks.length) return;
      rawBlob = new Blob(chunks, { type: recorder.mimeType || type || 'audio/webm' });
      await showMetrics(rawBlob);
      runVariantsBtn.disabled = false;
      setBusy(false);
    };
    recorder.start();
    startedAt = Date.now();
    timerInt = setInterval(clock, 250);
    recordBtn.classList.add('active');
    recordLabel.textContent = 'Detener';
  }

  function stopRecording() { if (recorder && recorder.state !== 'inactive') recorder.stop(); }

  async function showMetrics(blob) {
    const sizeKb = Math.round(blob.size / 1024);
    const type = blob.type || 'desconocido';
    let peak = '—', rate = '—', channels = '—', dur = '—';
    if (VA.decodeBlob) {
      try {
        const info = await VA.decodeBlob(blob);
        peak = info.peak ? (-20 * Math.log10(info.peak)).toFixed(1) + ' dBFS' : 'silencioso';
        rate = info.sampleRate + ' Hz';
        channels = info.channels + 'ch';
        dur = (info.durationMs / 1000).toFixed(1) + ' s';
      } catch (e) { peak = '—'; }
    }
    metricsEl.innerHTML = [
      ['Tamaño', sizeKb + ' KB'],
      ['Formato', type.split(';')[0]],
      ['Pico', peak],
      ['Sample rate', rate],
      ['Canales', channels],
      ['Duración', dur],
    ].map(([k, v]) => `<div class="metric"><b>${v}</b><small>${k}</small></div>`).join('');
  }

  function blobVariants() {
    const variants = [
      { name: 'Crudo (control)', key: 'raw', build: () => Promise.resolve({ blob: rawBlob }) },
      { name: 'WAV 16 kHz (como hoy)', key: 'wav', build: () => VA.normalizeAudio(rawBlob, { gain: 1, targetPeak: null }).then((o) => ({ blob: o.blob })) },
      { name: 'WAV 16 kHz + ganancia x2', key: 'gain2', build: () => VA.normalizeAudio(rawBlob, { gain: 2, targetPeak: null }).then((o) => ({ blob: o.blob })) },
      { name: 'WAV + normalizado pico', key: 'norm', build: () => VA.normalizeAudio(rawBlob, { gain: 1, targetPeak: 0.85 }).then((o) => ({ blob: o.blob })) },
      { name: 'WAV + normalizado intenso', key: 'normhard', build: () => VA.normalizeAudio(rawBlob, { gain: 1, targetPeak: 0.98 }).then((o) => ({ blob: o.blob })) },
    ];
    return variants;
  }

  function toBase64(blob) { return new Promise((resolve, reject) => { const r = new FileReader(); r.onloadend = () => resolve(String(r.result).split(',')[1]); r.onerror = reject; r.readAsDataURL(blob); }); }

  async function transcribe(blob) {
    const base64 = await toBase64(blob);
    const res = await fetch('/transcribe', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: 'audio-lab-' + Date.now(), audioBase64: base64, audioMimeType: (blob.type || 'audio/webm').split(';')[0], audioDuration: 1, groqApiKey: localStorage.getItem('groqApiKey') || '' }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Groq ${res.status}`);
    return (data.transcript || data.text || '').trim();
  }

  function escHtml(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  async function runAllVariants() {
    if (!rawBlob) return;
    setBusy(true, 'TRANSCRIBIENDO…');
    resultsEl.innerHTML = '<div class="empty">Transcribiendo variantes...</div>';
    const variants = blobVariants();
    const cards = [];
    for (const variant of variants) {
      try {
        const { blob } = await variant.build();
        const t0 = performance.now();
        const transcriptClean = cleanMarkdown(await transcribe(blob));
        const ms = Math.round(performance.now() - t0);
        const sizeKb = Math.round(blob.size / 1024);
        const tag = 'ok';
        cards.push({ variant, transcript: transcriptClean, ms, sizeKb, tag, error: null });
      } catch (err) {
        cards.push({ variant, transcript: '', ms: 0, sizeKb: 0, tag: 'fail', error: err.message });
      }
    }
    resultsEl.innerHTML = cards.map(({ variant, transcript, ms, sizeKb, tag, error }) => `
      <div class="variant">
        <div class="variant-head">
          <span class="variant-name">${escHtml(variant.name)}</span>
          <span class="variant-tag ${tag === 'fail' ? 'fail' : 'none'}">${error ? 'FALLO' : ms + ' ms · ' + sizeKb + ' KB'}</span>
        </div>
        ${error ? `<div class="variant-meta">${escHtml(error)}</div>` : `<div class="variant-transcript">${escHtml(transcript)}</div>`}
      </div>`).join('');
    setBusy(false);
  }

  recordBtn.addEventListener('click', () => { if (recorder && recorder.state === 'recording') stopRecording(); else startRecording(); });
  runVariantsBtn.addEventListener('click', runAllVariants);
  $('clearBtn').addEventListener('click', () => { if (recorder && recorder.state === 'recording') stopRecording(); rawBlob = null; chunks = []; metricsEl.innerHTML = ''; resultsEl.innerHTML = ''; setError(''); runVariantsBtn.disabled = true; setBusy(false); });
  setBusy(false);
})();