// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {expect, type BrowserContext, type Page} from '@playwright/test';
import {unzipSync} from 'fflate';
import {createGuideSpriteProject} from '../examples/guide-intro.ts';
import {openGuideEditor} from './editor-harness.ts';

const breakpoint = '\u200B\u200Bbreakpoint\u200B\u200B';
function practiceDuration(project: any) {
    const blocks = project.targets.find((target: any) => target.isStage).blocks;
    const input = blocks.practice.inputs.DURATION[1];
    return Array.isArray(input) ? input[1] : blocks[input].fields.NUM[0];
}

async function repositoryFixture() {
    const folder = await fs.mkdtemp(path.resolve('.host/git-interop-'));
    const files = unzipSync(createGuideSpriteProject());
    const project = JSON.parse(new TextDecoder().decode(files['project.json']));
    const stage = project.targets[0];
    const actor = project.targets[1];
    actor.blocks.await.inputs.TARGET = [1, [10, 'project.search']];
    actor.blocks.await.inputs.SIDE = [1, [10, 'bottom']];
    actor.blocks.await.inputs.MESSAGE = [1, [10, 'Gitとデバッガを使ってみよう']];
    stage.variables.debugSteps = ['Debug steps', 0];
    stage.broadcasts.debug = 'guide:debug';
    const block = (opcode: string, next: string | null, parent: string | null, inputs = {}, fields = {}) =>
        ({opcode, next, parent, inputs, fields, shadow: false, topLevel: parent === null});
    stage.blocks.debug = {...block('event_whenbroadcastreceived', 'breakpoint', null, {},
        {BROADCAST_OPTION: ['guide:debug', 'debug']}), x: 350, y: 50};
    stage.blocks.breakpoint = {...block('procedures_call', 'step', 'debug'), mutation: {
        tagName: 'mutation', children: [], proccode: breakpoint, argumentids: '[]', warp: 'false'}};
    stage.blocks.step = block('data_changevariableby', null, 'breakpoint', {VALUE: [1, [4, '1']]},
        {VARIABLE: ['Debug steps', 'debugSteps']});
    await fs.mkdir(path.join(folder, 'assets'));
    for (const [name, bytes] of Object.entries(files)) {
        if (name !== 'project.json') await fs.writeFile(path.join(folder, 'assets', name), bytes);
    }
    await fs.writeFile(path.join(folder, 'project.source.json'), JSON.stringify(project, null, 2) + '\n');
    await fs.writeFile(path.join(folder, 'embedded-extensions.json'), JSON.stringify({formatVersion: 1, extensions: []}));
    await fs.writeFile(path.join(folder, 'sb3-source.json'), JSON.stringify({formatVersion: 1, project: 'project.source.json',
        embeddedExtensions: 'embedded-extensions.json', assetsDirectory: 'assets', archiveEntries: Object.keys(files)}));
    await fs.writeFile(path.join(folder, '.gitignore'), '.tw-plus/\n');
    await fs.writeFile(path.join(folder, 'notes.txt'), 'Unrelated baseline\n');
    const git = (...args: string[]) => execFileSync('git', ['--no-optional-locks', ...args], {cwd: folder, encoding: 'utf8'}).trim();
    git('init', '-q', '-b', 'main');
    git('config', 'user.name', 'Guide coexistence fixture');
    git('config', 'user.email', 'guide-fixture@example.invalid');
    git('config', 'core.autocrlf', 'false');
    git('config', 'core.hooksPath', '/dev/null');
    git('config', 'commit.gpgSign', 'false');
    git('add', '.'); git('commit', '-qm', 'Guide fixture'); git('branch', 'other');
    assert.equal(git('remote'), '');
    return {folder, git};
}

