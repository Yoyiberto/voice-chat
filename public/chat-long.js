(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const SUPABASE_URL = document.querySelector('meta[name="sb-url"]')?.content || '';
  const SUPABASE_ANON = document.querySelector('meta[name="sb-anon"]')?.content || '';
  const SB_READY = !!(SUPABASE_URL && SUPABASE_ANON);
  localStorage.removeItem('voiceAuthSession');

  let DEVICE_ID = localStorage.getItem('voiceUsername') || localStorage.getItem('deviceId') || '';
  if (!DEVICE_ID) {
    DEVICE_ID = 'usuario_' + Math.random().toString(36).slice(2, 8);
    localStorage.setItem('voiceUsername', DEVICE_ID);
    localStorage.setItem('deviceId', DEVICE_ID);
  }
  const displayDevice = $('deviceIdDisplay');
  if (displayDevice) displayDevice.textContent = DEVICE_ID;

  const STORE_KEY = 'voiceChats_v2';
  const FOLDER_KEY = 'voiceFolders_v2';
  const loadStore = () => { try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch { return {}; } };
  const saveStore = (s) => localStorage.setItem(STORE_KEY, JSON.stringify(s));
  const loadFolders = () => { try { return JSON.parse(localStorage.getItem(FOLDER_KEY)) || {}; } catch { return {}; } };
  const saveFolders = (f) => localStorage.setItem(FOLDER_KEY, JSON.stringify(f));
  const allChats = () => Object.values(loadStore()).sort((a, b) => {
    const aLast = a.messages.at(-1)?.ts || parseInt(a.id.split('_')[1]) || 0;
    const bLast = b.messages.at(-1)?.ts || parseInt(b.id.split('_')[1]) || 0;
    return bLast - aLast;
  });
  const getChat = (id) => loadStore()[id] || null;

  const DEFAULT_SYSTEM_PROMPT = 'Responde máximo en 100 palabras y termina con tres preguntas cortas para saber hacia dónde dirigir la conversación. No te limites a repetir lo que dice el usuario: si en alguna ocasión repites algo de lo que dijo, que sea para aportar claridad real o señalar un insight importante. Sé concreto y evita respuestas vagas o que solo hagan eco de lo dicho.';
  const DEFAULT_MODEL = 'pipeline:openai/gpt-5.6-luna';

  function chatToRow(c) {
    return { id: c.id, device_id: DEVICE_ID, user_id: null, folder_id: c.folderId || null, emoji: c.emoji || '💬', name: c.name || '', system_prompt: c.systemPrompt || '', messages: c.messages || [], updated_at: new Date().toISOString() };
  }
  function folderToRow(f) {
    return { id: f.id, device_id: DEVICE_ID, user_id: null, emoji: f.emoji || '📁', name: f.name || '', system_prompt: f.systemPrompt || '', updated_at: new Date().toISOString() };
  }
  function rowToChat(r) {
    return { id: r.id, folderId: r.folder_id || null, emoji: r.emoji || '💬', name: r.name || 'Chat', systemPrompt: r.system_prompt || '', messages: Array.isArray(r.messages) ? r.messages : [] };
  }
  function rowToFolder(r) {
    return { id: r.id, folderId: null, emoji: r.emoji || '📁', name: r.name || 'Carpeta', systemPrompt: r.system_prompt || '' };
  }

  const headers = () => ({ apikey: SUPABASE_ANON, Authorization: 'Bearer ' + SUPABASE_ANON, 'Content-Type': 'application/json' });
  async function sbGet(table, eq = {}) {
    if (!SB_READY) return [];
    const params = new URLSearchParams({ select: '*', ...Object.fromEntries(Object.entries(eq).map(([k, v]) => [k, `eq.${v}`])) });
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${params}&order=created_at.asc`, { headers: headers() });
    if (!r.ok) throw new Error(`Supabase ${table}: ${(await r.text()).slice(0, 160) || r.status}`);
    return r.json();
  }
  async function sbUpsert(table, row) {
    if (!SB_READY) return;
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, { method: 'POST', headers: { ...headers(), Prefer: 'resolution=merge-duplicates' }, body: JSON.stringify(row) });
    if (!r.ok) throw new Error(`Supabase ${table}: ${(await r.text()).slice(0, 160) || r.status}`);
  }
  async function sbDelete(table, id) {
    if (!SB_READY) return;
    await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE', headers: headers() });
  }

  function saveChat(c) {
    const s = loadStore();
    s[c.id] = c;
    saveStore(s);
    sbUpsert('chats', chatToRow(c)).catch(() => {});
  }
  function createChat() {
    const id = 'chat_' + Date.now();
    const chat = { id, folderId: null, emoji: '💬', name: `Chat ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString().slice(0, 5)}`, systemPrompt: DEFAULT_SYSTEM_PROMPT, messages: [] };
    saveChat(chat);
    return chat;
  }

  function escHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }
  function formatTime(seconds) {
    const s = Math.max(0, Math.floor(seconds || 0));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }
  function showToast(msg, isError = true) {
    document.querySelectorAll('.toast').forEach((t) => t.remove());
    const el = document.createElement('div');
    el.className = 'toast';
    el.style.background = isError ? 'var(--danger)' : 'var(--accent)';
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3500);
  }
  const cleanMarkdown = (window.VoiceCleanMarkdown || {}).cleanMarkdown || ((t) => t);
  function currentModel() {
    return (localStorage.getItem('selectedModel') || DEFAULT_MODEL);
  }

  // ── Sidebar ──
  const sidebar = $('sidebar');
  const chatListEl = $('chatList');
  const toggleSidebar = $('toggleSidebar');
  toggleSidebar.addEventListener('click', () => sidebar.classList.toggle('open'));

  const FOLDERS = loadFolders();

  function renderChatList() {
    chatListEl.innerHTML = '';
    const chats = allChats();
    const roots = chats.filter((c) => !c.folderId);
    const children = chats.filter((c) => c.folderId);
    const folderChats = (fid) => children.filter((c) => c.folderId === fid);
    let hasRoot = false;
    Object.values(FOLDERS).forEach((folder) => {
      const fchats = folderChats(folder.id);
      if (!fchats.length) return;
      const frow = document.createElement('div');
      frow.className = 'folder-row';
      frow.textContent = `${folder.emoji || '📁'} ${folder.name}`;
      chatListEl.appendChild(frow);
      fchats.forEach((c) => chatListEl.appendChild(makeChatItem(c)));
    });
    roots.forEach((c) => { hasRoot = true; chatListEl.appendChild(makeChatItem(c)); });
    if (!hasRoot && !Object.values(FOLDERS).some((f) => folderChats(f.id).length)) {
      chatListEl.innerHTML = '<div class="empty-hint">Crea un chat o baja desde Supabase.</div>';
    }
  }

  function makeChatItem(chat) {
    const row = document.createElement('div');
    row.className = 'chat-item' + (chat.id === activeChatId ? ' active' : '');
    const name = document.createElement('div');
    name.className = 'chat-item-name';
    name.textContent = `${chat.emoji || '💬'} ${chat.name || 'Chat'}`;
    name.title = chat.name || 'Chat';
    row.appendChild(name);
    row.addEventListener('click', () => { switchChat(chat.id); sidebar.classList.remove('open'); });
    return row;
  }

  // ── Messages ──
  const messagesEl = $('messages');
  const chatTitleEl = $('chatTitle');
  let activeChatId = localStorage.getItem('activeChatId');
  if (!activeChatId || !getChat(activeChatId)) activeChatId = null;

  function switchChat(id) {
    const chat = getChat(id);
    if (!chat) return;
    activeChatId = id;
    localStorage.setItem('activeChatId', id);
    chatTitleEl.textContent = (chat.emoji !== '💬' ? chat.emoji + ' ' : '') + (chat.name || 'Chat');
    renderMessages();
    renderChatList();
  }

  function renderMessages() {
    const chat = getChat(activeChatId);
    messagesEl.innerHTML = '';
    if (!chat || !chat.messages.length) {
      messagesEl.innerHTML = '<div class="empty-state">Habla largo con el micrófono o escribe un mensaje.</div>';
      return;
    }
    chat.messages.forEach((m) => addMessageDOM(m.role, m.text || (m.isAudio ? '[audio]' : '')));
    scrollToBottom();
  }

  function scrollToBottom() { messagesEl.scrollTop = messagesEl.scrollHeight; }

  function addMessageDOM(role, text) {
    const wrap = document.createElement('div');
    wrap.className = 'message ' + (role === 'user' ? 'user' : 'model');
    const label = document.createElement('div');
    label.className = 'message-label';
    label.textContent = role === 'user' ? 'Tú' : (localStorage.getItem('lastResponseProvider') || 'IA');
    const bubble = document.createElement('div');
    bubble.className = 'message-bubble';
    bubble.textContent = role === 'user' ? String(text || '') : cleanMarkdown(text);
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
    label.textContent = currentModel().startsWith('pipeline:') ? 'Whisper + Luna' : 'IA';
    const bubble = document.createElement('div');
    bubble.className = 'message-bubble';
    bubble.textContent = 'Pensando...';
    wrap.appendChild(label);
    wrap.appendChild(bubble);
    messagesEl.appendChild(wrap);
    scrollToBottom();
    return wrap;
  }

  // ── Pipeline follow-up ──
  const textInput = $('textInput');
  const sendTextBtn = $('sendText');
  async function sendMessage(text, opts = {}) {
    const chat = getChat(activeChatId);
    if (!chat) return;
    const finalText = String(text || '').trim();
    if (!finalText) { showToast('Escribe algo'); return; }

    chat.messages = chat.messages || [];
    chat.messages.push({ role: 'user', text: finalText, ts: Date.now() });
    saveChat(chat);
    textInput.value = '';
    textInput.style.height = 'auto';
    addMessageDOM('user', finalText);

    const thinking = addThinkingDOM();
    try {
      const selected = currentModel();
      const isPipeline = selected.startsWith('pipeline:');
      const body = {
        sessionId: chat.id,
        systemPrompt: chat.systemPrompt || '',
        model: isPipeline ? selected.slice('pipeline:'.length) : selected,
        groqApiKey: localStorage.getItem('groqApiKey') || '',
        openrouterApiKey: localStorage.getItem('openrouterApiKey') || '',
        ...opts,
      };
      if (!body.message) body.message = finalText;
      localStorage.setItem('lastResponseProvider', isPipeline ? 'Whisper + Luna' : 'IA');
      const res = await fetch(isPipeline ? '/pipeline' : '/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      thinking.remove();
      if (!res.ok) { showToast(data.error || 'Error procesando el mensaje'); return; }
      if (data.provider) {
        const modelName = data.provider.model ? ` (${data.provider.model})` : '';
        localStorage.setItem('lastResponseProvider', `${data.provider.completion}${modelName}`);
      }
      const reply = data.reply || '';
      chat.messages.push({ role: 'model', text: reply, ts: Date.now() });
      saveChat(chat);
      addMessageDOM('model', reply);
      renderChatList();
      if (chat.messages.filter((m) => m.role === 'user').length === 1) {
        chat.name = finalText.slice(0, 30) + (finalText.length > 30 ? '…' : '');
        saveChat(chat);
        chatTitleEl.textContent = (chat.emoji !== '💬' ? chat.emoji + ' ' : '') + chat.name;
      }
      scrollToBottom();
    } catch (error) {
      thinking.remove();
      showToast(error.message || 'Error');
    }
  }

  sendTextBtn.addEventListener('click', () => sendMessage(textInput.value));
  textInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(textInput.value); }
  });

  // ── Long mic via shared recorder (segment + incremental transcription) ──
  // Each segment is normalized (16 kHz mono, gentle target peak) before Groq.
  const longRecorder = (window.VoiceLongRecord || {}).createLongRecorder({
    normalize: true,
    onSend: (text) => sendMessage(text),
  });

  const longMicBtn = $('longMicBtn');
  longMicBtn.addEventListener('click', () => {
    if (longRecorder.isRecording()) return;
    if (longRecorder.isReady()) { longRecorder.send(); return; }
    longRecorder.begin();
  });

  // ── Settings modal ──
  const settingsModal = $('settingsModal');
  const closeSettings = $('closeSettings');
  const settingsBtn = $('settingsBtn');
  const systemPromptEl = $('systemPrompt');
  const chatNameInput = $('chatNameInput');
  const savePromptBtn = $('savePromptBtn');
  const clearHistoryBtn = $('clearHistoryBtn');

  function openSettings() {
    const chat = getChat(activeChatId);
    systemPromptEl.value = chat?.systemPrompt || '';
    chatNameInput.value = chat?.name || '';
    settingsModal.classList.add('open');
  }
  settingsBtn.addEventListener('click', openSettings);
  closeSettings.addEventListener('click', () => settingsModal.classList.remove('open'));
  savePromptBtn.addEventListener('click', () => {
    const chat = getChat(activeChatId);
    if (!chat) return;
    chat.systemPrompt = systemPromptEl.value.trim();
    chat.name = chatNameInput.value.trim() || chat.name;
    saveChat(chat);
    chatTitleEl.textContent = (chat.emoji !== '💬' ? chat.emoji + ' ' : '') + chat.name;
    renderChatList();
    settingsModal.classList.remove('open');
  });
  clearHistoryBtn.addEventListener('click', () => {
    const chat = getChat(activeChatId);
    if (!chat) return;
    chat.messages = [];
    saveChat(chat);
    renderMessages();
    settingsModal.classList.remove('open');
  });

  // ── Sync ──
  const syncPushBtn = $('syncPushBtn');
  const syncPullBtn = $('syncPullBtn');
  syncPushBtn.addEventListener('click', async () => {
    if (!SB_READY) { showToast('Supabase no configurado'); return; }
    syncPushBtn.disabled = true;
    try {
      await Promise.all([...allChats().map((c) => sbUpsert('chats', chatToRow(c))), ...Object.values(loadFolders()).map((f) => sbUpsert('folders', folderToRow(f)))]);
      showToast(`Subido: ${allChats().length} chat(s)`, false);
    } catch (e) { showToast('Error al subir: ' + e.message); }
    finally { syncPushBtn.disabled = false; }
  });
  syncPullBtn.addEventListener('click', async () => {
    if (!SB_READY) { showToast('Supabase no configurado'); return; }
    syncPullBtn.disabled = true;
    try {
      const [chats, folders] = await Promise.all([
        sbGet('chats', { device_id: DEVICE_ID }),
        sbGet('folders', { device_id: DEVICE_ID }),
      ]);
      const store = loadStore();
      let merged = 0;
      chats.forEach((r) => { if (!store[r.id]) { store[r.id] = rowToChat(r); merged++; } });
      saveStore(store);
      const fstore = loadFolders();
      folders.forEach((r) => { if (!fstore[r.id]) { fstore[r.id] = rowToFolder(r); merged++; } });
      saveFolders(fstore);
      if (!activeChatId || !getChat(activeChatId)) {
        const existing = allChats();
        activeChatId = existing.length ? existing[0].id : createChat().id;
      }
      switchChat(activeChatId);
      showToast(`Bajado: ${merged} chat(s)`, false);
    } catch (e) { showToast('Error al bajar: ' + e.message); }
    finally { syncPullBtn.disabled = false; }
  });

  // ── Boot ──
  $('newChatBtn').addEventListener('click', () => { const chat = createChat(); switchChat(chat.id); });
  (async function boot() {
    let loaded = 0;
    if (SB_READY) {
      try {
        const [chats, folders] = await Promise.all([
          sbGet('chats', { device_id: DEVICE_ID }),
          sbGet('folders', { device_id: DEVICE_ID }),
        ]);
        const store = loadStore();
        chats.forEach((r) => { if (!store[r.id]) { store[r.id] = rowToChat(r); loaded++; } });
        if (loaded) saveStore(store);
        const fstore = loadFolders();
        folders.forEach((r) => { if (!fstore[r.id]) fstore[r.id] = rowToFolder(r); });
        saveFolders(fstore);
      } catch (e) { console.warn('sync skip:', e.message); }
    }
    if (!activeChatId || !getChat(activeChatId)) {
      const existing = allChats();
      activeChatId = existing.length ? existing[0].id : createChat().id;
    }
    switchChat(activeChatId);
    if (loaded) showToast(`Cargados ${loaded} chat(s) desde Supabase`, false);
  })();
})();