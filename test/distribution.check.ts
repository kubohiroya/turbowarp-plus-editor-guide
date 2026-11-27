// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import {runInNewContext} from 'node:vm';
test('the distribution keeps its exports even when a consumer provides AMD', async () => {
    let amdCalls = 0;
    const define = Object.assign(() => {amdCalls++;}, {amd: true});
    const module = {exports: {}};
    runInNewContext(fs.readFileSync('dist/cjs/host.js', 'utf8'),
        {module, exports: module.exports, require: createRequire(import.meta.url), define, console, process,
            setTimeout, clearTimeout}, {filename: 'guide-host-distribution.js'});
    const exported = module.exports as Record<string, unknown>;
    assert.equal(typeof exported.attachEditorGuide, 'function');
    assert.equal(typeof exported.installGuideExtension, 'function');
    assert.equal(amdCalls, 0);
    const esm = await import(new URL('../dist/host.mjs', import.meta.url).href);
    assert.equal(typeof esm.attachEditorGuide, 'function');
    assert.equal(typeof esm.installGuideExtension, 'function');
});
