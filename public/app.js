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
//  SUPABASE CONFIG
//  Credentials injected at build time or from meta tags
// ═══════════════════════════════════════════════
const SUPABASE_URL  = document.querySelector('meta[name="sb-url"]')?.content  || '';
const SUPABASE_ANON = document.querySelector('meta[name="sb-anon"]')?.content || '';
const SB_READY = !!(SUPABASE_URL && SUPABASE_ANON);

// Stable device id — same device always has same id; share it between devices to sync
let DEVICE_ID = localStorage.getItem('deviceId');
if (!DEVICE_ID) { DEVICE_ID = 'dev_' + Math.random().toString(36).slice(2, 10); localStorage.setItem('deviceId', DEVICE_ID); }

// Supabase REST helpers (no SDK needed — plain fetch)
async function sbGet(table, eq = {}) {
  if (!SB_READY) return [];
  const params = new URLSearchParams({ select: '*', ...Object.fromEntries(Object.entries(eq).map(([k,v])=>[k, `eq.${v}`])) });
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${params}&order=created_at.asc`, {
    headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}` }
  });
  if (!r.ok) {
    const errText = await r.text().catch(() => r.status);
    console.error(`sbGet ${table} error ${r.status}:`, errText);
    throw new Error(`sbGet ${table}: ${r.status} ${errText}`);
  }
  return r.json();
}

async function sbUpsert(table, row) {
  if (!SB_READY) return;
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}`,
               'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify(row)
  });
  if (!r.ok) {
    const errText = await r.text().catch(() => r.status);
    console.error(`sbUpsert ${table} error ${r.status}:`, errText);
  }
}

async function sbDelete(table, id) {
  if (!SB_READY) return;
  await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}` }
  });
}

// (polling removed — sync is manual via Push/Pull buttons)

// ═══════════════════════════════════════════════
//  DATA STORE  –  localStorage (primary) + Supabase (sync)
// ═══════════════════════════════════════════════
const STORE_KEY   = 'voiceChats_v2';
const FOLDER_KEY  = 'voiceFolders_v2';

function loadStore()   { try { return JSON.parse(localStorage.getItem(STORE_KEY))  || {}; } catch { return {}; } }
function saveStore(s)  { localStorage.setItem(STORE_KEY, JSON.stringify(s)); }
function loadFolders() { try { return JSON.parse(localStorage.getItem(FOLDER_KEY)) || {}; } catch { return {}; } }
function saveFolders(f){ localStorage.setItem(FOLDER_KEY, JSON.stringify(f)); }

// ── Sync helpers ──
function chatToRow(c) {
  return { id: c.id, device_id: DEVICE_ID, folder_id: c.folderId || null,
           emoji: c.emoji || '💬', name: c.name, system_prompt: c.systemPrompt || '',
           messages: c.messages || [], updated_at: new Date().toISOString() };
}
function rowToChat(r) {
  return { id: r.id, emoji: r.emoji || '💬', name: r.name, systemPrompt: r.system_prompt || '',
           folderId: r.folder_id || null, messages: r.messages || [] };
}
function folderToRow(f) {
  return { id: f.id, device_id: DEVICE_ID, emoji: f.emoji || '📁',
           name: f.name, system_prompt: f.systemPrompt || '' };
}
function rowToFolder(r) {
  return { id: r.id, emoji: r.emoji || '📁', name: r.name, systemPrompt: r.system_prompt || '' };
}

