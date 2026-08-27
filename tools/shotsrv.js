// Dev-only capture endpoint. The in-app browser pane cannot composite frames in
// this environment, so the page POSTs canvas data-URLs here and we write them to
// shots/ for inspection. Not part of the shipped app.
const http = require('http');
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'shots');
fs.mkdirSync(DIR, { recursive: true });

http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  if (req.method === 'OPTIONS') return res.end();
  if (req.method !== 'POST') { res.statusCode = 405; return res.end('post only'); }

  const name = (new URL(req.url, 'http://x').searchParams.get('name') || 'shot').replace(/[^a-z0-9_-]/gi, '');
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const m = /^data:image\/(png|jpeg);base64,(.+)$/s.exec(body.trim());
    if (!m) { res.statusCode = 400; return res.end('bad data url'); }
    const file = path.join(DIR, name + '.' + (m[1] === 'jpeg' ? 'jpg' : 'png'));
    fs.writeFileSync(file, Buffer.from(m[2], 'base64'));
    res.end(JSON.stringify({ ok: true, file, bytes: fs.statSync(file).size }));
  });
}).listen(5179, () => console.log('shotsrv on 5179'));
