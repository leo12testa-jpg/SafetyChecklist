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
  assert.deepEqual(labels, ['Dashboard', 'Nuovo sopralluogo', 'Raccolta dati', 'Generatore documenti', 'Storico', 'Il mio lavoro', 'Utenti', 'Impostazioni']);
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


test('dashboard: tre moduli separati senza cambiare le funzioni', () => {
  const screen = html.match(/<section id="screen-home"[\s\S]*?(?=<section id="screen-new-inspection")/)?.[0];
  assert.ok(screen, 'dashboard presente');
  const names = ['MODULO 01', 'MODULO 02', 'MODULO 03'];
  for (const label of names) assert.ok(screen.includes('class="module-card-overline">' + label + '</span>'));
  assert.equal((screen.match(/class="module-card-overline"/g) || []).length, 3);
  const navLinks = [...screen.matchAll(/class="dashboard-action-card primary-action(?: dvr-action| document-generation-action)?"[^>]*data-nav="([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(navLinks, ['new-inspection','new-inspection','document-generation']);
  assert.ok(screen.indexOf('class="home-actions dashboard-action-grid"') < screen.indexOf('dashboard-kpi-grid'));
  assert.match(screen, /class="dashboard-module-section-break"/);
  assert.match(screen, /data-nav="history"/);
  assert.match(css, /#screen-home \.dashboard-action-grid/);
  assert.match(css, /@media \(min-width:1250px\)/);
});

test('sidebar: raggruppamenti visivi conservano otto voci', () => {
  assert.equal((nav.match(/class="side-nav-module-label"/g) || []).length, 4);
  assert.ok(nav.indexOf('01 · SOPRALLUOGHI') < nav.indexOf('02 · RACCOLTA DATI'));
  assert.ok(nav.indexOf('02 · RACCOLTA DATI') < nav.indexOf('03 · GENERATORE DOCUMENTI'));
  assert.match(css, /\.side-nav-module-label/);
  assert.match(css, /max-width:900px[\s\S]*?\.side-nav-module-divider, \.side-nav-module-label/);
});

test('dashboard: titoli esatti dei tre moduli', () => {
  const screen = html.slice(html.indexOf('<section id="screen-home"'), html.indexOf('<section id="screen-new-inspection"'));
  const titles = [...screen.matchAll(/class="module-card-overline">MODULO \d\d<\/span><strong>([^<]+)<\/strong>/g)].map(m => m[1]);
  assert.deepEqual(titles, ['Sopralluoghi', 'Raccolta dati', 'Generatore documenti']);
});
