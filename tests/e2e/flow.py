import asyncio, json, sys
from playwright.async_api import async_playwright
URL='http://localhost:4173/'
EXPECT='A E F#m D A E F#m D Bm D E A'.split()
results=[]; errors=[]
def check(name, ok, detail=''):
    results.append((name, bool(ok), detail)); print(('PASS' if ok else 'FAIL'), name, detail, flush=True)

async def chords(page):
    return [t.strip() for t in await page.locator('.cseg .nm').all_inner_texts()]

def collapse(xs):
    out=[]
    for x in xs:
        if x!='N.C.' and (not out or out[-1]!=x): out.append(x)
    return out

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--autoplay-policy=no-user-gesture-required'])
        ctx = await b.new_context(viewport={'width':1440,'height':900}, device_scale_factor=1)
        page = await ctx.new_page()
        page.on('console', lambda m: errors.append(m.text) if m.type=='error' else None)
        page.on('pageerror', lambda e: errors.append(str(e)))
        await page.goto(URL); await page.wait_for_selector('text=Find the chords in any song')
        await page.screenshot(path='/tmp/e2e/01-empty.png')

        # 1. import MP3 → real analysis
        await page.locator('input[type=file]').first.set_input_files('/tmp/e2e/song.mp3')
        await page.wait_for_selector('.bigbar, .cseg', timeout=10000)
        saw_progress = await page.locator('.bigbar, .pi-progress').count() > 0
        await page.wait_for_selector('.cseg .nm', timeout=60000)
        await page.wait_for_timeout(500)
        got = collapse(await chords(page))
        check('analysis shows progress while running', saw_progress)
        check('MP3 import → detected chords match the known progression', got==collapse(EXPECT), f'got {got}')
        n_conf = await page.locator('.cseg .cf').count()
        check('chord blocks show confidence indicators', n_conf>0, f'{n_conf} blocks')
        key = await page.locator('.pv-meta .chip').first.inner_text()
        tempo = await page.locator('.pv-meta .chip').nth(1).inner_text()
        check('key detected', 'A major' in key, key.replace('\n',' '))
        check('tempo detected', '100' in tempo or '200' in tempo or '50' in tempo, tempo.replace('\n',' '))
        await page.screenshot(path='/tmp/e2e/02-analysed.png')

        # 2. playback sync
        await page.locator('button.play').click(); await page.wait_for_timeout(2500)
        t = await page.locator('.controls .time b').inner_text()
        check('playback advances time', t not in ('0:00.0',), t)
        active = await page.locator('.cseg.active .nm').inner_text()
        stage = await page.locator('.chord-big').get_attribute('aria-label')
        check('active timeline chord matches stage while playing', active in stage, f'{active} / {stage}')
        await page.locator('button.play').click()

        # 3. click a chord segment → seek
        segs = page.locator('.cseg')
        target = segs.nth(4)
        name = (await target.locator('.nm').inner_text()).strip()
        await target.click(); await page.wait_for_timeout(300)
        t2 = await page.evaluate("document.querySelector('.controls .time b').textContent")
        stage2 = await page.locator('.chord-big').get_attribute('aria-label')
        check('clicking a chord seeks and shows it', name in stage2, f'{name} at {t2} → {stage2}')
        # seek while playing with speed change
        await page.select_option('#speed', '0.75'); await page.locator('button.play').click(); await page.wait_for_timeout(1500)
        active2 = (await page.locator('.cseg.active .nm').inner_text()).strip()
        stage3 = await page.locator('.chord-big').get_attribute('aria-label')
        check('sync holds at 0.75× after seeking', active2 in stage3, f'{active2} / {stage3}')
        await page.locator('button.play').click()

        # 4. instruments
        await segs.nth(0).click(); await page.wait_for_timeout(200)
        g = await page.locator('.diagram-body svg').inner_html()
        await page.get_by_role('button', name='Ukulele', exact=True).click(); await page.wait_for_timeout(200)
        u = await page.locator('.diagram-body svg').inner_html()
        u_strings = [await e.text_content() for e in await page.locator('.diagram-body svg text').all()]
        await page.screenshot(path='/tmp/e2e/03-ukulele.png')
        await page.get_by_role('button', name='Piano', exact=True).click(); await page.wait_for_timeout(200)
        lit = await page.locator('.diagram-body svg rect[fill="#8d44f6"]').count()
        labels = [await e.text_content() for e in await page.locator('.diagram-body svg text[fill="white"]').all()]
        await page.screenshot(path='/tmp/e2e/04-piano.png')
        check('guitar → ukulele changes the diagram', g!=u and 'G' in u_strings and 'C' in u_strings, str(u_strings[-4:]))
        check('piano highlights the chord tones of A', lit==3 and set(labels)=={'A','C#','E'}, str(labels))
        await page.get_by_role('button', name='Guitar', exact=True).click()

        # 5. transpose +2
        before = await chords(page)
        await page.get_by_label('Transpose up a semitone').click(); await page.get_by_label('Transpose up a semitone').click()
        await page.wait_for_timeout(300)
        after = await chords(page)
        key2 = await page.locator('.pv-meta .chip').first.inner_text()
        check('transpose +2 updates labels and key', after[:4]==['B','F#','G#m','E'] and 'B major' in key2, f'{before[:4]} → {after[:4]}, {key2}')
        dia = await page.locator('.diagram-body svg').get_attribute('aria-label')
        check('diagram follows transposition', dia.startswith('B on'), dia)
        await page.get_by_role('button', name='Reset').click()

        # 6. manual correction: select segment 2, change root to C, rename via dblclick
        await segs.nth(1).click()
        await page.locator('.roots button', has_text='C').first.click(); await page.wait_for_timeout(200)
        n1 = (await segs.nth(1).locator('.nm').inner_text()).strip()
        await segs.nth(2).dblclick(); await page.locator('.cseg input').fill('Bb7'); await page.keyboard.press('Enter'); await page.wait_for_timeout(200)
        n2 = (await segs.nth(2).locator('.nm').inner_text()).strip()
        check('correct chord via root picker', n1=='C', n1)
        check('rename chord by typing', n2 in ('A#7','Bb7'), n2)
        await page.keyboard.press('Control+z'); await page.wait_for_timeout(200)
        n2u = (await segs.nth(2).locator('.nm').inner_text()).strip()
        check('undo restores previous chord', n2u=='F#m', n2u)
        await page.keyboard.press('Control+Shift+z'); await page.wait_for_timeout(200)
        count_before = await segs.count()
        await page.evaluate("document.activeElement && document.activeElement.blur()")
        await page.locator('button.play').evaluate('b => b.blur()')
        # split at playhead
        sb = await segs.nth(6).bounding_box()
        wb = await page.locator('.wave-track').bounding_box()
        await page.mouse.click(sb['x']+sb['width']/2, wb['y']+wb['height']/2); await page.wait_for_timeout(150)
        await page.locator('[aria-label="Split chord at playhead"]').click(); await page.wait_for_timeout(200)
        await page.locator('[aria-label="Split chord at playhead"]').click(); await page.wait_for_timeout(200)
        edge_toast = await page.locator('.toast', has_text='Move the playhead inside a chord').count()
        check('splitting at a chord edge explains why it can’t', edge_toast>0)
        await page.locator('[aria-label="Split chord at playhead"]').click(); await page.wait_for_timeout(200)
        check('split adds a segment', await segs.count()==count_before+1, f'{count_before} → {await segs.count()}')
        # loop: drag on ruler
        r = await page.locator('.ruler').bounding_box()
        await page.mouse.move(r['x']+100, r['y']+10); await page.mouse.down(); await page.mouse.move(r['x']+300, r['y']+10, steps=5); await page.mouse.up()
        loop_on = await page.locator('.loop-region').count()
        await page.screenshot(path='/tmp/e2e/05-edited-loop.png')
        check('dragging on ruler creates a loop region', loop_on==1)
        await page.wait_for_timeout(800)  # let autosave flush

        # 7. persistence across reload
        await page.reload(); await page.wait_for_selector('.cseg .nm', timeout=15000); await page.wait_for_timeout(300)
        persisted = await chords(page)
        check('edits persist after refresh', persisted[1]=='C' and persisted[2] in ('A#7','Bb7'), str(persisted[:4]))

        # 8. errors
        await page.locator('input[type=file]').first.set_input_files('/tmp/e2e/notes.txt'); await page.wait_for_timeout(400)
        t1 = await page.locator('.toast').all_inner_texts()
        check('non-audio file rejected with a clear message', any('isn’t an audio file' in x for x in t1), str(t1)[:120])
        await page.locator('input[type=file]').first.set_input_files('/tmp/e2e/corrupt.mp3')
        await page.wait_for_selector('text=Analysis didn’t finish', timeout=20000)
        msg = await page.locator('.err-text').first.inner_text()
        check('corrupted audio fails gracefully', 'decoded' in msg, msg[:110])
        await page.screenshot(path='/tmp/e2e/06-error.png')

        # 9. offline: SW should control the page after a reload
        await page.wait_for_function("navigator.serviceWorker && navigator.serviceWorker.controller !== null", timeout=15000)
        await ctx.set_offline(True)
        await page.reload(); await page.wait_for_selector('.project-item', timeout=15000)
        n_proj = await page.locator('.project-item').count()
        check('app shell loads offline', n_proj>=2, f'{n_proj} projects')
        await page.locator('.project-item', has_text='song').click()
        await page.wait_for_selector('.cseg .nm', timeout=10000)
        check('saved project reopens offline', (await chords(page))[1]=='C')
        await page.locator('input[type=file]').first.set_input_files('/tmp/e2e/second.ogg')
        await page.wait_for_function("document.querySelector('.pv-head h1')?.textContent==='second' && document.querySelectorAll('.cseg .nm').length>0", timeout=60000)
        await page.wait_for_timeout(300)
        got2 = collapse(await chords(page))
        check('new file analysed while offline (OGG)', got2==collapse('Dm A# F C Dm A# C Dm'.split()) or got2==collapse('Dm Bb F C Dm Bb C Dm'.split()), str(got2))
        await ctx.set_offline(False)

        # 9b. delete a project via the in-app dialog (Playwright auto-dismisses native dialogs)
        cnt = await page.locator('.project-item').count()
        await page.locator('.pi-del').last.click(); await page.get_by_role('button', name='Cancel').click()
        kept = await page.locator('.project-item').count() == cnt
        await page.locator('.pi-del').last.click(); await page.locator('[data-confirm]').click(); await page.wait_for_timeout(500)
        gone = await page.locator('.project-item').count() == cnt - 1
        await page.reload(); await page.wait_for_selector('.project-item'); await page.wait_for_timeout(500)
        check('delete: Cancel keeps it, Delete removes it, stays deleted after reload', kept and gone and await page.locator('.project-item').count() == cnt - 1)

        # 10. mobile layout
        m = await b.new_context(viewport={'width':390,'height':844}, device_scale_factor=2, is_mobile=True, has_touch=True)
        mp = await m.new_page(); mp.on('pageerror', lambda e: errors.append('mobile: '+str(e)))
        await mp.goto(URL); await mp.wait_for_selector('text=Find the chords in any song')
        await mp.locator('input[type=file]').first.set_input_files('/tmp/e2e/song.mp3')
        await mp.wait_for_selector('.cseg .nm', timeout=60000); await mp.wait_for_timeout(400)
        overflow = await mp.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
        check('mobile: no horizontal page overflow', overflow<=0, f'{overflow}px')
        await mp.screenshot(path='/tmp/e2e/07-mobile.png', full_page=True)
        await b.close()
    print('\nCONSOLE ERRORS:', json.dumps(errors[:10], indent=1))
    print(f"\n{sum(r[1] for r in results)}/{len(results)} passed")
asyncio.run(main())
