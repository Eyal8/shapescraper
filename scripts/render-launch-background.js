// One vector/palette source generates native backgrounds, symbols and the web symbol.
// Run node scripts/render-launch-background.js after changing assets/launch-design.json.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const root = path.join(__dirname, '..');
const design = require('../assets/launch-design.json');
const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
const stops = design.background.map(([at, hex]) => [at, rgb(hex)]);
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
function inside(x, y, points) {
  let hit = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [ax, ay] = points[i], [bx, by] = points[j];
    if ((ay > y) !== (by > y) && x < (bx - ax) * (y - ay) / (by - ay) + ax) hit = !hit;
  }
  return hit;
}
function png(width, height, symbolWidth = 0, transparent = false) {
  const stride = width * 4 + 1, pixels = Buffer.alloc(stride * height);
  const dx = Math.sin(design.angle * Math.PI / 180), dy = -Math.cos(design.angle * Math.PI / 180);
  if (!transparent) for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const t = (dx * x / (width - 1) + dy * y / (height - 1)) / (dx + dy);
    const i = t < .5 ? 0 : 1, [a, c] = stops[i], [b, d] = stops[i + 1], k = (t - a) / (b - a);
    const at = y * stride + 1 + x * 4;
    for (let j = 0; j < 3; j++) pixels[at + j] = Math.round(c[j] + (d[j] - c[j]) * k);
    pixels[at + 3] = 255;
  }
  if (symbolWidth) {
    const [vw, vh] = design.viewBox, scale = symbolWidth / vw;
    const left = (width - symbolWidth) / 2, top = (height - vh * scale) / 2;
    const faces = design.faces.map(f => ({ ...f, color: rgb(f.fill) }));
    // Four coverage samples per pixel keep native polygon edges clean without dependencies.
    for (let y = Math.max(0, Math.floor(top)); y < Math.min(height, Math.ceil(top + vh * scale)); y++) {
      for (let x = Math.max(0, Math.floor(left)); x < Math.min(width, Math.ceil(left + symbolWidth)); x++) {
        const sum = [0, 0, 0]; let hits = 0;
        for (const sy of [.25, .75]) for (const sx of [.25, .75]) {
          const px = (x + sx - left) / scale, py = (y + sy - top) / scale;
          for (let i = faces.length - 1; i >= 0; i--) if (inside(px, py, faces[i].points)) {
            faces[i].color.forEach((v, j) => sum[j] += v); hits++; break;
          }
        }
        if (!hits) continue;
        const at = y * stride + 1 + x * 4, alpha = hits / 4;
        for (let j = 0; j < 3; j++) pixels[at + j] = Math.round(transparent ? sum[j] / hits : sum[j] / 4 + pixels[at + j] * (1 - alpha));
        pixels[at + 3] = transparent ? Math.round(alpha * 255) : 255;
      }
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
}
const ios = path.join(root, 'ios/App/App/Assets.xcassets');
const android = path.join(root, 'android/app/src/main/res');
const cache = new Map();
function write(file, width, height, symbolWidth = 0, transparent = false) {
  const key = [width, height, symbolWidth, transparent].join(':');
  if (!cache.has(key)) cache.set(key, png(width, height, symbolWidth, transparent));
  fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, cache.get(key));
}
for (const name of fs.readdirSync(path.join(ios, 'Splash.imageset')).filter(n => n.endsWith('.png'))) {
  const file = path.join(ios, 'Splash.imageset', name), old = fs.readFileSync(file);
  write(file, old.readUInt32BE(16), old.readUInt32BE(20));
}
const densities = { ldpi: .75, mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
for (const dir of fs.readdirSync(android)) {
  const file = path.join(android, dir, 'splash.png');
  if (!fs.existsSync(file)) continue;
  const old = fs.readFileSync(file), w = old.readUInt32BE(16), h = old.readUInt32BE(20);
  const density = densities[dir.split('-').at(-1)] || 1;
  write(file, w, h, Math.min(Math.min(w, h) * design.symbolWidthFraction, design.symbolMaxPoints * density));
}
const symbolDir = path.join(ios, 'LaunchSymbol.imageset');
for (const scale of [1, 2, 3]) write(path.join(symbolDir, `symbol@${scale}x.png`), 200 * scale, 208 * scale, 200 * scale, true);
fs.writeFileSync(path.join(symbolDir, 'Contents.json'), JSON.stringify({ images: [1, 2, 3].map(scale => ({ idiom: 'universal', filename: `symbol@${scale}x.png`, scale: `${scale}x` })), info: { version: 1, author: 'xcode' } }, null, 2) + '\n');
const paths = design.faces.map(f => `<polygon fill="${f.fill}" points="${f.points.map(p => p.join(',')).join(' ')}"/>`).join('');
fs.writeFileSync(path.join(root, 'assets/launch-symbol.svg'), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 208">${paths}</svg>\n`);
const vectorPaths = design.faces.map(f => `<path android:fillColor="${f.fill}" android:pathData="M${f.points.map(p => p.join(',')).join(' L')} Z"/>`).join('\n');
fs.writeFileSync(path.join(android, 'drawable/launch_symbol.xml'), `<?xml version="1.0" encoding="utf-8"?>\n<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="288dp" android:height="288dp" android:viewportWidth="288" android:viewportHeight="288"><group android:scaleX="0.9" android:scaleY="0.9" android:translateX="54" android:translateY="50.4">\n${vectorPaths}\n</group></vector>\n`);
fs.writeFileSync(path.join(android, 'values/colors.xml'), `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <!-- Generated launch palette center; Android 12 requires a solid system background. -->\n    <color name="splash_background">${design.fallback}</color>\n</resources>\n`);
console.log(`Rendered launch artwork from assets/launch-design.json (${cache.size} raster variants, SVG and Android vector).`);
// Keep platform layout/fallbacks synchronized with the same design parameters.
const configPath = path.join(root, 'capacitor.config.json');
const config = JSON.parse(fs.readFileSync(configPath)); config.backgroundColor = design.fallback.toLowerCase();
fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
const [red, green, blue] = rgb(design.fallback).map(v => (v / 255).toFixed(6));
fs.writeFileSync(path.join(root, 'ios/App/App/Base.lproj/LaunchScreen.storyboard'), `<?xml version="1.0" encoding="UTF-8"?>
<document type="com.apple.InterfaceBuilder3.CocoaTouch.Storyboard.XIB" version="3.0" toolsVersion="17132" targetRuntime="iOS.CocoaTouch" propertyAccessControl="none" useAutolayout="YES" launchScreen="YES" useTraitCollections="YES" colorMatched="YES" initialViewController="01J-lp-oVM">
    <device id="retina4_7" orientation="portrait" appearance="light"/>
    <dependencies><deployment identifier="iOS"/><plugIn identifier="com.apple.InterfaceBuilder.IBCocoaTouchPlugin" version="17105"/></dependencies>
    <scenes><scene sceneID="EHf-IW-A2E"><objects>
        <viewController id="01J-lp-oVM" sceneMemberID="viewController">
            <view key="view" contentMode="scaleToFill" id="launch-root">
                <rect key="frame" x="0.0" y="0.0" width="375" height="667"/>
                <autoresizingMask key="autoresizingMask" widthSizable="YES" heightSizable="YES"/>
                <subviews>
                    <imageView userInteractionEnabled="NO" contentMode="scaleToFill" image="Splash" id="launch-sky">
                        <rect key="frame" x="0.0" y="0.0" width="375" height="667"/>
                        <autoresizingMask key="autoresizingMask" widthSizable="YES" heightSizable="YES"/>
                    </imageView>
                    <imageView userInteractionEnabled="NO" contentMode="scaleAspectFit" image="LaunchSymbol" translatesAutoresizingMaskIntoConstraints="NO" id="launch-symbol">
                        <rect key="frame" x="105" y="247.7" width="165" height="171.6"/>
                        <constraints>
                            <constraint firstAttribute="width" relation="lessThanOrEqual" constant="${design.symbolMaxPoints}" id="symbol-max"/>
                            <constraint firstAttribute="height" secondItem="launch-symbol" secondAttribute="width" multiplier="${design.viewBox[1] / design.viewBox[0]}" id="symbol-ratio"/>
                        </constraints>
                    </imageView>
                </subviews>
                <color key="backgroundColor" red="${red}" green="${green}" blue="${blue}" alpha="1" colorSpace="custom" customColorSpace="sRGB"/>
                <constraints>
                    <constraint firstItem="launch-symbol" firstAttribute="centerX" secondItem="launch-root" secondAttribute="centerX" id="symbol-x"/>
                    <constraint firstItem="launch-symbol" firstAttribute="centerY" secondItem="launch-root" secondAttribute="centerY" id="symbol-y"/>
                    <constraint firstItem="launch-symbol" firstAttribute="width" secondItem="launch-root" secondAttribute="width" multiplier="${design.symbolWidthFraction}" priority="999" id="symbol-width"/>
                    <constraint firstItem="launch-symbol" firstAttribute="width" relation="lessThanOrEqual" secondItem="launch-root" secondAttribute="height" multiplier="${design.symbolWidthFraction}" id="symbol-short-side"/>
                </constraints>
            </view>
        </viewController>
        <placeholder placeholderIdentifier="IBFirstResponder" id="iYj-Kq-Ea1" userLabel="First Responder" sceneMemberID="firstResponder"/>
    </objects></scene></scenes>
    <resources><image name="Splash" width="2732" height="2732"/><image name="LaunchSymbol" width="200" height="208"/></resources>
</document>
`);
