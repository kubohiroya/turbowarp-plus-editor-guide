// SPDX-License-Identifier: MPL-2.0
export type GuideStatus = 'completed' | 'cancelled' | 'unavailable' | 'timeout';
export interface GuideResult {status: GuideStatus; targetId: string; reason: string}
export type GuideAction = {kind: 'click'} | {kind: 'event'; event: string};
export interface GuideTarget {
    id: string;
    label: string;
    resolve(): Element | readonly Element[] | null;
    events?: readonly string[];
}
export interface GuideSnapshot {generation: number; targetId: string; element: HTMLElement; message: string; waiting: boolean; presentation: boolean}
export interface WaitOptions {signal?: AbortSignal; timeoutMs?: number; presentation?: boolean}
interface Session {snapshot: GuideSnapshot; action?: GuideAction; settle?: (result: GuideResult) => void; cleanup: Array<() => void>}
const validId = (value: unknown): value is string => typeof value === 'string' && /^[a-z][a-zA-Z0-9.-]{0,127}$/.test(value);

/** A project names registered targets; it never supplies selectors or markup. */
export class Guide {
    private targets = new Map<string, GuideTarget>();
    private listeners = new Set<() => void>();
    private session: Session | null = null;
    private generation = 0;
    private disposed = false;
    private result: GuideResult | null = null;
    readonly document: Document;
    constructor(document: Document) {this.document = document;}
    register(target: GuideTarget): () => void {
        if (this.disposed) throw new Error('Guide is disposed');
        if (!validId(target.id) || !target.label || typeof target.resolve !== 'function' ||
            target.events?.some(event => !validId(event))) throw new Error('Invalid guide target');
        if (this.targets.has(target.id)) throw new Error('Duplicate guide target: ' + target.id);
        this.targets.set(target.id, target);
        return () => {
            if (this.targets.get(target.id) !== target) return;
            this.targets.delete(target.id);
            if (this.session?.snapshot.targetId === target.id) this.finish('unavailable', 'unregistered');
        };
    }
    private resolve(id: string): {element: HTMLElement} | {reason: string} {
        const target = this.targets.get(id);
        if (!target) return {reason: 'unknown-target'};
        let candidates: readonly Element[];
        try {
            const found = target.resolve();
            candidates = found === null ? [] : Array.isArray(found) ? found : [found as Element];
        } catch {return {reason: 'resolver-failed'};}
        // Do not choose the first visible candidate when a resolver is ambiguous.
        if (candidates.length !== 1) return {reason: candidates.length ? 'ambiguous-target' : 'missing-target'};
        const element = candidates[0];
        const view = this.document.defaultView;
        if (!view || !(element instanceof view.HTMLElement) || element.ownerDocument !== this.document ||
            !element.isConnected) return {reason: 'missing-target'};
        const style = view.getComputedStyle(element);
        if (element.closest('[hidden], [aria-hidden="true"], [inert]') ||
            !element.getClientRects().length || style.display === 'none' || style.visibility === 'hidden' ||
            style.visibility === 'collapse') return {reason: 'hidden-target'};
        return {element};
    }
    listTargets() {
        return [...this.targets.values()].map(({id, label, events}) => {
            const resolved = this.resolve(id);
            return {id, label, events: [...(events || [])], available: 'element' in resolved,
                reason: 'reason' in resolved ? resolved.reason : ''};
        });
    }
    resolveTarget(id: string): {element: HTMLElement} | {reason: string} {
        return this.disposed ? {reason: 'disposed'} : this.resolve(id);
    }
    snapshot = (): GuideSnapshot | null => this.session?.snapshot || null;
    lastResult = (): GuideResult | null => this.result;
    subscribe = (listener: () => void): (() => void) => {this.listeners.add(listener); return () => {this.listeners.delete(listener);};};
    private emit() {
        // A failing observer must not strand another consumer's pending operation.
        for (const listener of [...this.listeners]) {try {listener();} catch {}}
    }
    private record(status: GuideStatus, targetId: string, reason: string): GuideResult {
        return this.result = {status, targetId, reason};
    }
    private finish(status: GuideStatus, reason: string) {
        const session = this.session;
        if (!session) return;
        this.session = null;
        for (const dispose of session.cleanup) dispose();
        const result = this.record(status, session.snapshot.targetId, reason);
        this.emit();
        session.settle?.(result);
    }
    private prepare(id: string, message: string): {element: HTMLElement} | GuideResult {
        this.finish('cancelled', 'superseded');
        if (this.disposed) return this.record('unavailable', id, 'disposed');
        if (!validId(id) || typeof message !== 'string' || !message.trim() || message.length > 4096) {
            return this.record('unavailable', id, 'invalid-request');
        }
        const resolved = this.resolve(id);
        return 'element' in resolved ? resolved : this.record('unavailable', id, resolved.reason);
    }
    private present(id: string, message: string, element: HTMLElement, action?: GuideAction,
        settle?: (result: GuideResult) => void, options: WaitOptions = {}) {
        const session: Session = {snapshot: {generation: ++this.generation, targetId: id, element, message,
            waiting: Boolean(action), presentation: options.presentation !== false}, action, settle, cleanup: []};
        this.session = session;
        const observer = new this.document.defaultView!.MutationObserver(() => {
            if (this.session !== session) return;
            const current = this.resolve(id);
            if (!('element' in current) || current.element !== element) {
                this.finish('unavailable', 'reason' in current ? current.reason : 'replaced-target');
            }
        });
        observer.observe(this.document.documentElement, {subtree: true, childList: true, attributes: true,
            attributeFilter: ['hidden', 'aria-hidden', 'inert', 'style', 'class']});
        session.cleanup.push(() => observer.disconnect());
        if (action?.kind === 'click') {
            const click = (event: Event) => {
                if (!event.isTrusted || this.session !== session) return;
                const current = this.resolve(id);
                if ('element' in current && current.element === element) this.finish('completed', 'click');
                else this.finish('unavailable', 'target-changed');
            };
            element.addEventListener('click', click, true);
            session.cleanup.push(() => element.removeEventListener('click', click, true));
        }
        if (options.timeoutMs) {
            const timer = setTimeout(() => {if (this.session === session) this.finish('timeout', 'timeout');}, options.timeoutMs);
            session.cleanup.push(() => clearTimeout(timer));
        }
        if (options.signal) {
            const abort = () => {if (this.session === session) this.finish('cancelled', 'aborted');};
            options.signal.addEventListener('abort', abort, {once: true});
            session.cleanup.push(() => options.signal?.removeEventListener('abort', abort));
            if (options.signal.aborted) {abort(); return;}
        }
        this.emit();
    }
    show(id: string, message: string): GuideResult {
        const prepared = this.prepare(id, message);
        if (!('element' in prepared)) return prepared;
        this.present(id, message, prepared.element);
        return this.record('completed', id, 'shown');
    }
    showAndWait(id: string, message: string, action: GuideAction, options: WaitOptions = {}): Promise<GuideResult> {
        const prepared = this.prepare(id, message);
        if (!('element' in prepared)) return Promise.resolve(prepared);
        if (!action || (action.kind !== 'click' && (action.kind !== 'event' || !validId(action.event) ||
            !this.targets.get(id)?.events?.includes(action.event))) ||
            (options.timeoutMs !== undefined && (!Number.isSafeInteger(options.timeoutMs) ||
                options.timeoutMs < 0 || options.timeoutMs > 3600000))) {
            return Promise.resolve(this.record('unavailable', id, 'unsupported-action'));
        }
        return new Promise(resolve => this.present(id, message, prepared.element, action, resolve, options));
    }
    notify(id: string, event: string): boolean {
        const session = this.session;
        if (!session || session.snapshot.targetId !== id || session.action?.kind !== 'event' ||
            session.action.event !== event) return false;
        const current = this.resolve(id);
        if (!('element' in current) || current.element !== session.snapshot.element) {
            this.finish('unavailable', 'target-changed'); return false;
        }
        this.finish('completed', event); return true;
    }
    cancelPresentation(generation: number, reason = 'closed') {
        if (this.session?.snapshot.generation === generation) this.finish('cancelled', reason);
    }
    failPresentation(generation: number, reason: string) {
        if (this.session?.snapshot.generation === generation) this.finish('unavailable', reason);
    }
    hide(reason = 'hidden') {this.finish('cancelled', reason);}
    dispose() {
        if (this.disposed) return;
        this.disposed = true; this.finish('cancelled', 'disposed');
        this.targets.clear(); this.listeners.clear();
    }
}
