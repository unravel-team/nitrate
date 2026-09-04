#!/usr/bin/env node

import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { cleanupPendingMcpReturn } from '../worker/index.mjs';

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const wrangler = join(repositoryRoot, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const nitrate = join(repositoryRoot, 'bin', 'nitrate.mjs');

function availablePort() {
  return new Promise((resolvePort, reject) => {
    const server = createNetServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(error => error ? reject(error) : resolvePort(address.port));
    });
  });
}

function listen(server, port) {
  return new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolveListen());
  });
}

function closeServer(server) {
  if (!server?.listening) return Promise.resolve();
  return new Promise((resolveClose, reject) => server.close(error => error ? reject(error) : resolveClose()));
}

async function mcpPost(baseUrl, token, method, params = {}, id = 1) {
  const headers = {
    Accept: 'application/json, text/event-stream',
    'Content-Type': 'application/json',
    'MCP-Protocol-Version': '2025-06-18'
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${baseUrl}/mcp`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params })
  });
  const text = await response.text();
  let payload;
  try {
    const jsonText = response.headers.get('content-type')?.includes('text/event-stream')
      ? text.split(/\r?\n/).find(line => line.startsWith('data: '))?.slice(6)
      : text;
    payload = JSON.parse(jsonText);
  } catch {
    throw new Error(`MCP ${method} returned non-JSON (${response.status}): ${text}`);
  }
  return { response, payload };
}

function mcpToolContent(result) {
  assert.equal(result.payload.error, undefined, JSON.stringify(result.payload.error));
  assert.equal(result.response.status, 200);
  assert.equal(result.payload.result?.isError, undefined, JSON.stringify(result.payload.result));
  assert.ok(result.payload.result?.structuredContent, JSON.stringify(result.payload.result));
  return result.payload.result.structuredContent;
}

function mcpToolFailure(result, pattern) {
  assert.equal(result.response.status, 200);
  const message = JSON.stringify(result.payload.error || result.payload.result || {});
  assert.ok(result.payload.error || result.payload.result?.isError, message);
  if (pattern) assert.match(message, pattern);
  return message;
}

async function apiJson(baseUrl, path, token, options = {}) {
  const headers = new Headers(options.headers || {});
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (options.body !== undefined) headers.set('Content-Type', 'application/json');
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method || 'GET',
    headers,
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) })
  });
  const payload = await response.json();
  return { response, payload };
}

async function createMcpConnection(baseUrl, pluginToken, body = {}) {
  const result = await apiJson(baseUrl, '/api/plugin/mcp-connections', pluginToken, {
    method: 'POST', body
  });
  assert.equal(result.response.status, 201, JSON.stringify(result.payload));
  assert.match(result.payload.token, /^nmc_/);
  assert.equal(result.payload.connection.audience, 'nitrate-mcp');
  return result.payload;
}

async function eventuallyHealthy(baseUrl, processLogs) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/healthz`);
      if (response.ok && (await response.json()).ok) return;
    } catch {
      // Wrangler is still starting.
    }
    await new Promise(resolveWait => setTimeout(resolveWait, 150));
  }
  throw new Error(`Local Worker did not become healthy.\n${processLogs()}`);
}

async function stopProcess(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([
    new Promise(resolveExit => child.once('exit', resolveExit)),
    new Promise(resolveTimeout => setTimeout(resolveTimeout, 3_000))
  ]);
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
}

async function runCli(args, configFile, cwd) {
  const { stdout, stderr } = await execFileAsync(process.execPath, [nitrate, ...args, '--json'], {
    cwd,
    env: { ...process.env, NITRATE_CONFIG_FILE: configFile }
  });
  assert.equal(stderr, '');
  return JSON.parse(stdout);
}

async function expectCliFailure(args, configFile, cwd, pattern) {
  await assert.rejects(
    runCli(args, configFile, cwd),
    error => pattern.test(`${error.stderr || ''}\n${error.message || ''}`)
  );
}

