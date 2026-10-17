(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.VoiceLongRecord = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Long voice notes: the mic is recorded in segments (default 10 s) that are
  // transcribed while you keep talking; the editable transcript is sent as text.
  const SEGMENT_MS = 10000;
  const MAX_TOTAL_SECONDS = 600;
  const MIN_SEGMENT_BYTES = 1200;
  const QUIET_LEVEL = 0.012;

  function formatTime(seconds) {
    const s = Math.max(0, Math.floor(seconds || 0));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  const ICONS = {
    close: '<path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>',
    pause: '<path d="M6 5h4v14H6zm8 0h4v14h-4z"/>',
    stop: '<rect x="6" y="6" width="12" height="12" rx="2.5"/>',
    mic: '<path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2z"/>',
    send: '<path d="M3.4 20.4 21 12 3.4 3.6 3.39 10.1 15 12 3.39 13.9z"/>',
    retry: '<path d="M17.65 6.35A7.96 7.96 0 0 0 12 4a8 8 0 1 0 7.73 10h-2.08A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/>',
  };
  const svg = (name, size = 24) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="currentColor" aria-hidden="true">${ICONS[name]}</svg>`;

  function createUi() {
    const root = document.createElement('div');
    root.className = 'lr-overlay';
    root.id = 'longRecordOverlay';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-label', 'Grabación de voz');
    root.innerHTML = `
      <div class="lr-card" data-state="idle">
        <header class="lr-top">
          <button type="button" class="lr-discard" data-lr="discard" aria-label="Descartar grabación">${svg('close', 20)}<span>¿Descartar?</span></button>
          <div class="lr-pill" data-lr="pill"><i class="lr-dot"></i><span data-lr="status">Listo</span></div>
          <div class="lr-timer" data-lr="timer">0:00</div>
        </header>
        <div class="lr-wave-wrap">
          <canvas class="lr-wave" data-lr="wave" aria-hidden="true"></canvas>
          <div class="lr-quiet" data-lr="quiet" hidden>No llega sonido… ¿el micrófono está activo?</div>
        </div>
        <div class="lr-segs-row">
          <div class="lr-segs" data-lr="segs" aria-hidden="true"></div>
          <span class="lr-segs-text" data-lr="segsText"></span>
          <button type="button" class="lr-retry" data-lr="retry" hidden>${svg('retry', 14)} Reintentar</button>
        </div>
        <div class="lr-text-wrap">
          <textarea class="lr-text" data-lr="text" placeholder="Habla con normalidad. El texto aparece aquí cada pocos segundos y puedes editarlo antes de enviar."></textarea>
        </div>
        <div class="lr-error" data-lr="error" hidden></div>
        <footer class="lr-controls">
          <div class="lr-ctl">
            <button type="button" class="lr-btn lr-btn-secondary" data-lr="secondary" aria-label="Pausar">${svg('pause')}</button>
            <span class="lr-ctl-label" data-lr="secondaryLabel">Pausar</span>
          </div>
          <div class="lr-ctl">
            <button type="button" class="lr-btn lr-btn-primary" data-lr="primary" aria-label="Terminar">${svg('stop', 28)}</button>
            <span class="lr-ctl-label" data-lr="primaryLabel">Terminar</span>
          </div>
          <div class="lr-ctl">
            <button type="button" class="lr-btn lr-btn-secondary lr-btn-quick" data-lr="quick" aria-label="Terminar y enviar sin revisar">${svg('send', 22)}</button>
            <span class="lr-ctl-label">Enviar ya</span>
          </div>
        </footer>
      </div>`;
    const q = (name) => root.querySelector(`[data-lr="${name}"]`);
    return {
      root, card: root.querySelector('.lr-card'),
      discard: q('discard'), pill: q('pill'), status: q('status'), timer: q('timer'),
      wave: q('wave'), quiet: q('quiet'), segs: q('segs'), segsText: q('segsText'), retry: q('retry'),
      text: q('text'), error: q('error'),
      secondary: q('secondary'), secondaryLabel: q('secondaryLabel'),
      primary: q('primary'), primaryLabel: q('primaryLabel'), quick: q('quick'),
    };
  }

  function createLongRecorder(options = {}) {
    const onSend = typeof options.onSend === 'function' ? options.onSend : () => {};
    const onReady = typeof options.onReady === 'function' ? options.onReady : () => {};
    const normalize = options.normalize === true;

    const els = createUi();
    document.body.appendChild(els.root);

    // state: idle | starting | recording | paused | finishing | ready | error
    let state = 'idle';
    let stream = null;
    let recorder = null;
    let segmentTimer = null;
    let segmentId = 0;
    let segments = new Map();
    let pendingStop = null;
    let elapsedMs = 0;
    let runStartedAt = 0;
    let clockInt = null;
    let edited = false;
    let autoSend = false;
    let discardArmed = false;
    let discardTimer = null;
    let wakeLock = null;
    let sessionId = '';

    // Live level meter
    let audioCtx = null;
    let analyser = null;
    let levels = [];
    let rafId = 0;
    let lastSampleAt = 0;
    let lastLoudAt = 0;
    let waveColors = { live: '#ff5a5f', idle: '#3a3a44' };

    const segmentMs = () => {
      const saved = Number(localStorage.getItem('voiceChunkMs'));
      return [5000, 10000, 15000, 20000, 30000].includes(saved) ? saved : SEGMENT_MS;
    };
    const elapsed = () => elapsedMs + (state === 'recording' && runStartedAt ? Date.now() - runStartedAt : 0);
    const buzz = (ms) => { try { navigator.vibrate?.(ms); } catch { /* unsupported */ } };

    const blobToBase64 = (blob) => new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onloadend = () => resolve(String(r.result).split(',')[1]);
      r.onerror = reject;
      r.readAsDataURL(blob);
    });

    // ── Rendering ──
    const STATUS = {
      starting: 'Activando micrófono…',
      recording: 'Grabando',
      paused: 'En pausa',
      finishing: 'Transcribiendo…',
      ready: 'Listo para enviar',
      error: 'Micrófono no disponible',
    };

    function setState(next) {
      state = next;
      els.card.dataset.state = next;
      render();
    }

    function setButton(btn, label, iconName, size, aria) {
      btn.innerHTML = svg(iconName, size);
      btn.setAttribute('aria-label', aria || label);
      (btn === els.primary ? els.primaryLabel : els.secondaryLabel).textContent = label;
    }

    function render() {
      els.status.textContent = state === 'ready' && !currentText() ? 'Sin texto' : (STATUS[state] || '');
      els.timer.textContent = formatTime(elapsed() / 1000);
      const secondaryCtl = els.secondary.parentElement;
      if (state === 'recording') {
        secondaryCtl.hidden = false;
        setButton(els.secondary, 'Pausar', 'pause', 24);
        setButton(els.primary, 'Terminar', 'stop', 28, 'Terminar grabación');
      } else if (state === 'paused') {
        secondaryCtl.hidden = false;
        setButton(els.secondary, 'Seguir', 'mic', 24, 'Seguir grabando');
        setButton(els.primary, 'Terminar', 'stop', 28, 'Terminar grabación');
      } else if (state === 'ready') {
        secondaryCtl.hidden = false;
        setButton(els.secondary, 'Hablar más', 'mic', 24, 'Seguir hablando');
        setButton(els.primary, 'Enviar', 'send', 26, 'Enviar transcripción');
      } else {
        secondaryCtl.hidden = true;
        setButton(els.primary, state === 'error' ? 'Cerrar' : 'Espera…', state === 'error' ? 'close' : 'stop', 26);
      }
      els.primary.disabled = state === 'starting' || state === 'finishing' || (state === 'ready' && !currentText());
      els.secondary.disabled = state === 'starting' || state === 'finishing';
      els.quick.parentElement.hidden = !(state === 'recording' || state === 'paused');
      renderSegments();
    }

    function renderSegments() {
      let done = 0;
      let failed = 0;
      els.segs.innerHTML = '';
      const list = [...segments.values()];
      list.forEach((seg) => {
        if (seg.status === 'done' || seg.status === 'empty') done++;
        if (seg.status === 'failed') failed++;
        const dot = document.createElement('i');
        dot.className = 'lr-seg is-' + seg.status;
        dot.title = seg.error || '';
        els.segs.appendChild(dot);
      });
      const total = list.length;
      const waiting = list.some((s) => s.status === 'waiting');
      let text = '';
      if (failed) text = `${failed} sin transcribir`;
      else if (waiting) text = 'Esperando al proveedor…';
      else if (total && done < total) text = `${done} de ${total} transcritos`;
      else if (total) text = `${total} fragmento${total > 1 ? 's' : ''}`;
      els.segsText.textContent = text;
      els.segsText.classList.toggle('is-bad', !!failed);
      els.retry.hidden = !failed;
    }

    // ── Transcript ──
    function autoText() {
      return [...segments.values()].filter((s) => s.text).sort((a, b) => a.id - b.id).map((s) => s.text).join(' ');
    }
    function currentText() { return els.text.value.trim(); }
    function applySegmentText(seg) {
      if (!edited) {
        els.text.value = autoText();
      } else {
        // The user edited the text: never overwrite it, append the new piece.
        const base = els.text.value.replace(/\s+$/, '');
        els.text.value = base ? `${base} ${seg.text}` : seg.text;
      }
      els.text.scrollTop = els.text.scrollHeight;
    }

    // ── Upload / transcription ──
    async function prepareBlob(blob) {
      if (normalize && (window.VoiceAudio || {}).normalizeAudio) {
        try {
          const out = await window.VoiceAudio.normalizeAudio(blob, { gain: 1, targetPeak: 0.85 });
          return { blob: out.blob, mime: 'audio/wav' };
        } catch { /* keep the original encoding */ }
      }
      return { blob, mime: (blob.type || 'audio/webm').split(';')[0] };
    }

    function sttFields() {
      if (window.VoiceSettings?.sttFields) return window.VoiceSettings.sttFields();
      return { groqApiKey: localStorage.getItem('groqApiKey') || '' };
    }

    async function uploadSegment(seg, attempt = 1) {
      seg.status = 'uploading';
      seg.error = '';
      renderSegments();
      try {
        const { blob, mime } = await prepareBlob(seg.blob);
        const res = await fetch('/transcribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionId,
            segmentId: seg.id,
            audioBase64: await blobToBase64(blob),
            audioMimeType: mime,
            audioDuration: (seg.durationMs || segmentMs()) / 1000,
            ...sttFields(),
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw Object.assign(new Error(data.error || `Transcripción ${res.status}`), { status: res.status, retryAfterMs: data.retryAfterMs });
        const text = String(data.transcript || data.text || '').trim();
        if (!text) throw new Error('Transcripción vacía');
        seg.text = text;
        seg.status = 'done';
        applySegmentText(seg);
      } catch (error) {
        const silent = /vac[ií]a|empty/i.test(error.message);
        // Rate limits wait what the provider asks (free tiers allow few requests per minute).
        const rateLimited = error.status === 429 && attempt <= 4;
        // One quiet retry for network blips; silence and auth/config errors do not retry.
        const transient = attempt === 1 && !(error.status >= 400 && error.status < 500);
        if (!silent && (rateLimited || transient)) {
          seg.status = 'waiting';
          renderSegments();
          const wait = rateLimited ? Math.min(30000, (error.retryAfterMs || 5000) + 500) : 1500;
          await new Promise((r) => setTimeout(r, wait));
          if (segments.get(seg.id) === seg) return uploadSegment(seg, attempt + 1);
          return;
        }
        seg.status = silent ? 'empty' : 'failed';
        seg.error = silent ? 'Sin voz' : error.message;
        if (!silent) showError(error.message);
      }
      if (segments.get(seg.id) !== seg) return; // cancelled meanwhile
      renderSegments();
      checkFinished();
      render();
    }

    function showError(message) {
      let text = String(message || 'Error de transcripción');
      if (/quota|límite de uso|rate limit|429/i.test(text)) {
        text = 'El proveedor de transcripción alcanzó su límite de uso. Usa “Reintentar” en un momento, fragmentos más largos o cambia de proveedor en Ajustes.';
      } else if (/api key|clave|401|403|invalid/i.test(text)) {
        text = (text.length > 120 ? text.slice(0, 117) + '…' : text) + ' Revisa la clave de transcripción en Ajustes.';
      } else if (text.length > 160) {
        text = text.slice(0, 157) + '…';
      }
      els.error.textContent = text;
      els.error.hidden = false;
    }

    function retryFailed() {
      els.error.hidden = true;
      [...segments.values()].forEach((seg) => { if (seg.status === 'failed' && seg.blob) uploadSegment(seg); });
      if (state === 'ready') setState('finishing');
    }

    // ── Recording ──
    function startSegment() {
      if (state !== 'recording' || !stream) return;
      const type = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4']
        .find((t) => window.MediaRecorder?.isTypeSupported?.(t)) || '';
      const mr = new MediaRecorder(stream, type ? { mimeType: type } : {});
      const seg = { id: ++segmentId, status: 'recording', blob: null, text: '', startedAt: Date.now() };
      const chunks = [];
      segments.set(seg.id, seg);
      mr.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      pendingStop = new Promise((resolve) => {
        mr.onstop = () => {
          seg.blob = new Blob(chunks, { type: mr.mimeType || type || 'audio/webm' });
          seg.durationMs = Date.now() - seg.startedAt;
          if (seg.blob.size < MIN_SEGMENT_BYTES || seg.durationMs < 700) {
            segments.delete(seg.id); // a tap on pause right after resuming
          } else if (segments.get(seg.id) === seg) {
            uploadSegment(seg);
          }
          renderSegments();
          resolve();
        };
      });
      recorder = mr;
      mr.start();
      renderSegments();
      clearTimeout(segmentTimer);
      segmentTimer = setTimeout(rotateSegment, segmentMs());
    }

    function stopSegment() {
      clearTimeout(segmentTimer);
      segmentTimer = null;
      const done = pendingStop;
      if (recorder && recorder.state !== 'inactive') recorder.stop();
      recorder = null;
      return done || Promise.resolve();
    }

    async function rotateSegment() {
      if (state !== 'recording') return;
      await stopSegment();
      startSegment();
    }

    function startClock() {
      clearInterval(clockInt);
      clockInt = setInterval(() => {
        els.timer.textContent = formatTime(elapsed() / 1000);
        if (state === 'recording' && elapsed() >= MAX_TOTAL_SECONDS * 1000) {
          stop();
          window.showToast?.(`Límite de ${MAX_TOTAL_SECONDS / 60} minutos alcanzado`, false);
        }
      }, 250);
    }

    function startMeter() {
      if (!audioCtx || !stream) return;
      try {
        const source = audioCtx.createMediaStreamSource(stream);
        analyser = audioCtx.createAnalyser();
        analyser.fftSize = 1024;
        source.connect(analyser);
      } catch { analyser = null; }
      lastLoudAt = Date.now();
      const styles = getComputedStyle(els.root);
      waveColors = {
        live: styles.getPropertyValue('--lr-rec').trim() || '#ff5a5f',
        idle: styles.getPropertyValue('--lr-muted-2').trim() || '#3a3a44',
      };
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(drawWave);
    }

    function drawWave(now) {
      rafId = requestAnimationFrame(drawWave);
      const canvas = els.wave;
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (!w || !h) return;
      if (canvas.width !== Math.round(w * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
      const barW = 3;
      const gap = 3;
      const maxBars = Math.floor(w / (barW + gap));
      if (now - lastSampleAt > 70) {
        lastSampleAt = now;
        let level = 0;
        if (analyser && state === 'recording') {
          const data = new Float32Array(analyser.fftSize);
          analyser.getFloatTimeDomainData(data);
          let sum = 0;
          for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
          level = Math.sqrt(sum / data.length);
          if (level > QUIET_LEVEL) lastLoudAt = Date.now();
        }
        if (state === 'recording' || state === 'paused') {
          levels.push(state === 'paused' ? -1 : level);
          if (levels.length > maxBars) levels.splice(0, levels.length - maxBars);
        }
        if (audioCtx?.state !== 'running') lastLoudAt = Date.now(); // no meter, no warning
        els.quiet.hidden = !(state === 'recording' && analyser && Date.now() - lastLoudAt > 6000);
      }
      const ctx = canvas.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const { live, idle } = waveColors;
      const mid = h / 2;
      const offset = w - levels.length * (barW + gap);
      for (let i = 0; i < maxBars; i++) {
        const idx = i - Math.round(offset / (barW + gap));
        const v = idx >= 0 ? levels[idx] : undefined;
        const x = i * (barW + gap);
        let amp = 2;
        if (v != null && v >= 0) amp = Math.max(2, Math.min(mid - 2, Math.sqrt(v) * h * 1.5));
        ctx.fillStyle = v == null || v < 0 || state !== 'recording' ? idle : live;
        ctx.globalAlpha = v == null ? 0.5 : 1;
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(x, mid - amp, barW, amp * 2, 1.5);
        else ctx.rect(x, mid - amp, barW, amp * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    async function requestWakeLock() {
      try { wakeLock = await navigator.wakeLock?.request('screen'); } catch { wakeLock = null; }
    }
    function releaseWakeLock() {
      try { wakeLock?.release(); } catch { /* already released */ }
      wakeLock = null;
    }

    function openOverlay() {
      els.root.classList.add('open');
      document.documentElement.classList.add('lr-open');
    }
    function closeOverlay() {
      els.root.classList.remove('open');
      document.documentElement.classList.remove('lr-open');
    }

    /** Starts a new recording, or continues the current transcript (`append`). */
    function begin(append = false) {
      if (state === 'ready' && append) {
        // keep segments + text, record more
      } else if (state !== 'idle') {
        return;
      } else {
        segments = new Map();
        segmentId = 0;
        elapsedMs = 0;
        edited = false;
        els.text.value = '';
        levels = [];
        sessionId = 'voice-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
      }
      els.error.hidden = true;
      disarmDiscard();
      setState('starting');
      openOverlay();
      if (!navigator.mediaDevices?.getUserMedia) return failMic('Este navegador no permite grabar audio (se necesita HTTPS).');
      // The meter's AudioContext needs a user activation. A touch pointerdown is not one,
      // so also resume on the pointerup/touchend of the same tap.
      try {
        audioCtx = audioCtx && audioCtx.state !== 'closed' ? audioCtx : new (window.AudioContext || window.webkitAudioContext)();
        audioCtx.resume?.().catch?.(() => {});
      } catch { audioCtx = null; }
      const kick = () => { audioCtx?.resume?.().catch?.(() => {}); };
      document.addEventListener('pointerup', kick, { once: true, capture: true });
      document.addEventListener('touchend', kick, { once: true, capture: true });
      navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
        .then((s) => {
          if (state !== 'starting') { s.getTracks().forEach((t) => t.stop()); return; }
          stream = s;
          runStartedAt = Date.now();
          setState('recording');
          buzz(12);
          requestWakeLock();
          startClock();
          startMeter();
          startSegment();
        })
        .catch((error) => failMic(error?.name === 'NotAllowedError'
          ? 'Permiso de micrófono denegado. Actívalo en los ajustes del navegador para este sitio.'
          : 'No se pudo abrir el micrófono: ' + (error?.message || error)));
    }

    function failMic(message) {
      setState('error');
      els.error.textContent = message;
      els.error.hidden = false;
    }

    function pause() {
      if (state !== 'recording') return;
      elapsedMs = elapsed();
      runStartedAt = 0;
      setState('paused');
      stopSegment(); // flush what was said so far so it gets transcribed now
      buzz(8);
    }
    function resume() {
      if (state !== 'paused') return;
      runStartedAt = Date.now();
      lastLoudAt = Date.now();
      setState('recording');
      startSegment();
      buzz(8);
    }
    function togglePause() {
      if (state === 'recording') pause();
      else if (state === 'paused') resume();
    }

    function releaseMic() {
      if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
      cancelAnimationFrame(rafId);
      try { audioCtx?.close(); } catch { /* closed */ }
      audioCtx = null;
      analyser = null;
      releaseWakeLock();
      els.quiet.hidden = true;
    }

    /** Ends the recording; becomes ready once every segment is transcribed. */
    async function stop() {
      if (state !== 'recording' && state !== 'paused') return;
      if (state === 'recording') { elapsedMs = elapsed(); runStartedAt = 0; }
      setState('finishing');
      buzz(12);
      await stopSegment();
      releaseMic();
      checkFinished();
    }

    function checkFinished() {
      if (state !== 'finishing') return;
      const busy = [...segments.values()].some((s) => s.status === 'recording' || s.status === 'uploading' || s.status === 'waiting');
      if (busy) return;
      clearInterval(clockInt);
      setState('ready');
      const text = currentText();
      const failed = [...segments.values()].some((s) => s.status === 'failed');
      if (autoSend && text && !failed) return send();
      autoSend = false;
      if (text) onReady(text);
      if (!text && !failed) {
        els.error.textContent = 'No se detectó voz. Prueba a hablar más cerca del micrófono.';
        els.error.hidden = false;
      }
    }

    function send() {
      if (state !== 'ready') return;
      const text = currentText();
      if (!text) return;
      reset();
      closeOverlay();
      onSend(text);
    }

    function reset() {
      clearTimeout(segmentTimer);
      clearInterval(clockInt);
      if (recorder && recorder.state !== 'inactive') { recorder.onstop = null; recorder.stop(); }
      recorder = null;
      pendingStop = null;
      releaseMic();
      segments = new Map();
      elapsedMs = 0;
      runStartedAt = 0;
      edited = false;
      autoSend = false;
      levels = [];
      els.text.value = '';
      els.error.hidden = true;
      disarmDiscard();
      setState('idle');
    }

    function cancel() {
      reset();
      closeOverlay();
    }

    // Discarding a long monologue by accident hurts: ask for a second tap when there is text.
    function disarmDiscard() {
      discardArmed = false;
      clearTimeout(discardTimer);
      els.discard.classList.remove('is-armed');
    }
    function requestDiscard() {
      const hasContent = currentText() || [...segments.values()].length > 0;
      if (!hasContent || discardArmed || state === 'error') return cancel();
      discardArmed = true;
      els.discard.classList.add('is-armed');
      clearTimeout(discardTimer);
      discardTimer = setTimeout(disarmDiscard, 3000);
    }

    // ── Wiring ──
    els.primary.addEventListener('click', () => {
      if (state === 'recording' || state === 'paused') stop();
      else if (state === 'ready') send();
      else if (state === 'error') cancel();
    });
    els.secondary.addEventListener('click', () => {
      if (state === 'recording' || state === 'paused') togglePause();
      else if (state === 'ready') begin(true);
    });
    els.quick.addEventListener('click', () => {
      if (state !== 'recording' && state !== 'paused') return;
      autoSend = true;
      stop();
    });
    els.discard.addEventListener('click', requestDiscard);
    els.retry.addEventListener('click', retryFailed);
    els.text.addEventListener('input', () => {
      edited = true;
      if (state === 'ready') render();
    });
    els.text.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && state === 'ready') { e.preventDefault(); send(); }
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && els.root.classList.contains('open')) requestDiscard();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && (state === 'recording' || state === 'paused')) requestWakeLock();
    });

    return {
      begin: () => begin(false),
      stop,
      cancel,
      send,
      retryFailed,
      togglePause,
      isRecording: () => state === 'recording' || state === 'starting',
      isPaused: () => state === 'paused',
      isBusy: () => state !== 'idle',
      isReady: () => state === 'ready',
      segments: () => [...segments.values()],
      getTranscript: () => currentText(),
    };
  }

  return { createLongRecorder, SEGMENT_MS };
});
