// SPDX-License-Identifier: MPL-2.0
import React, {useLayoutEffect, useState} from 'react';
import ReactDOM from 'react-dom';
import {Joyride, type EventData} from 'react-joyride';
import {Guide, type GuideTarget} from './core.js';
import {createGuideExtensionClass, GUIDE_EXTENSION_ID} from './extension.js';
import {GuideSprites, type SpriteRuntimePort} from './sprites.js';
import {NextLessonButton} from './next.js';
export interface EventPort {on?(event: string, listener: (...args: unknown[]) => void): unknown;
    isActiveThread?(thread: unknown): boolean;
    off?(event: string, listener: (...args: unknown[]) => void): unknown;
    removeListener?(event: string, listener: (...args: unknown[]) => void): unknown}
export interface GuideVm extends EventPort {
    runtime?: EventPort & SpriteRuntimePort;
    extensionManager?: {
        addBuiltinExtension(id: string, extension: ReturnType<typeof createGuideExtensionClass>): void;
        isExtensionLoaded(id: string): boolean;
        loadExtensionURL(id: string): Promise<unknown>;
        refreshBlocks?(id: string): Promise<unknown>;
    };
}
interface WorkspacePort {getInjectionDiv?(): HTMLElement; addChangeListener?(listener: (event: {type?: string; isUiEvent?: boolean}) => void): void;
    removeChangeListener?(listener: (event: {type?: string; isUiEvent?: boolean}) => void): void}
