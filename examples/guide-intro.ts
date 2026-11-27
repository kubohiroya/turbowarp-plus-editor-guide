// SPDX-License-Identifier: MPL-2.0
import {createHash} from 'node:crypto';
import {zipSync, unzipSync, strToU8} from 'fflate';
import {GUIDE_EXTENSION_ID} from '../src/extension.ts';
export function createGuideIntroProject(chapter = 1) {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="360"><rect width="480" height="360" fill="#edf1ff"/><text x="45" y="170" font-size="28">Guide: click the code workspace</text></svg>';
    const hash = createHash('md5').update(svg).digest('hex');
    const block = (opcode: string, next: string | null, parent: string | null, inputs = {}, fields = {}, topLevel = false) =>
        ({opcode, next, parent, inputs, fields, topLevel, shadow: false, ...(topLevel ? {x: 35, y: 45} : {})});
    const project = {targets: [{isStage: true, name: 'Stage', variables: {result: ['案内結果', 'idle'], clock: ['時計', 0], chapter: ['章', chapter]},
        lists: {}, broadcasts: {lesson: 'guide:workspace', pulse: 'guide:pulse'}, blocks: {
            lesson: block('event_whenbroadcastreceived', 'save', null, {}, {BROADCAST_OPTION: ['guide:workspace', 'lesson']}, true),
            save: block('data_setvariableto', null, 'lesson', {VALUE: [3, 'await', [10, '']]}, {VARIABLE: ['案内結果', 'result']}),
            await: block(GUIDE_EXTENSION_ID + '_showAndWait', null, 'save', {
                TARGET: [1, [10, 'code.workspace']], MESSAGE: [1, [10, 'コードの画面を押してね']], ACTION: [1, [10, 'click']]}),
            pulse: {...block('event_whenbroadcastreceived', 'forever', null, {}, {BROADCAST_OPTION: ['guide:pulse', 'pulse']}, true), y: 280},
            forever: block('control_forever', null, 'pulse', {SUBSTACK: [2, 'increment']}),
            increment: block('data_changevariableby', 'rest', 'forever', {VALUE: [1, [4, '1']]}, {VARIABLE: ['時計', 'clock']}),
            rest: block('control_wait', null, 'increment', {DURATION: [1, [4, '0.02']]})
        }, comments: {}, currentCostume: 0, costumes: [{assetId: hash, name: 'Guide', md5ext: hash + '.svg',
            dataFormat: 'svg', rotationCenterX: 240, rotationCenterY: 180}], sounds: [], volume: 100, layerOrder: 0,
        tempo: 60, videoTransparency: 50, videoState: 'on', textToSpeechLanguage: null}],
        monitors: [], extensions: [GUIDE_EXTENSION_ID], meta: {semver: '3.0.0', vm: '0.2.0', agent: 'Guide #724'}};
    return zipSync({'project.json': strToU8(JSON.stringify(project)), [hash + '.svg']: strToU8(svg)});
}

/** An original SVG actor calls Guide from a paper-story broadcast receiver. */
export function createGuideSpriteProject(chapter = 1) {
    const files = unzipSync(createGuideIntroProject(chapter));
    const project = JSON.parse(new TextDecoder().decode(files['project.json']));
    const stage = project.targets[0];
    const actorBlocks = Object.fromEntries(['lesson', 'save', 'await'].map(id => [id, stage.blocks[id]]));
    for (const id of Object.keys(actorBlocks)) delete stage.blocks[id];
    actorBlocks.await.opcode = GUIDE_EXTENSION_ID + '_spriteAndWait';
    actorBlocks.await.inputs.SIDE = [1, [10, 'center']];
    actorBlocks.await.inputs.MESSAGE = [1, [10, '編集や保存を試してからコードの画面を押してね']];
    stage.blocks.practice = {opcode: 'control_wait', next: null, parent: null, inputs: {DURATION: [1, 'practice-number']},
        fields: {}, topLevel: true, shadow: false, x: 30, y: 50};
    stage.blocks['practice-number'] = {opcode: 'math_positive_number', next: null, parent: 'practice', inputs: {},
        fields: {NUM: ['0.5', null]}, topLevel: false, shadow: true};
    const costumes = ['#f36c47', '#465de8'].map((color, index) => {
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="100"><path d="M40 0 L80 100 L0 100 Z" fill="${color}"/><circle cx="25" cy="60" r="5" fill="white"/><circle cx="55" cy="60" r="5" fill="white"/></svg>`;
        const assetId = createHash('md5').update(svg).digest('hex');
        files[assetId + '.svg'] = strToU8(svg);
        return {assetId, name: 'Guide ' + index, md5ext: assetId + '.svg', dataFormat: 'svg', rotationCenterX: 40, rotationCenterY: 50};
    });
    project.targets.push({isStage: false, name: '案内役', variables: {}, lists: {}, broadcasts: {}, blocks: actorBlocks,
        comments: {}, currentCostume: 0, costumes, sounds: [], volume: 100, layerOrder: 1, visible: true,
        x: 0, y: 0, size: 100, direction: 90, draggable: false, rotationStyle: 'all around'});
    files['project.json'] = strToU8(JSON.stringify(project));
    return zipSync(files);
}
