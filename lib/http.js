'use strict';

const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { Repository, MAX_UPLOAD_BYTES } = require('./domain');

const PUBLIC_ROOT = path.join(__dirname, '..', 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.pdf': 'application/pdf'
};

function send(response, status, body, headers = {}) {
  const payload = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  response.writeHead(status, {
    'Content-Length': Buffer.byteLength(payload),
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    ...headers
  });
  response.end(payload);
}

function json(response, status, value, headers = {}) {
  send(response, status, JSON.stringify(value), { 'Content-Type': 'application/json; charset=utf-8', ...headers });
}

function error(response, status, message, details) {
  json(response, status, { error: message, ...(details ? { details } : {}) });
}

async function readBody(request, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    request.on('data', chunk => {
      size += chunk.length;
      if (size > limit) {
        reject(Object.assign(new Error('Request body too large'), { statusCode: 413 }));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks)));
    request.on('error', reject);
  });
}

function parseDisposition(value, name) {
  const match = new RegExp(`${name}="([^"]*)"`).exec(value);
  return match ? match[1] : '';
}

function parseMultipart(body, contentType) {
  const boundaryMatch = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  if (!boundaryMatch) throw Object.assign(new Error('Missing multipart boundary'), { statusCode: 400 });
  const delimiter = Buffer.from(`--${boundaryMatch[1] || boundaryMatch[2]}`);
  const positions = [];
  let cursor = 0;
  while (true) {
    const found = body.indexOf(delimiter, cursor);
    if (found === -1) break;
    positions.push(found);
    cursor = found + delimiter.length;
  }
  if (positions.length < 2) throw Object.assign(new Error('Malformed multipart payload'), { statusCode: 400 });
  const fields = {};
  let file;
  for (let index = 0; index < positions.length - 1; index += 1) {
    let part = body.subarray(positions[index] + delimiter.length, positions[index + 1]);
    if (part.slice(0, 2).toString() === '--') break;
    if (part.slice(0, 2).toString() === '\r\n') part = part.subarray(2);
    if (part.slice(-2).toString() === '\r\n') part = part.subarray(0, -2);
    const separator = part.indexOf('\r\n\r\n');
    if (separator === -1) continue;
    const head = part.subarray(0, separator).toString('utf8');
    const content = part.subarray(separator + 4);
    const disposition = /^content-disposition:(.+)$/im.exec(head)?.[1] || '';
    const name = parseDisposition(disposition, 'name');
    const filename = parseDisposition(disposition, 'filename');
    const partType = /^content-type:\s*(.+)$/im.exec(head)?.[1]?.trim() || 'text/plain';
    if (filename) {
      file = { field: name, filename: decodeURIComponent(escape(filename)), mime: partType, bytes: content };
    } else if (name) {
      fields[name] = content.toString('utf8');
    }
  }
  if (!file) throw Object.assign(new Error('No file was supplied'), { statusCode: 400 });
  return { fields, file };
}

async function serveStatic(request, response, pathname) {
  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const target = path.resolve(PUBLIC_ROOT, relative.startsWith('press') ? relative : relative);
  if (!target.startsWith(PUBLIC_ROOT + path.sep) && target !== PUBLIC_ROOT) return error(response, 404, 'Not found');
  try {
    const stat = await fsp.stat(target);
    if (!stat.isFile()) return error(response, 404, 'Not found');
    const type = MIME[path.extname(target).toLowerCase()] || 'application/octet-stream';
    response.writeHead(200, {
      'Content-Type': type,
      'Content-Length': stat.size,
      'Cache-Control': process.env.NODE_ENV === 'production' ? 'public, max-age=300' : 'no-cache',
      'X-Content-Type-Options': 'nosniff'
    });
    if (request.method === 'HEAD') return response.end();
    fs.createReadStream(target).pipe(response);
  } catch (err) {
    if (err.code === 'ENOENT') error(response, 404, 'Not found');
    else error(response, 500, 'Static file failed');
  }
}

