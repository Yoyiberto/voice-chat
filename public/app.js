// Session ID (persisted across reloads)
let sessionId = localStorage.getItem('sessionId');
if (!sessionId) {
  sessionId = 'sess_' + Math.random().toString(36).slice(2);
  localStorage.setItem('sessionId', sessionId);
}

// DOM refs
const chatContainer = document.getElementById('chatContainer');
const emptyState = document.getElementById('emptyState');
const textInput = document.getElementById('textInput');
const sendText = document.getElementById('sendText');
const recordBtn = document.getElementById('recordBtn');
const recordingIndicator = document.getElementById('recordingIndicator');
const systemPromptEl = document.getElementById('systemPrompt');
const saveSystemPromptBtn = document.getElementById('saveSystemPrompt');
const clearHistoryBtn = document.getElementById('clearHistory');

// Load saved system prompt
systemPromptEl.value = localStorage.getItem('systemPrompt') || '';

saveSystemPromptBtn.addEventListener('click', () => {
  localStorage.setItem('systemPrompt', systemPromptEl.value);
  showToast('System prompt guardado', false);
});

clearHistoryBtn.addEventListener('click', async () => {
  await fetch('/clear', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId })
  });
  chatContainer.innerHTML = '';
  chatContainer.appendChild(emptyStateEl());
  showToast('Conversación limpiada', false);
});

function emptyStateEl() {
  const el = document.createElement('div');
  el.className = 'empty-state';
  el.id = 'emptyState';
  el.textContent = 'Presiona el micrófono para hablar o escribe un mensaje';
  return el;
}

// Auto-resize textarea
textInput.addEventListener('input', () => {
  textInput.style.height = 'auto';
  textInput.style.height = Math.min(textInput.scrollHeight, 120) + 'px';
});

// Send text on Enter (Shift+Enter = newline)
textInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage(textInput.value.trim(), null, null);
  }
});

sendText.addEventListener('click', () => {
  sendMessage(textInput.value.trim(), null, null);
});

// ---- Recording ----
let mediaRecorder = null;
let audioChunks = [];
let isRecording = false;
let recordingCancelled = false;

async function startRecording() {
  if (isRecording) return;
  recordingCancelled = false;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

    // User may have released the button while getUserMedia was pending (permission dialog)
    if (recordingCancelled) {
      stream.getTracks().forEach(t => t.stop());
      return;
    }

    audioChunks = [];

    // Prefer webm/opus, fallback to whatever is supported
    const mimeType = getSupportedMimeType();
    mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});

    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) audioChunks.push(e.data);
    };

    mediaRecorder.onstop = async () => {
      stream.getTracks().forEach(t => t.stop());
      if (recordingCancelled || audioChunks.length === 0) return;
      const actualMime = mediaRecorder.mimeType || mimeType || 'audio/webm';
      const blob = new Blob(audioChunks, { type: actualMime });
      await sendAudio(blob, actualMime);
    };

    mediaRecorder.start();
    isRecording = true;
    recordBtn.classList.add('recording');
    recordingIndicator.classList.add('visible');

  } catch (err) {
    showToast('No se pudo acceder al micrófono: ' + err.message);
  }
}

function stopRecording() {
  recordingCancelled = !isRecording; // true if stop called before recording actually started
  if (!isRecording || !mediaRecorder) return;
  mediaRecorder.stop();
  isRecording = false;
  recordBtn.classList.remove('recording');
  recordingIndicator.classList.remove('visible');
}

function getSupportedMimeType() {
  const types = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/ogg',
    'audio/mp4',
  ];
  for (const type of types) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return null;
}

// Pointer events for record button (handles mouse + touch uniformly)
// setPointerCapture keeps events on the button even if pointer moves away
recordBtn.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  recordBtn.setPointerCapture(e.pointerId);
  startRecording();
});

recordBtn.addEventListener('pointerup', (e) => {
  e.preventDefault();
  stopRecording();
});

recordBtn.addEventListener('pointercancel', (e) => {
  stopRecording();
});

// Prevent any stray click events on the record button from triggering twice
recordBtn.addEventListener('click', (e) => {
  e.preventDefault();
  e.stopPropagation();
});

// ---- Send Audio ----
async function sendAudio(blob, mimeType) {
  const base64 = await blobToBase64(blob);
  // Strip the data URL prefix if present
  const cleanBase64 = base64.includes(',') ? base64.split(',')[1] : base64;
  // Get clean mime type (strip codecs param for API)
  const cleanMime = mimeType.split(';')[0];
  await sendMessage(null, cleanBase64, cleanMime);
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// ---- Send Message ----
async function sendMessage(text, audioBase64, audioMimeType) {
  if (!text && !audioBase64) return;

  // Remove empty state
  const existing = document.getElementById('emptyState');
  if (existing) existing.remove();

  // Show user message
  if (audioBase64) {
    addMessage('user', null, true);
  } else {
    addMessage('user', text);
    textInput.value = '';
    textInput.style.height = 'auto';
  }

  // Show thinking indicator
  const thinkingEl = addThinking();

  const systemPrompt = localStorage.getItem('systemPrompt') || '';

  try {
    const body = { sessionId, systemPrompt };
    if (text) body.message = text;
    if (audioBase64) body.audioBase64 = audioBase64;
    if (audioMimeType) body.audioMimeType = audioMimeType;

    const res = await fetch('/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    const data = await res.json();
    thinkingEl.remove();

    if (!res.ok) {
      showToast(data.error || 'Error al conectar con Gemini');
      return;
    }

    addMessage('model', data.reply);

  } catch (err) {
    thinkingEl.remove();
    showToast('Error de conexión: ' + err.message);
  }
}

// ---- UI helpers ----
function addMessage(role, text, isAudio = false) {
  const wrap = document.createElement('div');
  wrap.className = `message ${role}`;

  const label = document.createElement('div');
  label.className = 'message-label';
  label.textContent = role === 'user' ? 'Tú' : 'Gemini';

  const bubble = document.createElement('div');
  bubble.className = 'message-bubble';

  if (isAudio) {
    bubble.innerHTML = `<span class="message-audio-label">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="14" height="14">
        <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/>
        <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>
      </svg>
      Mensaje de voz
    </span>`;
  } else {
    bubble.textContent = text;
  }

  wrap.appendChild(label);
  wrap.appendChild(bubble);
  chatContainer.appendChild(wrap);
  scrollToBottom();
  return wrap;
}

function addThinking() {
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
  chatContainer.appendChild(wrap);
  scrollToBottom();
  return wrap;
}

function scrollToBottom() {
  chatContainer.scrollTop = chatContainer.scrollHeight;
}

let toastTimeout = null;
function showToast(msg, isError = true) {
  const existing = document.querySelector('.error-toast');
  if (existing) existing.remove();
  if (toastTimeout) clearTimeout(toastTimeout);

  const toast = document.createElement('div');
  toast.className = 'error-toast';
  toast.style.background = isError ? 'var(--danger)' : 'var(--accent)';
  toast.textContent = msg;
  document.body.appendChild(toast);

  toastTimeout = setTimeout(() => toast.remove(), 3500);
}
