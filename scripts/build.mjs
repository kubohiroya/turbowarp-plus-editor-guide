import {build} from 'esbuild';
import {mkdir, readFile, writeFile, rm} from 'node:fs/promises';
await rm('dist', {recursive: true, force: true});
await mkdir('dist', {recursive: true});
for (const format of ['esm', 'cjs']) {
    await build({entryPoints: ['src/index.ts', 'src/host.tsx', 'src/extension.ts'], outdir: format === 'cjs' ? 'dist/cjs' : 'dist', bundle: true,
        platform: 'browser', format, target: 'es2017', external: ['react', 'react-dom'],
        // UMD dependencies are already bundled; consumer webpack must not reinterpret their AMD branches.
        define: {define: 'undefined'},
        outExtension: {'.js': format === 'esm' ? '.mjs' : '.js'}, legalComments: 'linked'});
}
await writeFile('dist/cjs/package.json', '{"type":"commonjs"}\n');
// Bundled CommonJS dependencies must resolve the same peer instances in native ESM too.
const peerBridge = `import guideReact from 'react';\nimport guideReactDOM from 'react-dom';\nconst require = id => {\n    if (id === 'react') return guideReact;\n    if (id === 'react-dom') return guideReactDOM;\n    throw new Error('Unsupported external module: ' + id);\n};\n`;
await writeFile('dist/host.mjs', peerBridge + await readFile('dist/host.mjs', 'utf8'));
const lock = JSON.parse(await readFile('package-lock.json', 'utf8'));
const entries = [];
for (const [directory, item] of Object.entries(lock.packages)) {
    if (!directory || item.dev || item.peer || !directory.startsWith('node_modules/')) continue;
    const name = directory.split('node_modules/').pop();
    for (const file of ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'license', 'license.md']) {
        try {entries.push(`${name}@${item.version}\n${await readFile(`${directory}/${file}`, 'utf8')}`); break;} catch {}
    }
}
await writeFile('THIRD_PARTY_NOTICES.txt', entries.join('\n\n---\n\n'));
