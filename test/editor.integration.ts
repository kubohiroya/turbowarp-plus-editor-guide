// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createServer} from 'node:http';
import {build} from 'esbuild';
import {chromium} from '@playwright/test';
import {createGuideIntroProject} from '../examples/guide-intro.ts';

test('fixed Editor VM and real paper-story runtime wait, resume, cancel and offer the next URL', {timeout: 120000}, async t => {
    const directory = process.env.GUIDE_EDITOR_BUILD;
    const app = process.env.GUIDE_KAMISHIBAI_ROOT;
    assert.ok(directory && path.isAbsolute(directory)); assert.ok(app && path.isAbsolute(app));
    assert.notEqual(process.env.E2E_HEADED, '1'); assert.notEqual(process.env.E2E_NATIVE, '1');
    assert.notEqual(process.env.TW_PLUS_NATIVE_INPUT, '1');
    assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], {cwd: app, encoding: 'utf8'}).trim(), '45f41d8bae8a0afa674d00da36a98b3090955694');
    execFileSync('git', ['diff', '--exit-code', 'HEAD', '--', 'src/dsl4', 'schema'], {cwd: app});
    const source = 'kamishibai: "4.0"\nscenes:\n  intro:\n    - broadcastMessageAndWait: "guide:workspace"\n    - wait: 0\n';
    const parser = await build({stdin: {contents: `import {createDsl4SourceFrontend} from './src/dsl4/source-frontend.ts';import schema from './schema/dsl-4.schema.json';const result=createDsl4SourceFrontend(schema).parse(${JSON.stringify(source)},{sourceId:'guide-intro.kamishibai.yaml'});if(!result.ok)throw new Error(JSON.stringify(result.diagnostics));console.log(JSON.stringify(result.storyDocument));`,
        resolveDir: app, loader: 'ts'}, bundle: true, platform: 'node', format: 'cjs', write: false});
    await fs.mkdir('.host', {recursive: true}); await fs.writeFile('.host/parse-story.cjs', parser.outputFiles[0]!.contents);
    const story = JSON.parse(execFileSync(process.execPath, ['.host/parse-story.cjs'], {encoding: 'utf8'}));
    const runner = await build({entryPoints: ['test/editor-fixture.ts'], bundle: true, platform: 'browser', target: 'es2017',
        write: false, alias: {'guide-test-app-controller': path.join(app, 'src/dsl4/runtime-controller.ts')},
        define: {__GUIDE_STORY__: JSON.stringify(story)}});
    const server = createServer(async (request, response) => {
        try {
            const relative = decodeURIComponent(new URL(request.url!, 'http://local').pathname).replace(/^\/turbowarp-plus-editor\//, '');
            if (relative === 'guide-next.sb3') {response.setHeader('Content-Type', 'application/octet-stream'); response.end(createGuideIntroProject(2)); return;}
            const target = path.resolve(directory, relative || 'editor.html');
            if (!target.startsWith(path.resolve(directory) + path.sep)) {response.writeHead(403).end(); return;}
            const mime: Record<string, string> = {'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml'};
            response.setHeader('Content-Type', mime[path.extname(target)] || 'application/octet-stream'); response.end(await fs.readFile(target));
        } catch {response.writeHead(404).end();}
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
    const address = server.address(); assert.ok(address && typeof address !== 'string');
    const browser = await chromium.launch({headless: true}); t.after(() => browser.close());
    const page = await browser.newPage({viewport: {width: 1440, height: 960}});
    page.on('pageerror', error => console.log('Browser error:', error.message));
    page.on('console', async message => {
        if (message.type() === 'error') {
            for (const argument of message.args()) {
                const stack = await argument.evaluate(value => value instanceof Error ? value.stack : null).catch(() => null);
                if (stack) console.log('Console error stack:', stack);
            }
        }
    });
    page.on('response', response => {if (response.status() >= 400) console.log('HTTP error:', response.status(), response.url());});
    await page.goto(`http://127.0.0.1:${address.port}/turbowarp-plus-editor/editor.html?locale=ja`);
    try {
        await page.waitForFunction(() => Boolean((window as any).vm?.runtime?.getTargetForStage()), undefined, {timeout: 10000});
    } catch (error) {
        console.log('Startup state:', await page.evaluate(() => ({url: location.href, title: document.title,
            text: document.body.innerText.slice(0, 1200), vm: typeof (window as any).vm,
            scripts: [...document.scripts].map(script => script.src)})));
        throw error;
    }
    const project = Buffer.from(createGuideIntroProject()).toString('base64');
    await page.evaluate(async data => {await (window as any).vm.loadProject(Uint8Array.from(atob(data), c => c.charCodeAt(0)));}, project);
    await page.waitForFunction(() => Boolean((window as any).vm.runtime._primitives['kubohiroyaeditorguide_showAndWait']));
    await page.addScriptTag({content: runner.outputFiles[0]!.text});
    await page.evaluate(() => {
        const vm = (window as any).vm;
        vm.runtime.startHats('event_whenbroadcastreceived', {BROADCAST_OPTION: 'guide:pulse'});
        void (window as any).guideLesson.start();
    });
    await page.locator('#joyride-tooltip-content').filter({hasText: 'コードの画面を押してね'}).waitFor();
    await page.waitForFunction(() => {
        const content = document.querySelector('#joyride-tooltip-content');
        const close = document.querySelector('button[aria-label="案内を閉じる"]');
        if (!content || !close) return false;
        return [content, close].every(element => {
            const box = element.getBoundingClientRect();
            return box.top >= 0 && box.left >= 0 && box.right <= innerWidth && box.bottom <= innerHeight;
        });
    }, undefined, {timeout: 3000});
    await page.screenshot({path: '.host/guide-editor.png'});
    const before = await page.evaluate(() => (window as any).vm.runtime.getTargetForStage().variables.clock.value);
    await page.waitForFunction(value => (window as any).vm.runtime.getTargetForStage().variables.clock.value > value, before);
    assert.equal(await page.getByRole('link', {name: '次の教材へ'}).count(), 0);
    await page.locator('.blocklySvg').filter({visible: true}).first().click({position: {x: 240, y: 160}});
    await page.getByRole('link', {name: '次の教材へ'}).waitFor();
    assert.equal(await page.evaluate(() => (window as any).vm.runtime.getTargetForStage().variables.result.value), 'completed');
    const next = new URL(await page.getByRole('link', {name: '次の教材へ'}).getAttribute('href') as string);
    assert.equal(next.searchParams.get('twPlusWorkspaceMinimap'), '1');
    assert.equal(next.searchParams.get('locale'), 'ja');
    await page.evaluate(() => {void (window as any).guideLesson.start();});
    await page.locator('#joyride-tooltip-content').filter({hasText: 'コードの画面を押してね'}).waitFor();
    await page.evaluate(() => (window as any).guideLesson.controller.stop('cancelled'));
    await page.locator('#joyride-tooltip-content').filter({hasText: 'コードの画面を押してね'}).waitFor({state: 'detached'});
    assert.equal(await page.evaluate(() => (window as any).guideLesson.controller.getState().status), 'stopped');
    await page.evaluate(() => {void (window as any).guideLesson.start();});
    await page.locator('#joyride-tooltip-content').filter({hasText: 'コードの画面を押してね'}).waitFor();
    await page.locator('.blocklySvg').filter({visible: true}).first().click({position: {x: 240, y: 160}});
    await page.getByRole('link', {name: '次の教材へ'}).click();
    await page.waitForFunction(() => (window as any).vm?.runtime?.getTargetForStage()?.variables.chapter?.value === 2);
    assert.equal(new URL(page.url()).searchParams.get('twPlusWorkspaceMinimap'), '1');
    assert.equal(new URL(page.url()).searchParams.get('locale'), 'ja');
    await fs.writeFile('.host/guide-intro.sb3', createGuideIntroProject());
    await fs.writeFile('.host/guide-next.sb3', createGuideIntroProject(2));
});