async function syncFromSupabase(renderAfter = true, replace = false) {
  if (!SB_READY) return;
  try {
    const [remoteChats, remoteFolders] = await Promise.all([
      sbGet('chats',   { device_id: DEVICE_ID }),
      sbGet('folders', { device_id: DEVICE_ID })
    ]);

    // replace=true: wipe local data and load only what's on Supabase for this device_id
    // replace=false: merge (remote wins on conflict, local-only entries are kept)
    const store = replace ? {} : loadStore();
    remoteChats.forEach(r => { store[r.id] = { ...store[r.id], ...rowToChat(r) }; });
    saveStore(store);

    const folders = replace ? {} : loadFolders();
    remoteFolders.forEach(r => { folders[r.id] = { ...folders[r.id], ...rowToFolder(r) }; });
    saveFolders(folders);

    if (renderAfter) { renderChatList(); }
    return { chats: remoteChats.length, folders: remoteFolders.length };
  } catch (e) {
    console.error('syncFromSupabase error:', e);
    throw e;   // re-throw so callers can show a toast
  }
}

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
  const folderPrompt = folderId ? (getFolder(folderId)?.systemPrompt || '') : '';
  store[id] = {
    id, emoji: '💬',
    name: name || chatDefaultName(),
    systemPrompt: folderPrompt || DEFAULT_SYSTEM_PROMPT,
    folderId: folderId || null,
    messages: []
  };
  saveStore(store);
  sbUpsert('chats', chatToRow(store[id]));
  return store[id];
}

function getChat(id)  { return loadStore()[id] || null; }

function updateChat(id, patch) {
  const s = loadStore();
  if (!s[id]) return;
  Object.assign(s[id], patch);
  saveStore(s);
  sbUpsert('chats', chatToRow(s[id]));
}

function deleteChat(id) {
  const s = loadStore();
  delete s[id];
  saveStore(s);
  sbDelete('chats', id);
}

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
  sbUpsert('folders', folderToRow(folders[id]));
  return folders[id];
}
function getFolder(id) { return loadFolders()[id] || null; }
function updateFolder(id, patch) {
  const f = loadFolders();
  if (!f[id]) return;
  Object.assign(f[id], patch);
  saveFolders(f);
  sbUpsert('folders', folderToRow(f[id]));
}
function deleteFolder(id) {
  const f = loadFolders();
  delete f[id];
  saveFolders(f);
  sbDelete('folders', id);
}
function allFolders() { return Object.values(loadFolders()); }

// ── Track which folders are open ──
const openFolders = new Set(JSON.parse(localStorage.getItem('openFolders') || '[]'));
function saveOpenFolders() { localStorage.setItem('openFolders', JSON.stringify([...openFolders])); }

// ═══════════════════════════════════════════════
//  INIT
// ═══════════════════════════════════════════════
let activeChatId = localStorage.getItem('activeChatId');

// Boot: sync from Supabase first, THEN ensure we have at least one chat
syncFromSupabase(false, false).catch(() => {}).finally(() => {
  // After sync, validate activeChatId — may have been populated by sync
  if (!activeChatId || !getChat(activeChatId)) {
    const existing = allChats();
    if (existing.length > 0) {
      activeChatId = existing[0].id;
    } else {
      const chat = createChat();
      activeChatId = chat.id;
    }
    localStorage.setItem('activeChatId', activeChatId);
  }
  renderChatList();
  switchChat(activeChatId);
});


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
const recAddTextBtn   = document.getElementById('recAddTextBtn');
const recTextInput    = document.getElementById('recTextInput');
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
      e.stopPropagation(); // prevent sidebar close on mobile
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

  // ── Inline rename on double-click ──
  function startRename(e) {
    e.stopPropagation();
    const input = document.createElement('input');
    input.className = 'chat-item-rename';
    input.value = chat.name;
    nameEl.replaceWith(input);
    input.focus();
    input.select();

    function commit() {
      const newName = input.value.trim() || chat.name;
      updateChat(chat.id, { name: newName });
      if (activeChatId === chat.id) {
        const c = getChat(chat.id);
        chatTitleEl.textContent = (c.emoji !== '💬' ? c.emoji + ' ' : '') + newName;
        chatNameInput.value = newName;
      }
      renderChatList();
    }
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter')  { ev.preventDefault(); input.blur(); }
      if (ev.key === 'Escape') { input.value = chat.name; input.blur(); }
      ev.stopPropagation();
    });
    input.addEventListener('click', e => e.stopPropagation());
  }

  nameEl.addEventListener('dblclick', startRename);

  // pencil button (always visible on active, hover on rest)
  const editBtn = document.createElement('button');
  editBtn.className = 'chat-item-edit';
  editBtn.title = 'Renombrar';
  editBtn.textContent = '✎';
  editBtn.addEventListener('click', (e) => { e.stopPropagation(); startRename(e); });

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

  item.append(emojiEl, nameEl, editBtn, delBtn);
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
    ttsBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="15" height="15">
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
    if (text) {
      const extra = document.createElement('div');
      extra.className = 'audio-text';
      extra.textContent = text;
      bubble.appendChild(extra);
    }
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
    if (text) userMsg.text = text;
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
    const body = { sessionId: activeChatId, systemPrompt: chat.systemPrompt || '', model: localStorage.getItem('selectedModel') || 'google:gemini-3.1-flash-lite-preview' };
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
const HOLD_MS       = 180;
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
let cachedStream       = null;

