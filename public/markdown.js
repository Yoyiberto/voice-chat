(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.VoiceCleanMarkdown = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function cleanMarkdown(text) {
    if (!text) return '';
    let value = String(text);
    value = value.replace(/```[\s\S]*?```/g, (block) => {
      const code = block.replace(/^```[^\n]*\n?/, '').replace(/```$/, '').trim();
      return code;
    });
    value = value.replace(/`([^`]+)`/g, '$1');
    value = value.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1');
    value = value.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
    value = value.replace(/(^|\n)\s*#{1,6}\s+/g, '$1');
    value = value.replace(/^\s*[-*+]\s+/gm, '');
    value = value.replace(/^\s*\d+\.\s+/gm, '');
    value = value.replace(/\*\*\*([^*]+)\*\*\*/g, '$1');
    value = value.replace(/\*\*([^*]+)\*\*/g, '$1');
    value = value.replace(/\*([^*]+)\*/g, '$1');
    value = value.replace(/(^|[\s(]|^)\/([^/\s][^/]*)\/(?=[\s.,;:!?)"]|$)/g, '$1"$2"');
    value = value.replace(/__([^_]+)__/g, '$1');
    value = value.replace(/(^|[\s(])_([^_]+)_(?=[\s.,;:!?)"]|$)/g, '$1$2');
    value = value.replace(/~~([^~]+)~~/g, '$1');
    value = value.replace(/^>+\s?/gm, '');
    value = value.replace(/\|/g, '');
    value = value.replace(/[ \t]+$/gm, '');
    value = value.replace(/\n{3,}/g, '\n\n');
    return value.trim();
  }

  return { cleanMarkdown };
});