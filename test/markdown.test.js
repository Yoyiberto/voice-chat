const test = require('node:test');
const assert = require('node:assert/strict');
const { cleanMarkdown } = require('../public/markdown');

test('strips bold markers', () => {
  assert.equal(cleanMarkdown('**muy** importante'), 'muy importante');
});

test('strips italic markers with asterisks and underscores', () => {
  assert.equal(cleanMarkdown('*itálica* y _subrayado_'), 'itálica y subrayado');
});

test('removes backticks from code spans', () => {
  assert.equal(cleanMarkdown('usa `npm test` aquí'), 'usa npm test aquí');
});

test('converts headings to plain text', () => {
  assert.equal(cleanMarkdown('## Título'), 'Título');
});

test('flattens markdown links to visible text', () => {
  assert.equal(cleanMarkdown('[ver docs](https://x.com)'), 'ver docs');
});

test('removes list bullets and numbering', () => {
  assert.equal(cleanMarkdown('- uno\n- dos'), 'uno\ndos');
  assert.equal(cleanMarkdown('1. uno\n2. dos'), 'uno\ndos');
});

test('strips bold italic combo markers', () => {
  assert.equal(cleanMarkdown('***énfasis***'), 'énfasis');
});

test('keeps plain text untouched', () => {
  assert.equal(cleanMarkdown('Hola mundo, esto sigue igual.'), 'Hola mundo, esto sigue igual.');
});