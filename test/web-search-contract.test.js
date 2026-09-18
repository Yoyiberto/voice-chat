const test = require('node:test');
const assert = require('node:assert/strict');
const { validateWebSearchOptions, normalizeCitations } = require('../lib/pipeline');

test('normalizes nested OpenRouter URL citations', () => {
  assert.deepEqual(normalizeCitations([
    { type: 'url_citation', url_citation: { url: 'https://example.com', title: 'Example', content: 'snippet', start_index: 2, end_index: 9 } },
  ]), [{ type: 'url_citation', url: 'https://example.com', title: 'Example', content: 'snippet', startIndex: 2, endIndex: 9 }]);
});

test('accepts bounded web search options', () => {
  assert.doesNotThrow(() => validateWebSearchOptions({ engine: 'auto', max_results: 5, max_uses: 2, max_total_results: 10, allowed_domains: ['openrouter.ai'] }));
});

test('rejects unsupported web search engine', () => {
  assert.throws(() => validateWebSearchOptions({ engine: 'google' }), /Unsupported web search engine/);
});

test('rejects invalid web search result limits', () => {
  assert.throws(() => validateWebSearchOptions({ max_results: 26 }), /max_results cannot exceed 25/);
  assert.throws(() => validateWebSearchOptions({ max_uses: 0 }), /positive integer/);
});
