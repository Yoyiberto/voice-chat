(() => {
  'use strict';
  const MODES = {
    'long-talk': { label: 'Long talk', description: 'Chunks incrementales', model: 'pipeline:openai/gpt-5.6-luna' },
    web: { label: 'Web', description: 'Reflexión + búsqueda', model: 'pipeline:openai/gpt-5.6-luna' },
    'no-cut': { label: 'No cut', description: 'Audio completo', model: 'pipeline:openai/gpt-5.6-luna' },
    gemini: { label: 'Gemini', description: 'Modelo Gemini directo', model: 'google:gemini-3.1-flash-lite-preview' },
  };
  const key = 'voiceMode';
  function getMode() {
    const stored = localStorage.getItem(key);
    if (stored && MODES[stored]) return stored;
    return (localStorage.getItem('selectedModel') || '').startsWith('pipeline:') ? 'long-talk' : 'gemini';
  }
  function setMode(mode) {
    if (!MODES[mode]) return getMode();
    localStorage.setItem(key, mode);
    const selected = localStorage.getItem('selectedModel') || '';
    if (mode === 'gemini' && selected.startsWith('pipeline:')) localStorage.setItem('selectedModel', MODES[mode].model);
    if (mode !== 'gemini' && !selected.startsWith('pipeline:')) localStorage.setItem('selectedModel', MODES[mode].model);
    window.dispatchEvent(new CustomEvent('voice-mode-change', { detail: { mode } }));
    return mode;
  }
  window.VoiceModes = { MODES, getMode, setMode };
})();