function warmMic() {
  if (cachedStream) return;
  navigator.mediaDevices.getUserMedia({ audio: true }).then(s => { cachedStream = s; }).catch(() => {});
}
document.addEventListener('pointerdown', warmMic, { once: true, capture: true });

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

function getSupportedMimeType() {
  const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/ogg', 'audio/mp4'];
  for (const t of types) { if (MediaRecorder.isTypeSupported(t)) return t; }
  return null;
}

async function blobToWav(blob) {
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  try {
    const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
    const input = decoded.getChannelData(0);
    // Downsample to 16kHz — lighter upload, better for speech models
    const targetRate = 16000;
    const ratio = decoded.sampleRate / targetRate;
    const len = Math.floor(input.length / ratio);
    const buffer = new ArrayBuffer(44 + len * 2);
    const view = new DataView(buffer);
    const w = (o, s) => { for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i)); };
    w(0, 'RIFF'); view.setUint32(4, 36 + len * 2, true);
    w(8, 'WAVE'); w(12, 'fmt ');
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, targetRate, true); view.setUint32(28, targetRate * 2, true);
    view.setUint16(32, 2, true); view.setUint16(34, 16, true);
    w(36, 'data'); view.setUint32(40, len * 2, true);
    for (let i = 0, o = 44; i < len; i++, o += 2) {
      const sample = Math.max(-1, Math.min(1, input[Math.floor(i * ratio)] || 0));
      view.setInt16(o, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    }
    return new Blob([buffer], { type: 'audio/wav' });
  } finally {
    await ctx.close().catch(() => {});
  }
}

async function beginRecording(mode) {
  if (isRecording) return;
  recordingCancelled = false;
  pendingBlob = null;
  recordingMode = mode;

  try {
    if (!cachedStream || cachedStream.getTracks().some(t => t.readyState === 'ended')) {
      cachedStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    }
    if (recordingCancelled) return;

    audioChunks = [];
    const mimeType = getSupportedMimeType();
    mediaRecorder = new MediaRecorder(cachedStream, mimeType ? { mimeType } : {});
    mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunks.push(e.data); };

    mediaRecorder.onstop = async () => {
      const dur = recSeconds;
      stopTimer();
      if (recordingCancelled || audioChunks.length === 0) {
        setRecordingUI(false);
        return;
      }
      try {
        const raw = new Blob(audioChunks, { type: mediaRecorder.mimeType || mimeType || 'audio/webm' });
        pendingBlob = await blobToWav(raw);
        pendingMime = 'audio/wav';
        pendingDur = dur;
      } catch (err) {
        showToast('Error al procesar audio: ' + err.message);
        setRecordingUI(false);
        return;
      }
      if (recordingMode === 'hold') await doSendAudio();
      else setOverlayReviewState(dur);
    };

    mediaRecorder.start(100);
    isRecording = true;
    startTimer();
    setRecordingUI(true, mode);
  } catch (err) {
    cachedStream = null;
    showToast('No se pudo acceder al micrófono: ' + err.message);
    setRecordingUI(false);
  }
}

