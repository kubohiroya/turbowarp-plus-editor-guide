// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import {JSDOM} from 'jsdom';
import {buildNextLessonUrl, NextLessonButton, parseNextFeatures} from '../src/next.ts';
import {createGuideExtensionClass} from '../src/extension.ts';
const editor = 'https://kubohiroya.github.io/turbowarp-plus-editor/editor.html';
test('the next URL keeps the current Editor, its language and enabled features, and only adds features', () => {
    const built = buildNextLessonUrl(`${editor}?locale=ja&twPlusLocalGit=1&project_url=https%3A%2F%2Fa.example%2F1.sb3#123`,
        {projectUrl: 'https://b.example/lessons/2.sb3', features: 'twPlusWorkspaceMinimap, twPlusLocalGit=1'});
    assert.ok('url' in built);
    const url = new URL(built.url);
    assert.equal(url.origin + url.pathname, editor);
    assert.equal(url.hash, '');
    assert.equal(url.searchParams.get('project_url'), 'https://b.example/lessons/2.sb3');
    assert.equal(url.searchParams.get('locale'), 'ja');
    assert.equal(url.searchParams.get('twPlusLocalGit'), '1');
    assert.equal(url.searchParams.get('twPlusWorkspaceMinimap'), '1');
    assert.equal(url.searchParams.getAll('project_url').length, 1);
});
test('a relative project resolves against the Editor page and the locale is filled only when absent', () => {
    const relative = buildNextLessonUrl(`${editor}?lang=en`, {projectUrl: 'lessons/2.sb3', locale: 'ja'});
    assert.ok('url' in relative);
    const url = new URL(relative.url);
    assert.equal(url.searchParams.get('project_url'), 'https://kubohiroya.github.io/turbowarp-plus-editor/lessons/2.sb3');
    assert.equal(url.searchParams.get('lang'), 'en');
    assert.equal(url.searchParams.has('locale'), false);
    const filled = buildNextLessonUrl(editor, {projectUrl: 'https://b.example/2.sb3', locale: 'ja'});
    assert.ok('url' in filled);
    assert.equal(new URL(filled.url).searchParams.get('locale'), 'ja');
});
test('insecure, credentialed and malformed projects or features are refused', () => {
    const refuse = (projectUrl: string, features = '') => {
        const built = buildNextLessonUrl(editor, {projectUrl, features});
        return 'reason' in built ? built.reason : 'accepted';
    };
    assert.equal(refuse('http://b.example/2.sb3'), 'insecure-project-url');
    assert.equal(refuse('javascript:alert(1)'), 'insecure-project-url');
    assert.equal(refuse('data:application/zip;base64,AA'), 'insecure-project-url');
    assert.equal(refuse('https://user:pass@b.example/2.sb3'), 'invalid-project-url');
    assert.equal(refuse('   '), 'invalid-project-url');
    assert.equal(refuse('https://b.example/2.sb3', 'twPlusLocalGit=0'), 'invalid-feature');
    assert.equal(refuse('https://b.example/2.sb3', 'project_url=x'), 'invalid-feature');
    assert.equal(refuse('https://b.example/2.sb3', 'twplusLower'), 'invalid-feature');
    assert.equal(buildNextLessonUrl('http://127.0.0.1:8080/editor.html',
        {projectUrl: 'http://localhost:9000/2.sb3'}).hasOwnProperty('url'), true);
    assert.deepEqual(parseNextFeatures(' twPlusA twPlusA,twPlusB '), ['twPlusA', 'twPlusB']);
});
test('the button is a text-only link that is replaced, hidden and reported through the Scratch blocks', t => {
    const dom = new JSDOM('<body></body>', {url: `${editor}?locale=ja`});
    t.after(() => dom.window.close());
    const button = new NextLessonButton(dom.window.document);
    const Extension = createGuideExtensionClass(() => null, () => 'ja', () => undefined, () => null, () => button);
    const extension = new Extension();
    assert.equal(extension.nextStatus(), 'not-requested');
    extension.offerNext({PROJECT: 'https://b.example/2.sb3', LABEL: '<b>つぎへ</b>', FEATURES: 'twPlusWorkspaceMinimap'});
    const links = dom.window.document.querySelectorAll('a[data-tw-guide-next]');
    assert.equal(links.length, 1);
    assert.equal(links[0]!.textContent, '<b>つぎへ</b>');
    assert.equal(links[0]!.querySelector('b'), null);
    assert.equal(new URL((links[0] as HTMLAnchorElement).href).searchParams.get('twPlusWorkspaceMinimap'), '1');
    assert.equal(extension.nextStatus(), 'shown');
    extension.offerNext({PROJECT: 'https://b.example/3.sb3', LABEL: ''});
    assert.equal(dom.window.document.querySelectorAll('a[data-tw-guide-next]').length, 1);
    assert.equal(button.current?.textContent, '次の教材へ');
    extension.offerNext({PROJECT: 'http://b.example/3.sb3'});
    assert.equal(button.current, null);
    assert.equal(extension.nextStatus(), 'insecure-project-url');
    extension.offerNext({PROJECT: 'https://b.example/3.sb3'});
    extension.hide();
    assert.equal(dom.window.document.querySelector('a[data-tw-guide-next]'), null);
    const detached = new (createGuideExtensionClass(() => null))();
    detached.offerNext({PROJECT: 'https://b.example/3.sb3'});
    assert.equal(detached.nextStatus(), 'not-attached');
});