export interface EditorGuideOptions {
    vm: GuideVm;
    document: Document;
    locale?: string;
    targets?: readonly GuideTarget[];
    getBlockly?: () => Promise<{getMainWorkspace?(): WorkspacePort}>;
    onError?: (error: unknown) => void;
}
interface Bridge {guide: Guide | null; sprites: GuideSprites | null; next: NextLessonButton | null; locale: string}
const bridges = new WeakMap<object, Bridge>();
function bridgeFor(vm: GuideVm): Bridge | null {
    const manager = vm.extensionManager;
    if (!manager?.addBuiltinExtension) return null;
    let bridge = bridges.get(vm);
    if (!bridge) {
        bridge = {guide: null, sprites: null, next: null, locale: 'en'};
        const owned = bridge;
        manager.addBuiltinExtension(GUIDE_EXTENSION_ID, createGuideExtensionClass(() => owned.guide, () => owned.locale,
            () => vm.runtime, () => owned.sprites, () => owned.next));
        bridges.set(vm, bridge);
    }
    return bridge;
}
/** Register before project loading; rendering attaches later through the workspace port. */
export function installGuideExtension(vm: GuideVm): boolean {return Boolean(bridgeFor(vm));}
export function GuideView({guide, locale = 'en'}: {guide: Guide; locale?: string}) {
    const [snapshot, setSnapshot] = useState(guide.snapshot);
    useLayoutEffect(() => guide.subscribe(() => setSnapshot(guide.snapshot())), [guide]);
    useLayoutEffect(() => {
        if (!snapshot) return;
        const element = snapshot.element;
        const previousOutline = element.style.outline;
        const previousOffset = element.style.outlineOffset;
        element.style.outline = '3px solid #6852b8';
        element.style.outlineOffset = '-3px';
        const applied = element.style.outline;
        return () => {
            if (element.style.outline === applied) element.style.outline = previousOutline;
            if (element.style.outlineOffset === '-3px') element.style.outlineOffset = previousOffset;
        };
    }, [snapshot?.generation]);
    if (!snapshot || !snapshot.presentation) return null;
    const ja = locale.startsWith('ja');
    const bounds = snapshot.element.getBoundingClientRect();
    const view = guide.document.defaultView!;
    // A workspace can fill the viewport, leaving no room for an anchored tooltip on either side.
    const placement = bounds.width > view.innerWidth * 0.6 && bounds.height > view.innerHeight * 0.6 ? 'center' : 'auto';
    const onEvent = (event: EventData) => {
        if (event.type === 'error:target_not_found' || event.type === 'error') {
            guide.failPresentation(snapshot.generation, 'renderer-target-unavailable');
        } else if (event.action === 'close' || event.action === 'skip') {
            guide.cancelPresentation(snapshot.generation, 'closed');
        }
    };
    return <Joyride key={snapshot.generation} run steps={[{target: snapshot.element, content: snapshot.message,
        placement, skipScroll: placement === 'center', hideOverlay: placement === 'center'}]}
        portalElement={guide.document.body} onEvent={onEvent}
        options={{skipBeacon: true, blockTargetInteraction: false, disableFocusTrap: true, buttons: ['close'],
            overlayClickAction: false, dismissKeyAction: 'close', scrollDuration: 0, targetWaitTimeout: 0, zIndex: 2147483000}}
        locale={{close: ja ? '案内を閉じる' : 'Close guide'}} />;
}
/** Own GUI target matching here; callers only provide public DOM and Blockly ports. */
export function editorTargets(document: Document, getWorkspace: () => WorkspacePort | undefined): GuideTarget[] {
    return [
        {id: 'editor.greenFlag', label: '緑の旗 / Green flag',
            resolve: () => [...document.querySelectorAll('[data-testid="green-flag"], img[class*="green-flag_green-flag"]')]},
        {id: 'sprite.list', label: 'スプライト一覧 / Sprites',
            resolve: () => [...document.querySelectorAll('[class*="sprite-selector_items-wrapper"]')]},
        {id: 'project.search', label: '作品全体の検索 / Project search',
            resolve: () => [...document.querySelectorAll('input[aria-label="作品全体を検索"], input[aria-label="Search project"]')]},
        {id: 'code.find', label: 'コードの検索 / Find in code',
            resolve: () => [...document.querySelectorAll('input.sa-find-input')]},
        {id: 'code.workspace', label: 'コード / Code', events: ['workspace.changed'],
            resolve: () => getWorkspace()?.getInjectionDiv?.() || null}
    ];
}
export function attachEditorGuide({vm, document, locale = 'en', targets, getBlockly, onError}: EditorGuideOptions) {
    const manager = vm.extensionManager;
    if (!manager?.addBuiltinExtension || !document?.body) {
        return {guide: null, ready: Promise.resolve(false), dispose() {}};
    }
    const bridge = bridgeFor(vm)!;
    if (bridge.guide) throw new Error('Guide is already attached to this VM');
    const guide = new Guide(document);
    const sprites = new GuideSprites(guide, vm.runtime || {});
    const next = new NextLessonButton(document);
    bridge.guide = guide; bridge.sprites = sprites; bridge.next = next; bridge.locale = locale;
    const container = document.createElement('div');
    container.dataset.twEditorGuide = 'true';
    document.body.appendChild(container);
    let workspace: WorkspacePort | undefined;
    let disposed = false;
    const disposals: Array<() => void> = [];
    try {
        for (const target of targets || editorTargets(document, () => workspace)) disposals.push(guide.register(target));
        ReactDOM.render(<GuideView guide={guide} locale={locale} />, container);
    } catch (error) {
        guide.dispose(); sprites.dispose(); next.hide();
        for (const cleanup of disposals.reverse()) cleanup();
        ReactDOM.unmountComponentAtNode(container);
        container.remove(); bridge.guide = null; bridge.sprites = null; bridge.next = null;
        throw error;
    }
    for (const port of new Set([vm, vm.runtime])) {
        if (!port?.on || !(port.off || port.removeListener)) continue;
        for (const event of ['PROJECT_STOP_ALL', 'PROJECT_LOADED', 'RUNTIME_DISPOSED']) {
            const cancel = () => {
                const reason = event === 'PROJECT_STOP_ALL' ? 'stopped' : 'project-changed';
                guide.hide(reason); sprites.hideAll(reason); next.hide();
            };
            port.on(event, cancel);
            disposals.push(() => (port.off || port.removeListener)?.call(port, event, cancel));
        }
    }
    const runtime = vm.runtime;
    if (runtime?.on && (runtime.off || runtime.removeListener)) {
        runtime.on('AFTER_EXECUTE', sprites.afterExecute);
        disposals.push(() => (runtime.off || runtime.removeListener)!.call(runtime, 'AFTER_EXECUTE', sprites.afterExecute));
    }
    const dispose = () => {
        if (disposed) return;
        disposed = true;
        guide.dispose(); sprites.dispose(); next.hide();
        for (const cleanup of disposals.splice(0).reverse()) cleanup();
        ReactDOM.unmountComponentAtNode(container);
        container.remove();
        if (bridge!.guide === guide) {bridge!.guide = null; bridge!.sprites = null; bridge!.next = null;}
    };
    const ready = (async () => {
        try {
            if (!manager.isExtensionLoaded(GUIDE_EXTENSION_ID)) await manager.loadExtensionURL(GUIDE_EXTENSION_ID);
            else await manager.refreshBlocks?.(GUIDE_EXTENSION_ID);
            if (getBlockly) {
                const blocks = await getBlockly();
                if (!disposed) {
                    workspace = blocks.getMainWorkspace?.();
                    const current = workspace;
                    const changed = (event: {type?: string; isUiEvent?: boolean}) => {
                        if (!event.isUiEvent && ['change', 'create', 'delete', 'move'].includes(event.type || '')) {
                            guide.notify('code.workspace', 'workspace.changed');
                        }
                    };
                    if (current?.addChangeListener && current.removeChangeListener) {
                        current.addChangeListener(changed);
                        disposals.push(() => current.removeChangeListener?.(changed));
                    }
                }
            }
            return !disposed;
        } catch (error) {dispose(); onError?.(error); return false;}
    })();
    return {guide, sprites, ready, dispose};
}