async function doSendAudio() {
  if (!pendingBlob) return;
  const blob = pendingBlob;
  const mime = pendingMime;
  const dur = pendingDur;
  const extraText = (recTextInput?.value || '').trim() || null;
  pendingBlob = null;
  resetRecTextUI();
  setRecordingUI(false);
  if (blob.size < 1000) { showToast('Grabación muy corta'); return; }
  const base64 = await blobToBase64(blob);
  const cleanB64 = base64.includes(',') ? base64.split(',')[1] : base64;
  await sendMessage(extraText, cleanB64, (mime || 'audio/wav').split(';')[0], dur);
}

function resetRecTextUI() {
  if (recTextInput) {
    recTextInput.value = '';
    recTextInput.hidden = true;
  }
  if (recAddTextBtn) recAddTextBtn.classList.remove('active');
}

function showRecTextUI() {
  if (!recTextInput) return;
  recTextInput.hidden = false;
  if (recAddTextBtn) recAddTextBtn.classList.add('active');
  const hint = recOverlay.querySelector('.rec-hint');
  if (hint) hint.textContent = 'Añade texto y pulsa Enviar';
  recTextInput.focus();
}

async function enableRecText() {
  // Always land in review (never auto-send) so the user can type first
  recordingMode = 'toggle';
  if (isRecording) {
    stopRecording(false);
    const t0 = Date.now();
    while (!pendingBlob && !recordingCancelled && Date.now() - t0 < 2500) {
      await new Promise(r => setTimeout(r, 30));
    }
  }
  if (!pendingBlob) { showToast('No hay audio aún'); return; }
  setOverlayReviewState(pendingDur);
  showRecTextUI();
}

function stopRecording(cancel = false) {
  if (!isRecording) { recordingCancelled = cancel; return; }
  recordingCancelled = cancel;
  isRecording = false;
  if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
}

function setOverlayReviewState(dur) {
  recTimerEl.textContent = formatTime(dur);
  const hint = recOverlay.querySelector('.rec-hint');
  if (hint) hint.textContent = 'Grabación lista — ¿Enviar?';
}

function setRecordingUI(on, mode) {
  if (on) {
    recordBtn.classList.add('recording');
    iconMic.style.display = 'none';
    iconStop.style.display = '';
    if (recOverlay.querySelector('.rec-hint')) {
      recOverlay.querySelector('.rec-hint').textContent = 'Grabando…';
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
    resetRecTextUI();
  }
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
  if (isRecording) stopRecording(false);
  const t0 = Date.now();
  while (!pendingBlob && !recordingCancelled && Date.now() - t0 < 2000) {
    await new Promise(r => setTimeout(r, 30));
  }
  await doSendAudio();
});

if (recAddTextBtn) recAddTextBtn.addEventListener('click', () => { enableRecText(); });

recCancelBtn.addEventListener('click', () => {
  stopRecording(true);
  pendingBlob = null;
  resetRecTextUI();
  setRecordingUI(false);
});

