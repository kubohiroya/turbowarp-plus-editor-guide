// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import {build} from 'esbuild';
import {chromium} from '@playwright/test';
const html = '<!doctype html><html><head><meta charset="utf-8"></head><body><div id="stage" style="width:480px;height:360px;background:#eee">Stage</div><button data-testid="green-flag" style="position:absolute;left:520px;top:60px">Green flag</button><div id="workspace" style="position:absolute;left:520px;top:140px;width:350px;height:300px">Workspace</div><input class="sa-find-input" aria-label="Find" style="position:absolute;left:520px;top:10px"></body></html>';
test('real Joyride with shared React 16 waits for operations and cleans up all lifecycle paths', async t => {
    assert.notEqual(process.env.E2E_HEADED, '1'); assert.notEqual(process.env.E2E_NATIVE, '1');
    assert.notEqual(process.env.TW_PLUS_NATIVE_INPUT, '1');
    const bundle = await build({entryPoints: ['test/browser-fixture.ts'], bundle: true, write: false,
        platform: 'browser', target: 'es2017', define: {'process.env.NODE_ENV': '"production"'}});
    const browser = await chromium.launch({headless: true});
    t.after(() => browser.close());
    const page = await browser.newPage();
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.setContent(html);
    await page.addScriptTag({content: bundle.outputFiles[0]!.text});
    assert.equal(await page.evaluate(() => (window as any).fixture.attachment.ready), true);
    await page.evaluate(() => {
        const f = (window as any).fixture;
        (window as any).outcome = '';
        f.extension.showAndWait({TARGET: 'editor.greenFlag', MESSAGE: '旗を押してね', ACTION: 'click'})
            .then((status: string) => {(window as any).outcome = status;});
    });
    await page.getByText('旗を押してね', {exact: true}).waitFor();
    assert.equal(await page.evaluate(() => (window as any).outcome), '');
    await page.locator('[data-testid="green-flag"]').evaluate((element: HTMLElement) => element.click());
    assert.equal(await page.evaluate(() => (window as any).outcome), '');
    await page.getByRole('button', {name: 'Green flag', exact: true}).click();
    await page.waitForFunction(() => (window as any).outcome === 'completed');
    assert.equal(await page.getByText('旗を押してね', {exact: true}).count(), 0);
    await page.evaluate(() => {
        const f = (window as any).fixture;
        (document.querySelector('#workspace') as HTMLElement).style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh';
        (window as any).outcome = '';
        f.extension.showAndWait({TARGET: 'code.workspace', MESSAGE: 'コードを変えてね', ACTION: 'event:workspace.changed'})
            .then((status: string) => {(window as any).outcome = status;});
    });
    await page.getByText('コードを変えてね', {exact: true}).waitFor();
    const close = await page.getByRole('button', {name: '案内を閉じる'}).boundingBox();
    assert.ok(close && close.y >= 0 && close.x >= 0);
    await page.locator('#workspace').click({position: {x: 20, y: 20}});
    assert.equal(await page.evaluate(() => (window as any).outcome), '');
    await page.evaluate(() => (window as any).fixture.changeWorkspace());
    await page.waitForFunction(() => (window as any).outcome === 'completed');
    await page.evaluate(() => {(document.querySelector('#workspace') as HTMLElement).style.cssText = 'position:absolute;left:520px;top:140px;width:350px;height:300px';});
    for (const event of ['PROJECT_STOP_ALL', 'PROJECT_LOADED']) {
        await page.evaluate(event => {
            const f = (window as any).fixture;
            (window as any).outcome = '';
            f.extension.showAndWait({TARGET: 'editor.greenFlag', MESSAGE: '待っています', ACTION: 'click'})
                .then((status: string) => {(window as any).outcome = status;});
            f.emit(event);
        }, event);
        await page.waitForFunction(() => (window as any).outcome === 'cancelled');
    }
    await page.evaluate(() => {
        const f = (window as any).fixture;
        f.extension.showAndWait({TARGET: 'editor.greenFlag', MESSAGE: '閉じられます', ACTION: 'click'})
            .then((status: string) => {(window as any).outcome = status;});
    });
    await page.getByText('閉じられます', {exact: true}).waitFor();
    await page.getByRole('button', {name: '案内を閉じる'}).click();
    await page.waitForFunction(() => (window as any).outcome === 'cancelled');
    await page.evaluate(() => {
        const f = (window as any).fixture;
        f.attachment.dispose();
    });
    assert.equal(await page.locator('[data-tw-editor-guide]').count(), 0);
    assert.equal(await page.evaluate(() => (window as any).fixture.listenerCount), 0);
    await page.evaluate(() => (window as any).fixture.reattach());
    assert.equal(await page.evaluate(() => (window as any).fixture.attachment.ready), true);
    assert.equal(await page.evaluate(() => (window as any).fixture.registrations), 1);
    assert.equal(await page.evaluate(() => (window as any).fixture.extension.available({TARGET: 'editor.greenFlag'})), true);
    assert.equal(await page.evaluate(() => (window as any).fixture.extension.available({TARGET: 'code.find'})), true);
    await page.evaluate(() => {
        (window as any).outcome = '';
        (window as any).fixture.extension.showAndWait({TARGET: 'code.find', MESSAGE: '検索してね', ACTION: 'click'})
            .then((status: string) => {(window as any).outcome = status;});
    });
    await page.getByText('検索してね', {exact: true}).waitFor();
    await page.getByRole('textbox', {name: 'Find'}).click();
    await page.waitForFunction(() => (window as any).outcome === 'completed');
    await page.evaluate(() => (window as any).fixture.attachment.dispose());
    assert.deepEqual(errors, []);
});

