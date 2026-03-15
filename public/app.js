// ═══════════════════════════════════════════════
//  CHAT STORE  –  persisted in localStorage
// ═══════════════════════════════════════════════
const STORE_KEY = 'voiceChats';

function loadStore() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch { return {}; }
}

function saveStore(store) {
  localStorage.setItem(STORE_KEY, JSON.stringify(store));
}

function createChat(name) {
  const id = 'chat_' + Date.now();
  const store = loadStore();
  store[id] = { id, name: name || 'Chat ' + new Date().toLocaleDateString('es', {day:'2-digit', month:'short'}), systemPrompt: '', messages: [] };
  saveStore(store);
  return store[id];
}

function getChat(id) {
  return loadStore()[id] || null;
}

function updateChat(id, patch) {
  const store = loadStore();
  if (!store[id]) return;
  Object.assign(store[id], patch);
  saveStore(store);
}

function deleteChat(id) {
  const store = loadStore();
  delete store[id];
  saveStore(store);
}

function allChats() {
  const store = loadStore();
  return Object.values(store).sort((a, b) => {
    const aLast = a.messages.at(-1)?.ts || parseInt(a.id.split('_')[1]);
    const bLast = b.messages.at(-1)?.ts || parseInt(b.id.split('_')[1]);
    return bLast - aLast;
  });
}

// ═══════════════════════════════════════════════
//  INIT: ensure we have at least one chat
// ═══════════════════════════════════════════════
let activeChatId = localStorage.getItem('activeChatId');
if (!activeChatId || !getChat(activeChatId)) {
  const chat = createChat();
  activeChatId = chat.id;
  localStorage.setItem('activeChatId', activeChatId);
}

// ═══════════════════════════════════════════════
//  DOM REFS
// ═══════════════════════════════════════════════
const sidebar       = document.getElementById('sidebar');
const toggleSidebar = document.getElementById('toggleSidebar');
const chatListEl    = document.getElementById('chatList');
const newChatBtn    = document.getElementById('newChatBtn');
const chatTitleEl   = document.getElementById('chatTitle');
const messagesEl    = document.getElementById('messages');
const textInput     = document.getElementById('textInput');
const sendTextBtn   = document.getElementById('sendText');
const recordBtn     = document.getElementById('recordBtn');
const micWrap       = document.getElementById('micWrap');
const btnTimer      = document.getElementById('btnTimer');
const lockHint      = document.getElementById('lockHint');
const recOverlay    = document.getElementById('recOverlay');
const recTimerEl    = document.getElementById('recTimer');
const recCancelZone = document.getElementById('recCancelZone');
const settingsBtn   = document.getElementById('settingsBtn');
const settingsModal = document.getElementById('settingsModal');
const closeSettings = document.getElementById('closeSettings');
const systemPromptEl= document.getElementById('systemPrompt');
const savePromptBtn = document.getElementById('saveSystemPrompt');
const clearHistBtn  = document.getElementById('clearHistory');
const iconMic       = recordBtn.querySelector('.icon-mic');
const iconStop      = recordBtn.querySelector('.icon-stop');

// ═══════════════════════════════════════════════
//  SIDEBAR
// ═══════════════════════════════════════════════
toggleSidebar.addEventListener('click', () => {
  sidebar.classList.toggle('open');
});

// close sidebar on outside click (mobile)
document.addEventListener('click', (e) => {
  if (sidebar.classList.contains('open') &&
      !sidebar.contains(e.target) &&
      !toggleSidebar.contains(e.target)) {
    sidebar.classList.remove('open');
  }
});

newChatBtn.addEventListener('click', () => {
  const chat = createChat();
  switchChat(chat.id);
  sidebar.classList.remove('open');
});

function renderChatList() {
  chatListEl.innerHTML = '';
  allChats().forEach(chat => {
    const item = document.createElement('div');
    item.className = 'chat-item' + (chat.id === activeChatId ? ' active' : '');
    item.dataset.id = chat.id;

    const nameEl = document.createElement('span');
    nameEl.className = 'chat-item-name';
    nameEl.textContent = chat.name;

    const delBtn = document.createElement('button');
    delBtn.className = 'chat-item-del';
    delBtn.title = 'Eliminar';
    delBtn.textContent = '✕';
    delBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (allChats().length === 1) { showToast('No puedes eliminar el único chat'); return; }
      deleteChat(chat.id);
      if (activeChatId === chat.id) {
        const remaining = allChats();
        switchChat(remaining[0].id);
      } else {
        renderChatList();
      }
    });

    item.appendChild(nameEl);
    item.appendChild(delBtn);
    item.addEventListener('click', () => {
      switchChat(chat.id);
      sidebar.classList.remove('open');
    });
    chatListEl.appendChild(item);
  });
}

