import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve('extension');
const required = [
  'manifest.json',
  'background.js',
  'sidepanel.html',
  'sidepanel.css',
  'sidepanel.js'
];

for (const file of required) {
  const target = path.join(root, file);
  if (!fs.existsSync(target)) {
    throw new Error(`Missing extension file: ${file}`);
  }
}

const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));

if (manifest.manifest_version !== 3) throw new Error('Expected Manifest V3.');
if (!manifest.side_panel?.default_path) throw new Error('Side panel is not configured.');
if (!manifest.host_permissions?.some((value) => value.includes('127.0.0.1:3000'))) {
  throw new Error('Local TTS host permission is missing.');
}

console.log('Peanut 2 Speech extension structure looks good.');