async function preparePicker(context: BrowserContext) {
    await context.addInitScript(() => {
        for (const type of ['dragenter', 'dragover', 'drop']) {
            window.addEventListener(type, async event => {
                event.preventDefault(); event.stopImmediatePropagation();
                if (type === 'drop') {
                    const item = (event as DragEvent).dataTransfer!.items[0] as DataTransferItem & {
                        getAsFileSystemHandle(): Promise<FileSystemDirectoryHandle>};
                    (window as any).guideDirectory = await item.getAsFileSystemHandle();
                }
            }, {capture: true});
        }
        (window as any).showDirectoryPicker = async () => (window as any).guideDirectory;
    });
}
async function openFolder(original: Page, folder: string) {
    console.log('Coexistence: opening project folder');
    await original.getByText('File', {exact: true}).click();
    const opening = original.context().waitForEvent('page');
    await original.getByRole('button', {name: 'Open Folder…', exact: true}).click();
    const page = await opening;
    console.log('Coexistence: folder editor opened', page.url());
    const choose = page.getByRole('dialog').getByRole('button', {name: 'Choose a folder', exact: true});
    await expect(choose).toBeVisible();
    const cdp = await page.context().newCDPSession(page);
    try {
        for (const type of ['dragEnter', 'dragOver', 'drop'] as const) {
            // Browser-only delivery of a directory handle; no OS picker, cursor or focus change.
            await cdp.send('Input.dispatchDragEvent', {type, x: 100, y: 100,
                data: {items: [], files: [folder], dragOperationsMask: 1}});
        }
    } finally {await cdp.detach();}
    await page.waitForFunction(() => (window as any).guideDirectory?.kind === 'directory');
    await choose.click();
    console.log('Coexistence: selected fixture directory');
    await expect(page.locator('[data-project-folder-status]')).toHaveText('Project folder opened.');
    await expect(page.getByRole('button', {name: 'Branch: main', exact: true})).toBeVisible();
    await original.close();
    return page;
}

async function clock(page: Page) {
    return page.evaluate(() => (window as any).vm.runtime.getTargetForStage().variables.clock.value as number);
}
async function sampleTicks(page: Page, ticks = 6) {
    return page.evaluate(ticks => new Promise<number>(resolve => {
        const runtime = (window as any).vm.runtime;
        const sample = () => {if (--ticks <= 0) {runtime.off('AFTER_EXECUTE', sample); resolve(runtime.getTargetForStage().variables.clock.value);}};
        runtime.on('AFTER_EXECUTE', sample);
    }), ticks);
}
async function assertGuideWaiting(page: Page) {
    await expect(page.locator('[data-tw-guide-sprite]')).toBeVisible();
    await expect(page.locator('[data-tw-guide-speech]')).toHaveText('Gitとデバッガを使ってみよう');
    assert.equal(await page.evaluate(() => (window as any).vm.runtime.getTargetForStage().variables.result.value), 'idle');
    assert.equal(await page.getByRole('link', {name: '次の教材へ'}).count(), 0);
}

