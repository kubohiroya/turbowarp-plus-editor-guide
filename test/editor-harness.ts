// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import type {TestContext} from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createServer} from 'node:http';
import {build} from 'esbuild';
import {chromium, type BrowserContext, type Page} from '@playwright/test';
import {createGuideIntroProject} from '../examples/guide-intro.ts';

/** Run the unchanged fixed Editor and actual paper runtime in an isolated headless browser. */
export async function openGuideEditor(t: TestContext, options: {locale?: string; debuggerEnabled?: boolean;
    beforeLoad?(context: BrowserContext): Promise<unknown>} = {}) {
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
    const parserFile = `.host/parse-story-${process.pid}.cjs`;
    await fs.mkdir('.host', {recursive: true}); await fs.writeFile(parserFile, parser.outputFiles[0]!.contents);
    const story = JSON.parse(execFileSync(process.execPath, [parserFile], {encoding: 'utf8'}));
    t.after(() => fs.rm(parserFile, {force: true}));
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
    const args = ['--enable-experimental-web-platform-features', '--enable-unsafe-swiftshader'];
    if (process.platform === 'darwin') args.push('--single-process', '--no-zygote', '--disable-crash-reporter');
    const browser = await chromium.launch({headless: true, args}); t.after(() => browser.close());
    const context = await browser.newContext({viewport: {width: 1440, height: 960}});
    if (options.debuggerEnabled) await context.addInitScript(() => {
        localStorage.setItem('tw:addons', JSON.stringify({_: 5, debugger: {enabled: true}, pause: {enabled: true}}));
    });
    await options.beforeLoad?.(context);
    const page = await context.newPage();
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
    await page.goto(`http://127.0.0.1:${address.port}/turbowarp-plus-editor/editor.html?locale=${options.locale || 'ja'}`);
    try {
        await page.waitForFunction(() => Boolean((window as any).vm?.runtime?.getTargetForStage()), undefined, {timeout: 10000});
    } catch (error) {
        console.log('Startup state:', await page.evaluate(() => ({url: location.href, title: document.title,
            text: document.body.innerText.slice(0, 1200), vm: typeof (window as any).vm,
            scripts: [...document.scripts].map(script => script.src)})));
        throw error;
    }
    return {page, installLesson: (target: Page = page) => target.addScriptTag({content: runner.outputFiles[0]!.text})};
}