test('a live sprite and speech follow a logical target while the editor remains interactive', async t => {
    const bundle = await build({entryPoints: ['test/browser-fixture.ts'], bundle: true, write: false,
        platform: 'browser', target: 'es2017', define: {'process.env.NODE_ENV': '"production"'}});
    const browser = await chromium.launch({headless: true}); t.after(() => browser.close());
    const page = await browser.newPage({viewport: {width: 1000, height: 700}});
    await page.setContent(html + '<input aria-label="Practice"><button id="save">Save</button>');
    await page.addScriptTag({content: bundle.outputFiles[0]!.text});
    assert.equal(await page.evaluate(() => (window as any).fixture.attachment.ready), true);
    await page.evaluate(() => {
        const f = (window as any).fixture; (window as any).outcome = '';
        (window as any).clicks = 0;
        document.querySelector('#workspace')!.addEventListener('click', () => {(window as any).clicks++;});
        f.extension.spriteAndWait({TARGET: 'code.workspace', SIDE: 'center', MESSAGE: '<b>コードを直してね</b>',
            ACTION: 'event:workspace.changed'}, {target: f.actor, thread: {}}).then((s: string) => {(window as any).outcome = s;});
    });
    const actor = page.locator('[data-tw-guide-sprite]');
    const speech = page.locator('[data-tw-guide-speech]');
    await actor.waitFor({state: 'visible'});
    assert.equal(await speech.textContent(), '<b>コードを直してね</b>');
    assert.equal(await speech.locator('b').count(), 0);
    assert.equal(await page.locator('#joyride-tooltip-content').count(), 0);
    assert.deepEqual(await actor.evaluate((e: HTMLCanvasElement) => [...e.getContext('2d')!.getImageData(0, 0, 1, 1).data]), [255, 0, 0, 255]);
    const initial = await actor.boundingBox(); assert.ok(initial && initial.x > 480);
    assert.equal(await page.evaluate(() => (window as any).fixture.nativeVisible), false);
    assert.equal(await page.evaluate(() => (window as any).fixture.actor.visible), true);
    await page.mouse.click(initial.x + initial.width / 2, initial.y + initial.height / 2);
    assert.equal(await page.evaluate(() => (window as any).clicks), 1);
    await page.getByRole('textbox', {name: 'Practice'}).fill('edited while the guide runs');
    assert.equal(await page.evaluate(() => (window as any).outcome), '');
    await page.evaluate(() => {
        const f = (window as any).fixture;
        f.actor.currentCostume = 1; f.actor.effects.ghost = 50; f.actor.x += 30;
        (document.querySelector('#workspace') as HTMLElement).style.left = '500px';
        f.emit('AFTER_EXECUTE');
    });
    assert.deepEqual(await actor.evaluate((e: HTMLCanvasElement) => [...e.getContext('2d')!.getImageData(0, 0, 1, 1).data]), [0, 0, 255, 255]);
    assert.equal(await actor.evaluate(e => getComputedStyle(e).opacity), '0.5');
    assert.equal((await actor.boundingBox())!.x, initial.x + 10);
    await page.evaluate(() => (window as any).fixture.changeWorkspace());
    await page.waitForFunction(() => (window as any).outcome === 'completed');
    assert.equal(await actor.count(), 0); assert.equal(await speech.count(), 0);
    assert.equal(await page.evaluate(() => (window as any).fixture.nativeVisible), true);
    for (const event of ['PROJECT_STOP_ALL', 'PROJECT_LOADED']) {
        await page.evaluate(() => {
            const f = (window as any).fixture; (window as any).outcome = '';
            f.extension.spriteAndWait({TARGET: 'code.workspace', MESSAGE: '待っています', ACTION: 'click'}, {target: f.actor})
                .then((s: string) => {(window as any).outcome = s;});
        });
        await actor.waitFor({state: 'visible'});
        await page.evaluate(event => (window as any).fixture.emit(event), event);
        await page.waitForFunction(() => (window as any).outcome === 'cancelled');
        assert.equal(await actor.count(), 0);
    }
    assert.equal(await page.evaluate(() => {
        const f = (window as any).fixture;
        return f.extension.spriteAndWait({TARGET: 'unknown', MESSAGE: '案内', ACTION: 'click'}, {target: f.actor});
    }), 'unavailable');
    assert.equal(await page.evaluate(() => {
        const f = (window as any).fixture;
        return f.extension.spriteAndWait({TARGET: 'code.workspace', MESSAGE: '案内', ACTION: 'click'},
            {target: {...f.actor, isStage: true}});
    }), 'unavailable');
    assert.equal(await actor.count(), 0);
    await page.evaluate(() => {
        const f = (window as any).fixture; (window as any).outcome = '';
        f.extension.spriteAndWait({TARGET: 'code.workspace', MESSAGE: '待っています', ACTION: 'click'}, {target: f.actor})
            .then((s: string) => {(window as any).outcome = s;});
    });
    await actor.waitFor({state: 'visible'});
    await page.evaluate(() => {const f = (window as any).fixture; f.actor.visible = false; f.emit('AFTER_EXECUTE');});
    await actor.waitFor({state: 'hidden'});
    await page.evaluate(() => (window as any).fixture.extension.hide());
    await page.waitForFunction(() => (window as any).outcome === 'cancelled');
    assert.equal(await page.evaluate(() => (window as any).fixture.nativeVisible), false);
    assert.equal(await speech.count(), 0);
    await page.evaluate(() => (window as any).fixture.attachment.dispose());
    assert.equal(await page.evaluate(() => (window as any).fixture.listenerCount), 0);
});