// ── Keyboard shortcuts ──
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (recOverlay.classList.contains('visible')) {
      stopRecording(true);
      pendingBlob = null;
      resetRecTextUI();
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
    btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="15" height="15">
      <path d="M6 6h12v12H6z"/>
    </svg>`;
  };
  utt.onend = utt.onerror = () => {
    btn.classList.remove('speaking');
    btn.dataset.speaking = 'false';
    btn.title = 'Escuchar';
    btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="15" height="15">
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
//  BOOT — device ID UI + link modal
// ═══════════════════════════════════════════════

// ── Manual sync: Push / Pull ──
const syncPushBtn = document.getElementById('syncPushBtn');
const syncPullBtn = document.getElementById('syncPullBtn');

if (syncPushBtn) syncPushBtn.addEventListener('click', async () => {
  if (!SB_READY) { showToast('Supabase no configurado'); return; }
  syncPushBtn.disabled = true;
  try {
    const localFolders = allFolders();
    const localChats   = allChats();
    await Promise.all([
      ...localFolders.map(f => sbUpsert('folders', folderToRow(f))),
      ...localChats.map(c => sbUpsert('chats',   chatToRow(c)))
    ]);
    showToast(`Subido: ${localChats.length} chat(s)`, false);
  } catch (e) {
    showToast('Error al subir: ' + e.message);
  } finally {
    syncPushBtn.disabled = false;
  }
});

if (syncPullBtn) syncPullBtn.addEventListener('click', async () => {
  if (!SB_READY) { showToast('Supabase no configurado'); return; }
  syncPullBtn.disabled = true;
  try {
    const result = await syncFromSupabase(true, false);
    // Ensure active chat still exists
    if (!getChat(activeChatId)) {
      const chats = allChats();
      activeChatId = chats.length > 0 ? chats[0].id : createChat().id;
      localStorage.setItem('activeChatId', activeChatId);
      switchChat(activeChatId);
    } else {
      renderChatList();
    }
    showToast(`Bajado: ${result.chats} chat(s)`, false);
  } catch (e) {
    showToast('Error al bajar: ' + e.message);
  } finally {
    syncPullBtn.disabled = false;
  }
});

// ── Global settings modal (model selector) ──
const DEFAULT_MODEL = 'google:gemini-3.1-flash-lite-preview';
const BUILTIN_MODELS = [
  { value: 'google:gemini-3.1-flash-lite-preview', name: 'Gemini 3.1 Flash Lite', tag: 'Google' },
  { value: 'openrouter:google/gemini-3.1-flash-lite-preview', name: 'Gemini 3.1 Flash Lite', tag: 'OpenRouter' },
  { value: 'openrouter:google/gemini-3.1-pro-preview', name: 'Gemini 3.1 Pro', tag: 'OpenRouter' },
  { value: 'openrouter:google/gemini-3-flash-preview', name: 'Gemini 3 Flash', tag: 'OpenRouter' },
];

const globalSettingsBtn   = document.getElementById('globalSettingsBtn');
const globalSettingsModal = document.getElementById('globalSettingsModal');
const closeGlobalSettings = document.getElementById('closeGlobalSettings');
const saveGlobalSettings  = document.getElementById('saveGlobalSettings');
const modelOptionsEl      = document.getElementById('modelOptions');
const addModelProvider    = document.getElementById('addModelProvider');
const addModelId          = document.getElementById('addModelId');
const addModelBtn         = document.getElementById('addModelBtn');
const addModelHint        = document.getElementById('addModelHint');

function loadCustomModels() {
  try { return JSON.parse(localStorage.getItem('customModels') || '[]'); } catch { return []; }
}
function saveCustomModels(list) {
  localStorage.setItem('customModels', JSON.stringify(list));
}

function modelLabel(id) {
  const bare = id.split('/').pop() || id;
  return bare.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function renderModelOptions() {
  if (!modelOptionsEl) return;
  const current = localStorage.getItem('selectedModel') || DEFAULT_MODEL;
  const customs = loadCustomModels();
  const all = [
    ...BUILTIN_MODELS.map(m => ({ ...m, custom: false })),
    ...customs.map(m => ({ ...m, custom: true })),
  ];
  modelOptionsEl.innerHTML = all.map(m => `
    <label class="model-option">
      <input type="radio" name="aiModel" value="${m.value}" ${m.value === current ? 'checked' : ''} />
      <span class="model-option-name">${m.name}</span>
      <span class="model-option-tag">${m.tag}</span>
      ${m.custom ? `<button type="button" class="model-remove" data-value="${m.value}" title="Quitar">✕</button>` : ''}
    </label>
  `).join('');
}

function updateAddModelHint() {
  if (!addModelHint || !addModelProvider) return;
  if (addModelProvider.value === 'google') {
    addModelHint.textContent = 'Google API: ej. gemini-2.5-flash';
    if (addModelId) addModelId.placeholder = 'gemini-2.5-flash';
  } else {
    addModelHint.textContent = 'OpenRouter: ej. google/gemini-2.5-pro';
    if (addModelId) addModelId.placeholder = 'google/gemini-2.5-pro';
  }
}

function openGlobalSettings() {
  renderModelOptions();
  updateAddModelHint();
  globalSettingsModal.classList.add('open');
}

if (globalSettingsBtn)   globalSettingsBtn.addEventListener('click', openGlobalSettings);
if (closeGlobalSettings) closeGlobalSettings.addEventListener('click', () => globalSettingsModal.classList.remove('open'));
if (globalSettingsModal) globalSettingsModal.addEventListener('click', (e) => { if (e.target === globalSettingsModal) globalSettingsModal.classList.remove('open'); });
if (addModelProvider)    addModelProvider.addEventListener('change', updateAddModelHint);

if (modelOptionsEl) modelOptionsEl.addEventListener('click', (e) => {
  const btn = e.target.closest('.model-remove');
  if (!btn) return;
  e.preventDefault();
  const value = btn.dataset.value;
  saveCustomModels(loadCustomModels().filter(m => m.value !== value));
  if (localStorage.getItem('selectedModel') === value) localStorage.setItem('selectedModel', DEFAULT_MODEL);
  renderModelOptions();
});

if (addModelBtn) addModelBtn.addEventListener('click', () => {
  const provider = addModelProvider?.value || 'google';
  let id = (addModelId?.value || '').trim().replace(/^models\//, '');
  if (!id) { showToast('Escribe el ID del modelo'); return; }
  // Allow pasting "google:xxx" / "openrouter:xxx" or raw id
  if (id.includes(':')) {
    const [p, ...rest] = id.split(':');
    id = rest.join(':');
    if (p === 'google' || p === 'openrouter') addModelProvider.value = p;
  }
  const finalProvider = addModelProvider.value || provider;
  const value = `${finalProvider}:${id}`;
  const customs = loadCustomModels();
  if (BUILTIN_MODELS.some(m => m.value === value) || customs.some(m => m.value === value)) {
    showToast('Ese modelo ya está en la lista', false);
    return;
  }
  customs.push({
    value,
    name: modelLabel(id),
    tag: finalProvider === 'google' ? 'Google' : 'OpenRouter',
  });
  saveCustomModels(customs);
  localStorage.setItem('selectedModel', value);
  if (addModelId) addModelId.value = '';
  renderModelOptions();
  showToast('Modelo agregado', false);
});

if (saveGlobalSettings) saveGlobalSettings.addEventListener('click', () => {
  const selected = globalSettingsModal.querySelector('input[name="aiModel"]:checked');
  if (selected) {
    localStorage.setItem('selectedModel', selected.value);
    showToast('Modelo guardado', false);
  }
  globalSettingsModal.classList.remove('open');
});

// ── Device ID display + copy ──
const deviceIdDisplay  = document.getElementById('deviceIdDisplay');
const copyDeviceIdBtn  = document.getElementById('copyDeviceId');
const linkDeviceBtn    = document.getElementById('linkDeviceBtn');
const linkDeviceModal  = document.getElementById('linkDeviceModal');
const closeLinkDevice  = document.getElementById('closeLinkDevice');
const linkDeviceInput  = document.getElementById('linkDeviceInput');
const confirmLinkBtn   = document.getElementById('confirmLinkDevice');
const resetDeviceBtn   = document.getElementById('resetDeviceId');
const linkModalCurrent = document.getElementById('linkModalCurrentId');
const linkModalCopyBtn = document.getElementById('linkModalCopyBtn');

function refreshDeviceIdUI() {
  if (deviceIdDisplay)  deviceIdDisplay.textContent  = DEVICE_ID;
  if (linkModalCurrent) linkModalCurrent.textContent = DEVICE_ID;
}
refreshDeviceIdUI();

function copyToClipboard(text, btn) {
  navigator.clipboard.writeText(text).then(() => {
    if (btn) { btn.classList.add('copied'); setTimeout(() => btn.classList.remove('copied'), 2000); }
    showToast('ID copiado al portapapeles', false);
  }).catch(() => {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
    showToast('ID copiado al portapapeles', false);
  });
}

if (copyDeviceIdBtn) copyDeviceIdBtn.addEventListener('click', () => copyToClipboard(DEVICE_ID, copyDeviceIdBtn));
if (linkModalCopyBtn) linkModalCopyBtn.addEventListener('click', () => copyToClipboard(DEVICE_ID, linkModalCopyBtn));

// ── Open / close link modal ──
if (linkDeviceBtn) linkDeviceBtn.addEventListener('click', () => {
  linkDeviceInput.value = '';
  refreshDeviceIdUI();
  linkDeviceModal.classList.add('open');
});
if (closeLinkDevice) closeLinkDevice.addEventListener('click', () => linkDeviceModal.classList.remove('open'));
if (linkDeviceModal) linkDeviceModal.addEventListener('click', (e) => {
  if (e.target === linkDeviceModal) linkDeviceModal.classList.remove('open');
});

// ── Confirm link: switch to the other device's ID and pull its data ──
if (confirmLinkBtn) confirmLinkBtn.addEventListener('click', async () => {
  const newId = linkDeviceInput.value.trim();
  if (!newId) { showToast('Pega un ID válido'); return; }
  if (newId === DEVICE_ID) { showToast('Ya estás usando ese ID', false); linkDeviceModal.classList.remove('open'); return; }

  linkDeviceModal.classList.remove('open');
  showToast('Sincronizando…', false);

  try {
    // 1. Re-upload all local data under the new device_id BEFORE switching
    //    so nothing gets lost on either side.
    const localFolders = allFolders();
    const localChats   = allChats();

    // Switch device ID globally
    DEVICE_ID = newId;
    localStorage.setItem('deviceId', DEVICE_ID);
    refreshDeviceIdUI();

    // Upload local folders + chats with the new device_id
    await Promise.all([
      ...localFolders.map(f => sbUpsert('folders', folderToRow(f))),
      ...localChats.map(c => sbUpsert('chats',   chatToRow(c)))
    ]);

    // 2. Pull everything from Supabase for this device_id (replace local store)
    const result = await syncFromSupabase(true, true);

    // 3. Switch to first chat
    const chats = allChats();
    if (chats.length > 0) {
      activeChatId = chats[0].id;
      localStorage.setItem('activeChatId', activeChatId);
      switchChat(activeChatId);
    } else {
      const chat = createChat();
      activeChatId = chat.id;
      localStorage.setItem('activeChatId', activeChatId);
      switchChat(activeChatId);
    }
    showToast(`Sincronizado: ${result.chats} chat(s) cargado(s)`, false);
  } catch (e) {
    showToast('Error al sincronizar: ' + e.message);
  }
});

// ── Reset: generate a brand-new device ID ──
if (resetDeviceBtn) resetDeviceBtn.addEventListener('click', () => {
  if (!confirm('¿Generar un nuevo ID? Perderás la sincronización con el ID actual.')) return;
  DEVICE_ID = 'dev_' + Math.random().toString(36).slice(2, 10);
  localStorage.setItem('deviceId', DEVICE_ID);
  linkDeviceModal.classList.remove('open');
  refreshDeviceIdUI();
  showToast('Nuevo ID generado', false);
});
