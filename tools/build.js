// Transforms index.html into one self-contained file: inlines the CSS, drops
// the dev importmap, replaces the module script with the bundle.
//
// Replacements use a FUNCTION, never a string. In a string replacement "$&"
// means "insert the matched text", and minified JS contains "$&" -- which
// silently re-injected the dev <script src> tag into its own replacement.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const css = read('css/style.css');
const js = read('dist/bundle.js').replace(/<\/script/gi, '<\/script');
let html = read('index.html');

html = html.replace(/<link rel="stylesheet" href="css\/style\.css">/, () => `<style>${css}</style>`);
html = html.replace(/<script type="importmap">[\s\S]*?<\/script>\s*/, () => '');
html = html.replace(/<script type="module" src="src\/main\.js"><\/script>/, () => `<script>${js}</script>`);

const desc = 'Hold an abandoned robotics facility against waves of hostile machines. Four weapons, four robot chassis, real AI.';
html = html.replace(/<title>ROBOT STRIKE<\/title>/, () =>
  `<meta name="description" content="${desc}">
<meta property="og:title" content="ROBOT STRIKE">
<meta property="og:description" content="${desc}">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect width='100' height='100' fill='%230b1017'/%3E%3Crect x='28' y='30' width='44' height='34' rx='5' fill='none' stroke='%237fe9c4' stroke-width='7'/%3E%3Crect x='40' y='43' width='20' height='8' fill='%237fe9c4'/%3E%3Cpath d='M50 12v16M22 74l-8 12M78 74l8 12' stroke='%237fe9c4' stroke-width='7' stroke-linecap='round'/%3E%3C/svg%3E">
<title>ROBOT STRIKE</title>`);

for (const bad of ['importmap', 'src/main.js', 'css/style.css']) {
  if (html.includes(bad)) throw new Error('build left a dev reference behind: ' + bad);
}

fs.mkdirSync(path.join(ROOT, 'dist'), { recursive: true });
fs.mkdirSync(path.join(ROOT, 'docs'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'dist/index.html'), html);
fs.writeFileSync(path.join(ROOT, 'docs/index.html'), html);
fs.writeFileSync(path.join(ROOT, 'docs/.nojekyll'), '');

const kb = (p) => (fs.statSync(path.join(ROOT, p)).size / 1024).toFixed(0) + ' KB';
console.log('bundle.js        ' + kb('dist/bundle.js'));
console.log('docs/index.html  ' + kb('docs/index.html') + '  (single file)');
