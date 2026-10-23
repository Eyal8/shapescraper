# Renders store screenshots by auto-playing the real game (www/index.html#shots).
import pathlib
from playwright.sync_api import sync_playwright
root = pathlib.Path(__file__).resolve().parent.parent
out = root / 'store'
url = f'file://{root}/www/index.html#shots'
PLAY = """async ({n, perfectTail, offs, shape}) => {
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  window.__ts.unlockAll(); window.__ts.start('endless', shape);
  for (let i = 0; i < n; i++) {
    const tail = i >= n - perfectTail;
    window.__ts.setOff(tail ? 0 : offs[i % offs.length]);
    window.__ts.place();
    await wait(tail ? 160 : 25);
  }
}"""
OFFS = [0, 0.18, 0, 0, -0.12, 0, 0, 0.1, 0, 0, -0.15, 0, 0]
devices = {'iphone': dict(viewport={'width': 430, 'height': 932}, device_scale_factor=3),
           'android': dict(viewport={'width': 360, 'height': 640}, device_scale_factor=3)}
with sync_playwright() as p:
    b = p.chromium.launch(args=['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'])
    for name, dev in devices.items():
        for shot, n, tail, over, shp in [('1-perfect', 20, 4, False, 'circle'), ('2-tall', 55, 0, False, 'hexagon'), ('3-continue', 33, 0, True, 'triangle')]:
            pg = b.new_page(**dev)
            pg.on('pageerror', lambda e: print('JS error:', e))
            pg.goto(url)
            pg.wait_for_function('window.__ts')
            pg.wait_for_timeout(500)
            if tail:
                pg.evaluate(PLAY, {'n': n - tail, 'perfectTail': 0, 'offs': OFFS, 'shape': shp})
                pg.wait_for_timeout(1500)
                pg.evaluate("""async (k) => { const w = ms => new Promise(r => setTimeout(r, ms));
                  for (let i = 0; i < k; i++) { window.__ts.setOff(0); window.__ts.place(); await w(130); } }""", tail)
                pg.wait_for_timeout(250)
            else:
                pg.evaluate(PLAY, {'n': n, 'perfectTail': 0, 'offs': OFFS, 'shape': shp})
                pg.wait_for_timeout(1800)
            if over:
                pg.evaluate("() => { window.__ts.setOff(6.9); window.__ts.place(); }")
                pg.wait_for_timeout(2500)
            pg.screenshot(path=str(out / f'{name}-{shot}.png'))
            print('wrote', name, shot)
            pg.close()
    b.close()
