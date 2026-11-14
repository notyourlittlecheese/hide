const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.join(__dirname, '..');
const code = fs.readFileSync(path.join(root, 'manual-hide-controls.js'), 'utf8').replaceAll('export function', 'function');
const css = fs.readFileSync(path.join(root, 'style.css'), 'utf8');

(async () => {
    const browser = await chromium.launch({
        headless: true,
        ...(process.env.HH_TEST_BROWSER ? { executablePath: process.env.HH_TEST_BROWSER } : {}),
    });
    try {
        for (const width of [320, 390, 1024]) {
            const page = await browser.newPage({ viewport: { width, height: 800 }, hasTouch: true });
            const errors = [];
            page.on('pageerror', error => errors.push(error.message));
            await page.setContent(`<!doctype html><meta charset="utf-8">
                <style>body{margin:0;font:16px sans-serif;background:#eee;color:#222}
                #form_sheld{position:fixed;bottom:0;width:100%;background:white}
                #send_form{display:flex;flex-direction:column;padding:8px}textarea{width:100%;height:54px;box-sizing:border-box}
                #qr--bar,.qr--buttons{display:flex;gap:5px;flex-wrap:wrap;width:100%}
                :root{--SmartThemeBodyColor:#222;--SmartThemeBlurTintColor:#fff;--SmartThemeBorderColor:#bbb}
                .fa-xmark:before{content:"×"}.fa-minus:before{content:"−"}.fa-plus:before{content:"+"}
                </style><main style="padding:16px">聊天内容</main><div id="form_sheld"><form id="send_form"><textarea aria-label="消息"></textarea></form></div>`);
            await page.addStyleTag({ content: css });
            await page.evaluate(source => {
                window.calls = [];
                window.snapshotId = 'a';
                eval(source + `
                    window.destroyControls = mountManualHideControls(document.getElementById('send_form'), {
                        onHide: (count, snapshot) => window.calls.push({count, snapshot}),
                        getSnapshot: () => window.snapshotId
                    });`);
            }, code);
            const button = page.locator('.hh-quick-button');
            const panel = page.locator('.hh-quick-picker');
            assert.equal(await page.locator('#send_form #qr--bar .hh-quick-button').count(), 1);
            await page.evaluate(() => {
                const bar = document.createElement('div');
                bar.id = 'qr--bar';
                bar.innerHTML = '<div class="qr--buttons"><button>Existing QR</button></div>';
                document.getElementById('send_form').prepend(bar);
            });
            await page.waitForFunction(() => document.querySelectorAll('#qr--bar').length === 1
                && document.querySelector('.qr--buttons .hh-quick-button'));
            await page.evaluate(() => document.querySelector('.qr--buttons').remove());
            await page.waitForFunction(() => document.querySelector('#qr--bar > #hide-helper-quick-row'));
            await button.tap();
            assert.deepEqual(await page.evaluate(() => calls.map(call => call.count)), [2]);
            assert.equal(await panel.isVisible(), false);
            assert.equal(await page.locator('input:focus').count(), 0);

            const box = await button.boundingBox();
            assert.ok(box.width > 0 && box.height < 60);
            const cdp = await page.context().newCDPSession(page);
            const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
            await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
            await page.waitForTimeout(580);
            await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
            await page.waitForTimeout(60);
            assert.equal(await panel.isVisible(), true);
            assert.equal(await page.locator('input:focus').count(), 0);
            assert.deepEqual(await page.evaluate(() => calls.map(call => call.count)), [2]);
            assert.equal(await page.locator('input').getAttribute('readonly'), '');
            const bounds = await panel.boundingBox();
            assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width && bounds.y >= 0);
            assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
            const out = process.env.HH_TEST_SCREENSHOTS;
            if (out) {
                fs.mkdirSync(out, { recursive: true });
                await page.screenshot({ path: path.join(out, 'hide-' + width + '.png') });
            }
            await page.locator('[data-count="4"]').tap();
            assert.deepEqual(await page.evaluate(() => calls.map(call => call.count)), [2, 4]);
            await button.tap();
            assert.deepEqual(await page.evaluate(() => calls.map(call => call.count)), [2, 4, 2]);

            await button.focus();
            await page.keyboard.press('ArrowDown');
            await page.locator('[data-step="1"]').click();
            await page.locator('[data-confirm]').click();
            assert.equal(await page.evaluate(() => calls.at(-1).count), 3);
            await button.focus();
            await page.keyboard.press('ArrowDown');
            await page.locator('input').click();
            await page.locator('input').fill('7');
            await page.locator('[data-confirm]').click();
            assert.equal(await page.evaluate(() => calls.at(-1).count), 7);
            await button.focus();
            await page.keyboard.press('ArrowDown');
            await page.keyboard.press('Escape');
            assert.equal(await panel.isVisible(), false);

            const countBeforeDrag = await page.evaluate(() => calls.length);
            await page.mouse.move(point.x, point.y);
            await page.mouse.down();
            await page.mouse.move(point.x + 25, point.y);
            await page.waitForTimeout(550);
            await page.mouse.up();
            assert.equal(await panel.isVisible(), false);
            assert.equal(await page.evaluate(() => calls.length), countBeforeDrag);
            await page.evaluate(() => destroyControls());
            assert.equal(await page.locator('#hide-helper-quick-row').count(), 0);
            assert.deepEqual(errors, []);
            await page.close();
            console.log('PASS quick controls: ' + width + 'px, touch tap/hold, no auto-focus, presets, stepper, keyboard, drag, teardown');
        }
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
