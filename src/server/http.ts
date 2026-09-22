import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { extname, resolve, sep } from 'node:path';
import { SchoolError, requireValue } from './errors.ts';
import type { SchoolService } from './school-service.ts';

function json(res: ServerResponse, status: number, value: unknown) {
  const body = JSON.stringify(value); res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Length': Buffer.byteLength(body) }); res.end(body);
}
function loopback(address: string | undefined) { return !!address && ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address); }
function checkCaller(req: IncomingMessage) {
  requireValue(loopback(req.socket.remoteAddress), 403, 'local_only', 'This School candidate is available only on this PC.');
  let host: URL;
  try { host = new URL('http://' + req.headers.host); } catch { throw new SchoolError(403, 'invalid_host', 'Invalid local host.'); }
  requireValue(['127.0.0.1', 'localhost', '[::1]'].includes(host.hostname) && Number(host.port || 80) === req.socket.localPort && host.pathname === '/' && !host.username && !host.password, 403, 'invalid_host', 'Use this School service through its local address.');
  if (req.headers.origin) requireValue(req.headers.origin === host.origin, 403, 'invalid_origin', 'This browser origin cannot access School records.');
  if (req.headers['sec-fetch-site']) requireValue(['same-origin', 'none'].includes(String(req.headers['sec-fetch-site'])), 403, 'invalid_origin', 'Cross-site requests are not accepted.');
}
async function readBody(req: IncomingMessage): Promise<unknown> {
  requireValue(req.headers['content-type']?.split(';')[0].trim().toLowerCase() === 'application/json', 415, 'content_type', 'Send application/json.');
  const declared = req.headers['content-length'];
  if (declared) requireValue(/^\d+$/.test(declared) && Number(declared) <= 65536 && Number(declared) > 0, 413, 'body_limit', 'The request body is empty or too large.');
  const chunks: Buffer[] = []; let length = 0;
  for await (const chunk of req) { const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk); length += part.length; requireValue(length <= 65536, 413, 'body_limit', 'The request body is too large.'); chunks.push(part); }
  requireValue(length > 0, 400, 'invalid_request', 'Provide a JSON request.');
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new SchoolError(400, 'invalid_json', 'The request is not valid JSON.'); }
}
function staticFile(pathname: string, publicDirectory: string, req: IncomingMessage, res: ServerResponse) {
  const root = resolve(publicDirectory); let path = resolve(root, '.' + decodeURIComponent(pathname));
  requireValue(path === root || path.startsWith(root + sep), 404, 'not_found', 'Page not found.');
  if (path === root || !extname(path)) path = resolve(root, 'index.html');
  requireValue(existsSync(path) && statSync(path).isFile(), 404, 'not_found', 'Page not found.');
  const actual = realpathSync(path); requireValue(actual.startsWith(realpathSync(root) + sep), 404, 'not_found', 'Page not found.');
  const types: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon' };
  requireValue(Object.hasOwn(types, extname(path)), 404, 'not_found', 'Page not found.');
  const data = readFileSync(path); res.writeHead(200, { 'Content-Type': types[extname(path)], 'Content-Length': data.length, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'" }); res.end(req.method === 'HEAD' ? undefined : data);
}
export function createSchoolServer(options: { service: SchoolService; publicDirectory?: string }) {
  const { service } = options;
  const server = createServer(async (req, res) => {
    try {
      checkCaller(req);
      const url = new URL(req.url ?? '/', 'http://' + req.headers.host); const path = url.pathname;
      if (!path.startsWith('/api/')) { requireValue(req.method === 'GET' || req.method === 'HEAD', 405, 'method_not_allowed', 'Method not allowed.'); staticFile(path, options.publicDirectory ?? resolve('public'), req, res); return; }
      requireValue(!url.search, 400, 'invalid_request', 'API query parameters are not supported.');
      if (req.method === 'GET') {
        if (path === '/api/v1/health') { json(res, 200, { apiVersion: 1, ok: true, mode: 'standalone-local', provider: service.provider.status() }); return; }
        if (path === '/api/v1/catalog') { json(res, 200, service.catalog()); return; }
        if (path === '/api/v1/capabilities') { json(res, 200, service.capabilities()); return; }
        if (path === '/api/v1/sessions') { json(res, 200, service.listSessions()); return; }
        let match = /^\/api\/v1\/sessions\/([a-zA-Z0-9_-]+)(\/export)?$/.exec(path);
        if (match) { if (match[2]) res.setHeader('Content-Disposition', `attachment; filename="school-session-${match[1]}.json"`); json(res, 200, match[2] ? service.export(match[1]) : service.session(match[1])); return; }
        match = /^\/api\/v1\/turns\/([a-zA-Z0-9_-]+)$/.exec(path); if (match) { json(res, 200, service.turn(match[1])); return; }
        match = /^\/api\/v1\/sessions\/([a-zA-Z0-9_-]+)\/matrix$/.exec(path); if (match) { json(res, 200, await service.matrix.status(match[1])); return; }
        match = /^\/api\/v1\/sessions\/([a-zA-Z0-9_-]+)\/matrix\/scene-builds\/([a-zA-Z0-9_-]+)$/.exec(path); if (match) { json(res, 200, await service.matrix.pollSceneBuild(match[1], match[2])); return; }
        match = /^\/api\/v1\/sessions\/([a-zA-Z0-9_-]+)\/matrix\/experiments\/([a-zA-Z0-9_-]+)$/.exec(path); if (match) { json(res, 200, await service.matrix.pollScale(match[1], match[2])); return; }
        match = /^\/api\/v1\/sessions\/([a-zA-Z0-9_-]+)\/matrix\/demonstrations\/([a-zA-Z0-9_-]+)$/.exec(path); if (match) { json(res, 200, await service.matrix.poll(match[1], match[2])); return; }
      } else if (req.method === 'POST') {
        const body = await readBody(req);
        if (path === '/api/v1/sessions') { json(res, 201, service.start(body)); return; }
        let match = /^\/api\/v1\/sessions\/([a-zA-Z0-9_-]+)\/turns$/.exec(path); if (match) { json(res, 202, service.createTurn(match[1], body)); return; }
        match = /^\/api\/v1\/sessions\/([a-zA-Z0-9_-]+)\/experiment$/.exec(path); if (match) { json(res, 200, service.experiment(match[1], body)); return; }
        match = /^\/api\/v1\/turns\/([a-zA-Z0-9_-]+)\/cancel$/.exec(path); if (match) { json(res, 200, service.cancel(match[1], body)); return; }
        match = /^\/api\/v1\/sessions\/([a-zA-Z0-9_-]+)\/matrix\/scene-builds$/.exec(path); if (match) { json(res, 200, await service.matrix.requestSceneBuild(match[1], body)); return; }
        match = /^\/api\/v1\/sessions\/([a-zA-Z0-9_-]+)\/matrix\/scene-builds\/([a-zA-Z0-9_-]+)\/cancel$/.exec(path); if (match) { json(res, 200, await service.matrix.cancelSceneBuild(match[1], match[2], body)); return; }
        match = /^\/api\/v1\/sessions\/([a-zA-Z0-9_-]+)\/matrix\/(pair|disconnect|demonstrations|experiments)$/.exec(path);
        if (match) {
          const result = match[2] === 'pair' ? await service.matrix.pair(match[1], body) : match[2] === 'disconnect' ? service.matrix.disconnect(match[1], body) : match[2] === 'experiments' ? await service.matrix.requestScale(match[1], body) : await service.matrix.request(match[1], body);
          json(res, 200, result); return;
        }
        match = /^\/api\/v1\/sessions\/([a-zA-Z0-9_-]+)\/matrix\/experiments\/([a-zA-Z0-9_-]+)\/cancel$/.exec(path); if (match) { json(res, 200, await service.matrix.cancelScale(match[1], match[2], body)); return; }
        match = /^\/api\/v1\/sessions\/([a-zA-Z0-9_-]+)\/matrix\/demonstrations\/([a-zA-Z0-9_-]+)\/cancel$/.exec(path); if (match) { json(res, 200, await service.matrix.cancel(match[1], match[2], body)); return; }
      } else throw new SchoolError(405, 'method_not_allowed', 'Method not allowed.');
      throw new SchoolError(404, 'not_found', 'Endpoint not found.');
    } catch (error) {
      const safe = error instanceof SchoolError ? error : new SchoolError(500, 'server_error', 'School could not complete this request. Existing records were preserved.');
      if (!res.headersSent) json(res, safe.status, { apiVersion: 1, error: safe.message, code: safe.code }); else res.end();
    }
  });
  server.requestTimeout = 15000; server.headersTimeout = 10000; server.keepAliveTimeout = 5000;
  return server;
}
