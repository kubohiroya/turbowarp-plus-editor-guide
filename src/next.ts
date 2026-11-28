// SPDX-License-Identifier: MPL-2.0
/**
 * The next-lesson button. A project names the next SB3 and the startup features it adds;
 * the Editor URL itself is built here from the current page, so a project cannot choose
 * another site, drop features the learner already has, or navigate without a click.
 */
export type NextLessonUrl = {url: string} | {reason: string};
export interface NextLessonOptions {projectUrl: string; features?: string; label?: string; locale?: string}
export type NextLessonResult = {status: 'shown'; url: string} | {status: 'unavailable'; reason: string};

const featureName = /^twPlus[A-Z][A-Za-z0-9]{0,63}$/;
const loopback = new Set(['localhost', '127.0.0.1', '[::1]']);
const LABEL_LIMIT = 40;

/** Parse "twPlusA twPlusB=1" (spaces or commas). Features are only ever switched on. */
export function parseNextFeatures(value: string): string[] | {reason: string} {
    const names: string[] = [];
    for (const token of value.split(/[\s,]+/).filter(Boolean)) {
        const [name, setting, extra] = token.split('=');
        if (extra !== undefined || !featureName.test(name!) || (setting !== undefined && setting !== '1')) {
            return {reason: 'invalid-feature'};
        }
        if (!names.includes(name!)) names.push(name!);
    }
    return names;
}

/** Build the next Editor URL on the current Editor page, keeping its language and enabled features. */
export function buildNextLessonUrl(current: string, {projectUrl, features = '', locale}: NextLessonOptions): NextLessonUrl {
    let page: URL;
    let project: URL;
    try {
        page = new URL(current);
        project = new URL(projectUrl.trim(), page);
    } catch {return {reason: 'invalid-project-url'};}
    if (!projectUrl.trim()) return {reason: 'invalid-project-url'};
    if (project.username || project.password) return {reason: 'invalid-project-url'};
    const sameOrigin = project.origin === page.origin;
    const secure = project.protocol === 'https:' || (project.protocol === 'http:' && loopback.has(project.hostname));
    if (!sameOrigin && !secure) return {reason: 'insecure-project-url'};
    const parsed = parseNextFeatures(features);
    if (!Array.isArray(parsed)) return parsed;
    const next = new URL(page.href);
    next.hash = '';
    next.searchParams.set('project_url', project.href);
    for (const name of parsed) next.searchParams.set(name, '1');
    if (!next.searchParams.has('locale') && !next.searchParams.has('lang') && locale) next.searchParams.set('locale', locale);
    return {url: next.href};
}

/** One button per document; it is removed on stop, project change, hide and dispose. */
export class NextLessonButton {
    private element: HTMLAnchorElement | null = null;
    private readonly document: Document;
    constructor(document: Document) {this.document = document;}
    get current(): HTMLAnchorElement | null {return this.element;}
    show(options: NextLessonOptions): NextLessonResult {
        this.hide();
        const view = this.document.defaultView;
        if (!view || !this.document.body) return {status: 'unavailable', reason: 'no-document'};
        const built = buildNextLessonUrl(view.location.href, options);
        if ('reason' in built) return {status: 'unavailable', reason: built.reason};
        const ja = (options.locale || 'en').startsWith('ja');
        const label = (options.label || '').trim().slice(0, LABEL_LIMIT) || (ja ? '次の教材へ' : 'Next lesson');
        const link = this.document.createElement('a');
        link.dataset.twGuideNext = 'true';
        link.href = built.url;
        // Text only; a project never supplies markup.
        link.textContent = label;
        link.style.cssText = 'position:fixed;right:24px;bottom:24px;z-index:2147483001;padding:14px 22px;' +
            'border-radius:999px;background:#6852b8;color:#fff;font:bold 18px/1.2 system-ui,sans-serif;' +
            'text-decoration:none;box-shadow:0 4px 14px rgba(0,0,0,.25)';
        this.document.body.appendChild(link);
        this.element = link;
        return {status: 'shown', url: built.url};
    }
    hide(): void {
        this.element?.remove();
        this.element = null;
    }
}
