import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareRelease, uploadRelease } from '../scripts/publish.mjs';

async function project(t) {
    const root = await mkdtemp(join(tmpdir(), 'ggr-publish-test-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    await mkdir(join(root, 'dist'));
    const config = { name: 'windy-plugin-ggr2026', version: '0.3.2', private: true, author: 'GGR tracker' };
    await writeFile(join(root, 'package.json'), JSON.stringify(config));
    await writeFile(join(root, 'source.js'), 'export const release = true;\n');
    await writeFile(join(root, '.gitignore'), 'dist/\n.windy-publish.env\n');
    await writeFile(join(root, '.windy-publish.env'), 'WINDY_API_KEY=TEST_PRIVATE_KEY_NEVER_PACKAGE\n');
    await writeFile(join(root, 'dist/plugin.json'), JSON.stringify(config));
    await writeFile(join(root, 'dist/plugin.js'), 'export default "plugin";\n');
    await writeFile(join(root, 'dist/plugin.min.js'), 'export default"plugin";');
    const git = args => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    git(['init', '--quiet']); git(['add', '.']);
    git(['-c', 'user.name=Release Test', '-c', 'user.email=release-test@example.invalid', 'commit', '--quiet', '-m', 'Test release']);
    return { root, config, git };
}

function unpack(bytes) {
    const entries = [];
    for (let at = 0; at < bytes.length && bytes[at] !== 0;) {
        const header = bytes.subarray(at, at + 512);
        const string = (from, length) => header.subarray(from, from + length).toString().replace(/\0.*$/s, '');
        const size = parseInt(string(124, 12), 8);
        entries.push({ name: string(0, 100), uid: parseInt(string(108, 8), 8), gid: parseInt(string(116, 8), 8),
            user: string(265, 32), group: string(297, 32), body: bytes.subarray(at + 512, at + 512 + size) });
        at += 512 + Math.ceil(size / 512) * 512;
    }
    return entries;
}

test('release archive contains only plugin files, real Git metadata and neutral ownership', async t => {
    const { root, git } = await project(t);
    const release = await prepareRelease(root, 'https://github.com/anonymous-sailor/ggr-plugin.git');
    const bytes = await readFile(release.archive);
    const entries = unpack(bytes);
    assert.deepEqual(entries.map(entry => entry.name), ['plugin.js', 'plugin.min.js', 'plugin.json']);
    assert.ok(entries.every(entry => entry.uid === 0 && entry.gid === 0 && !entry.user && !entry.group));
    assert.ok(!bytes.includes(Buffer.from('TEST_PRIVATE_KEY_NEVER_PACKAGE')));
    const config = JSON.parse(entries[2].body);
    assert.equal(config.repositoryOwner, 'anonymous-sailor');
    assert.equal(config.repositoryName, 'https://github.com/anonymous-sailor/ggr-plugin');
    assert.equal(config.commitSha, git(['rev-parse', 'HEAD']));
    assert.equal(config.private, true);
});

test('publishing refuses uncommitted source, mismatched versions and missing repository metadata', async t => {
    const { root, config } = await project(t);
    const repo = 'https://github.com/anonymous-sailor/ggr-plugin';
    await assert.rejects(prepareRelease(root, ''), /WINDY_REPOSITORY/);
    await writeFile(join(root, 'dist/plugin.json'), JSON.stringify({ ...config, version: '0.3.3' }));
    await assert.rejects(prepareRelease(root, repo), /versions must match/);
    await writeFile(join(root, 'source.js'), 'uncommitted change');
    await assert.rejects(prepareRelease(root, repo), /Commit the current source/);
});

test('upload sends the key only to the official endpoint and verifies the hosted bytes', async t => {
    const { root } = await project(t);
    const release = await prepareRelease(root, 'https://github.com/anonymous-sailor/ggr-plugin');
    const url = 'https://windy-plugins.com/42/windy-plugin-ggr2026/0.3.2/plugin.min.js';
    const key = 'TEST_PLUGIN_KEY';
    let requests = 0;
    const request = async (target, options) => {
        if (requests++ === 0) {
            assert.equal(target, 'https://node.windy.com/plugins/v1.0/upload');
            assert.deepEqual(options.headers, { 'x-windy-api-key': key });
            assert.equal(options.redirect, 'error');
            assert.equal(options.body.get('plugin_archive').name, 'plugin.tar');
            return new Response(JSON.stringify({ url }));
        }
        assert.equal(target, url);
        assert.equal(options.headers, undefined);
        return new Response(await readFile(join(root, 'dist/plugin.min.js')));
    };
    const receipt = await uploadRelease(release, key, request);
    assert.equal(requests, 2);
    assert.equal(receipt.url, url);
    assert.ok(!JSON.stringify(receipt).includes(key));
    await assert.rejects(uploadRelease(release, '', request), /WINDY_API_KEY/);
    await assert.rejects(uploadRelease(release, key, async () => new Response(`Invalid key: ${key}`, { status: 401 })),
        error => error.message.includes('HTTP 401') && !error.message.includes(key));
    await assert.rejects(uploadRelease(release, key, async (_, options) =>
        options.method === 'POST' ? new Response(JSON.stringify({ url })) : new Response('modified bundle')),
    /verification failed/);
});
