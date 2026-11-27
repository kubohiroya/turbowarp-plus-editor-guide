// SPDX-License-Identifier: MPL-2.0
import type {Guide, GuideResult} from './core.js';

export type SpriteSide = 'left' | 'right' | 'top' | 'bottom' | 'center';
export interface SpriteTargetPort {
    id: string; isStage?: boolean; drawableID: number; visible: boolean;
    x?: number; y?: number; size?: number; direction?: number; rotationStyle?: string;
    currentCostume?: number; effects?: Record<string, number>;
    getName?(): string;
    getCostumes?(): Array<{asset?: {assetId?: string}; md5ext?: string}>;
}
export interface SpriteRendererPort {
    canvas: HTMLCanvasElement;
    getNativeSize?(): number[];
    getBounds(id: number): {left: number; right: number; top: number; bottom: number};
    extractDrawableScreenSpace(id: number): {imageData: ImageData};
    updateDrawableVisible(id: number, visible: boolean): void;
}
export interface SpriteRuntimePort {
    targets?: readonly SpriteTargetPort[];
    renderer?: SpriteRendererPort;
    requestRedraw?(): void;
}
export interface SpriteLease {id: number; spriteId: string}
export interface SpritePlaceOptions {side?: SpriteSide; offsetX?: number; offsetY?: number; message?: string;
    signal?: AbortSignal; onLost?(reason: string): void}
interface Binding {
    lease: SpriteLease; target: SpriteTargetPort; element: HTMLElement; anchorId: string;
    canvas: HTMLCanvasElement; context: CanvasRenderingContext2D; bubble: HTMLDivElement;
    side: SpriteSide; offsetX: number; offsetY: number; originX: number; originY: number;
    signature: string; width: number; height: number; suppressed: boolean; started: number;
    settle?: (result: GuideResult) => void;
    onLost?: (reason: string) => void; removeAbort?: () => void;
}
export function spritePosition(rect: {left: number; top: number; right: number; bottom: number},
    width: number, height: number, side: SpriteSide, viewport: {width: number; height: number}, dx = 0, dy = 0) {
    const gap = 12;
    let x = (rect.left + rect.right - width) / 2;
    let y = (rect.top + rect.bottom - height) / 2;
    if (side === 'left') x = rect.left - width - gap;
    if (side === 'right') x = rect.right + gap;
    if (side === 'top') y = rect.top - height - gap;
    if (side === 'bottom') y = rect.bottom + gap;
    if (side === 'left' && x < 0 && rect.right + gap + width <= viewport.width) x = rect.right + gap;
    if (side === 'right' && x + width > viewport.width && rect.left - gap - width >= 0) x = rect.left - gap - width;
    if (side === 'top' && y < 0 && rect.bottom + gap + height <= viewport.height) y = rect.bottom + gap;
    if (side === 'bottom' && y + height > viewport.height && rect.top - gap - height >= 0) y = rect.top - gap - height;
    return {x: Math.max(0, Math.min(Math.max(0, viewport.width - width), x + dx)),
        y: Math.max(0, Math.min(Math.max(0, viewport.height - height), y + dy))};
}

