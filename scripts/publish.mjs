import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const uploadEndpoint = 'https://node.windy.com/plugins/v1.0/upload';
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

export async function prepareRelease(root, repository) {
    const match = /^https:\/\/github\.com\/([\w-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(repository || '');
    if (!match) throw new Error('Set WINDY_REPOSITORY to the pseudonymous GitHub repository HTTPS URL.');
    const git = args => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    let commitSha;
    try { commitSha = git(['rev-parse', 'HEAD']); }
    catch { throw new Error('Commit the plugin source in its release Git repository before publishing.'); }
    if (git(['status', '--porcelain'])) throw new Error('Commit the current source changes before publishing.');

    const config = JSON.parse(await readFile(join(root, 'dist/plugin.json'), 'utf8'));
    const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
    if (config.name !== pkg.name || config.version !== pkg.version) throw new Error('Package and built plugin versions must match.');
    if (config.private !== false) throw new Error('This deployment process expects public distribution (private: false).');
    if (!/^screenshot\.(jpg|png|webp|jpeg)$/.test(config.screenshot || '')) {
        throw new Error('Public releases require a gallery screenshot in src/screenshot.jpg (or png, webp, jpeg).');
    }
    const repositoryName = `https://github.com/${match[1]}/${match[2]}`;
    const manifest = { ...config, repositoryName, repositoryOwner: match[1], commitSha };
    const stage = await mkdtemp(join(tmpdir(), 'ggr-plugin-'));
    const archive = join(root, 'dist/plugin.tar');
    const minified = await readFile(join(root, 'dist/plugin.min.js'));
    try {
        await writeFile(join(stage, 'plugin.js'), await readFile(join(root, 'dist/plugin.js')));
        await writeFile(join(stage, 'plugin.min.js'), minified);
        await writeFile(join(stage, 'plugin.json'), JSON.stringify(manifest, null, 2) + '\n');
        await writeFile(join(stage, config.screenshot), await readFile(join(root, 'dist', config.screenshot)));
        const ownership = process.platform === 'darwin'
            ? ['--uid', '0', '--gid', '0', '--uname', '', '--gname', '']
            : ['--owner=0', '--group=0', '--numeric-owner'];
        execFileSync('tar', ['--format=ustar', ...ownership, '-cf', archive, 'plugin.js', 'plugin.min.js', 'plugin.json', config.screenshot],
            { cwd: stage, env: { ...process.env, COPYFILE_DISABLE: '1' }, stdio: 'pipe' });
    } finally {
        await rm(stage, { recursive: true, force: true });
    }
    return { archive, name: config.name, version: config.version, repositoryName, commitSha, sha256: sha256(minified) };
}

export async function uploadRelease(release, key, request = fetch) {
    if (!key?.trim()) throw new Error('Set WINDY_API_KEY to a Windy Plugins API key.');
    const form = new FormData();
    form.append('plugin_archive', new Blob([await readFile(release.archive)], { type: 'application/x-tar' }), 'plugin.tar');
    const response = await request(uploadEndpoint, { method: 'POST', headers: { 'x-windy-api-key': key.trim() },
        body: form, redirect: 'error', signal: AbortSignal.timeout(60000) });
    const receipt = (await response.text()).replaceAll(key.trim(), '[redacted]');
    if (!response.ok) throw new Error(`Windy upload failed (HTTP ${response.status}): ${receipt.slice(0, 2000)}`);
    const urls = receipt.replaceAll('\\/', '/').match(/https:\/\/windy-plugins\.com\/[^\s"'<>]+/g) || [];
    const url = urls.find(value => new URL(value).pathname.endsWith(`/${release.name}/${release.version}/plugin.min.js`));
    if (!url) throw new Error(`Upload accepted; obtain the hosted plugin URL from Windy's response: ${receipt.slice(0, 2000)}`);
    const hosted = await request(url, { signal: AbortSignal.timeout(30000) });
    if (!hosted.ok || sha256(Buffer.from(await hosted.arrayBuffer())) !== release.sha256) {
        throw new Error(`Upload accepted, but hosted-bundle verification failed: ${url}`);
    }
    return { version: release.version, commitSha: release.commitSha, repository: release.repositoryName,
        url, sha256: release.sha256, publishedAt: new Date().toISOString() };
}

async function main() {
    const root = fileURLToPath(new URL('../', import.meta.url));
    const envFile = join(root, '.windy-publish.env');
    if (existsSync(envFile)) process.loadEnvFile(envFile);
    const prepareOnly = process.argv.includes('--prepare');
    if (!prepareOnly && !process.env.WINDY_API_KEY?.trim()) throw new Error('Set WINDY_API_KEY in .windy-publish.env before deploying.');
    const release = await prepareRelease(root, process.env.WINDY_REPOSITORY);
    console.log(`Prepared ${release.name} ${release.version}: ${release.archive}`);
    if (prepareOnly) return;
    const receipt = await uploadRelease(release, process.env.WINDY_API_KEY);
    await writeFile(join(root, 'dist/publish-result.json'), JSON.stringify(receipt, null, 2) + '\n');
    console.log(`Published and verified: ${receipt.url}`);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
    main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
