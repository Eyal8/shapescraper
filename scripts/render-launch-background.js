// Render the intro's first purple/blue/mint gradient into the existing native splash sizes.
// Android stretches its launch bitmap; iOS and the WebView aspect-fill the square artwork.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const root = path.join(__dirname, '..');
const stops = [[0, [155, 107, 255]], [.45, [154, 166, 243]], [.8, [127, 227, 214]], [1, [184, 245, 220]]];
const crc = data => {
  let c = 0xffffffff;
  for (const b of data) { c ^= b; for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0); }
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (name, data) => {
  const type = Buffer.from(name), size = Buffer.alloc(4), sum = Buffer.alloc(4);
  size.writeUInt32BE(data.length); sum.writeUInt32BE(crc(Buffer.concat([type, data])));
  return Buffer.concat([size, type, data, sum]);
};
function gradient(width, height) {
  const pixels = Buffer.alloc((width * 4 + 1) * height);
  const dx = Math.sin(115 * Math.PI / 180), dy = -Math.cos(115 * Math.PI / 180);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const t = (dx * x / (width - 1) + dy * y / (height - 1)) / (dx + dy);
    const i = t < .45 ? 0 : t < .8 ? 1 : 2;
    const [a, c] = stops[i], [b, d] = stops[i + 1], k = (t - a) / (b - a);
    const at = y * (width * 4 + 1) + 1 + x * 4;
    for (let j = 0; j < 3; j++) pixels[at + j] = Math.round(c[j] + (d[j] - c[j]) * k);
    pixels[at + 3] = 255;
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
}
const ios = path.join(root, 'ios/App/App/Assets.xcassets/Splash.imageset');
const android = path.join(root, 'android/app/src/main/res');
const files = fs.readdirSync(ios).filter(n => n.endsWith('.png')).map(n => path.join(ios, n));
for (const dir of fs.readdirSync(android)) {
  const file = path.join(android, dir, 'splash.png');
  if (fs.existsSync(file)) files.push(file);
}
const rendered = new Map();
for (const file of files) {
  const old = fs.readFileSync(file), width = old.readUInt32BE(16), height = old.readUInt32BE(20), size = `${width}x${height}`;
  if (!rendered.has(size)) rendered.set(size, gradient(width, height));
  fs.writeFileSync(file, rendered.get(size));
}
console.log(`Rendered ${files.length} launch images in ${rendered.size} existing sizes.`);