async function handleApi(request, response, url, repository) {
  const actorSource = request.headers['x-reel-user'] || 'Maya Chen';
  const actor = String(actorSource).slice(0, 80).replace(/[<>\r\n]/g, '') || 'Maya Chen';
  const sendCreatedFile = async versionId => {
    const db = repository.snapshot();
    const version = db.versions.find(item => item.id === versionId || item.hash === versionId);
    if (!version) return error(response, 404, 'Media not found');
    const target = path.join(repository.dataDir, 'blobs', version.hash.slice(0, 2), version.hash);
    try {
      const stat = await fsp.stat(target);
      response.writeHead(200, {
        'Content-Type': version.mime,
        'Content-Length': stat.size,
        'Cache-Control': 'private, max-age=31536000, immutable',
        'Content-Disposition': `inline; filename="${encodeURIComponent(version.filename)}"`
      });
      fs.createReadStream(target).pipe(response);
    } catch {
      error(response, 404, 'Media bytes unavailable');
    }
  };

  if (request.method === 'GET' && url.pathname === '/healthz') {
    return json(response, 200, { ok: true, versions: repository.snapshot().versions.length });
  }
  if (request.method === 'GET' && url.pathname === '/api/state') {
    const db = repository.snapshot();
    return json(response, 200, {
      users: db.users,
      projects: db.projects,
      assets: db.assets,
      versions: db.versions.map(({ previewSpec, ...version }) => version),
      templates: db.templates,
      activity: db.activity.slice(0, 80),
      shares: db.shares.map(share => ({ ...share, token: undefined }))
    });
  }
  if (request.method === 'POST' && url.pathname === '/api/plugin/login') {
    const input = JSON.parse((await readBody(request, 1024 * 1024)).toString('utf8') || '{}');
    return json(response, 201, await repository.pluginLogin(input));
  }
  if (request.method === 'GET' && url.pathname === '/api/plugin/packets') {
    const token = url.searchParams.get('token') || request.headers['x-nitrate-plugin-token'];
    return json(response, 200, repository.pluginPackets(token));
  }
  if (request.method === 'POST' && url.pathname === '/api/plugin/push') {
    const input = JSON.parse((await readBody(request, 1024 * 1024)).toString('utf8') || '{}');
    return json(response, 201, await repository.pushPacket(input, actor));
  }
  const assignmentMatch = url.pathname.match(/^\/api\/plugin\/assignments\/([^/]+)$/);
  if (assignmentMatch && request.method === 'PATCH') {
    const input = JSON.parse((await readBody(request, 1024 * 1024)).toString('utf8') || '{}');
    return json(response, 200, await repository.updateAssignment(assignmentMatch[1], input, actor));
  }
  if (request.method === 'POST' && url.pathname === '/api/projects') {
    const input = JSON.parse((await readBody(request, 1024 * 1024)).toString('utf8') || '{}');
    return json(response, 201, await repository.createProject(input, actor));
  }
  if (request.method === 'POST' && url.pathname === '/api/uploads') {
    const raw = await readBody(request, MAX_UPLOAD_BYTES + 1024 * 1024);
    const contentType = request.headers['content-type'] || '';
    if (!contentType.toLowerCase().includes('multipart/form-data')) return error(response, 415, 'Use multipart/form-data');
    const { fields, file } = parseMultipart(raw, contentType);
    const result = await repository.commit(fields, file.bytes, actor);
    return json(response, 201, result);
  }
  const versionMatch = url.pathname.match(/^\/api\/versions\/([^/]+)(\/raw)?$/);
  if (versionMatch && versionMatch[2]) return sendCreatedFile(versionMatch[1]);
  if (versionMatch && request.method === 'PATCH') {
    const input = JSON.parse((await readBody(request, 1024 * 1024)).toString('utf8') || '{}');
    return json(response, 200, await repository.updateVersion(versionMatch[1], input, actor));
  }
  if (versionMatch) {
    const db = repository.snapshot();
    const version = db.versions.find(item => item.id === versionMatch[1]);
    return version ? json(response, 200, version) : error(response, 404, 'Unknown version');
  }
  if (request.method === 'POST' && url.pathname === '/api/shares') {
    const input = JSON.parse((await readBody(request, 1024 * 1024)).toString('utf8') || '{}');
    const share = await repository.createShare(input, actor);
    return json(response, 201, { ...share, url: `/share/${share.token}` });
  }
  const shareMatch = url.pathname.match(/^\/api\/shared\/([A-Za-z0-9_-]+)$/);
  if (shareMatch) {
    const view = repository.sharedView(shareMatch[1]);
    return view ? json(response, 200, view) : error(response, 404, 'This share is unavailable');
  }
  const mediaMatch = url.pathname.match(/^\/api\/media\/([A-Za-z0-9_-]+)$/);
  if (mediaMatch) return sendCreatedFile(mediaMatch[1]);
  if (request.method === 'POST' && url.pathname === '/api/waitlist') {
    const input = JSON.parse((await readBody(request, 64 * 1024)).toString('utf8') || '{}');
    return json(response, 200, await repository.addToWaitlist(input));
  }
  return error(response, 404, 'API route not found');
}