const root = await mkdtemp(join(tmpdir(), 'nitrate-worker-loop-'));
const persistDir = join(root, 'wrangler-state');
const leaderConfig = join(root, 'leader', 'config.json');
const creatorConfig = join(root, 'creator', 'config.json');
const port = await availablePort();
const fixturePort = await availablePort();
const baseUrl = `http://127.0.0.1:${port}`;
const fixtureOrigin = `http://127.0.0.1:${fixturePort}`;
const wranglerEnv = { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' };
const bootstrapSecret = 'local-verifier-bootstrap-secret-32-bytes';
let worker;
let fixtureServer;
let workerOutput = '';

try {
  await mkdir(persistDir, { recursive: true });
  await execFileAsync(process.execPath, [
    wrangler, 'd1', 'migrations', 'apply', 'nitrate', '--local', '--persist-to', persistDir
  ], { cwd: repositoryRoot, env: wranglerEnv });

  const higgsfieldBytes = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64'
  );
  const fixtureRequests = [];
  fixtureServer = createHttpServer((request, response) => {
    fixtureRequests.push({ url: request.url, headers: { ...request.headers } });
    if (request.method !== 'GET') {
      response.writeHead(404).end();
      return;
    }
    if (request.url === '/redirect.png') {
      response.writeHead(302, { Location: `${fixtureOrigin}/higgsfield-result.png` }).end();
      return;
    }
    if (request.url === '/result.html') {
      const html = Buffer.from('<html>not media</html>');
      response.writeHead(200, { 'Content-Type': 'text/html', 'Content-Length': String(html.length) });
      response.end(html);
      return;
    }
    if (request.url === '/missing-length.png') {
      response.writeHead(200, { 'Content-Type': 'image/png', 'Transfer-Encoding': 'chunked' });
      response.end(higgsfieldBytes);
      return;
    }
    if (request.url === '/false-length.png') {
      response.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': String(higgsfieldBytes.length + 20) });
      response.end(higgsfieldBytes);
      return;
    }
    if (request.url !== '/higgsfield-result.png') {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, {
      'Content-Type': 'image/png',
      'Content-Length': String(higgsfieldBytes.length),
      'Cache-Control': 'no-store'
    });
    response.end(higgsfieldBytes);
  });
  await listen(fixtureServer, fixturePort);

  worker = spawn(process.execPath, [
    wrangler, 'dev', '--local', '--ip', '127.0.0.1', '--port', String(port),
    '--persist-to', persistDir,
    '--var', `NITRATE_PUBLIC_BASE_URL:${baseUrl}`,
    '--var', 'NITRATE_MCP_ASSET_SIGNING_KEY:local-test-signing-key-32-bytes-minimum',
    '--var', `NITRATE_MCP_IMPORT_ORIGINS:${fixtureOrigin}`,
    '--var', 'NITRATE_MCP_ALLOW_HTTP_IMPORTS:true',
    '--var', `NITRATE_BOOTSTRAP_SECRET:${bootstrapSecret}`,
    '--log-level', 'error'
  ], { cwd: repositoryRoot, env: wranglerEnv, stdio: ['ignore', 'pipe', 'pipe'] });
  worker.stdout.on('data', chunk => { workerOutput += chunk; });
  worker.stderr.on('data', chunk => { workerOutput += chunk; });
  await eventuallyHealthy(baseUrl, () => workerOutput);

  const rejectedBootstrap = await apiJson(baseUrl, '/api/plugin/login', '', {
    method: 'POST',
    body: { email: 'blocked@northwind.test', name: 'Blocked', role: 'leader' }
  });
  assert.equal(rejectedBootstrap.response.status, 403);
  const loginResult = await apiJson(baseUrl, '/api/plugin/login', '', {
    method: 'POST',
    headers: { 'X-Nitrate-Bootstrap-Secret': bootstrapSecret },
    body: {
      email: 'maya@northwind.test', name: 'Maya Chen', role: 'leader',
      surface: 'Codex', agent: 'maya-codex'
    }
  });
  assert.equal(loginResult.response.status, 201, JSON.stringify(loginResult.payload));
  const login = { ...loginResult.payload, agent: 'maya-codex' };
  await mkdir(dirname(leaderConfig), { recursive: true, mode: 0o700 });
  await writeFile(leaderConfig, `${JSON.stringify({
    apiUrl: baseUrl,
    token: login.session.token,
    user: login.user,
    session: { ...login.session, token: undefined }
  }, null, 2)}\n`, { mode: 0o600 });
  assert.equal(login.user.role, 'team_lead');
  assert.equal((await stat(leaderConfig)).mode & 0o777, 0o600);

  const sourceFile = join(root, 'northwind-brand-guide.pdf');
  const sourceBytes = Buffer.from('%PDF-1.4\nNorthwind violet, safe-area, and logo rules\n%%EOF');
  await writeFile(sourceFile, sourceBytes);
  const handoff = await runCli([
    'handoff', '--name', 'Northwind vertical launch', '--client', 'Northwind',
    '--brief', 'Create one 9:16 launch ad that follows the supplied brand guide.',
    '--input', sourceFile, '--to', 'nia@northwind.test', '--creator-name', 'Nia Patel',
    '--task', 'Create and return one client-reviewable 9:16 hero render.',
    '--review', 'logo stays readable', '--review', '9:16 safe areas are respected',
    '--folder', '/inputs', '--folder', '/renders', '--folder', '/prompts',
    '--folder', '/notes', '--folder', '/handoff'
  ], leaderConfig, root);
  assert.equal(handoff.uploads.length, 1);
  assert.equal(handoff.uploads[0].size, sourceBytes.length);
  const inviteUrl = handoff.invitations[0]?.inviteUrl;
  assert.match(inviteUrl, new RegExp(`^${baseUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/join/`));

  const workspace = join(root, 'nia-workspace');
  const pulled = await runCli([
    'pull', inviteUrl, '--dir', workspace, '--name', 'Nia Patel',
    '--surface', 'Claude Code', '--agent', 'nia-claude'
  ], creatorConfig, root);
  assert.equal(pulled.receipt.inputsVerified, true);
  assert.equal(pulled.receipt.inputCount, 1);
  assert.deepEqual(await readFile(join(workspace, 'inputs', 'northwind-brand-guide.pdf')), sourceBytes);
  assert.match(await readFile(join(workspace, 'AGENT_BRIEF.md'), 'utf8'), /client-reviewable 9:16 hero render/);
  await expectCliFailure(
    ['pull', inviteUrl, '--dir', join(root, 'invite-reuse')], creatorConfig, root,
    /already been accepted/i
  );

  const renderBytes = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><title>Northwind hero</title></svg>');
  await writeFile(join(workspace, 'renders', 'hero.svg'), renderBytes);
  await writeFile(join(workspace, 'prompts', 'hero.md'), 'Violet product stage, vertical framing, readable Northwind mark.');
  await writeFile(join(workspace, 'notes', 'hero.md'), 'Prepared for the first client review.');
  const returned = await runCli([
    'return', 'renders/hero.svg', '--dir', workspace,
    '--made-with', 'Claude Code + Higgsfield Supercomputer'
  ], creatorConfig, workspace);
  assert.equal(returned.receipt.size, renderBytes.length);
  assert.equal(returned.return.validation.complete, true);

  await expectCliFailure([
    'review', returned.receipt.id, '--decision', 'approve'
  ], creatorConfig, workspace, /only a nitrate leader|forbidden|only team leads/i);

  const reviewed = await runCli([
    'review', returned.receipt.id, '--decision', 'approve',
    '--note', 'Matches the brief and is ready for client review.'
  ], leaderConfig, root);
  assert.equal(reviewed.reviewed.status, 'approved');

  const inbox = await runCli(['packets'], leaderConfig, root);
  const completed = inbox.packets.find(entry => (entry.packet || entry.project).id === handoff.packetId);
  assert.equal(completed.activation.uploadedInputCount, 1);
  assert.equal(completed.activation.ahaReached, true);
  assert.equal(completed.activation.closedLoop, true);

  const unauthenticatedMedia = await fetch(`${baseUrl}/api/media/${returned.receipt.id}`);
  assert.equal(unauthenticatedMedia.status, 401);

  const unauthenticatedMcp = await mcpPost(baseUrl, '', 'initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'higgsfield-supercomputer-verifier', version: '1.0.0' }
  });
  assert.equal(unauthenticatedMcp.response.status, 401);
  assert.match(unauthenticatedMcp.response.headers.get('www-authenticate') || '', /^Bearer /);
  assert.ok(unauthenticatedMcp.response.headers.get('x-request-id'));
  assert.equal(unauthenticatedMcp.response.headers.get('access-control-allow-origin'), null);

  const remoteInput = join(root, 'higgsfield-reference.png');
  await writeFile(remoteInput, higgsfieldBytes);
  const remoteHandoff = await runCli([
    'handoff', '--name', 'Northwind Higgsfield variation', '--client', 'Northwind',
    '--brief', 'Create one alternate launch still in Higgsfield while preserving the supplied reference.',
    '--input', remoteInput, '--to', 'suri@northwind.test', '--creator-name', 'Suri Rao',
    '--task', 'Use Higgsfield Supercomputer to generate and return one approved still.',
    '--review', 'reference composition is preserved', '--folder', '/inputs', '--folder', '/renders',
    '--folder', '/prompts', '--folder', '/notes', '--folder', '/handoff'
  ], leaderConfig, root);
  const remoteInvite = remoteHandoff.invitations[0];
  const inviteToken = new URL(remoteInvite.inviteUrl).pathname.split('/').filter(Boolean).at(-1);
  const acceptedResponse = await fetch(`${baseUrl}/api/plugin/invites/${inviteToken}/accept`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Suri Rao', surface: 'Higgsfield Supercomputer', agent: 'higgsfield-supercomputer' })
  });
  assert.equal(acceptedResponse.status, 201);
  const accepted = await acceptedResponse.json();
  const creatorPluginToken = accepted.session.token;
  const leaderPluginToken = JSON.parse(await readFile(leaderConfig, 'utf8')).token;

  const pluginTokenAtMcp = await mcpPost(baseUrl, creatorPluginToken, 'initialize', {
    protocolVersion: '2025-06-18', capabilities: {},
    clientInfo: { name: 'plugin-token-negative-test', version: '1.0.0' }
  });
  assert.equal(pluginTokenAtMcp.response.status, 401);

  const creatorConnectionOne = await createMcpConnection(baseUrl, creatorPluginToken, {
    label: 'Higgsfield creator primary', client: 'Higgsfield Supercomputer'
  });
  const creatorConnectionTwo = await createMcpConnection(baseUrl, creatorPluginToken, {
    label: 'Higgsfield creator recovery', client: 'Higgsfield Supercomputer'
  });
  const leaderConnection = await createMcpConnection(baseUrl, leaderPluginToken, {
    label: 'Higgsfield lead review', client: 'Higgsfield Supercomputer'
  });
  assert.equal(creatorConnectionOne.connection.scopes.includes('returns:review'), false);
  assert.equal(leaderConnection.connection.scopes.includes('returns:review'), true);

  const crossOwnerRevoke = await apiJson(
    baseUrl,
    `/api/plugin/mcp-connections/${creatorConnectionOne.connection.id}`,
    leaderPluginToken,
    { method: 'DELETE' }
  );
  assert.equal(crossOwnerRevoke.response.status, 404);

  const overScoped = await apiJson(baseUrl, '/api/plugin/mcp-connections', creatorPluginToken, {
    method: 'POST', body: { scopes: ['returns:review'] }
  });
  assert.equal(overScoped.response.status, 422);
  const overlong = await apiJson(baseUrl, '/api/plugin/mcp-connections', creatorPluginToken, {
    method: 'POST', body: { expiresInSeconds: 30 * 24 * 60 * 60 + 1 }
  });
  assert.equal(overlong.response.status, 422);

  const listedConnections = await apiJson(baseUrl, '/api/plugin/mcp-connections', creatorPluginToken);
  assert.equal(listedConnections.response.status, 200);
  assert.equal(listedConnections.payload.connections.length, 2);
  assert.equal(JSON.stringify(listedConnections.payload).includes(creatorConnectionOne.token), false);
  const leaderConnections = await apiJson(baseUrl, '/api/plugin/mcp-connections', leaderPluginToken);
  assert.equal(leaderConnections.payload.connections.length, 1);

  const mcpTokenAtRest = await apiJson(baseUrl, '/api/plugin/packets', creatorConnectionOne.token);
  assert.equal(mcpTokenAtRest.response.status, 401);

  const invalidMcp = await mcpPost(baseUrl, 'nmc_invalid_invalid_invalid_invalid_invalid', 'initialize', {
    protocolVersion: '2025-06-18', capabilities: {},
    clientInfo: { name: 'invalid-token-test', version: '1.0.0' }
  });
  assert.equal(invalidMcp.response.status, 401);

  const expiringConnection = await createMcpConnection(baseUrl, creatorPluginToken, {
    label: 'Expiry test', expiresInSeconds: 300, scopes: ['identity:read']
  });
  const limitedTools = await mcpPost(baseUrl, expiringConnection.token, 'tools/list', {}, 1);
  assert.deepEqual(limitedTools.payload.result.tools.map(tool => tool.name), ['nitrate_whoami']);
  await execFileAsync(process.execPath, [
    wrangler, 'd1', 'execute', 'nitrate', '--local', '--persist-to', persistDir,
    '--command', `UPDATE mcp_connections SET expires_at = '2000-01-01T00:00:00.000Z' WHERE id = '${expiringConnection.connection.id}'`
  ], { cwd: repositoryRoot, env: wranglerEnv });
  const expiredMcp = await mcpPost(baseUrl, expiringConnection.token, 'initialize', {
    protocolVersion: '2025-06-18', capabilities: {},
    clientInfo: { name: 'expired-token-test', version: '1.0.0' }
  });
  assert.equal(expiredMcp.response.status, 401);

  const initialized = await mcpPost(baseUrl, creatorConnectionOne.token, 'initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'higgsfield-supercomputer-verifier', version: '1.0.0' }
  });
  assert.equal(initialized.response.status, 200);
  assert.equal(initialized.response.headers.get('access-control-allow-origin'), null);
  assert.equal(initialized.payload.result.serverInfo.name, 'nitrate-higgsfield');
  const usedConnections = await apiJson(baseUrl, '/api/plugin/mcp-connections', creatorPluginToken);
  assert.ok(usedConnections.payload.connections.find(item => item.id === creatorConnectionOne.connection.id).lastUsedAt);

  const oversizedMcp = await fetch(`${baseUrl}/mcp`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${creatorConnectionOne.token}`,
      Accept: 'application/json, text/event-stream',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 99, method: 'tools/list', params: {}, padding: 'x'.repeat(256 * 1024) })
  });
  assert.equal(oversizedMcp.status, 413);
  assert.match(JSON.stringify(await oversizedMcp.json()), /256 KiB/i);

  const creatorTools = await mcpPost(baseUrl, creatorConnectionOne.token, 'tools/list', {}, 2);
  assert.equal(creatorTools.response.status, 200);
  const creatorToolNames = creatorTools.payload.result.tools.map(tool => tool.name);
  assert.deepEqual(creatorToolNames.sort(), [
    'nitrate_list_work',
    'nitrate_pull_assignment',
    'nitrate_submit_return_from_url',
    'nitrate_whoami'
  ]);
  assert.equal(creatorToolNames.includes('nitrate_review_return'), false);

  const assignmentId = remoteInvite.assignmentId;
  const firstPullCall = await mcpPost(baseUrl, creatorConnectionOne.token, 'tools/call', {
    name: 'nitrate_pull_assignment', arguments: { assignmentId }
  }, 3);
  const firstPull = mcpToolContent(firstPullCall);
  assert.equal(firstPull.assignment.status, 'pulled');
  assert.equal(firstPull.assignment.inputs.length, 1);
  const signedInputUrl = firstPull.assignment.inputs[0].downloadUrl;
  const signedInput = await fetch(signedInputUrl);
  assert.equal(signedInput.status, 200);
  assert.deepEqual(Buffer.from(await signedInput.arrayBuffer()), higgsfieldBytes);
  assert.equal(signedInput.headers.get('cache-control'), 'private, no-store');
  assert.equal(signedInput.headers.get('referrer-policy'), 'no-referrer');
  assert.ok(signedInput.headers.get('x-request-id'));
  const signedHead = await fetch(signedInputUrl, { method: 'HEAD' });
  assert.equal(signedHead.status, 200);
  assert.equal(Number(signedHead.headers.get('content-length')), higgsfieldBytes.length);

  const tamperedUrl = new URL(signedInputUrl);
  const [claims, signature] = tamperedUrl.searchParams.get('access').split('.');
  tamperedUrl.searchParams.set('access', `${claims}.${signature[0] === 'A' ? 'B' : 'A'}${signature.slice(1)}`);
  assert.equal((await fetch(tamperedUrl)).status, 403);

  const revokedCreator = await apiJson(
    baseUrl,
    `/api/plugin/mcp-connections/${creatorConnectionOne.connection.id}`,
    creatorPluginToken,
    { method: 'DELETE' }
  );
  assert.equal(revokedCreator.response.status, 200);
  assert.ok(revokedCreator.payload.connection.revokedAt);
  const revokedCreatorAgain = await apiJson(
    baseUrl,
    `/api/plugin/mcp-connections/${creatorConnectionOne.connection.id}`,
    creatorPluginToken,
    { method: 'DELETE' }
  );
  assert.equal(revokedCreatorAgain.payload.connection.revokedAt, revokedCreator.payload.connection.revokedAt);
  assert.equal((await fetch(signedInputUrl)).status, 403);
  const revokedMcp = await mcpPost(baseUrl, creatorConnectionOne.token, 'tools/list', {}, 3);
  assert.equal(revokedMcp.response.status, 401);

  const secondPullCall = await mcpPost(baseUrl, creatorConnectionTwo.token, 'tools/call', {
    name: 'nitrate_pull_assignment', arguments: { assignmentId }
  }, 4);
  const secondPull = mcpToolContent(secondPullCall);
  assert.equal(secondPull.assignment.status, 'pulled');
  assert.equal(secondPull.assignment.pulledAt, firstPull.assignment.pulledAt);

  const fixtureCountBeforePreflight = fixtureRequests.length;
  const badPathCall = await mcpPost(baseUrl, creatorConnectionTwo.token, 'tools/call', {
    name: 'nitrate_submit_return_from_url',
    arguments: {
      assignmentId, sourceUrl: `${fixtureOrigin}/higgsfield-result.png`, filename: 'bad-path.png',
      prompt: 'Must fail before network access.', relativePath: '../bad-path.png',
      externalAssetId: 'hf_bad_path'
    }
  }, 5);
  mcpToolFailure(badPathCall, /relativePath|traverse/i);
  assert.equal(fixtureRequests.length, fixtureCountBeforePreflight);

  const spoofedProviderCall = await mcpPost(baseUrl, creatorConnectionTwo.token, 'tools/call', {
    name: 'nitrate_submit_return_from_url',
    arguments: {
      assignmentId, sourceUrl: `${fixtureOrigin}/higgsfield-result.png`, filename: 'spoof.png',
      prompt: 'Must fail schema validation.', madeWith: 'Another provider',
      relativePath: 'renders/spoof.png', externalAssetId: 'hf_spoofed_provider'
    }
  }, 5);
  mcpToolFailure(spoofedProviderCall, /unrecognized|madeWith|invalid/i);
  assert.equal(fixtureRequests.length, fixtureCountBeforePreflight);

  const disallowedOriginCall = await mcpPost(baseUrl, creatorConnectionTwo.token, 'tools/call', {
    name: 'nitrate_submit_return_from_url',
    arguments: {
      assignmentId, sourceUrl: 'https://media.invalid/result.png', filename: 'origin.png',
      prompt: 'Disallowed origin.', relativePath: 'renders/origin.png', externalAssetId: 'hf_bad_origin'
    }
  }, 6);
  mcpToolFailure(disallowedOriginCall, /origin is not allowed/i);
  assert.equal(fixtureRequests.length, fixtureCountBeforePreflight);

  for (const [path, externalId, pattern] of [
    ['/redirect.png', 'hf_redirect', /redirect/i],
    ['/result.html', 'hf_html', /supported raster|video|audio/i],
    ['/missing-length.png', 'hf_missing_length', /Content-Length/i],
    ['/false-length.png', 'hf_false_length', /size|imported|Content-Length/i]
  ]) {
    const rejected = await mcpPost(baseUrl, creatorConnectionTwo.token, 'tools/call', {
      name: 'nitrate_submit_return_from_url',
      arguments: {
        assignmentId, sourceUrl: `${fixtureOrigin}${path}`, filename: `${externalId}.png`,
        prompt: 'Provider response validation test.', relativePath: `renders/${externalId}.png`,
        externalAssetId: externalId
      }
    }, 7);
    mcpToolFailure(rejected, pattern);
  }

  const externalAssetId = 'hf_asset_verifier_001';
  await execFileAsync(process.execPath, [
    wrangler, 'd1', 'execute', 'nitrate', '--local', '--persist-to', persistDir,
    '--command', `INSERT INTO mcp_external_asset_imports
      (id, agency_id, user_id, connection_id, assignment_id, provider, external_asset_id,
       return_id, staging_key, lease_expires_at, cleanup_error, status, created_at, updated_at)
      VALUES ('mcpimport_stale_verifier', '${accepted.agency.id}', '${accepted.user.id}',
       '${creatorConnectionTwo.connection.id}', '${assignmentId}', 'Higgsfield Supercomputer',
       '${externalAssetId}', NULL, 'mcp-staging/${accepted.agency.id}/mcpimport_stale_verifier',
       '2000-01-01T00:00:00.000Z', NULL, 'pending', '2000-01-01T00:00:00.000Z',
       '2000-01-01T00:00:00.000Z')`
  ], { cwd: repositoryRoot, env: wranglerEnv });
  const fixtureCountBeforeImport = fixtureRequests.length;
  const importedCall = await mcpPost(baseUrl, creatorConnectionTwo.token, 'tools/call', {
    name: 'nitrate_submit_return_from_url',
    arguments: {
      assignmentId,
      sourceUrl: `${fixtureOrigin}/higgsfield-result.png`,
      filename: 'northwind-higgsfield.png',
      prompt: 'Northwind launch still, violet studio, preserve reference composition.',
      relativePath: 'renders/northwind-higgsfield.png',
      notes: 'Generated as the requested alternate.',
      externalAssetId
    }
  }, 5);
  const imported = mcpToolContent(importedCall);
  assert.equal(imported.sizeBytes, higgsfieldBytes.length);
  assert.equal(imported.sha256, createHash('sha256').update(higgsfieldBytes).digest('hex'));
  assert.deepEqual(imported.provenance, { provider: 'Higgsfield Supercomputer', externalAssetId });
  assert.equal(fixtureRequests.length, fixtureCountBeforeImport + 1);
  const providerRequest = fixtureRequests.at(-1);
  assert.equal(providerRequest.headers.authorization, undefined);
  assert.equal(providerRequest.headers.cookie, undefined);
  assert.equal(providerRequest.headers.referer, undefined);

  const duplicateImport = await mcpPost(baseUrl, creatorConnectionTwo.token, 'tools/call', {
    name: 'nitrate_submit_return_from_url',
    arguments: {
      assignmentId, sourceUrl: `${fixtureOrigin}/higgsfield-result.png`,
      filename: 'northwind-higgsfield.png', prompt: 'Safe retry.',
      relativePath: 'renders/northwind-higgsfield.png', externalAssetId
    }
  }, 8);
  const duplicate = mcpToolContent(duplicateImport);
  assert.equal(duplicate.returnId, imported.returnId);
  assert.equal(fixtureRequests.length, fixtureCountBeforeImport + 1);

  const returnedAssignmentCall = await mcpPost(baseUrl, creatorConnectionTwo.token, 'tools/call', {
    name: 'nitrate_submit_return_from_url',
    arguments: {
      assignmentId, sourceUrl: `${fixtureOrigin}/higgsfield-result.png`, filename: 'second.png',
      prompt: 'Must reject because assignment already returned.',
      relativePath: 'renders/second.png', externalAssetId: 'hf_after_return'
    }
  }, 9);
  mcpToolFailure(returnedAssignmentCall, /not accepting|returned/i);
  assert.equal(fixtureRequests.length, fixtureCountBeforeImport + 1);

  const creatorReview = await mcpPost(baseUrl, creatorConnectionTwo.token, 'tools/call', {
    name: 'nitrate_review_return',
    arguments: { returnId: imported.returnId, decision: 'approve', note: 'Creator must not review.' }
  }, 6);
  assert.ok(creatorReview.payload.error || creatorReview.payload.result?.isError);

  const leaderTools = await mcpPost(baseUrl, leaderConnection.token, 'tools/list', {}, 10);
  const leaderToolNames = leaderTools.payload.result.tools.map(tool => tool.name);
  assert.equal(leaderToolNames.includes('nitrate_review_return'), true);
  assert.equal(leaderToolNames.includes('nitrate_pull_assignment'), false);
  const reviewTool = leaderTools.payload.result.tools.find(tool => tool.name === 'nitrate_review_return');
  assert.equal(reviewTool.annotations.destructiveHint, true);
  const leaderWorkCall = await mcpPost(baseUrl, leaderConnection.token, 'tools/call', {
    name: 'nitrate_list_work', arguments: {}
  }, 8);
  const leaderWork = mcpToolContent(leaderWorkCall);
  const remotePacket = leaderWork.packets.find(packet => packet.packetId === remoteHandoff.packetId);
  const remoteReturn = remotePacket.returns.find(item => item.id === imported.returnId);
  const reviewedBytes = await fetch(remoteReturn.assetUrl);
  assert.equal(reviewedBytes.status, 200);
  assert.deepEqual(Buffer.from(await reviewedBytes.arrayBuffer()), higgsfieldBytes);

  const apiPacketsResponse = await fetch(`${baseUrl}/api/plugin/packets`, {
    headers: { Authorization: `Bearer ${leaderPluginToken}` }
  });
  const apiPacketsText = await apiPacketsResponse.text();
  assert.match(apiPacketsText, new RegExp(externalAssetId));
  assert.equal(apiPacketsText.includes(`${fixtureOrigin}/higgsfield-result.png`), false);

  const reviewedRemoteCall = await mcpPost(baseUrl, leaderConnection.token, 'tools/call', {
    name: 'nitrate_review_return',
    arguments: { returnId: imported.returnId, decision: 'approve', note: 'Approved for the campaign.' }
  }, 9);
  const reviewedRemote = mcpToolContent(reviewedRemoteCall);
  assert.equal(reviewedRemote.status, 'approved');
  const remoteInbox = await runCli(['packets'], leaderConfig, root);
  const remoteCompleted = remoteInbox.packets.find(entry => (entry.packet || entry.project).id === remoteHandoff.packetId);
  assert.equal(remoteCompleted.activation.ahaReached, true);
  assert.equal(remoteCompleted.activation.closedLoop, true);

  await execFileAsync(process.execPath, [
    wrangler, 'd1', 'execute', 'nitrate', '--local', '--persist-to', persistDir,
    '--command', `UPDATE agency_memberships SET role = 'ai_creator'
      WHERE agency_id = '${leaderConnection.connection.agencyId}' AND user_id = '${leaderConnection.connection.userId}'`
  ], { cwd: repositoryRoot, env: wranglerEnv });
  const downgradedLeaderTools = await mcpPost(baseUrl, leaderConnection.token, 'tools/list', {}, 30);
  assert.deepEqual(downgradedLeaderTools.payload.result.tools.map(tool => tool.name).sort(), [
    'nitrate_list_work', 'nitrate_whoami'
  ]);
  await execFileAsync(process.execPath, [
    wrangler, 'd1', 'execute', 'nitrate', '--local', '--persist-to', persistDir,
    '--command', `UPDATE agency_memberships SET role = 'team_lead'
      WHERE agency_id = '${leaderConnection.connection.agencyId}' AND user_id = '${leaderConnection.connection.userId}'`
  ], { cwd: repositoryRoot, env: wranglerEnv });

  await execFileAsync(process.execPath, [
    wrangler, 'd1', 'execute', 'nitrate', '--local', '--persist-to', persistDir,
    '--command', `DELETE FROM agency_memberships
      WHERE agency_id = '${accepted.agency.id}' AND user_id = '${accepted.user.id}'`
  ], { cwd: repositoryRoot, env: wranglerEnv });
  const removedMemberMcp = await mcpPost(baseUrl, creatorConnectionTwo.token, 'tools/list', {}, 31);
  assert.equal(removedMemberMcp.response.status, 401);

  const cleanupCalls = [];
  await assert.rejects(cleanupPendingMcpReturn({
    DB: {
      prepare(sql) {
        cleanupCalls.push(sql);
        return {
          bind() {
            return sql.startsWith('SELECT')
              ? { first: async () => ({ id: 'ret_cleanup', packet_id: 'pkt_cleanup', agency_id: 'agency_cleanup', filename: 'file.png', object_key: 'returns/test.png', uploaded_at: null }) }
              : { run: async () => ({}) };
          }
        };
      }
    },
    MEDIA: { delete: async () => { throw new Error('simulated R2 delete failure'); } }
  }, 'ret_cleanup'), /simulated R2 delete failure/);
  assert.equal(cleanupCalls.some(sql => sql.startsWith('DELETE FROM returns')), false);

  await execFileAsync(process.execPath, [
    wrangler, 'd1', 'execute', 'nitrate', '--local', '--persist-to', persistDir,
    '--command', 'DROP TABLE packet_inputs'
  ], { cwd: repositoryRoot, env: wranglerEnv });
  const redactedFailure = await mcpPost(baseUrl, leaderConnection.token, 'tools/call', {
    name: 'nitrate_list_work', arguments: {}
  }, 32);
  const redactedMessage = mcpToolFailure(redactedFailure, /Nitrate could not complete this tool call\. Reference:/i);
  assert.doesNotMatch(redactedMessage, /packet_inputs|no such table|D1_ERROR/i);

  const revokedLeader = await apiJson(
    baseUrl,
    `/api/plugin/mcp-connections/${leaderConnection.connection.id}`,
    leaderPluginToken,
    { method: 'DELETE' }
  );
  assert.equal(revokedLeader.response.status, 200);
  assert.equal((await fetch(remoteReturn.assetUrl)).status, 403);

  const mcpOptions = await fetch(`${baseUrl}/mcp`, { method: 'OPTIONS', headers: { Origin: 'https://untrusted.example' } });
  assert.equal(mcpOptions.status, 405);
  assert.equal(mcpOptions.headers.get('access-control-allow-origin'), null);

  await stopProcess(worker);
  worker = undefined;
  workerOutput = '';
  worker = spawn(process.execPath, [
    wrangler, 'dev', '--local', '--ip', '127.0.0.1', '--port', String(port),
    '--persist-to', persistDir,
    '--var', `NITRATE_PUBLIC_BASE_URL:${baseUrl}`,
    '--var', 'NITRATE_MCP_ASSET_SIGNING_KEY:local-test-signing-key-32-bytes-minimum',
    '--var', `NITRATE_MCP_IMPORT_ORIGINS:${fixtureOrigin}`,
    '--var', 'NITRATE_MCP_ALLOW_HTTP_IMPORTS:true',
    '--log-level', 'error'
  ], { cwd: repositoryRoot, env: wranglerEnv, stdio: ['ignore', 'pipe', 'pipe'] });
  worker.stdout.on('data', chunk => { workerOutput += chunk; });
  worker.stderr.on('data', chunk => { workerOutput += chunk; });
  await eventuallyHealthy(baseUrl, () => workerOutput);
  const unconfiguredBootstrap = await apiJson(baseUrl, '/api/plugin/login', '', {
    method: 'POST', body: { email: 'new-leader@northwind.test', name: 'New Leader', role: 'leader' }
  });
  assert.equal(unconfiguredBootstrap.response.status, 503);
  console.log('Local Worker closed loops verified: CLI bytes and Higgsfield-style remote MCP URL import.');
} finally {
  await stopProcess(worker);
  await closeServer(fixtureServer);
  await rm(root, { recursive: true, force: true });
}