function switchChat(id) {
  activeChatId = id;
  localStorage.setItem('activeChatId', id);
  renderChatList();
  renderMessages();
  const chat = getChat(id);
  chatTitleEl.textContent = chat.name;
  systemPromptEl.value = chat.systemPrompt || '';
}

// ═══════════════════════════════════════════════
//  MESSAGES RENDER
// ═══════════════════════════════════════════════
function renderMessages() {
  const chat = getChat(activeChatId);
  messagesEl.innerHTML = '';

  if (!chat || chat.messages.length === 0) {
    const es = document.createElement('div');
    es.className = 'empty-state';
    es.textContent = 'Presiona el micrófono para hablar o escribe un mensaje';
    messagesEl.appendChild(es);
    return;
  }

  chat.messages.forEach(msg => {
    if (msg.role === 'user') {
      addMessageDOM('user', msg.text || null, msg.isAudio || false, msg.audioDur || null);
    } else {
      addMessageDOM('model', msg.text);
    }
  });
  scrollToBottom();
}

function addMessageDOM(role, text, isAudio = false, audioDur = null) {
  // Remove empty state
  const es = messagesEl.querySelector('.empty-state');
  if (es) es.remove();

  const wrap = document.createElement('div');
  wrap.className = `message ${role}`;

  const label = document.createElement('div');
  label.className = 'message-label';
  label.textContent = role === 'user' ? 'Tú' : 'Gemini';

  const bubble = document.createElement('div');
  bubble.className = 'message-bubble';

  if (isAudio) {
    const chip = document.createElement('span');
    chip.className = 'audio-chip';
    chip.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="14" height="14">
      <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/>
      <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>
    </svg> Mensaje de voz`;
    if (audioDur) {
      const dur = document.createElement('span');
      dur.className = 'audio-dur';
      dur.textContent = formatTime(audioDur);
      chip.appendChild(dur);
    }
    bubble.appendChild(chip);
  } else {
    bubble.textContent = text || '';
  }

  wrap.appendChild(label);
  wrap.appendChild(bubble);
  messagesEl.appendChild(wrap);
  return wrap;
}

function addThinkingDOM() {
  const wrap = document.createElement('div');
  wrap.className = 'message model thinking';
  const label = document.createElement('div');
  label.className = 'message-label';
  label.textContent = 'Gemini';
  const bubble = document.createElement('div');
  bubble.className = 'message-bubble';
  bubble.innerHTML = `Pensando <span class="dots"><span></span><span></span><span></span></span>`;
  wrap.appendChild(label);
  wrap.appendChild(bubble);
  messagesEl.appendChild(wrap);
  scrollToBottom();
  return wrap;
}

function scrollToBottom() {
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

// ═══════════════════════════════════════════════
//  SEND MESSAGE
// ═══════════════════════════════════════════════
async function sendMessage(text, audioBase64, audioMimeType, audioDur) {
  if (!text && !audioBase64) return;
  const chat = getChat(activeChatId);
  if (!chat) return;

  // Store & display user message
  const userMsg = { role: 'user', ts: Date.now() };
  if (audioBase64) {
    userMsg.isAudio = true;
    userMsg.audioDur = audioDur || null;
  } else {
    userMsg.text = text;
    textInput.value = '';
    textInput.style.height = 'auto';
  }
  chat.messages.push(userMsg);
  updateChat(activeChatId, { messages: chat.messages });
  addMessageDOM('user', userMsg.text || null, userMsg.isAudio || false, userMsg.audioDur || null);

  // Update chat name from first user text
  if (chat.messages.filter(m=>m.role==='user').length === 1 && text) {
    const newName = text.slice(0, 30) + (text.length > 30 ? '…' : '');
    updateChat(activeChatId, { name: newName });
    chatTitleEl.textContent = newName;
    renderChatList();
  }

  const thinking = addThinkingDOM();

  try {
    const body = {
      sessionId: activeChatId,
      systemPrompt: chat.systemPrompt || ''
    };
    if (text) body.message = text;
    if (audioBase64) { body.audioBase64 = audioBase64; body.audioMimeType = audioMimeType; }

    const res = await fetch('/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    thinking.remove();

    if (!res.ok) { showToast(data.error || 'Error de Gemini'); return; }

    const modelMsg = { role: 'model', text: data.reply, ts: Date.now() };
    chat.messages.push(modelMsg);
    updateChat(activeChatId, { messages: chat.messages });
    addMessageDOM('model', data.reply);
    scrollToBottom();

  } catch (err) {
    thinking.remove();
    showToast('Error de conexión: ' + err.message);
  }
}

// ═══════════════════════════════════════════════
//  SETTINGS MODAL
// ═══════════════════════════════════════════════
settingsBtn.addEventListener('click', () => {
  const chat = getChat(activeChatId);
  systemPromptEl.value = chat?.systemPrompt || '';
  settingsModal.classList.add('open');
});
closeSettings.addEventListener('click', () => settingsModal.classList.remove('open'));
settingsModal.addEventListener('click', (e) => { if (e.target === settingsModal) settingsModal.classList.remove('open'); });

savePromptBtn.addEventListener('click', () => {
  const chat = getChat(activeChatId);
  if (!chat) return;
  updateChat(activeChatId, { systemPrompt: systemPromptEl.value });
  settingsModal.classList.remove('open');
  showToast('System prompt guardado', false);
});

clearHistBtn.addEventListener('click', async () => {
  const chat = getChat(activeChatId);
  if (!chat) return;
  updateChat(activeChatId, { messages: [] });
  // also clear server-side session
  await fetch('/clear', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId: activeChatId })
  }).catch(() => {});
  settingsModal.classList.remove('open');
  renderMessages();
  showToast('Conversación limpiada', false);
});

// ═══════════════════════════════════════════════
//  TEXT INPUT
// ═══════════════════════════════════════════════
textInput.addEventListener('input', () => {
  textInput.style.height = 'auto';
  textInput.style.height = Math.min(textInput.scrollHeight, 120) + 'px';
});
textInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(textInput.value.trim()); }
});
sendTextBtn.addEventListener('click', () => sendMessage(textInput.value.trim()));

// ═══════════════════════════════════════════════
//  RECORDING LOGIC
//  Modes:
//   1. Hold (pointerdown → pointerup within HOLD_MS = hold detected) → send on release
//   2. Toggle (quick tap → starts recording, shows overlay; tap Send or Cancel to finish)
// ═══════════════════════════════════════════════
const HOLD_MS = 300;   // threshold: hold > 300ms = hold mode; tap = toggle mode

let mediaRecorder = null;
let audioChunks   = [];
let isRecording   = false;
let recordingMode = null;   // 'hold' | 'toggle'
let recordingCancelled = false;
let timerInterval = null;
let recSeconds    = 0;
let holdTimer     = null;
let pointerDownY  = 0;
let LOCK_THRESHOLD = -60;  // px upward to lock (toggle mode)

function formatTime(s) {
  const m = Math.floor(s / 60);
  return m + ':' + String(s % 60).padStart(2, '0');
}

function startTimer() {
  recSeconds = 0;
  updateTimerUI();
  timerInterval = setInterval(() => { recSeconds++; updateTimerUI(); }, 1000);
}

function stopTimer() {
  clearInterval(timerInterval);
  timerInterval = null;
}

function updateTimerUI() {
  const t = formatTime(recSeconds);
  recTimerEl.textContent = t;
  btnTimer.textContent   = t;
}

async function beginRecording(mode) {
  if (isRecording) return;
  recordingCancelled = false;
  recordingMode = mode;

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

    if (recordingCancelled) { stream.getTracks().forEach(t => t.stop()); return; }

    audioChunks = [];
    const mimeType = getSupportedMimeType();
    mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});

    mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunks.push(e.data); };

    mediaRecorder.onstop = async () => {
      stream.getTracks().forEach(t => t.stop());
      const dur = recSeconds;
      stopTimer();
      setRecordingUI(false);

      if (recordingCancelled || audioChunks.length === 0) return;

      const actualMime = mediaRecorder.mimeType || mimeType || 'audio/webm';
      const blob = new Blob(audioChunks, { type: actualMime });
      const base64 = await blobToBase64(blob);
      const cleanB64 = base64.includes(',') ? base64.split(',')[1] : base64;
      const cleanMime = actualMime.split(';')[0];
      await sendMessage(null, cleanB64, cleanMime, dur);
    };

    mediaRecorder.start();
    isRecording = true;
    startTimer();
    setRecordingUI(true, mode);

  } catch (err) {
    showToast('No se pudo acceder al micrófono: ' + err.message);
    setRecordingUI(false);
  }
}

function stopRecording(cancel = false) {
  if (!isRecording) { recordingCancelled = true; return; }
  recordingCancelled = cancel;
  mediaRecorder.stop();
  isRecording = false;
}

function setRecordingUI(on, mode) {
  if (on) {
    recordBtn.classList.add('recording');
    iconMic.style.display = 'none';
    iconStop.style.display = '';
    if (mode === 'toggle') {
      recOverlay.classList.add('visible');
      btnTimer.style.display = 'none';
    } else {
      // hold mode: show inline timer
      btnTimer.style.display = '';
      lockHint.classList.add('visible');
    }
  } else {
    recordBtn.classList.remove('recording');
    iconMic.style.display = '';
    iconStop.style.display = 'none';
    recOverlay.classList.remove('visible');
    btnTimer.style.display = 'none';
    lockHint.classList.remove('visible');
  }
}

function getSupportedMimeType() {
  const types = ['audio/webm;codecs=opus','audio/webm','audio/ogg;codecs=opus','audio/ogg','audio/mp4'];
  for (const t of types) { if (MediaRecorder.isTypeSupported(t)) return t; }
  return null;
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onloadend = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

// ── Pointer events on mic button ──
recordBtn.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  if (isRecording && recordingMode === 'toggle') {
    // Second tap in toggle mode = send
    stopRecording(false);
    return;
  }
  if (isRecording) return;

  recordBtn.setPointerCapture(e.pointerId);
  pointerDownY = e.clientY;

  // Start a hold timer; if pointer lifts before HOLD_MS → it's a tap (toggle)
  holdTimer = setTimeout(() => {
    holdTimer = null;
    beginRecording('hold');
  }, HOLD_MS);
});

recordBtn.addEventListener('pointermove', (e) => {
  if (!holdTimer && isRecording && recordingMode === 'hold') {
    const dy = e.clientY - pointerDownY;
    if (dy < LOCK_THRESHOLD) {
      // Dragged far enough up → switch to toggle/lock mode
      recordingMode = 'toggle';
      setRecordingUI(true, 'toggle');
    }
  }
});

recordBtn.addEventListener('pointerup', (e) => {
  e.preventDefault();
  if (holdTimer) {
    // Released before hold threshold → toggle mode
    clearTimeout(holdTimer);
    holdTimer = null;
    if (!isRecording) {
      beginRecording('toggle');
    }
    return;
  }
  if (isRecording && recordingMode === 'hold') {
    stopRecording(false);
  }
  // toggle mode: do nothing on pointerup (wait for next tap)
});

recordBtn.addEventListener('pointercancel', () => {
  if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
  if (isRecording && recordingMode === 'hold') stopRecording(false);
});

// Prevent stray click
recordBtn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); });

// ── Cancel zone in overlay ──
recCancelZone.addEventListener('click', () => { stopRecording(true); });
recCancelZone.addEventListener('pointerdown', () => recCancelZone.classList.add('active'));
recCancelZone.addEventListener('pointerup', () => recCancelZone.classList.remove('active'));

// ── Keyboard: Escape cancels toggle recording ──
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && isRecording && recordingMode === 'toggle') {
    stopRecording(true);
  }
});

// ═══════════════════════════════════════════════
//  TOAST
// ═══════════════════════════════════════════════
let toastTimeout = null;
function showToast(msg, isError = true) {
  document.querySelectorAll('.toast').forEach(t => t.remove());
  clearTimeout(toastTimeout);
  const el = document.createElement('div');
  el.className = 'toast';
  el.style.background = isError ? 'var(--danger)' : 'var(--accent)';
  el.textContent = msg;
  document.body.appendChild(el);
  toastTimeout = setTimeout(() => el.remove(), 3500);
}

// ═══════════════════════════════════════════════
//  BOOT
// ═══════════════════════════════════════════════
renderChatList();
switchChat(activeChatId);