/** The VM still runs the actor; only its presentation destination changes during a lease. */
export class GuideSprites {
    private bindings = new Map<number, Binding>();
    private serial = 0;
    private frame: number | null = null;
    private disposed = false;
    private root: HTMLDivElement | null = null;
    private result: GuideResult | null = null;
    private readonly guide: Guide;
    private readonly runtime: SpriteRuntimePort;
    private readonly document: Document;
    constructor(guide: Guide, runtime: SpriteRuntimePort) {
        this.guide = guide; this.runtime = runtime; this.document = guide.document;
    }
    lastResult() {return this.result;}
    private record(status: GuideResult['status'], targetId: string, reason: string): GuideResult {
        return this.result = {status, targetId, reason};
    }
    async place(spriteId: string, anchorId: string, options: SpritePlaceOptions = {}):
        Promise<{lease: SpriteLease; result: GuideResult} | {result: GuideResult}> {
        if (this.disposed) return {result: this.record('unavailable', anchorId, 'disposed')};
        if (options.signal?.aborted) return {result: this.record('cancelled', anchorId, 'aborted')};
        const renderer = this.runtime.renderer;
        if (!renderer?.extractDrawableScreenSpace || !renderer.getBounds || !renderer.updateDrawableVisible) {
            return {result: this.record('unavailable', anchorId, 'sprite-renderer-unavailable')};
        }
        const anchor = this.guide.resolveTarget(anchorId);
        if (!('element' in anchor)) return {result: this.record('unavailable', anchorId, anchor.reason)};
        const matches = this.runtime.targets?.filter(target => target.id === spriteId && !target.isStage) || [];
        if (matches.length !== 1) return {result: this.record('unavailable', anchorId, 'sprite-unavailable')};
        const side = options.side ?? 'right';
        if (!['left', 'right', 'top', 'bottom', 'center'].includes(side) ||
            ![options.offsetX ?? 0, options.offsetY ?? 0].every(Number.isFinite) ||
            (options.message !== undefined && (typeof options.message !== 'string' || options.message.length > 4096))) {
            return {result: this.record('unavailable', anchorId, 'invalid-sprite-placement')};
        }
        const target = matches[0]!;
        for (const binding of [...this.bindings.values()]) {
            if (binding.target === target) this.release(binding.lease, 'superseded');
        }
        const canvas = this.document.createElement('canvas');
        const context = canvas.getContext('2d');
        if (!context) return {result: this.record('unavailable', anchorId, 'sprite-surface-unavailable')};
        if (!this.root) {
            this.root = this.document.createElement('div');
            this.root.dataset.twGuideSprites = 'true';
            this.root.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147482995;';
            this.document.body.appendChild(this.root);
        }
        canvas.dataset.twGuideSprite = target.id;
        canvas.setAttribute('role', 'img');
        canvas.setAttribute('aria-label', target.getName?.() || target.id);
        canvas.style.cssText = 'position:fixed;pointer-events:none;display:none;';
        this.root.appendChild(canvas);
        const bubble = this.document.createElement('div');
        bubble.dataset.twGuideSpeech = target.id;
        bubble.setAttribute('role', 'status');
        bubble.style.cssText = 'position:fixed;display:none;pointer-events:none;box-sizing:border-box;max-width:min(300px,100vw);max-height:40vh;overflow:auto;padding:12px 16px;border:2px solid #6852b8;border-radius:18px;background:white;color:#222;font:16px/1.5 sans-serif;white-space:pre-wrap;overflow-wrap:anywhere;';
        bubble.textContent = options.message || '';
        this.root.appendChild(bubble);
        const lease = {id: ++this.serial, spriteId: target.id};
        const binding: Binding = {lease, target, element: anchor.element, anchorId, canvas, context, bubble, side,
            offsetX: options.offsetX ?? 0, offsetY: options.offsetY ?? 0, originX: target.x ?? 0, originY: target.y ?? 0,
            signature: '', width: 0, height: 0, suppressed: false, started: this.document.defaultView!.performance.now(), onLost: options.onLost};
        const pending = new Promise<GuideResult>(resolve => {binding.settle = resolve;});
        this.bindings.set(lease.id, binding);
        if (options.signal) {
            const abort = () => this.release(lease, 'aborted');
            options.signal.addEventListener('abort', abort, {once: true});
            binding.removeAbort = () => options.signal!.removeEventListener('abort', abort);
        }
        this.update(binding);
        this.schedule();
        const result = await pending;
        return result.status === 'completed' && this.bindings.has(lease.id) ? {lease, result} : {result};
    }
    private signature(target: SpriteTargetPort) {
        const costume = target.getCostumes?.()[target.currentCostume || 0];
        return JSON.stringify([target.currentCostume, costume?.asset?.assetId, costume?.md5ext,
            target.size, target.direction, target.rotationStyle, target.effects]);
    }
    private update(binding: Binding) {
        const {target, canvas} = binding;
        if (!this.runtime.targets?.includes(target)) {this.release(binding.lease, 'sprite-removed'); return;}
        const anchor = this.guide.resolveTarget(binding.anchorId);
        if (!('element' in anchor) || anchor.element !== binding.element) {
            this.release(binding.lease, 'anchor-unavailable'); return;
        }
        const renderer = this.runtime.renderer;
        if (!renderer) {this.release(binding.lease, 'sprite-renderer-unavailable'); return;}
        const signature = this.signature(target);
        try {
            if (!binding.suppressed || signature !== binding.signature) {
                // Extraction uses its own framebuffer. Never mutate the VM's visible property.
                renderer.updateDrawableVisible(target.drawableID, true);
                const bounds = renderer.getBounds(target.drawableID);
                const {imageData} = renderer.extractDrawableScreenSpace(target.drawableID);
                const scale = renderer.canvas.width / (renderer.getNativeSize?.()[0] || 0);
                const width = Number.isFinite(scale) && scale > 0 ? imageData.width / scale : bounds.right - bounds.left;
                const height = Number.isFinite(scale) && scale > 0 ? imageData.height / scale : bounds.top - bounds.bottom;
                if (!imageData.width || !imageData.height || !Number.isFinite(width + height) || width <= 0 || height <= 0) {
                    throw new Error('Sprite pixels are not ready');
                }
                canvas.width = imageData.width; canvas.height = imageData.height;
                binding.context.putImageData(imageData, 0, 0);
                binding.width = width; binding.height = height;
                binding.signature = signature; binding.suppressed = true;
                canvas.style.width = width + 'px'; canvas.style.height = height + 'px';
                this.runtime.requestRedraw?.();
                binding.settle?.(this.record('completed', binding.anchorId, 'sprite-presented'));
                binding.settle = undefined;
            }
        } catch {
            if (!binding.suppressed && this.document.defaultView!.performance.now() - binding.started > 1500) {
                this.release(binding.lease, 'sprite-pixels-unavailable'); return;
            }
        } finally {
            renderer.updateDrawableVisible(target.drawableID, binding.suppressed ? false : target.visible);
        }
        if (!binding.suppressed) return;
        const view = this.document.defaultView!;
        const position = spritePosition(binding.element.getBoundingClientRect(), binding.width, binding.height, binding.side,
            {width: view.innerWidth, height: view.innerHeight},
            binding.offsetX + (target.x ?? 0) - binding.originX, binding.offsetY - (target.y ?? 0) + binding.originY);
        canvas.style.left = position.x + 'px'; canvas.style.top = position.y + 'px';
        canvas.style.opacity = String(Math.max(0, Math.min(1, 1 - (target.effects?.ghost || 0) / 100)));
        canvas.style.display = target.visible ? 'block' : 'none';
        const bubble = binding.bubble;
        bubble.style.display = target.visible && bubble.textContent ? 'block' : 'none';
        if (bubble.style.display !== 'none') {
            const box = bubble.getBoundingClientRect();
            const speech = spritePosition({left: position.x, right: position.x + binding.width,
                top: position.y, bottom: position.y + binding.height}, box.width, box.height, 'top',
            {width: view.innerWidth, height: view.innerHeight});
            bubble.style.left = speech.x + 'px'; bubble.style.top = speech.y + 'px';
        }
    }
    /** Suppress the native presentation again after normal VM blocks update the drawable. */
    afterExecute = () => {
        for (const binding of [...this.bindings.values()]) this.update(binding);
    };
    private schedule() {
        if (this.disposed || !this.bindings.size || this.frame !== null) return;
        this.frame = this.document.defaultView!.requestAnimationFrame(() => {
            this.frame = null;
            for (const binding of [...this.bindings.values()]) this.update(binding);
            this.schedule();
        });
    }
    release(lease: SpriteLease, reason = 'sprite-returned') {
        const binding = this.bindings.get(lease.id);
        if (!binding || binding.lease !== lease) return;
        this.bindings.delete(lease.id);
        binding.canvas.remove(); binding.bubble.remove(); binding.removeAbort?.();
        if (binding.suppressed && this.runtime.targets?.includes(binding.target)) {
            this.runtime.renderer?.updateDrawableVisible(binding.target.drawableID, binding.target.visible);
            this.runtime.requestRedraw?.();
        }
        binding.settle?.(this.record('unavailable', binding.anchorId, reason));
        binding.onLost?.(reason);
        if (!this.bindings.size) {
            if (this.frame !== null) this.document.defaultView!.cancelAnimationFrame(this.frame);
            this.frame = null; this.root?.remove(); this.root = null;
        }
    }
    hideAll(reason = 'hidden') {for (const binding of [...this.bindings.values()]) this.release(binding.lease, reason);}
    dispose() {if (this.disposed) return; this.disposed = true; this.hideAll('disposed');}
}
