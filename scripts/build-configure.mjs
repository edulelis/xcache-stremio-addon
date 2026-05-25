import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const src = path.join(root, 'apps/configure/index.html');
const outDir = path.join(root, 'apps/configure/dist');
const out = path.join(outDir, 'index.html');

if (process.argv.includes('--check')) {
  if (!fs.existsSync(src)) throw new Error('apps/configure/index.html is missing');
  process.exit(0);
}

fs.mkdirSync(outDir, { recursive: true });
fs.copyFileSync(src, out);
