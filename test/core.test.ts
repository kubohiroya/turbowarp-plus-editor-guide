// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import test, {type TestContext} from 'node:test';
import {JSDOM} from 'jsdom';
import {Guide} from '../src/core.ts';
import {createGuideExtensionClass, GUIDE_EXTENSION_ID} from '../src/extension.ts';
function fixture(t: TestContext) {
    const dom = new JSDOM('<button id="target">Target</button>', {pretendToBeVisual: true});
    t.after(() => dom.window.close());
    const document = dom.window.document;
    const element = document.querySelector('button')!;
    element.getClientRects = () => [{x: 0, y: 0, width: 100, height: 30}] as unknown as DOMRectList;
    const guide = new Guide(document);
    t.after(() => guide.dispose());
    const unregister = guide.register({id: 'editor.target', label: 'Target', resolve: () => element, events: ['state.changed']});
    return {dom, document, element, guide, unregister};
}
const turn = () => new Promise<void>(resolve => setImmediate(resolve));
test('targets reject duplicate IDs and distinguish missing, hidden and ambiguous candidates', t => {
    const {guide, document, element} = fixture(t);
    assert.throws(() => guide.register({id: 'editor.target', label: 'Duplicate', resolve: () => element}));
    assert.throws(() => guide.register({id: '#css', label: 'Selector', resolve: () => element}));
    guide.register({id: 'missing', label: 'Missing', resolve: () => null});
    guide.register({id: 'ambiguous', label: 'Ambiguous', resolve: () => [element, document.createElement('button')]});
    assert.equal(guide.show('missing', 'Help').reason, 'missing-target');
    assert.equal(guide.show('ambiguous', 'Help').reason, 'ambiguous-target');
    element.hidden = true;
    assert.equal(guide.show('editor.target', 'Help').reason, 'hidden-target');
    assert.equal(guide.show('unknown', 'Help').reason, 'unknown-target');
});
test('only the registered semantic action on the current target completes a wait', async t => {
    const {guide} = fixture(t);
    const pending = guide.showAndWait('editor.target', 'Help', {kind: 'event', event: 'state.changed'});
    assert.equal(guide.notify('other', 'state.changed'), false);
    assert.equal(guide.notify('editor.target', 'clicked'), false);
    assert.equal(guide.snapshot()?.waiting, true);
    assert.equal(guide.notify('editor.target', 'state.changed'), true);
    assert.equal((await pending).status, 'completed');
    assert.equal(guide.notify('editor.target', 'state.changed'), false);
    assert.equal(guide.snapshot(), null);
});
test('human waits have no implicit timeout and can be aborted', async t => {
    const {guide} = fixture(t);
    const abort = new AbortController(); let done = false;
    const pending = guide.showAndWait('editor.target', 'Help', {kind: 'click'}, {signal: abort.signal}).then(x => {done = true; return x;});
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(done, false); abort.abort();
    assert.equal((await pending).reason, 'aborted');
});
test('explicit timeout is distinct from cancellation', async t => {
    const {guide} = fixture(t);
    assert.equal((await guide.showAndWait('editor.target', 'Help', {kind: 'click'}, {timeoutMs: 5})).status, 'timeout');
});
test('a new guide cancels an old wait and stale presentation events cannot close it', async t => {
    const {guide} = fixture(t);
    const pending = guide.showAndWait('editor.target', 'First', {kind: 'click'});
    const old = guide.snapshot()!.generation;
    assert.equal(guide.show('editor.target', 'Second').status, 'completed');
    assert.equal((await pending).reason, 'superseded');
    guide.cancelPresentation(old);
    assert.equal(guide.snapshot()?.message, 'Second');
    guide.hide(); assert.equal(guide.snapshot(), null);
});
test('disappearing targets resolve as unavailable without leaving a wait behind', async t => {
    const {guide, element} = fixture(t);
    const pending = guide.showAndWait('editor.target', 'Help', {kind: 'click'});
    element.remove();
    assert.equal((await pending).status, 'unavailable');
    assert.equal(guide.snapshot(), null);
});
test('hiding a target or unregistering its port settles the active wait', async t => {
    const {guide, element, unregister} = fixture(t);
    let pending = guide.showAndWait('editor.target', 'Help', {kind: 'click'});
    element.hidden = true; assert.equal((await pending).reason, 'hidden-target');
    element.hidden = false;
    pending = guide.showAndWait('editor.target', 'Help', {kind: 'click'});
    unregister(); assert.equal((await pending).reason, 'unregistered');
});
test('synthetic clicks and Joyride presentation do not count as user completion', async t => {
    const {guide, element} = fixture(t);
    let done = false; const pending = guide.showAndWait('editor.target', 'Help', {kind: 'click'}).then(x => {done = true; return x;});
    element.click(); await turn(); assert.equal(done, false);
    guide.hide('closed'); assert.equal((await pending).status, 'cancelled');
});
test('dispose is idempotent, settles pending work and rejects later requests', async t => {
    const {guide} = fixture(t);
    const pending = guide.showAndWait('editor.target', 'Help', {kind: 'click'});
    guide.dispose(); guide.dispose();
    assert.equal((await pending).reason, 'disposed');
    assert.equal(guide.show('editor.target', 'Help').reason, 'disposed');
    assert.deepEqual(guide.listTargets(), []);
});
test('unsupported events and invalid options never start a wait', async t => {
    const {guide} = fixture(t);
    assert.equal((await guide.showAndWait('editor.target', 'Help', {kind: 'event', event: 'unknown'})).status, 'unavailable');
    assert.equal((await guide.showAndWait('editor.target', 'Help', {kind: 'click'}, {timeoutMs: -1})).status, 'unavailable');
    assert.equal(guide.show('editor.target', ' ').reason, 'invalid-request');
    const abort = new AbortController(); abort.abort();
    assert.equal((await guide.showAndWait('editor.target', 'Help', {kind: 'click'}, {signal: abort.signal})).reason, 'aborted');
});
test('an observer exception cannot strand another pending operation', async t => {
    const {guide} = fixture(t);
    guide.subscribe(() => {throw new Error('observer');});
    const pending = guide.showAndWait('editor.target', 'Help', {kind: 'event', event: 'state.changed'});
    guide.notify('editor.target', 'state.changed');
    assert.equal((await pending).status, 'completed');
});
test('Scratch blocks return asynchronous outcomes and use registered IDs', async t => {
    const {guide} = fixture(t); let attached: Guide | null = guide;
    const Extension = createGuideExtensionClass(() => attached, () => 'ja');
    const extension = new Extension();
    assert.equal(extension.getInfo().id, GUIDE_EXTENSION_ID);
    assert.equal(extension.getInfo().name, 'エディター案内');
    assert.equal(extension.available({TARGET: 'editor.target'}), true);
    const result = extension.showAndWait({TARGET: 'editor.target', MESSAGE: '案内', ACTION: 'event:state.changed'});
    guide.notify('editor.target', 'state.changed'); assert.equal(await result, 'completed');
    assert.equal(extension.result(), 'completed');
    attached = null; assert.equal(await extension.showAndWait({}), 'unavailable');
});
test('stopping only the invoking Scratch thread cancels its guide and releases its observer', async t => {
    const {guide} = fixture(t);
    const callbacks = new Set<() => void>(); let active = true;
    const runtime = {on(_event: string, callback: () => void) {callbacks.add(callback);},
        off(_event: string, callback: () => void) {callbacks.delete(callback);}, isActiveThread: () => active};
    const Extension = createGuideExtensionClass(() => guide, () => 'en', () => runtime);
    const pending = new Extension().showAndWait({TARGET: 'editor.target', MESSAGE: 'Wait', ACTION: 'click'}, {thread: {}});
    assert.equal(callbacks.size, 1); active = false;
    for (const callback of callbacks) callback();
    assert.equal(await pending, 'cancelled');
    assert.equal(guide.lastResult()?.reason, 'thread-stopped');
    assert.equal(callbacks.size, 0);
});
