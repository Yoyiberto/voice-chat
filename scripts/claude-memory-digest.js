#!/usr/bin/env node
// Builds a short, redacted digest of Claude Code's auto-memory to paste into
// "Memoria → Importar" (source: Claude Code). It keeps the MEMORY.md index and
// the full "user"/"feedback" memories, skips project details and references,
// and strips e-mails, keys and tokens. The app then distills it further.
//
//   node scripts/claude-memory-digest.js [memoryDir] [--out digest.txt]

const fs = require('fs');
const os = require('os');
const path = require('path');

const MAX_CHARS = 20_000;
const args = process.argv.slice(2);
const outIndex = args.indexOf('--out');
const outFile = outIndex >= 0 ? args.splice(outIndex, 2)[1] : null;
const dir = args[0] || path.join(os.homedir(), '.claude', 'projects', 'D--prog-projs', 'memory');

function redact(text) {
  return text
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[correo]')
    .replace(/\b(?:sk|gsk|pk|rk|xox[abp])[-_][\w-]{10,}/gi, '[clave]')
    .replace(/\bAIza[\w-]{20,}/g, '[clave]')
    .replace(/\b([A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PIN))\s*[=:]\s*\S+/g, '$1=[oculto]')
    .replace(/\b[0-9a-f]{32,}\b/gi, '[id]')
    .replace(/\b[A-Za-z0-9+/_-]{40,}={0,2}/g, '[token]');
}

function parse(file) {
  const raw = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  const front = match ? match[1] : '';
  const field = (name) => (front.match(new RegExp(`^\\s*${name}:\\s*(.+)$`, 'm')) || [])[1]?.replace(/^["']|["']$/g, '').trim() || '';
  return { name: field('name') || path.basename(file, '.md'), type: field('type'), description: field('description'), body: (match ? match[2] : raw).trim() };
}

const files = fs.readdirSync(dir).filter((f) => f.endsWith('.md') && f !== 'MEMORY.md');
const memories = files.map((f) => parse(path.join(dir, f)));
const index = fs.existsSync(path.join(dir, 'MEMORY.md'))
  ? fs.readFileSync(path.join(dir, 'MEMORY.md'), 'utf8').replace(/\r\n/g, '\n').split('\n')
    .filter((line) => line.startsWith('- '))
    .map((line) => line.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1'))
  : [];

const sections = ['# Memorias de Claude Code (resumen)', '', '## Índice de temas y proyectos', ...index];
const personal = memories.filter((m) => m.type === 'user' || m.type === 'feedback');
if (personal.length) {
  sections.push('', '## Sobre el usuario y cómo prefiere trabajar');
  for (const m of personal) sections.push('', `### ${m.name}`, m.body);
}

let digest = redact(sections.join('\n'));
if (digest.length > MAX_CHARS) digest = `${digest.slice(0, MAX_CHARS - 20)}\n[…recortado]`;

if (outFile) {
  fs.writeFileSync(outFile, digest, 'utf8');
  console.error(`Digest: ${digest.length} caracteres, ${index.length} temas, ${personal.length} memorias personales → ${outFile}`);
} else {
  process.stdout.write(`${digest}\n`);
}
