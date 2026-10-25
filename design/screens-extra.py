# Extra Android store screenshots: shape menu, shape unlock, daily calendar. Run after npm run build.
import pathlib, sys
from PIL import Image
from playwright.sync_api import sync_playwright
root = pathlib.Path(__file__).resolve().parent.parent; out = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else root / 'store' / 'android' / 'screenshots'
url = f'file://{root}/www/index.html#shots'
OFFS = [0, 0.18, 0, 0, -0.12, 0, 0, 0.1, 0, 0, -0.15, 0, 0]
with sync_playwright() as p:
    b = p.chromium.launch(args=['--use-gl=swiftshader','--enable-webgl','--ignore-gpu-blocklist'])
    def page():
        pg = b.new_page(viewport={'width':360,'height':640}, device_scale_factor=3)
        pg.on('pageerror', lambda e: print('JS error:', e)); pg.goto(url); pg.wait_for_function('window.__ts'); pg.wait_for_timeout(500); return pg
    def save(pg, name):
        d = out/f'android-{name}.png'; pg.screenshot(path=str(d)); Image.open(d).convert('RGB').save(d); print('wrote', name)
    # 4: menu with star selected
    pg = page(); pg.evaluate("localStorage.setItem('ss_games','12'); localStorage.setItem('ss_best_endless_star','62')"); pg.evaluate("window.__ts.unlockAll(); localStorage.setItem('ss_best_endless_star','62'); window.__ts.menu('endless','star')"); pg.wait_for_timeout(1500); save(pg,'4-shapes'); pg.close()
    # 5: unlock circle (fresh, play square to 20, then miss)
    pg = page(); pg.evaluate("localStorage.setItem('ss_games','3')")
    pg.evaluate("""async (offs) => { const w=ms=>new Promise(r=>setTimeout(r,ms)); window.__ts.start('endless','square');
      for (let i=0;i<20;i++){ window.__ts.setOff(offs[i%offs.length]); window.__ts.place(); await w(40);} }""", OFFS)
    pg.wait_for_timeout(900); save(pg,'5-unlock-play')
    pg.evaluate("() => { window.__ts.setOff(6.9); window.__ts.place(); }"); pg.wait_for_timeout(2500)
    # dismiss continue offer if present
    pg.evaluate("() => { const b=[...document.querySelectorAll('button,a')].find(x=>/no thanks/i.test(x.textContent)&&x.offsetParent); if(b) b.click(); }"); pg.wait_for_timeout(2200); save(pg,'5-unlock'); pg.close()
    # 6: daily calendar with a streak
    pg = page()
    pg.evaluate("""() => { const k=o=>{const d=new Date(); d.setDate(d.getDate()+o); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');};
      const days={}; for (const o of [-1,-2,-3,-4,-5,-6,-7,-8,-9,-11,-12,-13,-15,-16]) days[k(o)]={best:20+(-o*3)%17,perf:9,done:true,onTime:true,played:true};
      days[k(-10)]={best:14,perf:4,done:false,played:true}; window.__ts.unlockAll(); window.__ts.seedDays(days); window.__ts.setMode('daily'); window.__ts.calendar(); }""")
    pg.wait_for_timeout(1500); save(pg,'6-daily'); pg.close()
    b.close()