test('the next-lesson button navigates only on a real click and leaves with stop, project change and dispose', async t => {
    const bundle = await build({entryPoints: ['test/browser-fixture.ts'], bundle: true, write: false,
        platform: 'browser', target: 'es2017', define: {'process.env.NODE_ENV': '"production"'}});
    const browser = await chromium.launch({headless: true}); t.after(() => browser.close());
    const page = await browser.newPage({viewport: {width: 1000, height: 700}});
    await page.route('https://editor.test/**', route => route.fulfill({contentType: 'text/html', body: html}));
    await page.goto('https://editor.test/editor.html?locale=ja&twPlusLocalGit=1');
    await page.addScriptTag({content: bundle.outputFiles[0]!.text});
    assert.equal(await page.evaluate(() => (window as any).fixture.attachment.ready), true);
    const link = page.getByRole('link', {name: '次の教材へ'});
    const offer = () => page.evaluate(() => (window as any).fixture.extension.offerNext({
        PROJECT: 'https://lessons.test/2.sb3', LABEL: '次の教材へ', FEATURES: 'twPlusWorkspaceMinimap'}));
    for (const event of ['PROJECT_STOP_ALL', 'PROJECT_LOADED']) {
        await offer();
        await link.waitFor({state: 'visible'});
        await page.evaluate(event => (window as any).fixture.emit(event), event);
        assert.equal(await link.count(), 0);
    }
    await offer();
    await page.evaluate(() => (window as any).fixture.attachment.dispose());
    assert.equal(await link.count(), 0);
    await page.evaluate(() => (window as any).fixture.reattach());
    await offer();
    await page.locator('a[data-tw-guide-next]').evaluate((element: HTMLElement) => element.dispatchEvent(new MouseEvent('mouseover')));
    assert.equal(new URL(page.url()).searchParams.has('project_url'), false);
    await link.click();
    await page.waitForURL(url => url.searchParams.has('project_url'));
    const next = new URL(page.url());
    assert.equal(next.pathname, '/editor.html');
    assert.equal(next.searchParams.get('project_url'), 'https://lessons.test/2.sb3');
    assert.equal(next.searchParams.get('locale'), 'ja');
    assert.equal(next.searchParams.get('twPlusLocalGit'), '1');
    assert.equal(next.searchParams.get('twPlusWorkspaceMinimap'), '1');
});
