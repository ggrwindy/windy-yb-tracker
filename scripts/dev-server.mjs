import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

const port = Number(process.argv[2] || 9999);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Use a port between 1 and 65535.');
const files = new Map([
    ['/plugin.js', 'text/javascript; charset=utf-8'],
    ['/plugin.min.js', 'text/javascript; charset=utf-8'],
    ['/plugin.json', 'application/json; charset=utf-8'],
]);

const server = createServer(async (request, response) => {
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Cache-Control', 'no-cache');
    if (!['GET', 'HEAD'].includes(request.method)) {
        response.writeHead(405, { Allow: 'GET, HEAD' }).end();
        return;
    }
    const path = new URL(request.url, 'http://localhost').pathname;
    if (!files.has(path)) {
        response.writeHead(404).end('Not found');
        return;
    }
    try {
        const bytes = await readFile(new URL('../dist' + path, import.meta.url));
        response.writeHead(200, { 'Content-Type': files.get(path), 'Content-Length': bytes.length });
        response.end(request.method === 'HEAD' ? undefined : bytes);
    } catch (error) {
        response.writeHead(error.code === 'ENOENT' ? 404 : 500).end('Build the plugin with npm run build.');
    }
});

server.listen(port, '127.0.0.1', () => console.log(`Development bundle: http://localhost:${port}/plugin.js`));
