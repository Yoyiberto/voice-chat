// ═══════════════════════════════════════════════
//  EMOJI PICKER
// ═══════════════════════════════════════════════
const EMOJIS = [
  '😀','😂','😍','🤔','😎','🥳','😴','🤯',
  '👍','👎','❤️','🔥','✨','💡','🎯','⚡',
  '📁','📂','📝','📌','📎','🔖','🗂️','🗃️',
  '🌍','🌎','🌏','🏠','🏢','🏗️','🎓','🎒',
  '💬','💭','🗣️','📢','📣','🔔','📡','🛰️',
  '🤖','👾','🎮','🕹️','💻','📱','⌨️','🖥️',
  '🍕','🍔','☕','🍵','🍺','🎂','🍎','🥑',
  '🚀','✈️','🚗','🚌','🛸','🌊','⛰️','🌋',
  '🎵','🎶','🎸','🥁','🎹','🎤','🎧','🎼',
  '📚','📖','✏️','🖊️','📐','🔬','🔭','🧪',
  '💰','💳','🏦','📈','📉','💹','🪙','💎',
  '🌱','🌿','🌳','🌸','🌺','🍀','🍁','🌻',
];

const emojiPicker  = document.getElementById('emojiPicker');
const emojiGrid    = document.getElementById('emojiGrid');
let emojiCallback  = null;

// Build emoji grid once
EMOJIS.forEach(em => {
  const btn = document.createElement('button');
  btn.textContent = em;
  btn.addEventListener('click', () => {
    if (emojiCallback) emojiCallback(em);
    closeEmojiPicker();
  });
  emojiGrid.appendChild(btn);
});

function openEmojiPicker(anchorEl, cb) {
  emojiCallback = cb;
  const rect = anchorEl.getBoundingClientRect();
  // Position above the anchor
  let top = rect.top - 8 - 290; // picker height ~290
  let left = rect.left;
  if (top < 8) top = rect.bottom + 8;
  if (left + 260 > window.innerWidth) left = window.innerWidth - 268;
  emojiPicker.style.top  = top + 'px';
  emojiPicker.style.left = left + 'px';
  emojiPicker.classList.add('open');
}

function closeEmojiPicker() {
  emojiPicker.classList.remove('open');
  emojiCallback = null;
}

document.addEventListener('pointerdown', (e) => {
  if (emojiPicker.classList.contains('open') && !emojiPicker.contains(e.target)) {
    closeEmojiPicker();
  }
});

// ═══════════════════════════════════════════════
//  DATA STORE  –  persisted in localStorage
// ═══════════════════════════════════════════════
const STORE_KEY   = 'voiceChats_v2';
const FOLDER_KEY  = 'voiceFolders_v2';

function loadStore()   { try { return JSON.parse(localStorage.getItem(STORE_KEY))  || {}; } catch { return {}; } }
function saveStore(s)  { localStorage.setItem(STORE_KEY, JSON.stringify(s)); }
function loadFolders() { try { return JSON.parse(localStorage.getItem(FOLDER_KEY)) || {}; } catch { return {}; } }
function saveFolders(f){ localStorage.setItem(FOLDER_KEY, JSON.stringify(f)); }

// ── Chats ──
const DEFAULT_SYSTEM_PROMPT = 'Responde máximo en 200 palabras y termina con tres preguntas cortas para saber hacia dónde dirigir la conversación.';

function chatDefaultName() {
  const now = new Date();
  const date = now.toLocaleDateString('es', { day: '2-digit', month: 'short' });
  const time = now.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit', hour12: false });
  return 'Chat ' + date + ' ' + time;
}

function createChat(name, folderId) {
  const id = 'chat_' + Date.now();
  const store = loadStore();
  // If inside a folder, inherit folder's system prompt; otherwise use default
  const folderPrompt = folderId ? (getFolder(folderId)?.systemPrompt || '') : '';
  store[id] = {
    id,
    emoji: '💬',
    name: name || chatDefaultName(),
    systemPrompt: folderPrompt || DEFAULT_SYSTEM_PROMPT,
    folderId: folderId || null,
    messages: []
  };
  saveStore(store);
  return store[id];
}

