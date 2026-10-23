// Builds www/ from src/game.html: local three.js + Capacitor runtime, full HTML document.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const www = path.join(root, 'www');
fs.mkdirSync(www, { recursive: true });

let game = fs.readFileSync(path.join(root, 'src/game.html'), 'utf8');
const cdn = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';
if (!game.includes(cdn)) throw new Error('three.js CDN tag not found in src/game.html');
game = game.replace(`<script src="${cdn}"></script>`, '<script src="capacitor.js"></script>\n<script src="three.min.js"></script>');

// Use bundled fonts so the app works offline
game = game.replace(/<link rel="preconnect"[^>]*>\n?/, '').replace(/<link rel="stylesheet" href="https:\/\/fonts.googleapis.com[^>]*>/,
  `<style>
@font-face{font-family:"Unbounded";font-weight:500;font-display:swap;src:url(fonts/unbounded-500.woff2) format("woff2")}
@font-face{font-family:"Unbounded";font-weight:800;font-display:swap;src:url(fonts/unbounded-800.woff2) format("woff2")}
@font-face{font-family:"DM Mono";font-weight:500;font-display:swap;src:url(fonts/dm-mono-500.woff2) format("woff2")}
</style>`);
if (game.includes('fonts.googleapis.com')) throw new Error('Google Fonts link not replaced');

// Real ads only in store builds: ADS_TEST=false. Everything else shows Google's test ads.
const realAds = process.env.ADS_TEST === 'false';
if (!game.includes('    testing: true,')) throw new Error('ads testing flag not found');
if (realAds) game = game.replace('    testing: true,', '    testing: false,');
console.log(realAds ? 'Ads: REAL (store build)' : 'Ads: test mode');

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
</head>
<body>
${game}
</body>
</html>
`;
fs.writeFileSync(path.join(www, 'index.html'), html);
fs.copyFileSync(path.join(root, 'node_modules/three/build/three.min.js'), path.join(www, 'three.min.js'));
fs.copyFileSync(path.join(root, 'node_modules/@capacitor/core/dist/capacitor.js'), path.join(www, 'capacitor.js'));
const fonts = path.join(www, 'fonts');
fs.mkdirSync(fonts, { recursive: true });
const fs_ = (pkg, file, out) => fs.copyFileSync(path.join(root, 'node_modules/@fontsource', pkg, 'files', file), path.join(fonts, out));
fs_('unbounded', 'unbounded-latin-500-normal.woff2', 'unbounded-500.woff2');
fs_('unbounded', 'unbounded-latin-800-normal.woff2', 'unbounded-800.woff2');
fs_('dm-mono', 'dm-mono-latin-500-normal.woff2', 'dm-mono-500.woff2');
console.log('Built www/');
