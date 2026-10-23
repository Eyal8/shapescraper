import sys, pathlib
from playwright.sync_api import sync_playwright
root = pathlib.Path(__file__).resolve().parent
out = root.parent / 'assets'
jobs = [('icon', 1024, 1024, 'icon-only.png', False), ('fg', 1024, 1024, 'icon-foreground.png', True),
        ('splash', 2732, 2732, 'splash.png', False), ('feature', 1024, 500, '../store/feature-graphic.png', False)]
(root.parent / 'store').mkdir(exist_ok=True)
with sync_playwright() as p:
    b = p.chromium.launch(args=['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'])
    for mode, w, h, name, transparent in jobs:
        pg = b.new_page(viewport={'width': w, 'height': h})
        pg.on('pageerror', lambda e: print('JS error:', e))
        pg.goto(f'file://{root}/art.html?mode={mode}')
        pg.wait_for_function('document.title === "ready"', timeout=15000)
        pg.wait_for_timeout(1200)
        pg.screenshot(path=str(out / name), omit_background=transparent)
        print('wrote', name)
    b.close()