function getChat(id)            { return loadStore()[id] || null; }
function updateChat(id, patch)  { const s = loadStore(); if (!s[id]) return; Object.assign(s[id], patch); saveStore(s); }
function deleteChat(id)         { const s = loadStore(); delete s[id]; saveStore(s); }

function allChats() {
  return Object.values(loadStore()).sort((a, b) => {
    const aLast = a.messages.at(-1)?.ts || parseInt(a.id.split('_')[1]);
    const bLast = b.messages.at(-1)?.ts || parseInt(b.id.split('_')[1]);
    return bLast - aLast;
  });
}

// ── Folders ──
function createFolder(name, emoji, systemPrompt) {
  const id = 'folder_' + Date.now();
  const folders = loadFolders();
  folders[id] = { id, emoji: emoji || '📁', name: name || 'Nueva carpeta', systemPrompt: systemPrompt || '' };
  saveFolders(folders);
  return folders[id];
}
function getFolder(id)            { return loadFolders()[id] || null; }
function updateFolder(id, patch)  { const f = loadFolders(); if (!f[id]) return; Object.assign(f[id], patch); saveFolders(f); }
function deleteFolder(id)         { const f = loadFolders(); delete f[id]; saveFolders(f); }
function allFolders()             { return Object.values(loadFolders()); }

// ── Track which folders are open ──
const openFolders = new Set(JSON.parse(localStorage.getItem('openFolders') || '[]'));
function saveOpenFolders() { localStorage.setItem('openFolders', JSON.stringify([...openFolders])); }

// ═══════════════════════════════════════════════
//  INIT
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
const sidebar         = document.getElementById('sidebar');
const toggleSidebar   = document.getElementById('toggleSidebar');
const chatListEl      = document.getElementById('chatList');
const newChatBtn      = document.getElementById('newChatBtn');
const newFolderBtn    = document.getElementById('newFolderBtn');
const chatTitleEl     = document.getElementById('chatTitle');
const messagesEl      = document.getElementById('messages');
const textInput       = document.getElementById('textInput');
const sendTextBtn     = document.getElementById('sendText');
const recordBtn       = document.getElementById('recordBtn');
const micWrap         = document.getElementById('micWrap');
const btnTimer        = document.getElementById('btnTimer');
const lockHint        = document.getElementById('lockHint');
const recOverlay      = document.getElementById('recOverlay');
const recTimerEl      = document.getElementById('recTimer');
const recCancelBtn    = document.getElementById('recCancelBtn');
const recSendBtn      = document.getElementById('recSendBtn');
const settingsBtn     = document.getElementById('settingsBtn');
const ttsAutoBtn      = document.getElementById('ttsAutoBtn');
const settingsModal   = document.getElementById('settingsModal');
const closeSettings   = document.getElementById('closeSettings');
const chatNameInput   = document.getElementById('chatNameInput');
const chatEmojiBtn    = document.getElementById('chatEmojiBtn');
const systemPromptEl  = document.getElementById('systemPrompt');
const savePromptBtn   = document.getElementById('saveSystemPrompt');
const clearHistBtn    = document.getElementById('clearHistory');
const folderModal     = document.getElementById('folderModal');
const folderModalTitle= document.getElementById('folderModalTitle');
const closeFolderModal= document.getElementById('closeFolderModal');
const folderNameInput = document.getElementById('folderNameInput');
const folderEmojiBtn  = document.getElementById('folderEmojiBtn');
const folderPromptEl  = document.getElementById('folderPrompt');
const saveFolderBtn   = document.getElementById('saveFolderBtn');
const deleteFolderBtn = document.getElementById('deleteFolderBtn');
const iconMic         = recordBtn.querySelector('.icon-mic');
const iconStop        = recordBtn.querySelector('.icon-stop');

