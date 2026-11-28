// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import {createGuideIntroProject, createGuideSpriteProject} from '../examples/guide-intro.ts';
import {unzipSync} from 'fflate';
import {openGuideEditor} from './editor-harness.ts';

test('a paper-story sprite speaks outside the Stage while real Editor editing and saving continue', {timeout: 120000}, async t => {
    const {page, installLesson} = await openGuideEditor(t);
    const project = Buffer.from(createGuideSpriteProject()).toString('base64');
    await page.evaluate(async data => {await (window as any).vm.loadProject(Uint8Array.from(atob(data), c => c.charCodeAt(0)));}, project);
    await page.waitForFunction(() => Boolean((window as any).vm.runtime._primitives['kubohiroyaeditorguide_showAndWait']));
    await installLesson();
    await page.evaluate(() => {
        const vm = (window as any).vm;
        vm.runtime.startHats('event_whenbroadcastreceived', {BROADCAST_OPTION: 'guide:pulse'});
        void (window as any).guideLesson.start();
    });
    const sprite = page.locator('[data-tw-guide-sprite]');
    const speech = page.locator('[data-tw-guide-speech]');
    await sprite.waitFor({state: 'visible'});
    await page.waitForFunction(() => {
        const content = document.querySelector('[data-tw-guide-speech]');
        const actor = document.querySelector('[data-tw-guide-sprite]');
        if (!content || !actor) return false;
        return [content, actor].every(element => {
            const box = element.getBoundingClientRect();
            return box.top >= 0 && box.left >= 0 && box.right <= innerWidth && box.bottom <= innerHeight;
        });
    }, undefined, {timeout: 3000});
    assert.match(await speech.textContent() || '', /編集や保存を試して/);
    const position = await sprite.boundingBox(); assert.ok(position && position.x < 1000);
    const stageBounds = await page.evaluate(() => {
        const box = (window as any).vm.runtime.renderer.canvas.getBoundingClientRect();
        return {left: box.left, right: box.right, top: box.top, bottom: box.bottom};
    });
    assert.ok(position.x + position.width <= stageBounds.left || position.x >= stageBounds.right ||
        position.y + position.height <= stageBounds.top || position.y >= stageBounds.bottom,
    JSON.stringify({position, stageBounds}));
    const pixels = await sprite.evaluate((e: HTMLCanvasElement) => [...e.getContext('2d')!.getImageData(e.width / 2, e.height * 0.8, 1, 1).data]);
    assert.ok(pixels[0]! > 200 && pixels[3]! > 200, JSON.stringify(pixels));
    await page.screenshot({path: '.host/guide-editor.png'});
    const before = await page.evaluate(() => (window as any).vm.runtime.getTargetForStage().variables.clock.value);
    await page.waitForFunction(value => (window as any).vm.runtime.getTargetForStage().variables.clock.value > value, before);
    assert.equal(await page.getByRole('link', {name: '次の教材へ'}).count(), 0);
    // Edit an idle script through the actual Blockly API while the Guide receiver is waiting.
    await page.evaluate(() => {
        const vm = (window as any).vm; vm.setEditingTarget(vm.runtime.getTargetForStage().id);
    });
    await page.waitForFunction(() => Boolean((window as any).ScratchBlocks.getMainWorkspace().getBlockById('practice-number')));
    await page.evaluate(() => {
        const block = (window as any).ScratchBlocks.getMainWorkspace().getBlockById('practice-number');
        if (!block) throw new Error('Practice block missing');
        block.setFieldValue('0.7', 'NUM');
    });
    await page.waitForFunction(() => (window as any).vm.runtime.getTargetForStage().blocks.getBlock('practice-number').fields.NUM.value === '0.7');
    const saved = await page.evaluate(async () => [...new Uint8Array(await (await (window as any).vm.saveProjectSb3()).arrayBuffer())]);
    const savedFiles = unzipSync(Uint8Array.from(saved));
    const savedProject = JSON.parse(new TextDecoder().decode(savedFiles['project.json']));
    await fs.writeFile('.host/guide-saved-edit.sb3', Uint8Array.from(saved));
    // SB3 serialization may inline number shadows and compress IDs; check the saved script by its structure.
    const savedStage = savedProject.targets.find((target: any) => target.isStage);
    const practice: any = Object.values(savedStage.blocks).find((block: any) => block.opcode === 'control_wait' && block.topLevel);
    assert.ok(practice);
    const duration = practice.inputs.DURATION[1];
    assert.equal(Array.isArray(duration) ? duration[1] : savedStage.blocks[duration].fields.NUM[0], '0.7');
    assert.equal(savedProject.targets[1].visible, true);
    assert.ok(savedFiles[savedProject.targets[1].costumes[0].md5ext]);
    assert.equal(await sprite.count(), 1);
    assert.equal(await page.evaluate(() => (window as any).vm.runtime.getTargetForStage().variables.result.value), 'idle');
    // Costume, size and motion remain owned by the running VM.
    await page.evaluate(() => {
        const actor = (window as any).vm.runtime.targets.find((t: any) => !t.isStage);
        actor.setCostume(1); actor.setSize(70); actor.setXY(15, -10);
    });
    await page.waitForFunction(() => {
        const e = document.querySelector('[data-tw-guide-sprite]') as HTMLCanvasElement;
        const pixel = e?.getContext('2d')?.getImageData(e.width / 2, e.height * 0.8, 1, 1).data;
        return pixel && pixel[2] > 180 && parseFloat(e.style.width) < 70;
    });
    await page.locator('.blocklySvg').filter({visible: true}).first().click({position: {x: 600, y: 160}});
    await page.getByRole('link', {name: '次の教材へ'}).waitFor();
    assert.equal(await page.evaluate(() => (window as any).vm.runtime.getTargetForStage().variables.result.value), 'completed');
    const next = new URL(await page.getByRole('link', {name: '次の教材へ'}).getAttribute('href') as string);
    assert.equal(next.searchParams.get('twPlusWorkspaceMinimap'), '1');
    assert.equal(next.searchParams.get('locale'), 'ja');
    await page.evaluate(() => {void (window as any).guideLesson.start();});
    await sprite.waitFor({state: 'visible'});
    await page.evaluate(() => (window as any).guideLesson.controller.stop('cancelled'));
    await sprite.waitFor({state: 'detached'});
    await speech.waitFor({state: 'detached'});
    assert.equal(await page.evaluate(() => (window as any).guideLesson.controller.getState().status), 'stopped');
    const afterCancel = await page.evaluate(() => (window as any).vm.runtime.getTargetForStage().variables.clock.value);
    await page.waitForFunction(value => (window as any).vm.runtime.getTargetForStage().variables.clock.value > value, afterCancel);
    await page.evaluate(() => {void (window as any).guideLesson.start();});
    await sprite.waitFor({state: 'visible'});
    await page.locator('.blocklySvg').filter({visible: true}).first().click({position: {x: 600, y: 160}});
    await page.getByRole('link', {name: '次の教材へ'}).click();
    await page.waitForFunction(() => (window as any).vm?.runtime?.getTargetForStage()?.variables.chapter?.value === 2);
    assert.equal(new URL(page.url()).searchParams.get('twPlusWorkspaceMinimap'), '1');
    assert.equal(new URL(page.url()).searchParams.get('locale'), 'ja');
    await fs.writeFile('.host/guide-intro.sb3', createGuideSpriteProject());
    await fs.writeFile('.host/guide-next.sb3', createGuideIntroProject(2));
});
