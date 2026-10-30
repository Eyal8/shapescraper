# Renders the six store screenshots for one device size by auto-playing the real game (www/index.html#shots).
# Usage: python3 design/screens-store.py iphone|iphone-large|android   (run `npm run build` first)
import pathlib, sys
from PIL import Image
from playwright.sync_api import sync_playwright
root = pathlib.Path(__file__).resolve().parent.parent
DEVICES = {  # css viewport x3 = store pixel size
    'iphone': (402, 874, 'ios'),        # 1206 x 2622, App Store "medium" (required)
    'iphone-large': (430, 932, 'ios'),  # 1290 x 2796, App Store "large" (optional)
    'android': (360, 640, 'android'),   # 1080 x 1920, Google Play phone
}
name = sys.argv[1] if len(sys.argv) > 1 else 'iphone'
HIDE_HELP = '--no-help' in sys.argv  # match builds from before the tutorial (iOS 1.0 build 23)
w, h, store = DEVICES[name]
out = root / 'store' / store / 'screenshots'
url = f'file://{root}/www/index.html#shots'
OFFS = [0, 0.18, 0, 0, -0.12, 0, 0, 0.1, 0, 0, -0.15, 0, 0]
PLAY = """async ({n, offs, shape}) => { const wt = ms => new Promise(r => setTimeout(r, ms));
  window.__ts.start('endless', shape);
  for (let i = 0; i < n; i++) { window.__ts.setOff(offs[i % offs.length]); window.__ts.place(); await wt(25); } }"""
with sync_playwright() as p:
    b = p.chromium.launch(args=['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'])
    def page(games=12):
        pg = b.new_page(viewport={'width': w, 'height': h}, device_scale_factor=3)
        pg.on('pageerror', lambda e: print('JS error:', e)); pg.goto(url); pg.wait_for_function('window.__ts'); pg.wait_for_timeout(500)
        pg.evaluate(f"localStorage.setItem('ss_games','{games}'); localStorage.setItem('ss_tut_done','1'); localStorage.setItem('ss_intro_daily','1'); localStorage.setItem('ss_cont_tip','2')")  # skip one-time popups
        if HIDE_HELP: pg.add_style_tag(content='#helpBtn{display:none!important}')
        return pg
    def save(pg, shot):
        d = out / f'{name}-{shot}.png'; pg.screenshot(path=str(d)); Image.open(d).convert('RGB').save(d)  # Apple rejects alpha
        print('wrote', d.name); pg.close()
    # 1: a tall hexagon tower
    pg = page(); pg.evaluate("window.__ts.unlockAll()"); pg.evaluate(PLAY, {'n': 55, 'offs': OFFS, 'shape': 'hexagon'}); pg.wait_for_timeout(1800); save(pg, '1-tall')
    # 2: a shape unlocks mid-game (confetti)
    pg = page(3); pg.evaluate(PLAY, {'n': 19, 'offs': OFFS, 'shape': 'square'}); pg.wait_for_timeout(1200)
    pg.evaluate("() => { window.__ts.setOff(0); window.__ts.place(); }"); pg.wait_for_timeout(150); save(pg, '2-unlocked')
    # 3: the shape carousel in the menu
    pg = page(); pg.evaluate("window.__ts.unlockAll(); localStorage.setItem('ss_best_endless_star','62'); window.__ts.menu('endless','star')"); pg.wait_for_timeout(1500); save(pg, '3-shapes')
    # 4: the results card after unlocking a shape
    pg = page(3); pg.evaluate(PLAY, {'n': 20, 'offs': OFFS, 'shape': 'square'}); pg.wait_for_timeout(900)
    pg.evaluate("() => { window.__ts.setOff(6.9); window.__ts.place(); }"); pg.wait_for_timeout(2500)
    pg.evaluate("() => { const x = [...document.querySelectorAll('button')].find(e => /no thanks/i.test(e.textContent) && e.offsetParent); if (x) x.click(); }"); pg.wait_for_timeout(2200); save(pg, '4-unlock-card')
    # 5: the Daily calendar with a streak
    pg = page()
    pg.evaluate("""() => { const k = o => { const d = new Date(); d.setDate(d.getDate() + o); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
      const days = {}; for (const o of [-1,-2,-3,-4,-5,-6,-7,-8,-9,-11,-12,-13,-15,-16]) days[k(o)] = { best: 20 + (-o * 3) % 17, perf: 9, done: true, onTime: true, played: true };
      days[k(-10)] = { best: 14, perf: 4, done: false, played: true };
      window.__ts.unlockAll(); window.__ts.seedDays(days); window.__ts.setMode('daily'); window.__ts.calendar(); }""")
    pg.wait_for_timeout(1500); save(pg, '5-daily')
    # 6: the continue offer
    pg = page(); pg.evaluate("window.__ts.unlockAll()"); pg.evaluate(PLAY, {'n': 33, 'offs': OFFS, 'shape': 'triangle'}); pg.wait_for_timeout(1800)
    pg.evaluate("() => { window.__ts.setOff(6.9); window.__ts.place(); }"); pg.wait_for_timeout(2500); save(pg, '6-continue')
    b.close()
