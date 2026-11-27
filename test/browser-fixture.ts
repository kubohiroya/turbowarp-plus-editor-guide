// SPDX-License-Identifier: MPL-2.0
import {attachEditorGuide, installGuideExtension} from '../src/host.js';
import type {GuideVm} from '../src/host.js';
const listeners = new Map<string, Set<() => void>>();
const loaded = new Map<string, unknown>();
let registrations = 0;
let blockListener: ((event: {type: string}) => void) | undefined;
let extensionClass: new () => unknown;
const vm: GuideVm = {
    on(event, callback) {let set = listeners.get(event); if (!set) listeners.set(event, set = new Set()); set.add(callback);},
    off(event, callback) {listeners.get(event)?.delete(callback);},
    extensionManager: {
        addBuiltinExtension(_id, Extension) {registrations++; extensionClass = Extension;},
        isExtensionLoaded(id) {return loaded.has(id);},
        async loadExtensionURL(id) {loaded.set(id, new extensionClass());}
    }
};
vm.runtime = vm;
installGuideExtension(vm);
function attach() {
    return attachEditorGuide({vm, document, locale: 'ja', getBlockly: async () => ({getMainWorkspace: () => ({
        getInjectionDiv: () => document.querySelector('#workspace') as HTMLElement,
        addChangeListener(listener) {blockListener = listener;},
        removeChangeListener(listener) {if (blockListener === listener) blockListener = undefined;}
    })})});
}
let attachment = attach();
Object.assign(window, {fixture: {
    get attachment() {return attachment;},
    get extension() {return [...loaded.values()][0];},
    get registrations() {return registrations;},
    get listenerCount() {return [...listeners.values()].reduce((n, s) => n + s.size, 0);},
    emit(event: string) {for (const callback of [...(listeners.get(event) || [])]) callback();},
    changeWorkspace() {blockListener?.({type: 'change'});},
    reattach() {attachment.dispose(); attachment = attach();}
}});
