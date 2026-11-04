'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'css/style.css'), 'utf8');
const nav = html.match(/<nav class="side-nav">([\s\S]*?)<\/nav>/)?.[1];

test('sidebar: otto icone SVG uniformi e decorative', () => {
  assert.ok(nav, 'sidebar presente');
  const items = [...nav.matchAll(/<button\b[^>]*class="side-nav-item"[^>]*>[\s\S]*?<\/button>/g)].map(m => m[0]);
  assert.equal(items.length, 8);
  for (const item of items) {
    assert.match(item, /<span class="nav-icon" aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false">/);
    assert.match(item, /<\/svg><\/span><span>[^<]+<\/span><\/button>/);
    assert.equal((item.match(/<svg\b/g) || []).length, 1);
  }
  assert.equal((nav.match(/<svg viewBox="0 0 24 24"/g) || []).length, 8);
});

test('sidebar: etichette e collegamenti invariati', () => {
  const labels = [...nav.matchAll(/<\/svg><\/span><span>([^<]+)<\/span>/g)].map(m => m[1]);
  assert.deepEqual(labels, ['Dashboard', 'Nuovo sopralluogo', 'Raccolta dati DVR', 'Generazione documenti', 'Storico', 'Il mio lavoro', 'Utenti', 'Impostazioni']);
  const targets = [...nav.matchAll(/<button\b[^>]*class="side-nav-item"[^>]*data-nav="([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(targets, ['home', 'new-inspection', 'new-inspection', 'document-generation', 'history', 'my-work', 'admin-users', 'settings']);
  assert.match(nav, /data-nav="new-inspection" data-modalita="audit"/);
  assert.match(nav, /data-nav="new-inspection" data-modalita="dvr"/);
});

test('sidebar: focus e icone mobile accessibili', () => {
  assert.match(css, /\.side-nav-item:focus-visible\s*\{/);
  assert.match(css, /\.nav-icon svg\s*\{[^}]*stroke:currentColor/s);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /\.nav-icon svg \{ width:19px; height:19px; \}/);
});
