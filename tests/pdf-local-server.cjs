const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
// The real DOM/application with isolated local persistence. No cloud clients or SW.
function harness() {
  return fs.readFileSync(path.join(root, 'index.html'), 'utf8')
    .replace(/<script src="js\/(?:vendor\/firebase[^" ]*|firebase-config|vendor\/supabase|supabase-config|foto-sync|sync|aggiornamento)\.js"><\/script>/g, '')
    .replace('<script src="js/app.js">', `<script>
      const sync = { statoAttuale: () => 'offline', onCambioStato() {}, onDatiAggiornati() {}, init: async () => false, sincronizzaTutto: async () => true };
      const fotoSync = { caricaFoto: async () => {}, riprovaInSospeso: async () => {}, init() {}, onCambioStato() {}, statoDi: () => null, eliminaFotoRemota() {}, risolviFoto: id => db.leggiFoto(id) };
    </script><script src="js/app.js">`);
}
const server = http.createServer((req, res) => {
  const route = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  if (route === '/' || route === '/pdf-test') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); return res.end(harness()); }
  const file = path.resolve(root, '.' + route);
  if (!file.startsWith(root + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, bytes) => {
    if (err) { res.writeHead(404); return res.end(); }
    res.setHeader('Content-Type', ({ '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.pdf': 'application/pdf', '.png': 'image/png', '.webp': 'image/webp' })[path.extname(file)] || 'application/octet-stream');
    res.end(bytes);
  });
});
if (require.main === module) server.listen(8765, '127.0.0.1', () => console.log('PDF test server http://127.0.0.1:8765'));
module.exports = server;