async function handler(request, response, repository) {
  const url = new URL(request.url, 'http://localhost');
  response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  try {
    if (url.pathname.startsWith('/api/')) {
      response.setHeader('Access-Control-Allow-Origin', '*');
      response.setHeader('Access-Control-Allow-Headers', 'Content-Type,X-Reel-User,X-Reel-Role');
      response.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,OPTIONS');
      if (request.method === 'OPTIONS') return send(response, 204, '');
      return await handleApi(request, response, url, repository);
    }
    if (url.pathname === '/healthz') return await handleApi(request, response, url, repository);
    if (url.pathname === '/favicon.ico') return send(response, 204, '');
    if (url.pathname === '/' ) return serveStatic(request, response, '/index.html');
    if (url.pathname === '/app') return serveStatic(request, response, '/app/index.html');
    if (url.pathname === '/plugin' || url.pathname === '/plugin/') return serveStatic(request, response, '/plugin/index.html');
    if (url.pathname === '/use' || url.pathname === '/use/') return serveStatic(request, response, '/use/index.html');
    if (url.pathname === '/share' || url.pathname.startsWith('/share/')) return serveStatic(request, response, '/share.html');
    if (url.pathname === '/press') return serveStatic(request, response, '/press/index.html');
    return await serveStatic(request, response, url.pathname);
  } catch (err) {
    if (response.headersSent) return response.destroy();
    const status = err.statusCode || 400;
    if (status >= 500) console.error(err);
    return error(response, status, err.message || 'Request failed');
  }
}

function createServer(options = {}) {
  const dataDir = options.dataDir || process.env.REEL_DATA_DIR || path.join(process.cwd(), '.reel-data');
  const repositoryPromise = new Repository(dataDir).init();
  const server = http.createServer(async (request, response) => {
    try {
      const repository = await repositoryPromise;
      await handler(request, response, repository);
    } catch (err) {
      console.error(err);
      if (!response.headersSent) error(response, 500, 'Server initialization failed');
    }
  });
  server.dataDir = dataDir;
  return server;
}

function start(options = {}) {
  const server = createServer(options);
  const port = options.port ?? Number(process.env.PORT || 4173);
  return new Promise(resolve => server.listen(port, options.host || '127.0.0.1', () => resolve({
    server,
    port: server.address().port,
    dataDir: server.dataDir
  })));
}

if (require.main === module) {
  start().then(({ port }) => {
    console.log(`nitrate is running at http://127.0.0.1:${port}`);
    console.log('App: /app · Press kit: /press');
  }).catch(err => {
    console.error(err);
    process.exitCode = 1;
  });
}

module.exports = { createServer, start, parseMultipart };
