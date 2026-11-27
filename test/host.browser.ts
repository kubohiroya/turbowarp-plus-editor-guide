// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import {build} from 'esbuild';
import {chromium} from '@playwright/test';
const html = '<!doctype html><html><head><meta charset="utf-8"></head><body><div id="stage" style="width:480px;height:360px;background:#eee">Stage</div><button data-testid="green-flag" style="position:absolute;left:520px;top:60px">Green flag</button><div id="workspace" style="position:absolute;left:520px;top:140px;width:350px;height:300px">Workspace</div></body></html>';
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
    await page.evaluate(() => (window as any).fixture.attachment.dispose());
    assert.deepEqual(errors, []);
});