for (const compiled of [false, true]) {
const mode = compiled ? 'compiled' : 'interpreter';
test(`Guide coexists with the real debugger and local Git (${mode})`, {timeout: 90000}, async t => {
    const {folder, git} = await repositoryFixture();
    const initial = git('rev-parse', 'HEAD');
    const {page: original, installLesson} = await openGuideEditor(t, {locale: 'en', debuggerEnabled: true, beforeLoad: preparePicker});
    const page = await openFolder(original, folder);
    page.setDefaultTimeout(8000);
    const errors: string[] = [];
    page.on('pageerror', error => {errors.push(error.message); console.log('Coexistence browser error:', error.message);});
    await installLesson(page);
    console.log('Coexistence: paper runtime installed');
    await page.waitForFunction(code => Boolean((window as any).vm.runtime.getAddonBlock(code)), breakpoint);
    await page.evaluate(compiled => {
        const vm = (window as any).vm;
        vm.setCompilerOptions({enabled: compiled});
        (window as any).guideDebug = {paused: false, pauses: 0, resumes: 0};
        vm.runtime.on('RUNTIME_PAUSED', () => {const p = (window as any).guideDebug; p.paused = true; p.pauses++;});
        vm.runtime.on('RUNTIME_UNPAUSED', () => {const p = (window as any).guideDebug; p.paused = false; p.resumes++;});
        vm.runtime.startHats('event_whenbroadcastreceived', {BROADCAST_OPTION: 'guide:pulse'});
        void (window as any).guideLesson.start();
    }, compiled);
    await assertGuideWaiting(page);
    console.log('Coexistence: guide is waiting');
    assert.equal(await page.evaluate(() => (window as any).vm.runtime.threads.some((thread: any) => thread.isCompiled)), compiled);
    await page.evaluate(() => (window as any).vm.runtime.startHats('event_whenbroadcastreceived', {BROADCAST_OPTION: 'guide:debug'}));
    await page.waitForFunction(() => (window as any).guideDebug.paused);
    console.log('Coexistence: breakpoint reached');
    const debug = page.locator('.sa-debugger-interface');
    await expect(debug).toBeVisible();
    await debug.getByText('Threads', {exact: true}).click();
    await expect(debug.locator('.sa-debugger-thread-target-name').filter({hasText: '案内役'})).toBeVisible();
    const pausedClock = await clock(page);
    assert.equal(await sampleTicks(page), pausedClock);
    await assertGuideWaiting(page);
    for (let count = 0; !compiled && count < 4; count++) {
        const value = await page.evaluate(() => (window as any).vm.runtime.getTargetForStage().variables.debugSteps.value);
        if (value === 1) break;
        await debug.getByText('Step', {exact: true}).click();
    }
    assert.equal(await page.evaluate(() => (window as any).vm.runtime.getTargetForStage().variables.debugSteps.value), compiled ? 0 : 1);
    await assertGuideWaiting(page);
    await page.screenshot({path: `.host/guide-debugger-${mode}.png`});
    console.log('Coexistence: debugger inspection completed');
    await debug.locator('.sa-debugger-unpause').click();
    await page.waitForFunction(value => !(window as any).guideDebug.paused &&
        (window as any).vm.runtime.getTargetForStage().variables.clock.value > value, pausedClock);
    await page.getByRole('button', {name: 'Close Debugger', exact: true}).click();
    await assertGuideWaiting(page);

    await page.evaluate(() => {const vm = (window as any).vm; vm.setEditingTarget(vm.runtime.getTargetForStage().id);});
    await page.waitForFunction(() => Boolean((window as any).ScratchBlocks.getMainWorkspace().getBlockById('practice-number')));
    await page.evaluate(() => (window as any).ScratchBlocks.getMainWorkspace().getBlockById('practice-number').setFieldValue('0.7', 'NUM'));
    await page.waitForFunction(() => (window as any).vm.runtime.getTargetForStage().blocks.getBlock('practice-number').fields.NUM.value === '0.7');
    await page.getByRole('button', {name: 'Branch: main', exact: true}).click();
    await page.getByRole('menuitem', {name: 'Open Local Git', exact: true}).click();
    const panel = page.locator('.twgit-panel:not(.twgit-connection-dialog)');
    await expect(panel).toBeVisible();
    console.log('Coexistence: Git panel opened');
    const saveTask = panel.getByRole('button', {name: 'Save files', exact: true});
    if (await saveTask.getAttribute('aria-expanded') !== 'true') await saveTask.click();
    const unsaved = panel.getByRole('region', {name: 'Save files', exact: true});
    await unsaved.getByRole('button', {name: 'project.source.json', exact: true}).click();
    await expect(unsaved.locator('.twgit-save-diff')).toContainText('HEAD → Unsaved edits');
    await assertGuideWaiting(page);
    const beforeSave = await clock(page);
    await unsaved.getByRole('button', {name: 'Save unsaved files', exact: true}).click();
    await expect(saveTask.locator('.twgit-count')).toHaveText('0');
    console.log('Coexistence: project saved');
    const saved = JSON.parse(await fs.readFile(path.join(folder, 'project.source.json'), 'utf8'));
    assert.equal(practiceDuration(saved), '0.7');
    assert.equal(saved.targets[1].visible, true);
    console.log('Coexistence: saved snapshot verified', await clock(page), beforeSave);
    await page.waitForFunction(value => (window as any).vm.runtime.getTargetForStage().variables.clock.value > value, beforeSave,
        {timeout: 3000});
    console.log('Coexistence: runtime continued after saving');
    const commitTask = panel.getByRole('button', {name: 'Commit saved changes', exact: true});
    if (await commitTask.getAttribute('aria-expanded') !== 'true') await commitTask.click();
    console.log('Coexistence: saved changes selected');
    const savedPane = panel.getByRole('region', {name: 'Commit saved changes', exact: true});
    await panel.getByRole('region', {name: 'Changes by project element'}).getByText('List by file', {exact: true}).click();
    await savedPane.getByRole('button', {name: /^project\.source\.json/}).click();
    await savedPane.getByRole('button', {name: 'Text', exact: true}).click();
    await expect(savedPane.locator('.twgit-diff .diff')).toContainText('0.7');
    await assertGuideWaiting(page);
    await fs.writeFile(path.join(folder, 'notes.txt'), 'Unrelated staged edit\n');
    git('add', 'notes.txt');
    await savedPane.getByRole('checkbox', {name: 'Include in commit: project.source.json', exact: true}).check();
    await savedPane.getByLabel('Commit message').fill('Record an edit while Guide waits');
    await savedPane.getByRole('button', {name: 'Commit', exact: true}).click();
    await expect(panel.getByText('Recorded the changes (commit).', {exact: true})).toBeVisible();
    assert.notEqual(git('rev-parse', 'HEAD'), initial);
    assert.equal(git('diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD'), 'project.source.json');
    assert.equal(git('diff', '--cached', '--name-only'), 'notes.txt');
    assert.equal(git('show', 'HEAD:notes.txt'), 'Unrelated baseline');
    assert.equal(practiceDuration(JSON.parse(git('show', 'HEAD:project.source.json'))), '0.7');
    await assertGuideWaiting(page);
    await page.screenshot({path: `.host/guide-git-${mode}.png`});

    await page.getByRole('button', {name: 'Branch: main', exact: true}).click();
    await page.getByRole('menuitemradio', {name: 'other', exact: true}).click();
    await expect(page.locator('[data-git-snackbar]').getByRole('alert')).toHaveText(
        'Stop the project, and save or record (or undo) every change, before switching branches.');
    assert.equal(git('branch', '--show-current'), 'main');
    await assertGuideWaiting(page);
    await page.keyboard.press('Escape');
    if (compiled) {
        await page.keyboard.press('Alt+x');
        await page.waitForFunction(() => (window as any).guideDebug.paused);
        await assertGuideWaiting(page);
    }
    // A trusted operation completes the same scene after Git and debugging, without restarting it.
    await page.getByRole('combobox', {name: 'Search project', exact: true}).click();
    await expect(page.locator('[data-tw-guide-sprite]')).toHaveCount(0);
    if (compiled) {
        const stoppedClock = await clock(page);
        assert.equal(await sampleTicks(page), stoppedClock);
        assert.equal(await page.evaluate(() => (window as any).vm.runtime.getTargetForStage().variables.result.value), 'idle');
        assert.equal(await page.getByRole('link', {name: '次の教材へ'}).count(), 0);
        await page.keyboard.press('Alt+x');
        await page.waitForFunction(() => !(window as any).guideDebug.paused);
    }
    await expect(page.getByRole('link', {name: '次の教材へ'})).toBeVisible();
    assert.equal(await page.evaluate(() => (window as any).guideLesson.completions), 1);
    git('fsck', '--no-progress');
    assert.deepEqual(errors, []);
    await fs.writeFile(`.host/guide-coexistence-${mode}-result.json`, JSON.stringify({folder, commit: git('rev-parse', 'HEAD'),
        initial, remote: git('remote'), mode, stepped: !compiled,
        debugger: await page.evaluate(() => (window as any).guideDebug)}, null, 2) + '\n');
});
}