// ═══════════════════════════════════════════════
//  SIDEBAR
// ═══════════════════════════════════════════════
toggleSidebar.addEventListener('click', () => sidebar.classList.toggle('open'));

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

// ── Render sidebar ──
function renderChatList() {
  chatListEl.innerHTML = '';
  const folders = allFolders();
  const chats   = allChats();

  // 1. Render folders
  folders.forEach(folder => {
    const folderChats = chats.filter(c => c.folderId === folder.id);
    const isOpen = openFolders.has(folder.id);

    // Folder row
    const row = document.createElement('div');
    row.className = 'folder-row' + (isOpen ? ' open' : '');
    row.innerHTML = `
      <span class="folder-chevron">▶</span>
      <span class="folder-emoji">${folder.emoji || '📁'}</span>
      <span class="folder-name">${escHtml(folder.name)}</span>
      <button class="folder-edit" title="Editar carpeta">✎</button>
    `;
    row.querySelector('.folder-edit').addEventListener('click', (e) => {
      e.stopPropagation();
      openFolderModal(folder.id);
    });
    row.addEventListener('click', (e) => {
      if (e.target.classList.contains('folder-edit')) return;
      openFolders.has(folder.id) ? openFolders.delete(folder.id) : openFolders.add(folder.id);
      saveOpenFolders();
      renderChatList();
    });
    chatListEl.appendChild(row);

    // Children container
    const children = document.createElement('div');
    children.className = 'folder-children' + (isOpen ? ' open' : '');

    folderChats.forEach(chat => {
      children.appendChild(makeChatItem(chat));
    });

    // Add-chat button
    const addBtn = document.createElement('button');
    addBtn.className = 'folder-add-chat';
    addBtn.innerHTML = `<span>＋</span> Nuevo chat`;
    addBtn.addEventListener('click', () => {
      const chat = createChat(null, folder.id);
      // Inherit folder's system prompt
      const fp = getFolder(folder.id)?.systemPrompt || '';
      if (fp) updateChat(chat.id, { systemPrompt: fp });
      openFolders.add(folder.id);
      saveOpenFolders();
      switchChat(chat.id);
      sidebar.classList.remove('open');
    });
    children.appendChild(addBtn);
    chatListEl.appendChild(children);
  });

  // 2. Root chats (no folder)
  const rootChats = chats.filter(c => !c.folderId);
  rootChats.forEach(chat => {
    const item = makeChatItem(chat);
    item.classList.add('chat-item-root');
    chatListEl.appendChild(item);
  });
}

function makeChatItem(chat) {
  const item = document.createElement('div');
  item.className = 'chat-item' + (chat.id === activeChatId ? ' active' : '');
  item.dataset.id = chat.id;

  const emojiEl = document.createElement('span');
  emojiEl.className = 'chat-emoji';
  emojiEl.textContent = chat.emoji || '💬';

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
      switchChat(allChats()[0].id);
    } else {
      renderChatList();
    }
  });

  item.append(emojiEl, nameEl, delBtn);
  item.addEventListener('click', () => {
    switchChat(chat.id);
    sidebar.classList.remove('open');
  });
  return item;
}

function switchChat(id) {
  ttsStop();
  activeChatId = id;
  localStorage.setItem('activeChatId', id);
  renderChatList();
  renderMessages();
  const chat = getChat(id);
  if (chat) {
    chatTitleEl.textContent = (chat.emoji !== '💬' ? chat.emoji + ' ' : '') + chat.name;
    systemPromptEl.value  = chat.systemPrompt || '';
    chatNameInput.value   = chat.name;
    chatEmojiBtn.textContent = chat.emoji || '💬';
  }
}

function escHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
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
  const es = messagesEl.querySelector('.empty-state');
  if (es) es.remove();

  const wrap   = document.createElement('div');
  wrap.className = `message ${role}`;

  // Label row: "Gemini" + TTS button for model messages
  const labelRow = document.createElement('div');
  labelRow.className = 'message-label-row';
  const label  = document.createElement('div');
  label.className = 'message-label';
  label.textContent = role === 'user' ? 'Tú' : 'Gemini';
  labelRow.appendChild(label);

  if (role === 'model' && text) {
    const ttsBtn = document.createElement('button');
    ttsBtn.className = 'btn-tts';
    ttsBtn.title = 'Escuchar';
    ttsBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="13" height="13">
      <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/>
    </svg>`;
    ttsBtn.dataset.speaking = 'false';
    ttsBtn.addEventListener('click', () => ttsToggle(ttsBtn, text));
    labelRow.appendChild(ttsBtn);
  }

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

  wrap.appendChild(labelRow);
  wrap.appendChild(bubble);
  messagesEl.appendChild(wrap);
  return wrap;
}

function addThinkingDOM() {
  const wrap   = document.createElement('div');
  wrap.className = 'message model thinking';
  const label  = document.createElement('div');
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

function scrollToBottom() { messagesEl.scrollTop = messagesEl.scrollHeight; }

// ═══════════════════════════════════════════════
//  SEND MESSAGE
// ═══════════════════════════════════════════════
async function sendMessage(text, audioBase64, audioMimeType, audioDur) {
  if (!text && !audioBase64) return;
  const chat = getChat(activeChatId);
  if (!chat) return;

  const userMsg = { role: 'user', ts: Date.now() };
  if (audioBase64) {
    userMsg.isAudio  = true;
    userMsg.audioDur = audioDur || null;
  } else {
    userMsg.text = text;
    textInput.value = '';
    textInput.style.height = 'auto';
  }
  chat.messages.push(userMsg);
  updateChat(activeChatId, { messages: chat.messages });
  addMessageDOM('user', userMsg.text || null, userMsg.isAudio || false, userMsg.audioDur || null);

  // Auto-name from first user text
  if (chat.messages.filter(m => m.role === 'user').length === 1 && text) {
    const newName = text.slice(0, 30) + (text.length > 30 ? '…' : '');
    updateChat(activeChatId, { name: newName });
    chatNameInput.value   = newName;
    chatTitleEl.textContent = (chat.emoji !== '💬' ? chat.emoji + ' ' : '') + newName;
    renderChatList();
  }

  const thinking = addThinkingDOM();

  try {
    const body = { sessionId: activeChatId, systemPrompt: chat.systemPrompt || '' };
    if (text) body.message = text;
    if (audioBase64) { body.audioBase64 = audioBase64; body.audioMimeType = audioMimeType; }

    const res  = await fetch('/chat', {
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
    const msgEl = addMessageDOM('model', data.reply);
    scrollToBottom();
    // Auto-TTS if enabled
    if (autoTts && data.reply) {
      const ttsBtn = msgEl?.querySelector('.btn-tts');
      if (ttsBtn) ttsToggle(ttsBtn, data.reply);
    }

  } catch (err) {
    thinking.remove();
    showToast('Error de conexión: ' + err.message);
  }
}

// ═══════════════════════════════════════════════
//  SETTINGS MODAL (chat config)
// ═══════════════════════════════════════════════
settingsBtn.addEventListener('click', () => {
  const chat = getChat(activeChatId);
  systemPromptEl.value     = chat?.systemPrompt || '';
  chatNameInput.value      = chat?.name || '';
  chatEmojiBtn.textContent = chat?.emoji || '💬';
  settingsModal.classList.add('open');
});
closeSettings.addEventListener('click', () => settingsModal.classList.remove('open'));
settingsModal.addEventListener('click', (e) => { if (e.target === settingsModal) settingsModal.classList.remove('open'); });

chatEmojiBtn.addEventListener('click', () => {
  openEmojiPicker(chatEmojiBtn, (em) => { chatEmojiBtn.textContent = em; });
});

savePromptBtn.addEventListener('click', () => {
  const chat = getChat(activeChatId);
  if (!chat) return;
  const newName  = chatNameInput.value.trim() || chat.name;
  const newEmoji = chatEmojiBtn.textContent;
  updateChat(activeChatId, {
    name:         newName,
    emoji:        newEmoji,
    systemPrompt: systemPromptEl.value
  });
  chatTitleEl.textContent = (newEmoji !== '💬' ? newEmoji + ' ' : '') + newName;
  renderChatList();
  settingsModal.classList.remove('open');
  showToast('Configuración guardada', false);
});

clearHistBtn.addEventListener('click', async () => {
  const chat = getChat(activeChatId);
  if (!chat) return;
  updateChat(activeChatId, { messages: [] });
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
//  FOLDER MODAL
// ═══════════════════════════════════════════════
let editingFolderId = null;

function openFolderModal(folderId) {
  editingFolderId = folderId || null;
  if (folderId) {
    const f = getFolder(folderId);
    folderModalTitle.textContent   = 'Editar carpeta';
    folderNameInput.value          = f.name;
    folderEmojiBtn.textContent     = f.emoji || '📁';
    folderPromptEl.value           = f.systemPrompt || '';
    deleteFolderBtn.style.display  = '';
  } else {
    folderModalTitle.textContent   = 'Nueva carpeta';
    folderNameInput.value          = '';
    folderEmojiBtn.textContent     = '📁';
    folderPromptEl.value           = '';
    deleteFolderBtn.style.display  = 'none';
  }
  folderModal.classList.add('open');
}

newFolderBtn.addEventListener('click', () => openFolderModal(null));
closeFolderModal.addEventListener('click', () => folderModal.classList.remove('open'));
folderModal.addEventListener('click', (e) => { if (e.target === folderModal) folderModal.classList.remove('open'); });

folderEmojiBtn.addEventListener('click', () => {
  openEmojiPicker(folderEmojiBtn, (em) => { folderEmojiBtn.textContent = em; });
});

saveFolderBtn.addEventListener('click', () => {
  const name   = folderNameInput.value.trim() || 'Carpeta';
  const emoji  = folderEmojiBtn.textContent;
  const prompt = folderPromptEl.value;

  if (editingFolderId) {
    updateFolder(editingFolderId, { name, emoji, systemPrompt: prompt });
  } else {
    createFolder(name, emoji, prompt);
  }
  folderModal.classList.remove('open');
  renderChatList();
  showToast('Carpeta guardada', false);
});

deleteFolderBtn.addEventListener('click', () => {
  if (!editingFolderId) return;
  // Move all chats in this folder to root
  allChats().filter(c => c.folderId === editingFolderId).forEach(c => updateChat(c.id, { folderId: null }));
  deleteFolder(editingFolderId);
  openFolders.delete(editingFolderId);
  saveOpenFolders();
  folderModal.classList.remove('open');
  renderChatList();
  showToast('Carpeta eliminada', false);
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
//
//  Modes:
//   1. HOLD  — pointerdown → recording starts after HOLD_MS,
//              pointerup sends; drag up to lock.
//   2. TOGGLE — quick tap → starts recording, shows overlay.
//              In overlay: "Enviar" button sends, "Cancelar" discards.
//              Pressing mic button again in toggle mode also sends.
// ═══════════════════════════════════════════════
const HOLD_MS       = 300;
const LOCK_THRESHOLD = -60; // px upward to lock from hold → toggle

let mediaRecorder      = null;
let audioChunks        = [];
let isRecording        = false;
let recordingMode      = null;   // 'hold' | 'toggle'
let recordingCancelled = false;
let timerInterval      = null;
let recSeconds         = 0;
let holdTimer          = null;
let pointerDownY       = 0;

// Stored audio for "review before send" in toggle mode
let pendingBlob        = null;
let pendingMime        = null;
let pendingDur         = 0;

function formatTime(s) {
  const m = Math.floor(s / 60);
  return m + ':' + String(s % 60).padStart(2, '0');
}

function startTimer() {
  recSeconds = 0;
  updateTimerUI();
  timerInterval = setInterval(() => { recSeconds++; updateTimerUI(); }, 1000);
}

function stopTimer() { clearInterval(timerInterval); timerInterval = null; }

function updateTimerUI() {
  const t = formatTime(recSeconds);
  recTimerEl.textContent = t;
  btnTimer.textContent   = t;
}

async function beginRecording(mode) {
  if (isRecording) return;
  recordingCancelled = false;
  pendingBlob = null;
  recordingMode = mode;

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    if (recordingCancelled) { stream.getTracks().forEach(t => t.stop()); return; }

    audioChunks = [];
    const mimeType   = getSupportedMimeType();
    mediaRecorder    = new MediaRecorder(stream, mimeType ? { mimeType } : {});

    mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunks.push(e.data); };

    mediaRecorder.onstop = async () => {
      stream.getTracks().forEach(t => t.stop());
      const dur = recSeconds;
      stopTimer();

      if (recordingCancelled || audioChunks.length === 0) {
        setRecordingUI(false);
        return;
      }

      const actualMime = mediaRecorder.mimeType || mimeType || 'audio/webm';
      pendingBlob = new Blob(audioChunks, { type: actualMime });
      pendingMime = actualMime;
      pendingDur  = dur;

      // In hold mode: send immediately
      // In toggle mode: show overlay with Send/Cancel buttons (already visible)
      if (recordingMode === 'hold') {
        setRecordingUI(false);
        await doSendAudio();
      } else {
        // toggle: recording stopped, show review state in overlay
        setOverlayReviewState(dur);
      }
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

async function doSendAudio() {
  if (!pendingBlob) return;
  const blob  = pendingBlob;
  const mime  = pendingMime;
  const dur   = pendingDur;
  pendingBlob = null;
  setRecordingUI(false);
  const base64 = await blobToBase64(blob);
  const cleanB64  = base64.includes(',') ? base64.split(',')[1] : base64;
  const cleanMime = mime.split(';')[0];
  await sendMessage(null, cleanB64, cleanMime, dur);
}

function stopRecording(cancel = false) {
  if (!isRecording) { recordingCancelled = cancel; return; }
  recordingCancelled = cancel;
  mediaRecorder.stop();
  isRecording = false;
}

// Overlay shows "recording" state or "review" state (after stop in toggle)
function setOverlayReviewState(dur) {
  // Recording already stopped; show Send/Cancel in overlay, hide waveform animation
  recTimerEl.textContent = formatTime(dur);
  // Swap hint text
  recOverlay.querySelector('.rec-hint').textContent = 'Grabación lista — ¿Enviar?';
  // Keep overlay visible, buttons already there
}

function setRecordingUI(on, mode) {
  if (on) {
    recordBtn.classList.add('recording');
    iconMic.style.display = 'none';
    iconStop.style.display = '';
    // Reset hint text
    if (recOverlay.querySelector('.rec-hint')) {
      recOverlay.querySelector('.rec-hint').textContent = 'Grabando — bloqueado';
    }
    if (mode === 'toggle') {
      recOverlay.classList.add('visible');
      btnTimer.style.display = 'none';
    } else {
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
    pendingBlob = null;
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
    r.onerror   = reject;
    r.readAsDataURL(blob);
  });
}

// ── Pointer events on mic button ──
recordBtn.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  // If already in toggle mode and recording → second tap = stop recording (goes to review)
  if (isRecording && recordingMode === 'toggle') {
    stopRecording(false);
    return;
  }
  // If in review state (pendingBlob exists, overlay visible) → send
  if (!isRecording && pendingBlob && recOverlay.classList.contains('visible')) {
    doSendAudio();
    return;
  }
  if (isRecording) return;

  recordBtn.setPointerCapture(e.pointerId);
  pointerDownY = e.clientY;

  holdTimer = setTimeout(() => {
    holdTimer = null;
    beginRecording('hold');
  }, HOLD_MS);
});

recordBtn.addEventListener('pointermove', (e) => {
  if (!holdTimer && isRecording && recordingMode === 'hold') {
    const dy = e.clientY - pointerDownY;
    if (dy < LOCK_THRESHOLD) {
      recordingMode = 'toggle';
      setRecordingUI(true, 'toggle');
    }
  }
});

recordBtn.addEventListener('pointerup', (e) => {
  e.preventDefault();
  if (holdTimer) {
    clearTimeout(holdTimer);
    holdTimer = null;
    if (!isRecording) beginRecording('toggle');
    return;
  }
  if (isRecording && recordingMode === 'hold') {
    stopRecording(false);
  }
});

recordBtn.addEventListener('pointercancel', () => {
  if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
  if (isRecording && recordingMode === 'hold') stopRecording(false);
});

recordBtn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); });

// ── Overlay buttons ──
recSendBtn.addEventListener('click', async () => {
  if (isRecording) {
    // Stop recording first, then send (onstop will call doSendAudio via review state)
    stopRecording(false);
    // Give onstop a tick to run, then send
    setTimeout(async () => { await doSendAudio(); }, 150);
  } else {
    await doSendAudio();
  }
});

recCancelBtn.addEventListener('click', () => {
  stopRecording(true);
  pendingBlob = null;
  setRecordingUI(false);
});

// ── Keyboard shortcuts ──
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (recOverlay.classList.contains('visible')) {
      stopRecording(true);
      pendingBlob = null;
      setRecordingUI(false);
    }
  }
});

// ═══════════════════════════════════════════════
//  TEXT-TO-SPEECH  (Web Speech API — free, native)
// ═══════════════════════════════════════════════
const tts = window.speechSynthesis;
let activeTtsBtn = null;

function ttsToggle(btn, text) {
  // If something is already speaking, stop it
  if (tts.speaking) {
    tts.cancel();
    if (activeTtsBtn) {
      activeTtsBtn.classList.remove('speaking');
      activeTtsBtn.dataset.speaking = 'false';
      activeTtsBtn.title = 'Escuchar';
    }
    // If we clicked the same button that was speaking, just stop
    if (activeTtsBtn === btn) {
      activeTtsBtn = null;
      return;
    }
  }

  // Start speaking
  const utt = new SpeechSynthesisUtterance(text);
  utt.rate  = 1.1;   // slightly faster = more natural for quick responses
  utt.pitch = 1;
  utt.lang  = 'es-ES';  // Spanish default; browser will pick best voice available

  utt.onstart = () => {
    activeTtsBtn = btn;
    btn.classList.add('speaking');
    btn.dataset.speaking = 'true';
    btn.title = 'Detener';
    btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="13" height="13">
      <path d="M6 6h12v12H6z"/>
    </svg>`;
  };
  utt.onend = utt.onerror = () => {
    btn.classList.remove('speaking');
    btn.dataset.speaking = 'false';
    btn.title = 'Escuchar';
    btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="13" height="13">
      <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/>
    </svg>`;
    if (activeTtsBtn === btn) activeTtsBtn = null;
  };

  tts.speak(utt);
}

// ─── auto-TTS toggle ───
let autoTts = localStorage.getItem('autoTts') === 'true';
function updateTtsAutoBtn() {
  ttsAutoBtn.classList.toggle('active', autoTts);
  ttsAutoBtn.title = autoTts ? 'Auto-voz activada (clic para desactivar)' : 'Reproducir respuestas automáticamente';
}
updateTtsAutoBtn();
ttsAutoBtn.addEventListener('click', () => {
  autoTts = !autoTts;
  localStorage.setItem('autoTts', autoTts);
  updateTtsAutoBtn();
  if (!autoTts && tts.speaking) tts.cancel();
});

// Stop TTS when switching chats
function ttsStop() {
  if (tts.speaking) tts.cancel();
  activeTtsBtn = null;
}

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
