// Cross-chat memory: D1-backed store (via the Cloudflare worker) + the "Memoria" view.
// The server never keeps memory; this module sends the relevant items with each
// /pipeline request and asks /memory-extract for new items when a chat is closed.
(function () {
  const KIND_LABELS = { decision: 'Decisión', paso: 'Paso', pregunta: 'Pregunta abierta', patron: 'Patrón' };
  const KINDS = Object.keys(KIND_LABELS);
  const CACHE_KEY = 'voiceMemory_v1';
  const MAX_CANDIDATES = 40;
  const MAX_EXISTING_FOR_EXTRACT = 30;
  const PROFILE_KEY = 'voiceMemoryProfile_v1';
  const MAX_PROFILE_LINES = 5;
  const MAX_IMPORT_CHARS = 20000;
  const MANY_ACTIVE = 25;
  const SOURCES = ['Claude Code', 'ChatGPT', 'Perplexity', 'Otro asistente'];

  function profileLines(text) {
    return String(text || '').split(/\r?\n/).map((line) => line.replace(/^\s*[-*•]\s*/, '').trim()).filter(Boolean);
  }

  function create({ workerUrl, getOwner, getChat, toast, onChange = () => {} }) {
    let cache = load();
    let profile = loadProfile();
    let filter = 'active';
    let currentChatId = null;

    function load() {
      try { return JSON.parse(localStorage.getItem(CACHE_KEY)) || {}; } catch { return {}; }
    }
    function loadProfile() {
      try { return JSON.parse(localStorage.getItem(PROFILE_KEY)) || { text: '' }; } catch { return { text: '' }; }
    }
    function persist() {
      try { localStorage.setItem(CACHE_KEY, JSON.stringify(cache)); } catch { /* cache only */ }
      if (modal.classList.contains('open')) renderList();
      onChange();
    }
    function persistProfile() {
      try { localStorage.setItem(PROFILE_KEY, JSON.stringify(profile)); } catch { /* cache only */ }
      if (modal.classList.contains('open')) renderProfile();
    }

    async function request(path, init = {}) {
      if (!workerUrl) throw new Error('Cloudflare no configurado');
      const res = await fetch(`${workerUrl}${path}`, {
        ...init,
        headers: { 'Content-Type': 'application/json', 'x-device-id': getOwner() },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Memoria: error ${res.status}`);
      return data;
    }

    // Memory UI appears only after the worker has answered /memory once, so a
    // frontend deployed before the worker behaves exactly as without memory.
    let available = false;
    function isAvailable() { return available; }

    async function sync() {
      const [data, prof] = await Promise.all([request('/memory'), request('/profile').catch(() => null)]);
      available = true;
      cache = Object.fromEntries((data.memory || []).map((item) => [item.id, item]));
      if (prof) { profile = prof.profile || { text: '' }; persistProfile(); }
      persist();
    }

    // "Contexto sobre mí": short stable profile sent with every /pipeline request.
    function profileText() { return profile.text || ''; }

    async function saveProfile(text) {
      const lines = profileLines(text);
      if (lines.length > MAX_PROFILE_LINES) throw new Error(`El perfil admite como máximo ${MAX_PROFILE_LINES} líneas`);
      const data = await request('/profile', { method: 'PUT', body: JSON.stringify({ text: lines.join('\n') }) });
      profile = data.profile;
      persistProfile();
    }

    function list() {
      return Object.values(cache).sort((a, b) => b.created_at.localeCompare(a.created_at));
    }
    function active() { return list().filter((item) => item.status === 'active'); }
    function toPrompt(item) { return { id: item.id, kind: item.kind, text: item.text, created_at: item.created_at }; }

    // First turn of a chat: send every active item and let the server pick ≤10 by
    // relevance. Later turns resend that same pick, so the system prompt (and the
    // provider's prompt cache) stays stable for the whole chat.
    function forChat(chat) {
      const items = Array.isArray(chat?.memoryIds)
        ? chat.memoryIds.map((id) => cache[id]).filter((item) => item && item.status === 'active')
        : active().slice(0, MAX_CANDIDATES);
      return items.map(toPrompt);
    }

    async function save(item) {
      const row = await request(`/memory/${encodeURIComponent(item.id)}`, { method: 'PUT', body: JSON.stringify(item) });
      cache[row.id] = row;
      persist();
      return row;
    }

    async function remove(id) {
      await request(`/memory/${encodeURIComponent(id)}`, { method: 'DELETE' });
      delete cache[id];
      persist();
    }

    function newId() {
      return `mem_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
    }

    async function memoryTask(body) {
      const res = await fetch('/memory-extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'La tarea de memoria falló');
      return data;
    }

    // Distill an export from another assistant into a profile proposal + ≤8 items (nothing is saved yet).
    function distill(source, text) {
      return memoryTask({ mode: 'import', source, text: text.slice(0, MAX_IMPORT_CHARS), profile: profileText(), existing: active().slice(0, MAX_EXISTING_FOR_EXTRACT).map(toPrompt) });
    }

    // Propose merges of near-duplicates and deletions of stale items (nothing is applied yet).
    function consolidate() {
      return memoryTask({ mode: 'consolidate', profile: profileText(), items: list().map((item) => ({ ...toPrompt(item), status: item.status })) });
    }

    async function extractFromChat(chat) {
      const messages = (chat?.messages || []).filter((m) => m.text).map((m) => ({ role: m.role, text: m.text }));
      if (!messages.length) throw new Error('La conversación está vacía');
      const data = await memoryTask({ messages, chatName: chat.name, existing: active().slice(0, MAX_EXISTING_FOR_EXTRACT).map(toPrompt) });
      const createdAt = new Date().toISOString();
      const saved = [];
      for (const item of data.items || []) {
        saved.push(await save({
          id: newId(), kind: item.kind, text: item.text, status: 'active',
          source_chat_id: chat.id, source_chat_name: chat.name, created_at: createdAt,
        }));
      }
      const resolved = [];
      for (const id of data.resolved || []) {
        if (cache[id]?.status === 'active') resolved.push(await save({ ...cache[id], status: 'done' }));
      }
      return { saved, resolved };
    }

    // ── View ──
    const modal = document.getElementById('memoryModal');
    const listEl = document.getElementById('memoryList');
    const countEl = document.getElementById('memoryCount');
    const filtersEl = document.getElementById('memoryFilters');
    const addForm = document.getElementById('memoryAddForm');
    const addKind = document.getElementById('memoryAddKind');
    const addText = document.getElementById('memoryAddText');
    const mainEl = document.getElementById('memoryMain');
    const panel = document.getElementById('memoryPanel');
    const hintEl = document.getElementById('memoryHint');
    const hintDefault = hintEl.textContent;
    const profileEl = document.getElementById('memoryProfileText');
    const profileCountEl = document.getElementById('memoryProfileCount');

    function el(tag, className, text) {
      const node = document.createElement(tag);
      if (className) node.className = className;
      if (text != null) node.textContent = text;
      return node;
    }

    function chip(kind) {
      return el('span', `memory-chip memory-chip-${kind}`, KIND_LABELS[kind] || kind);
    }

    function formatDate(iso) {
      const date = new Date(iso);
      return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('es', { day: 'numeric', month: 'short' });
    }

    function kindSelect(value) {
      const select = document.createElement('select');
      select.className = `memory-kind memory-kind-${value}`;
      select.setAttribute('aria-label', 'Tipo');
      for (const kind of KINDS) {
        const option = document.createElement('option');
        option.value = kind;
        option.textContent = KIND_LABELS[kind];
        option.selected = kind === value;
        select.appendChild(option);
      }
      return select;
    }

    function autosize(textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = `${textarea.scrollHeight}px`;
    }

    async function guarded(action) {
      try { await action(); } catch (error) { toast(error.message || 'Error de memoria'); renderList(); }
    }

    function itemRow(item, inChat) {
      const row = document.createElement('div');
      row.className = `memory-item${item.status === 'done' ? ' done' : ''}`;
      row.dataset.id = item.id;

      const meta = document.createElement('div');
      meta.className = 'memory-item-meta';
      const select = kindSelect(item.kind);
      select.addEventListener('change', () => guarded(() => save({ ...item, kind: select.value })));
      meta.appendChild(select);
      const info = document.createElement('span');
      info.className = 'memory-item-info';
      info.textContent = [formatDate(item.created_at), item.source_chat_name ? `de «${item.source_chat_name}»` : ''].filter(Boolean).join(' · ');
      meta.appendChild(info);
      if (inChat) {
        const badge = document.createElement('span');
        badge.className = 'memory-badge';
        badge.textContent = 'en este chat';
        badge.title = 'Este ítem se inyectó en el chat abierto';
        meta.appendChild(badge);
      }

      const text = document.createElement('textarea');
      text.className = 'memory-text';
      text.rows = 1;
      text.value = item.text;
      text.setAttribute('aria-label', 'Texto del ítem');
      text.addEventListener('input', () => autosize(text));
      text.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); text.blur(); } });
      text.addEventListener('blur', () => {
        const value = text.value.replace(/\s+/g, ' ').trim();
        if (!value) { text.value = item.text; return; }
        if (value !== item.text) guarded(async () => { await save({ ...item, text: value }); toast('Memoria actualizada', false); });
      });

      const actions = document.createElement('div');
      actions.className = 'memory-item-actions';
      const done = document.createElement('button');
      done.type = 'button';
      done.className = 'memory-action';
      done.textContent = item.status === 'done' ? 'Reabrir' : 'Hecho';
      done.title = item.status === 'done' ? 'Volver a usarlo en las conversaciones' : 'Marcar como hecho: deja de inyectarse';
      done.addEventListener('click', () => guarded(() => save({ ...item, status: item.status === 'done' ? 'active' : 'done' })));
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'memory-action memory-action-danger';
      del.textContent = 'Borrar';
      let armed = null;
      del.addEventListener('click', () => {
        if (!armed) {
          del.textContent = '¿Borrar?';
          del.classList.add('armed');
          armed = setTimeout(() => { armed = null; del.textContent = 'Borrar'; del.classList.remove('armed'); }, 3000);
          return;
        }
        clearTimeout(armed);
        guarded(async () => { await remove(item.id); toast('Ítem borrado', false); });
      });
      actions.append(done, del);

      row.append(meta, text, actions);
      requestAnimationFrame(() => autosize(text));
      return row;
    }

    function renderList() {
      const all = list();
      const injected = new Set(getChat(currentChatId)?.memoryIds || []);
      const visible = all.filter((item) => {
        if (filter === 'active') return item.status === 'active';
        if (filter === 'done') return item.status === 'done';
        return item.status === 'active' && item.kind === filter;
      });
      const activeCount = all.filter((item) => item.status === 'active').length;
      countEl.textContent = `${activeCount} activos · ${all.length - activeCount} hechos`;
      const tooMany = activeCount > MANY_ACTIVE;
      hintEl.classList.toggle('warn', tooMany);
      hintEl.textContent = tooMany
        ? `Tienes ${activeCount} ítems activos: pulsa «Consolidar» para que la memoria siga siendo pequeña y útil.`
        : hintDefault;
      for (const button of filtersEl.querySelectorAll('button')) button.classList.toggle('active', button.dataset.filter === filter);
      listEl.innerHTML = '';
      if (!visible.length) {
        const empty = document.createElement('div');
        empty.className = 'memory-empty';
        empty.textContent = all.length
          ? 'Nada en este filtro.'
          : 'Aún no hay memoria. Di «cierra» al final de un chat o pulsa «Cerrar y recordar».';
        listEl.appendChild(empty);
        return;
      }
      for (const item of visible) listEl.appendChild(itemRow(item, injected.has(item.id)));
    }

    filtersEl.addEventListener('click', (e) => {
      const button = e.target.closest('button[data-filter]');
      if (!button) return;
      filter = button.dataset.filter;
      renderList();
    });

    addForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const value = addText.value.replace(/\s+/g, ' ').trim();
      if (!value) return;
      guarded(async () => {
        await save({ id: newId(), kind: addKind.value, text: value, status: 'active', source_chat_id: null, source_chat_name: 'añadido a mano', created_at: new Date().toISOString() });
        addText.value = '';
        if (filter !== 'active' && filter !== addKind.value) filter = 'active';
        renderList();
      });
    });

    // ── Profile ──
    function updateProfileCount() {
      const n = profileLines(profileEl.value).length;
      profileCountEl.textContent = `${n}/${MAX_PROFILE_LINES} líneas`;
      profileCountEl.classList.toggle('over', n > MAX_PROFILE_LINES);
    }
    function renderProfile() {
      if (document.activeElement !== profileEl) profileEl.value = profile.text || '';
      updateProfileCount();
      requestAnimationFrame(() => autosize(profileEl));
    }
    profileEl.addEventListener('input', () => { updateProfileCount(); autosize(profileEl); });
    profileEl.addEventListener('blur', () => {
      const value = profileLines(profileEl.value).join('\n');
      if (value === (profile.text || '')) return;
      guarded(async () => { await saveProfile(value); toast('Perfil guardado', false); });
    });

    // ── Panels (import / consolidate) replace the list while open ──
    function showPanel(title) {
      mainEl.hidden = true;
      panel.hidden = false;
      panel.innerHTML = '';
      panel.appendChild(el('div', 'memory-panel-title', title));
      const body = el('div', 'memory-panel-body');
      const actions = el('div', 'memory-panel-actions');
      panel.append(body, actions);
      return { body, actions };
    }
    function hidePanel() {
      panel.hidden = true;
      panel.innerHTML = '';
      mainEl.hidden = false;
      renderList();
    }
    function button(label, className, onClick) {
      const node = el('button', className, label);
      node.type = 'button';
      node.addEventListener('click', onClick);
      return node;
    }
    function checkRow(checked) {
      const row = el('label', 'memory-check-row');
      const box = el('input');
      box.type = 'checkbox';
      box.checked = checked;
      row.appendChild(box);
      return { row, box };
    }
    async function busy(btn, label, work) {
      const original = btn.textContent;
      btn.disabled = true;
      btn.textContent = label;
      try { await work(); } catch (error) { toast(error.message || 'Error de memoria'); } finally { btn.disabled = false; btn.textContent = original; }
    }

    const importDraft = { source: SOURCES[0], text: '' };

    function openImport() {
      const { body, actions } = showPanel('Importar memorias');
      body.appendChild(el('p', 'memory-hint', 'Pega las memorias exportadas de otro asistente o carga un archivo. Se destilan en un perfil corto y como mucho 8 ítems, sin duplicar lo que ya hay; tú eliges qué guardar.'));
      const row = el('div', 'memory-import-row');
      const source = el('select', 'modal-input');
      source.setAttribute('aria-label', 'Fuente');
      for (const name of SOURCES) source.appendChild(Object.assign(el('option', '', name), { value: name }));
      const fileLabel = el('label', 'memory-action memory-file', 'Cargar archivo');
      const file = el('input');
      file.type = 'file';
      file.accept = '.txt,.md,.json,text/plain,text/markdown,application/json';
      fileLabel.appendChild(file);
      row.append(source, fileLabel);
      const text = el('textarea', 'memory-import-text');
      text.rows = 8;
      text.placeholder = 'Pega aquí las memorias (una por línea, en cualquier formato)…';
      text.setAttribute('aria-label', 'Memorias a importar');
      const count = el('div', 'memory-import-count');
      const updateCount = () => {
        const n = text.value.length;
        count.textContent = `${n.toLocaleString('es')} / ${MAX_IMPORT_CHARS.toLocaleString('es')} caracteres${n > MAX_IMPORT_CHARS ? ' · se recortará' : ''}`;
        count.classList.toggle('over', n > MAX_IMPORT_CHARS);
      };
      // "Atrás" from the preview comes back here with the same source and text.
      source.value = importDraft.source;
      text.value = importDraft.text;
      text.addEventListener('input', () => { importDraft.text = text.value; updateCount(); });
      source.addEventListener('change', () => { importDraft.source = source.value; });
      file.addEventListener('change', async () => {
        const chosen = file.files?.[0];
        if (!chosen) return;
        text.value = importDraft.text = await chosen.text();
        updateCount();
      });
      updateCount();
      body.append(row, text, count);
      const go = button('Destilar', 'memory-bar-btn', () => {
        if (!text.value.trim()) { toast('Pega algo de texto primero'); return; }
        busy(go, 'Destilando…', async () => renderImportPreview(await distill(source.value, text.value), source.value));
      });
      actions.append(button('Cancelar', 'memory-action', hidePanel), go);
    }

    function renderImportPreview(result, source) {
      const { body, actions } = showPanel(`Propuesta desde ${source}`);
      let profileBox = null;
      let profileInput = null;
      if (result.profile?.length) {
        body.appendChild(el('div', 'memory-panel-sub', 'Perfil propuesto (puedes editarlo)'));
        profileInput = el('textarea', 'memory-import-profile');
        profileInput.rows = Math.min(5, result.profile.length);
        profileInput.value = result.profile.join('\n');
        const { row, box } = checkRow(true);
        row.appendChild(document.createTextNode(profile.text ? 'Reemplazar mi perfil actual por este' : 'Usar como mi perfil'));
        profileBox = box;
        body.append(profileInput, row);
        requestAnimationFrame(() => autosize(profileInput));
      }
      body.appendChild(el('div', 'memory-panel-sub', result.items?.length ? `Ítems (${result.items.length})` : 'No hay ítems nuevos que valga la pena guardar.'));
      const picks = [];
      for (const item of result.items || []) {
        const { row, box } = checkRow(true);
        row.append(chip(item.kind), document.createTextNode(` ${item.text}`));
        picks.push({ item, box });
        body.appendChild(row);
      }
      const saveBtn = button('Guardar selección', 'memory-bar-btn', () => busy(saveBtn, 'Guardando…', async () => {
        if (profileBox?.checked) await saveProfile(profileInput.value);
        const createdAt = new Date().toISOString();
        let n = 0;
        for (const { item, box } of picks) {
          if (!box.checked) continue;
          await save({ id: newId(), kind: item.kind, text: item.text, status: 'active', source_chat_id: null, source_chat_name: `importado de ${source}`, created_at: createdAt });
          n += 1;
        }
        toast(`Importado: ${n} ítem(s)${profileBox?.checked ? ' y perfil' : ''}`, false);
        hidePanel();
        renderProfile();
      }));
      actions.append(button('Atrás', 'memory-action', openImport), saveBtn);
    }

    async function openConsolidate() {
      const total = list().length;
      const { body, actions } = showPanel('Consolidar memoria');
      if (total < 2) {
        body.appendChild(el('p', 'memory-empty', 'Todavía no hay suficiente memoria para consolidar.'));
        actions.append(button('Volver', 'memory-action', hidePanel));
        return;
      }
      body.appendChild(el('p', 'memory-empty', `Revisando ${total} ítems…`));
      let result;
      try { result = await consolidate(); } catch (error) {
        body.innerHTML = '';
        body.appendChild(el('p', 'memory-empty', `No se pudo consolidar: ${error.message}`));
        actions.append(button('Volver', 'memory-action', hidePanel));
        return;
      }
      if (panel.hidden) return;
      body.innerHTML = '';
      if (!result.merge.length && !result.remove.length) {
        body.appendChild(el('p', 'memory-empty', 'La memoria ya está compacta: nada que fusionar ni podar.'));
        actions.append(button('Volver', 'memory-action', hidePanel));
        return;
      }
      const merges = [];
      if (result.merge.length) body.appendChild(el('div', 'memory-panel-sub', `Fusionar (${result.merge.length})`));
      for (const group of result.merge) {
        const { row, box } = checkRow(true);
        const content = el('div', 'memory-check-content');
        const head = el('div');
        head.append(chip(group.kind), document.createTextNode(` ${group.text}`));
        const olds = el('ul', 'memory-merge-olds');
        for (const id of group.ids) olds.appendChild(el('li', '', cache[id]?.text || id));
        content.append(head, olds);
        row.appendChild(content);
        merges.push({ group, box });
        body.appendChild(row);
      }
      const removals = [];
      if (result.remove.length) body.appendChild(el('div', 'memory-panel-sub', `Borrar (${result.remove.length})`));
      for (const entry of result.remove) {
        const { row, box } = checkRow(true);
        const content = el('div', 'memory-check-content');
        content.append(el('div', 'memory-remove-text', cache[entry.id]?.text || entry.id), el('div', 'memory-remove-reason', entry.reason));
        row.appendChild(content);
        removals.push({ entry, box });
        body.appendChild(row);
      }
      const apply = button('Aplicar selección', 'memory-bar-btn', () => busy(apply, 'Aplicando…', async () => {
        let merged = 0;
        let removed = 0;
        for (const { group, box } of merges) {
          if (!box.checked) continue;
          const dates = group.ids.map((id) => cache[id]?.created_at).filter(Boolean).sort();
          await save({ id: newId(), kind: group.kind, text: group.text, status: 'active', source_chat_id: null, source_chat_name: 'fusionado', created_at: dates.at(-1) || new Date().toISOString() });
          for (const id of group.ids) if (cache[id]) await remove(id);
          merged += 1;
        }
        for (const { entry, box } of removals) {
          if (!box.checked || !cache[entry.id]) continue;
          await remove(entry.id);
          removed += 1;
        }
        toast(`Memoria consolidada: ${merged} fusión(es), ${removed} borrado(s)`, false);
        hidePanel();
      }));
      actions.append(button('Cancelar', 'memory-action', hidePanel), apply);
    }

    document.getElementById('memoryImportBtn').addEventListener('click', openImport);
    document.getElementById('memoryConsolidateBtn').addEventListener('click', openConsolidate);

    document.getElementById('closeMemoryModal').addEventListener('click', () => modal.classList.remove('open'));
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.remove('open'); });

    function open(chatId) {
      currentChatId = chatId || null;
      modal.classList.add('open');
      if (!panel.hidden) hidePanel();
      renderProfile();
      renderList();
      sync().catch((error) => toast(`No se pudo cargar la memoria: ${error.message}`));
    }

    return { sync, isAvailable, list, forChat, profileText, extractFromChat, open, KIND_LABELS };
  }

  window.VoiceMemory = { create, KIND_LABELS };
})();
