// SPDX-License-Identifier: MPL-2.0
import type {Guide} from './core.js';
import type {GuideSprites, SpriteSide, SpriteTargetPort} from './sprites.js';
export const GUIDE_EXTENSION_ID = 'kubohiroyaeditorguide';
type Arguments = {TARGET?: unknown; MESSAGE?: unknown; ACTION?: unknown; SIDE?: unknown};
type Util = {thread?: unknown; target?: SpriteTargetPort};
export interface GuideThreadPort {
    on?(event: string, listener: () => void): unknown;
    off?(event: string, listener: () => void): unknown;
    removeListener?(event: string, listener: () => void): unknown;
    isActiveThread?(thread: unknown): boolean;
}
export function createGuideExtensionClass(getGuide: () => Guide | null, getLocale: () => string = () => 'en',
    getRuntime: () => GuideThreadPort | undefined = () => undefined, getSprites: () => GuideSprites | null = () => null) {
    return class GuideExtension {
        getInfo() {
            const ja = getLocale().startsWith('ja');
            return {id: GUIDE_EXTENSION_ID, name: ja ? 'エディター案内' : 'Editor Guide', color1: '#6852b8',
                blocks: [
                    {opcode: 'show', blockType: 'command', text: ja ? '[TARGET] を案内する [MESSAGE]' : 'guide [TARGET] saying [MESSAGE]',
                        arguments: {TARGET: {type: 'string', menu: 'targets', defaultValue: 'editor.greenFlag'},
                            MESSAGE: {type: 'string', defaultValue: ja ? '緑の旗を押してみよう' : 'Try the green flag'}}},
                    {opcode: 'showAndWait', blockType: 'reporter',
                        text: ja ? '[TARGET] を [MESSAGE] と案内して [ACTION] を待つ' : 'guide [TARGET] saying [MESSAGE] and wait for [ACTION]',
                        arguments: {TARGET: {type: 'string', menu: 'targets', defaultValue: 'editor.greenFlag'},
                            MESSAGE: {type: 'string', defaultValue: ja ? 'ここを押してみよう' : 'Try this control'},
                            ACTION: {type: 'string', defaultValue: 'click'}}},
                    {opcode: 'spriteAndWait', blockType: 'reporter', filter: ['sprite'],
                        text: ja ? 'このスプライトを [TARGET] の [SIDE] に出し [MESSAGE] と話して [ACTION] を待つ' :
                            'guide with this sprite [SIDE] of [TARGET] saying [MESSAGE] and wait for [ACTION]',
                        arguments: {TARGET: {type: 'string', menu: 'targets', defaultValue: 'code.workspace'},
                            SIDE: {type: 'string', menu: 'sides', defaultValue: 'right'},
                            MESSAGE: {type: 'string', defaultValue: ja ? 'コードを変えてみよう' : 'Try editing the code'},
                            ACTION: {type: 'string', defaultValue: 'event:workspace.changed'}}},
                    {opcode: 'hide', blockType: 'command', text: ja ? 'エディター案内を閉じる' : 'hide editor guide'},
                    {opcode: 'result', blockType: 'reporter', text: ja ? '案内の結果' : 'guide result'},
                    {opcode: 'reason', blockType: 'reporter', text: ja ? '案内の結果の理由' : 'guide result reason'},
                    {opcode: 'available', blockType: 'Boolean', text: ja ? '[TARGET] を案内できる' : 'can guide [TARGET]',
                        arguments: {TARGET: {type: 'string', menu: 'targets', defaultValue: 'editor.greenFlag'}}}
                ], menus: {targets: {acceptReporters: true, items: 'getTargets'}, sides: {acceptReporters: true,
                    items: ['left', 'right', 'top', 'bottom', 'center'].map((value, index) =>
                        ({value, text: ja ? ['左', '右', '上', '下', '中央'][index] : value}))}}};
        }
        getTargets() {
            const entries = getGuide()?.listTargets().map(target => ({text: target.label, value: target.id})) || [];
            return entries.length ? entries : [{text: 'Editor', value: 'editor.greenFlag'}];
        }
        show(args: Arguments) {getGuide()?.show(String(args.TARGET ?? ''), String(args.MESSAGE ?? ''));}
        wait(args: Arguments, util?: Util, sprite = false): Promise<string> {
            const guide = getGuide();
            if (!guide) return Promise.resolve('unavailable');
            const action = String(args.ACTION ?? 'click');
            const pending = guide.showAndWait(String(args.TARGET ?? ''), String(args.MESSAGE ?? ''),
                action === 'click' ? {kind: 'click'} : {kind: 'event', event: action.startsWith('event:') ? action.slice(6) : ''},
                {presentation: !sprite});
            const generation = guide.snapshot()?.generation;
            const runtime = getRuntime();
            const thread = util?.thread;
            const stopped = () => {
                if (generation !== undefined && thread && runtime?.isActiveThread?.(thread) === false) {
                    guide.cancelPresentation(generation, 'thread-stopped');
                }
            };
            const observe = generation !== undefined && thread && runtime?.isActiveThread && runtime.on &&
                (runtime.off || runtime.removeListener);
            if (observe) runtime.on!('AFTER_EXECUTE', stopped);
            const abort = new AbortController();
            if (sprite && generation !== undefined) {
                const sprites = getSprites();
                if (!sprites || !util?.target || util.target.isStage) guide.failPresentation(generation, 'sprite-unavailable');
                else void sprites.place(util.target.id, String(args.TARGET ?? ''), {side: String(args.SIDE ?? 'right') as SpriteSide,
                    message: String(args.MESSAGE ?? ''), signal: abort.signal,
                    onLost: reason => guide.failPresentation(generation, reason)}).then(placed => {
                    if (!('lease' in placed)) guide.failPresentation(generation, placed.result.reason);
                }).catch(() => guide.failPresentation(generation, 'sprite-renderer-unavailable'));
            }
            return pending.then(result => result.status).finally(() => {
                abort.abort();
                if (observe) (runtime!.off || runtime!.removeListener)!.call(runtime, 'AFTER_EXECUTE', stopped);
            });
        }
        showAndWait(args: Arguments, util?: Util) {return this.wait(args, util);}
        spriteAndWait(args: Arguments, util?: Util) {return this.wait(args, util, true);}
        hide() {getGuide()?.hide();}
        result() {return getGuide()?.lastResult()?.status || 'unavailable';}
        reason() {return getGuide()?.lastResult()?.reason || 'not-attached';}
        available(args: Arguments) {return getGuide()?.listTargets().some(target => target.id === String(args.TARGET) && target.available) || false;}
    };
}
