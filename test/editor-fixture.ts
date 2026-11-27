// SPDX-License-Identifier: MPL-2.0
import {createTurboWarpBroadcastPort} from '@kubohiroya/turbowarp-runtime-adapter';
import {createDsl4RuntimeController} from 'guide-test-app-controller';
declare const __GUIDE_STORY__: Record<string, unknown>;
const vm = (window as any).vm;
const broadcast = createTurboWarpBroadcastPort({runtime: vm.runtime});
const next = document.createElement('a');
next.textContent = '次の教材へ';
next.hidden = true;
const target = new URL(location.href);
target.searchParams.set('twPlusWorkspaceMinimap', '1');
target.searchParams.set('project_url', new URL('guide-next.sb3', location.href).href);
next.href = target.href;
next.style.cssText = 'position:fixed;right:30px;bottom:30px;z-index:2147483100;padding:15px;background:white';
document.body.appendChild(next);
const controller = createDsl4RuntimeController({
    storyDocument: __GUIDE_STORY__, broadcastMessageAndWaitEnabled: true,
    port: {
        broadcastMessageAndWait: (payload: {message: string}, context: {signal: AbortSignal}) =>
            broadcast.broadcastMessageAndWait(payload, context),
        wait: async () => {if (vm.runtime.getTargetForStage().variables.result.value === 'completed') next.hidden = false;}
    }
});
Object.assign(window, {guideLesson: {controller, broadcast, next, start: () => {
    next.hidden = true;
    vm.runtime.getTargetForStage().variables.result.value = 'idle';
    return controller.start();
}}});
