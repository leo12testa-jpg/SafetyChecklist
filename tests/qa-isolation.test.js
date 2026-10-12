const test = require('node:test');
const assert = require('node:assert/strict');
const { harness } = require('./pdf-local-server.cjs');
const fs = require('node:fs');
const vm = require('node:vm');

test('PDF harness strips versioned cloud/auth scripts and installs local identity before app', () => {
  const html = harness();
  assert.doesNotMatch(html, /<script src="js\/(?:vendor\/firebase|firebase-config|auth\.|identity\.|account-screens|vendor\/supabase|supabase-config|foto-sync|sync\.|aggiornamento)/);
  assert.match(html, /const appIdentity =/);
  assert.match(html, /const sync =/);
  assert.ok(html.indexOf('const appIdentity =') < html.indexOf('<script src="js/app.js'));
  assert.match(html, /<script src="js\/pdf\.js\?v=/);
});

test('every HTML script and stylesheet is precached at its exact versioned URL', () => {
  const c=vm.createContext({self:{addEventListener(){}}});
  vm.runInContext(fs.readFileSync('service-worker.js','utf8')+';globalThis.shell=APP_SHELL;',c);
  const html=fs.readFileSync('index.html','utf8');
  const urls=[...html.matchAll(/<script src="([^"]+)"/g)].map(m=>m[1]);
  urls.push(...[...html.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map(m=>m[1]));
  for(const url of urls)assert.ok(c.shell.includes('./'+url),'Missing exact precache URL: '+url);
});
