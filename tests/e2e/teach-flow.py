import asyncio
from playwright.async_api import async_playwright
R=[]
def check(name, ok, d=''):
    R.append(ok); print('PASS' if ok else 'FAIL', name, d, flush=True)
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream','--use-file-for-fake-audio-capture=/tmp/teach/mic-am.wav','--autoplay-policy=no-user-gesture-required'])
        ctx = await b.new_context(viewport={'width':1440,'height':900}); await ctx.grant_permissions(['microphone'])
        pg = await ctx.new_page(); errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto('http://localhost:4173/')
        await pg.get_by_label('Teach Chordlab your guitar').click()
        for name in ['Dominant 7th','Major 7th','Minor 7th','Sus2']:
            await pg.locator('.pick-chip', has_text=name).click()
        summary = await pg.locator('.teach-actions .hint').inner_text()
        check('setup: 3 types × 3 roots = 9 takes', '9 takes' in summary, summary)
        await pg.get_by_role('button', name='Start recording').click()
        await pg.locator('.session').wait_for()
        await pg.locator('.session-foot .toggle').click()   # manual advance for the test
        await pg.screenshot(path='/tmp/teach/1-session.png')
        # take 1 asks for G; the fake mic is playing Am → must be rejected
        first = await pg.locator('.teach-chord').inner_text()
        await pg.locator('.session-left .btn.primary').click()
        await pg.locator('.session-status .warn').wait_for(timeout=15000)
        warn = await pg.locator('.session-status .warn').inner_text()
        check('mic take of the wrong chord is rejected', first == 'G' and 'Am' in warn, f'asked {first}: "{warn[:70]}"')
        await pg.screenshot(path='/tmp/teach/2-rejected.png')
        file_in = pg.locator('[data-teach-file]')
        mic_ok = None
        for i in range(9):
            await pg.wait_for_function("document.querySelector('.session-status') && !document.querySelector('.session-status.saved') && !document.querySelector('.session-status.checking')", timeout=10000) if False else None
            chord = (await pg.locator('.teach-chord').inner_text()).strip()
            if chord == 'Am':   # this one comes from the real (fake) microphone and should pass
                await pg.locator('.session-left .btn.primary').click()
                await pg.locator('.session-status.saved, .session-status .warn').first.wait_for(timeout=15000)
                mic_ok = await pg.locator('.session-status.saved').count() == 1
            else:
                await file_in.set_input_files(f'/tmp/teach/{chord}.wav')
                await pg.locator('.session-status.saved, .session-status .warn').first.wait_for(timeout=15000)
                if await pg.locator('.session-status .warn').count(): print('   unexpected warn for', chord, await pg.locator('.session-status .warn').inner_text())
            await pg.wait_for_timeout(250)
            await pg.locator('.session-left .btn.primary, .teach-done').first.wait_for(timeout=10000)
            if i < 8:
                nxt = (await pg.locator('.teach-chord').inner_text()).strip() if await pg.locator('.teach-chord').count() else ''
                if nxt == chord: await pg.wait_for_timeout(800)
        check('mic take of the right chord (Am) is accepted and saved', mic_ok is True)
        await pg.locator('.teach-done').wait_for(timeout=10000)
        await pg.get_by_role('button', name='See results').click()
        await pg.locator('.score-cards').wait_for()
        scores = await pg.locator('.score b').all_inner_texts()
        rows = await pg.locator('.results tbody tr').all_inner_texts()
        check('results show leave-one-out scores and 3 learned chord types', len(scores)==2 and len(rows)==3 and all('Learned' in r for r in rows), f'default {scores[0]}, profile {scores[1]}; rows {[r.split(chr(9))[0] for r in rows]}')
        hint = await pg.locator('.profile-switch .hint').inner_text()
        check('results explain the new chord type it adds', 'sus4' in hint, hint[:90])
        await pg.locator('.profile-switch .toggle').click()
        check('profile switched on', await pg.locator('.profile-switch .toggle').get_attribute('aria-checked') == 'true')
        await pg.screenshot(path='/tmp/teach/3-results.png')
        await pg.get_by_label('Close').first.click()
        # a song with sus4 chords, analysed with the profile
        await pg.locator('input[type=file]').first.set_input_files('/tmp/teach/sus-song.wav')
        await pg.locator('.cseg .nm').nth(3).wait_for(timeout=60000); await pg.wait_for_timeout(400)
        names = [t.strip() for t in await pg.locator('.cseg .nm').all_inner_texts()]
        engine = await pg.locator('.kv dd').first.inner_text()
        check('song analysed with the profile detects sus4 chords', sum(n.endswith('sus4') for n in names) >= 3 and 'profile' in engine, f'{names} | {engine}')
        await pg.screenshot(path='/tmp/teach/4-song.png')
        # switch the profile off from the inspector → re-analyse removes sus4
        await pg.locator('#gp').click(); await pg.get_by_role('button', name='Re-analyse with these settings').click(); await pg.wait_for_timeout(1500)
        names2 = [t.strip() for t in await pg.locator('.cseg .nm').all_inner_texts()]
        check('profile off + re-analyse returns to the default engine', not any('sus' in n for n in names2), str(names2))
        # persistence
        await pg.reload(); await pg.locator('.cseg .nm').first.wait_for(timeout=15000)
        await pg.get_by_label('Teach Chordlab your guitar').click(); await pg.get_by_role('tab', name='Takes (9)').click()
        n = await pg.locator('.take-chip').count()
        check('takes persist after reload', n == 9, f'{n} takes')
        await pg.screenshot(path='/tmp/teach/5-takes.png')
        print('page errors:', errs or 'none'); print(f'{sum(R)}/{len(R)} passed')
        await b.close()
asyncio.run(main())
