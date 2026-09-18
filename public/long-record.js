(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.VoiceLongRecord = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SEGMENT_MS = 10000;
  const MAX_TOTAL_SECONDS = 600;

  function formatTime(seconds) {
    const s = Math.max(0, Math.floor(seconds || 0));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  function createUi() {
    const root = document.createElement('div');
    root.className = 'lr-overlay';
    root.id = 'longRecordOverlay';
    root.setAttribute('role', 'dialog');
    root.innerHTML = `
      <div class="lr-card">
        <div class="lr-timer" id="lrTimer">0:00</div>
         <div class="lr-status" id="lrStatus">READY</div>
         <label class="lr-chunk-label" for="lrChunkSize">CHUNKS</label>
         <select id="lrChunkSize" class="lr-chunk-size"><option value="5000">5 segundos</option><option value="10000" selected>10 segundos</option><option value="15000">15 segundos</option><option value="20000">20 segundos</option><option value="30000">30 segundos</option></select>
        <div class="lr-segments" id="lrSegments"></div>
        <div class="lr-progress" id="lrProgress" style="display:none">TRANSCRIBIENDO <span id="lrProgressText"></span></div>
        <div class="lr-transcript-wrap">
          <div class="lr-label">TRANSCRIPCIÓN ACUMULADA</div>
          <textarea id="lrTranscript" class="lr-transcript" rows="6" placeholder="La transcripción aparecerá aquí mientras hablas..."></textarea>
        </div>
         <div class="lr-actions">
           <button type="button" class="lr-btn lr-cancel" id="lrCancel">Cancelar</button>
           <button type="button" class="lr-btn lr-pause" id="lrPause">Pausar</button>
           <button type="button" class="lr-btn lr-retry" id="lrRetry" style="display:none">Reintentar fallidos</button>
           <button type="button" class="lr-btn lr-send" id="lrSend" disabled>Terminar grabación</button>
        </div>
      </div>`;
    const q = (id) => root.querySelector('#' + id);
    return {
       root, timer: q('lrTimer'), status: q('lrStatus'), chunkSize: q('lrChunkSize'), segments: q('lrSegments'),
      progress: q('lrProgress'), progressText: q('lrProgressText'), transcript: q('lrTranscript'),
       cancelBtn: q('lrCancel'), pauseBtn: q('lrPause'), retryBtn: q('lrRetry'), sendBtn: q('lrSend'),
    };
  }

  function createLongRecorder(options = {}) {
    const onSend = typeof options.onSend === 'function' ? options.onSend : () => {};
    const onReady = typeof options.onReady === 'function' ? options.onReady : () => {};
    const normalize = options.normalize === true;
    const ui = { root: document.getElementById('longRecordOverlay') } || null;
    let els = null;

    if (!(ui.root && ui.root.id === 'longRecordOverlay')) {
      els = createUi();
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape') cancel(); });
      ui.root = els.root;
      document.body.appendChild(ui.root);
    } else {
      const q = (id) => ui.root.querySelector('#' + id);
      els = { root: ui.root, timer: q('lrTimer'), status: q('lrStatus'), chunkSize: q('lrChunkSize'), segments: q('lrSegments'), progress: q('lrProgress'), progressText: q('lrProgressText'), transcript: q('lrTranscript'), cancelBtn: q('lrCancel'), pauseBtn: q('lrPause'), retryBtn: q('lrRetry'), sendBtn: q('lrSend') };
    }

    let stream = null;
    let recorder = null;
    let recordGeneration = 0;
    let segmentId = 0;
    let sessionId = '';
    let segments = new Map();
    let accumulated = '';
    let activeStop = null;
    let segmentTimer = null;
    let startedAt = 0;
    let recording = false;
    let paused = false;
    let ready = false;
    let timerInt = null;
    let sendBtnAssigned = false;
    const segmentMs = () => Math.max(5000, Math.min(30000, Number(els.chunkSize.value) || SEGMENT_MS));

    const setStatus = (text) => { els.status.textContent = text; };

    const blobToBase64 = (blob) => new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onloadend = () => resolve(String(r.result).split(',')[1]);
      r.onerror = reject;
      r.readAsDataURL(blob);
    });

    function timers() {
      return [...segments.values()].map((s) => s.status);
    }

    function renderSegments() {
      els.segments.innerHTML = '';
      let done = 0, failed = 0, busy = 0;
      [...segments.values()].forEach((seg) => {
        if (seg.status === 'done') done++;
        else if (seg.status === 'failed') failed++;
        else busy++;
        const chip = document.createElement('span');
        chip.className = 'lr-seg ' + seg.status;
        chip.textContent = `#${seg.id} ${seg.status === 'done' ? '✓' : seg.status === 'failed' ? '✗' : '●'}`;
        chip.title = seg.text || seg.error || '';
        els.segments.appendChild(chip);
      });
      const total = segments.size;
      if (total && (!ready || failed)) {
        els.progress.style.display = '';
        els.progressText.textContent = `${done}/${total} segmentos, ${failed ? failed + ' fallidos' : 'terminando...'}`;
      } else {
        els.progress.style.display = 'none';
      }
      els.retryBtn.style.display = failed ? '' : 'none';
    }

    async function prepareBlob(blob) {
      if (options.normalize && (window.VoiceAudio || {}).normalizeAudio) {
        try {
          const out = await window.VoiceAudio.normalizeAudio(blob, { gain: 1, targetPeak: 0.85 });
          return { blob: out.blob, mime: 'audio/wav', metrics: out.metrics };
        } catch (e) { /* keep original; quiet mobiles should still cap */ }
      }
      return { blob, mime: (blob.type || 'audio/webm').split(';')[0], metrics: null };
    }

    async function uploadSegment(id, blob) {
      const seg = segments.get(id);
      if (!seg) return;
      seg.status = 'uploading';
      renderSegments();
      try {
        const { blob: upload, mime, metrics } = await prepareBlob(blob);
        if (metrics) seg.metrics = metrics;
        const base64 = await blobToBase64(upload);
        const res = await fetch('/transcribe', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
             sessionId, segmentId: id,
            audioBase64: base64, audioMimeType: mime,
             audioDuration: (seg.durationMs || segmentMs()) / 1000,
            groqApiKey: localStorage.getItem('groqApiKey') || '',
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `Transcripción ${res.status}`);
        const text = (data.transcript || data.text || '').trim();
        if (!text) throw new Error('Transcripción vacía');
        seg.text = text;
        seg.status = 'done';
        accumulated = [...segments.values()].filter((s) => s.text).sort((a, b) => a.id - b.id).map((s) => s.text).join('\n\n');
        els.transcript.value = accumulated;
      } catch (error) {
        seg.error = error.message;
        seg.status = 'failed';
      }
      renderSegments();
    }

    function retrySegment(id) { if (segments.get(id)?.blob) uploadSegment(id, segments.get(id).blob); }
    function retryFailed() {
      let count = 0;
      [...segments.values()].forEach((seg) => { if (seg.status === 'failed' && seg.blob) { retrySegment(seg.id); count++; } });
      if (count) setStatus(`Reintentando ${count} segmento(s)...`);
    }

    function beginRecorder() {
      if (!recording) return;
      const gen = recordGeneration;
      const id = ++segmentId;
      const localChunks = [];
      const type = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg'].find((t) => (window.MediaRecorder.isTypeSupported ? window.MediaRecorder.isTypeSupported(t) : false)) || '';
      const mr = new MediaRecorder(stream, type ? { mimeType: type } : {});
      const seg = { id, status: 'recording', blob: null, text: '' };
      segments.set(id, seg);
      renderSegments();
      activeStop = new Promise((resolve) => {
        mr.ondataavailable = (e) => { if (e.data.size) localChunks.push(e.data); };
       mr.onstop = () => {
           const blob = new Blob(localChunks, { type: mr.mimeType || type || 'audio/webm' });
           const completed = segments.get(id);
           if (completed) { completed.blob = blob; completed.durationMs = Math.min(segmentMs(), Date.now() - completed.startedAt); completed.status = 'todo'; }
           renderSegments();
           const upload = uploadSegment(id, blob);
           if (gen === recordGeneration && recording) beginRecorder();
           resolve(upload);
         };
       });
       recorder = mr;
       mr.start();
       seg.startedAt = Date.now();
       clearTimeout(segmentTimer);
       segmentTimer = setTimeout(() => { if (mr.state !== 'inactive') mr.stop(); }, segmentMs());
    }

    function clearTimer() { if (timerInt) { clearInterval(timerInt); timerInt = null; } }
    function clock() {
      const secs = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
      els.timer.textContent = formatTime(secs);
      if (secs >= MAX_TOTAL_SECONDS) stop();
    }

    function openOverlay() {
      ui.root.classList.add('open');
      els.transcript.value = accumulated;
    }
    function closeOverlay() { ui.root.classList.remove('open'); }

    function begin() {
      if (ready || recording) return;
      recording = true; // mark immediately so a quick second tap lands on stop()
      if (!navigator.mediaDevices?.getUserMedia) { recording = false; setStatus('Micrófono no disponible'); return; }
      navigator.mediaDevices.getUserMedia({ audio: true }).then((s) => {
        stream = s;
         recordGeneration++;
         sessionId = 'chat-long-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
        ready = false;
        sendBtnAssigned = false;
        segments = new Map();
        accumulated = '';
        segmentId = 0;
        els.transcript.value = '';
        els.chunkSize.disabled = true;
         els.sendBtn.disabled = false;
         els.sendBtn.textContent = 'Terminar grabación';
         els.pauseBtn.style.display = '';
         els.pauseBtn.textContent = 'Pausar';
        els.retryBtn.style.display = 'none';
        els.progress.style.display = 'none';
        startedAt = Date.now();
        setStatus('LISTENING...');
        openOverlay();
        if (timerInt) clearInterval(timerInt);
        timerInt = setInterval(clock, 250);
        beginRecorder();
      }).catch(() => { recording = false; setStatus('No se pudo acceder al micrófono'); });
    }

    function finishPending() {
      const pending = [...segments.values()].filter((s) => s.status === 'uploading' || s.status === 'todo' || (s.status === 'failed' && s.blob));
      if (pending.length) {
        setStatus(`Esperando transcripciones (${pending.length})...`);
        els.progress.style.display = '';
        els.progressText.textContent = 'terminando...';
      }
      const check = setInterval(() => {
        const still = [...segments.values()].filter((s) => s.status !== 'done' && s.status !== 'failed');
        if (!still.length) { clearInterval(check); markReady(); }
      }, 200);
      setTimeout(() => { clearInterval(check); markReady(); }, 20000);
    }

    function stop() {
      clearTimer();
      clearTimeout(segmentTimer);
      segmentTimer = null;
      const stopPromise = activeStop;
      // Mark the session as stopped before MediaRecorder emits onstop. Otherwise
      // onstop mistakes a manual finish for a timed rotation and opens one more recorder.
      recording = false;
      if (recorder && recorder.state !== 'inactive') recorder.stop();
      const after = () => {
        if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
         recorder = null;
         activeStop = null;
         paused = false;
         els.pauseBtn.style.display = 'none';
         renderSegments();
        finishPending();
      };
      if (stopPromise) { Promise.resolve(stopPromise).then(after, after); }
      else after();
    }

    function markReady() {
      ready = true;
      els.chunkSize.disabled = false;
      const text = accumulated && accumulated.trim();
      renderSegments();
      if (!text) {
        setStatus('No hay texto para enviar');
        els.sendBtn.disabled = true;
        els.sendBtn.textContent = 'Terminar y enviar';
        els.retryBtn.style.display = segments.size ? '' : 'none';
        return;
      }
      setStatus('TRANSCRIPT READY');
       els.sendBtn.disabled = false;
       els.sendBtn.textContent = 'Enviar transcripción';
       els.pauseBtn.style.display = 'none';
       onReady(text);
    }

    function send() {
      if (!ready) return;
      const text = els.transcript.value.trim();
      closeOverlay();
      resetState();
      onSend(text);
    }

    function togglePause() {
      if (!recorder || recorder.state === 'inactive') return;
      if (recorder.state === 'recording') {
        recorder.pause();
        recording = false;
        paused = true;
        setStatus('PAUSADO — puedes continuar');
        els.pauseBtn.textContent = 'Continuar';
      } else if (recorder.state === 'paused') {
        recorder.resume();
        recording = true;
        paused = false;
        setStatus('LISTENING...');
        els.pauseBtn.textContent = 'Pausar';
      }
    }

    function cancel() {
      if (recording) {
        clearTimer();
        clearTimeout(segmentTimer);
        segmentTimer = null;
        const p = activeStop;
        recording = false;
        if (recorder && recorder.state !== 'inactive') recorder.stop();
        if (p) Promise.resolve(p).catch(() => {});
      }
      if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
      recorder = null;
      activeStop = null;
      clearTimeout(segmentTimer);
      segmentTimer = null;
      resetState();
      closeOverlay();
    }

    function resetState() {
      ready = false;
      recording = false;
      paused = false;
      segments = new Map();
      accumulated = '';
      sendBtnAssigned = false;
      els.sendBtn.disabled = true;
      els.chunkSize.disabled = false;
      els.sendBtn.textContent = 'Terminar y enviar';
      els.pauseBtn.style.display = 'none';
      els.retryBtn.style.display = 'none';
      els.progress.style.display = 'none';
      els.transcript.value = '';
    }

    els.sendBtn.addEventListener('click', () => {
      if (recording || paused) stop();
      else if (ready) send();
      else if (!ready && !recording && segments.size) markReady();
    });
    els.pauseBtn.addEventListener('click', togglePause);
    els.cancelBtn.addEventListener('click', cancel);
    els.retryBtn.addEventListener('click', retryFailed);
    els.chunkSize.addEventListener('change', () => localStorage.setItem('voiceChunkMs', String(segmentMs())));
    const savedChunkMs = Number(localStorage.getItem('voiceChunkMs'));
    if ([5000, 10000, 15000, 20000, 30000].includes(savedChunkMs)) els.chunkSize.value = String(savedChunkMs);

    return {
      begin,
      stop,
      cancel,
      send,
      retryFailed,
      isRecording: () => recording,
      isPaused: () => paused,
      togglePause,
      isReady: () => ready,
      segments: () => [...segments.values()],
      getTranscript: () => els.transcript.value.trim(),
    };
  }

  return { createLongRecorder, SEGMENT_MS };
});
