(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const els = { state: $('state'), record: $('recordBtn'), label: $('recordLabel'), size: $('chunkSize'), normalize: $('normalizeAudio'), timer: $('timer'), error: $('error'), transcript: $('transcript'), stats: $('stats'), timeline: $('timeline'), dot: $('liveDot') };
  let stream = null, recorder = null, rotateTimer = null, clockTimer = null, startedAt = 0, sequence = 0, sessionId = '', running = false;
  const segments = new Map();
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const base64 = (blob) => new Promise((resolve, reject) => { const r = new FileReader(); r.onloadend = () => resolve(String(r.result).split(',')[1]); r.onerror = reject; r.readAsDataURL(blob); });
  const elapsed = () => Math.max(0, Math.round((Date.now() - startedAt) / 100) / 10);
  function status(text) { els.state.textContent = text; els.state.classList.toggle('busy', running); }
  function render() {
    const all = [...segments.values()], done = all.filter((s) => s.status === 'done');
    if (!running && all.some((s) => s.status === 'uploading')) status('ESPERANDO RESPUESTAS', true);
    else if (!running) status('READY', false);
    els.stats.innerHTML = [['Chunks creados', all.length], ['Enviando ahora', all.filter((s) => s.status === 'uploading').length], ['Recibidos', done.length], ['Fallidos', all.filter((s) => s.status === 'failed').length]].map(([k, v]) => `<div class="stat"><span>${k}</span><b>${v}</b></div>`).join('');
    els.timeline.innerHTML = all.length ? all.map((s) => `<div class="segment ${s.status}"><span class="seg-id">#${s.id}</span><span class="seg-status">${s.status === 'recording' ? 'GRABANDO' : s.status === 'uploading' ? 'ENVIANDO' : s.status === 'done' ? 'RECIBIDO' : 'FALLO'}</span><span class="seg-text">${esc(s.text || s.error || (s.status === 'recording' ? 'El siguiente chunk se esta capturando...' : 'Preparando envio...'))}</span><span class="seg-time">${s.sentAt ? '+' + s.sentAt + ' s' : ''}</span>${s.audioUrl ? `<span class="seg-audio"><button class="play" data-play="${s.id}" type="button">▶ Oir</button><a href="${s.audioUrl}" download="chunk-${s.id}.webm" title="Descargar audio">↓</a></span>` : ''}</div>`).join('') : '<div class="empty">Aun no hay chunks. El primer envio aparecera aqui al cerrar el primer segmento.</div>';
    els.transcript.innerHTML = done.length ? done.sort((a, b) => a.id - b.id).map((s) => esc(s.text)).join('\n\n') : '<span class="placeholder">La transcripcion aparecera cuando llegue el primer response...</span>';
    els.timeline.scrollTop = els.timeline.scrollHeight;
  }
  async function upload(seg, blob) {
    seg.status = 'uploading'; seg.sentAt = elapsed(); render();
    try {
      let uploadBlob = blob;
      if (els.normalize.checked && window.VoiceAudio?.normalizeAudio) uploadBlob = (await window.VoiceAudio.normalizeAudio(blob, { gain: 1, targetPeak: 0.85 })).blob;
      const res = await fetch('/transcribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId, segmentId: seg.id, audioBase64: await base64(uploadBlob), audioMimeType: (uploadBlob.type || 'audio/webm').split(';')[0], audioDuration: Number(els.size.value) / 1000, groqApiKey: localStorage.getItem('groqApiKey') || '' }) });
      const data = await res.json().catch(() => ({})); if (!res.ok) throw new Error(data.error || `Transcripcion ${res.status}`);
      seg.text = (data.transcript || data.text || '').trim() || '[respuesta vacia]'; seg.status = 'done';
    } catch (e) { seg.status = 'failed'; seg.error = e.message; }
    render();
  }
  function openSegment() {
    if (!running) return;
    const id = ++sequence, local = [], type = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg'].find((t) => MediaRecorder.isTypeSupported?.(t)) || '';
    const mr = new MediaRecorder(stream, type ? { mimeType: type } : {}), seg = { id, status: 'recording', text: '' }; segments.set(id, seg); recorder = mr; render();
    mr.ondataavailable = (e) => { if (e.data.size) local.push(e.data); };
    mr.onstop = () => { const blob = new Blob(local, { type: mr.mimeType || type || 'audio/webm' }); if (seg.status === 'recording' && blob.size) { seg.blob = blob; seg.audioUrl = URL.createObjectURL(blob); upload(seg, blob); } if (running) openSegment(); else finish(); };
    mr.start(); rotateTimer = setTimeout(() => { if (mr.state !== 'inactive') mr.stop(); }, Number(els.size.value));
  }
  function stop() { running = false; clearTimeout(rotateTimer); clearInterval(clockTimer); if (recorder?.state !== 'inactive') recorder.stop(); else finish(); }
  function finish() { stream?.getTracks().forEach((t) => t.stop()); stream = null; recorder = null; els.record.classList.remove('active'); els.label.textContent = 'Empezar'; els.dot.classList.remove('on'); render(); }
  async function start() {
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) { els.error.textContent = 'Este navegador no soporta grabacion.'; return; }
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch (e) { els.error.textContent = 'No se pudo acceder al microfono: ' + e.message; return; }
    els.error.textContent = ''; segments.clear(); sequence = 0; sessionId = 'chunk-lab-' + Date.now(); startedAt = Date.now(); running = true; els.record.classList.add('active'); els.label.textContent = 'Detener'; els.dot.classList.add('on'); status('GRABANDO');
    clockTimer = setInterval(() => { els.timer.textContent = (Math.floor((Date.now() - startedAt) / 1000 / 60)) + ':' + String(Math.floor((Date.now() - startedAt) / 1000) % 60).padStart(2, '0'); }, 250); openSegment();
  }
  els.record.addEventListener('click', () => running ? stop() : start());
  els.timeline.addEventListener('click', (event) => { const button = event.target.closest('[data-play]'); if (!button) return; const seg = segments.get(Number(button.dataset.play)); if (!seg?.audioUrl) return; document.querySelectorAll('.play').forEach((item) => { item.textContent = '▶ Oir'; }); if (window.chunkAudio) window.chunkAudio.pause(); const audio = new Audio(seg.audioUrl); window.chunkAudio = audio; button.textContent = '■ Parar'; audio.onended = () => { button.textContent = '▶ Oir'; window.chunkAudio = null; }; audio.play().catch(() => { button.textContent = '▶ Oir'; }); });
  $('clearBtn').addEventListener('click', () => { if (running) stop(); segments.clear(); els.timer.textContent = '0:00'; els.transcript.innerHTML = '<span class="placeholder">Habla despues de pulsar Empezar...</span>'; render(); });
  render();
})();
