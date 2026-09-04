'use strict';

const assert = require('node:assert/strict');
const { after, before, describe, it } = require('node:test');
const { execFile } = require('node:child_process');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { promisify } = require('node:util');
const { start } = require('../lib/http');

const execFileAsync = promisify(execFile);
const cliFile = path.join(__dirname, '..', 'bin', 'nitrate.mjs');

describe('nitrate CLI golden path', () => {
  let server;
  let base;
  let root;
  let leaderConfig;
  let creatorConfig;

  before(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'nitrate-cli-loop-'));
    leaderConfig = path.join(root, 'leader', 'config.json');
    creatorConfig = path.join(root, 'creator', 'config.json');
    const started = await start({ dataDir: path.join(root, 'server'), port: 0, seedDemo: false });
    server = started.server;
    base = `http://127.0.0.1:${started.port}`;
  });

  after(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
    if (root) await fs.rm(root, { recursive: true, force: true });
  });

  async function cli(args, { config = leaderConfig, cwd = root } = {}) {
    const result = await execFileAsync(process.execPath, [cliFile, ...args, '--json'], {
      cwd,
      env: { ...process.env, NITRATE_CONFIG_FILE: config }
    });
    assert.equal(result.stderr, '');
    return JSON.parse(result.stdout);
  }

  it('moves one real brief from leader to creator and back to an approved return', async () => {
    const login = await cli([
      'login', '--api', base, '--email', 'maya@northwind.test', '--name', 'Maya Chen',
      '--surface', 'Claude Code', '--agent', 'maya-claude'
    ]);
    assert.equal(login.user.role, 'team_lead');
    assert.equal((await fs.stat(leaderConfig)).mode & 0o777, 0o600);

    const brandGuide = path.join(root, 'northwind-brand-guide.pdf');
    const brandBytes = Buffer.from('%PDF-1.4\nNorthwind violet, safe-area, and logo rules\n%%EOF');
    await fs.writeFile(brandGuide, brandBytes);
    const handoff = await cli([
      'handoff',
      '--name', 'Northwind vertical launch',
      '--client', 'Northwind',
      '--brief', 'Create a 9:16 launch ad. Keep the product mark readable and follow the supplied brand guide.',
      '--input', brandGuide,
      '--to', 'nia@studio.test',
      '--creator-name', 'Nia Patel',
      '--task', 'Create the product-first 9:16 route and return one reviewable hero render.',
      '--review', 'logo stays readable',
      '--review', '9:16 safe areas are respected',
      '--folder', '/inputs',
      '--folder', '/renders',
      '--folder', '/prompts',
      '--folder', '/notes',
      '--folder', '/handoff'
    ]);
    assert.ok(handoff.packetId);
    assert.equal(handoff.uploads.length, 1);
    assert.equal(handoff.uploads[0].size, brandBytes.length);
    assert.match(handoff.invitations[0].inviteUrl, new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/join/`));

    const workspace = path.join(root, 'nia-workspace');
    const pulled = await cli([
      'pull', handoff.invitations[0].inviteUrl, '--dir', workspace,
      '--name', 'Nia Patel', '--surface', 'Codex', '--agent', 'nia-codex'
    ], { config: creatorConfig });
    assert.equal(pulled.inputs.length, 1);
    assert.equal(pulled.receipt.inputsVerified, true);
    assert.equal(pulled.receipt.inputCount, 1);
    assert.deepEqual(await fs.readFile(path.join(workspace, 'inputs', 'northwind-brand-guide.pdf')), brandBytes);
    assert.equal((await fs.stat(creatorConfig)).mode & 0o777, 0o600);
    const brief = await fs.readFile(path.join(workspace, 'AGENT_BRIEF.md'), 'utf8');
    assert.match(brief, /Create the product-first 9:16 route/);
    assert.match(brief, /logo stays readable/);
    assert.match(brief, /SHA-256/);

    await assert.rejects(
      cli(['pull', handoff.invitations[0].inviteUrl, '--dir', path.join(root, 'reused-invite')], { config: creatorConfig }),
      error => /already been accepted/i.test(error.stderr || error.message)
    );

    const renderBytes = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><title>Northwind launch hero</title></svg>');
    await fs.writeFile(path.join(workspace, 'renders', 'hero.svg'), renderBytes);
    await fs.writeFile(path.join(workspace, 'prompts', 'hero.md'), 'Product-first macro shot, violet stage, readable Northwind mark.');
    await fs.writeFile(path.join(workspace, 'notes', 'hero.md'), 'Prepared as a 9:16 client-review render.');

    const returned = await cli([
      'return', 'renders/hero.svg', '--dir', workspace,
      '--made-with', 'Codex + Higgsfield Supercomputer'
    ], { config: creatorConfig, cwd: workspace });
    assert.ok(returned.receipt.id);
    assert.equal(returned.receipt.size, renderBytes.length);
    assert.equal(returned.return.validation.complete, true);

    const reviewed = await cli([
      'review', returned.receipt.id, '--decision', 'approve',
      '--note', 'Matches the brief and is ready for client review.'
    ]);
    assert.equal(reviewed.decision, 'approve');
    assert.equal(reviewed.reviewed.status, 'approved');

    const inbox = await cli(['packets']);
    const completed = inbox.packets.find(entry => (entry.packet || entry.project).id === handoff.packetId);
    assert.equal(completed.activation.ahaReached, true);
    assert.equal(completed.activation.closedLoop, true);
    assert.equal(completed.activation.uploadedInputCount, 1);

    const doctor = await cli(['doctor', '--dir', workspace], { config: creatorConfig, cwd: workspace });
    assert.equal(doctor.ok, true);
    assert.equal(doctor.checks.find(check => check.name === 'workspace').found, true);
  });
});

describe('nitrate CLI remote MCP connection controls', () => {
  let server;
  let base;
  let root;
  let configFile;
  const requests = [];
  const connection = {
    id: 'mcp_conn_01', agencyId: 'agency_01', userId: 'user_01', label: 'Higgsfield Supercomputer', client: 'Higgsfield Supercomputer',
    audience: 'nitrate-mcp', scopes: ['creator:work'], createdAt: '2026-09-04T00:00:00.000Z', expiresAt: '2026-09-11T00:00:00.000Z', revokedAt: null, lastUsedAt: null
  };

  before(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'nitrate-cli-mcp-'));
    configFile = path.join(root, 'config.json');
    await fs.writeFile(configFile, JSON.stringify({
      apiUrl: 'http://127.0.0.1:0', token: 'plugin_session_for_test', user: { name: 'Maya', role: 'team_lead' }, session: { surface: 'Codex' }
    }));
    server = http.createServer(async (request, response) => {
      const url = new URL(request.url, 'http://127.0.0.1');
      let body = '';
      for await (const chunk of request) body += chunk;
      requests.push({ method: request.method, path: url.pathname, authorization: request.headers.authorization, body: body ? JSON.parse(body) : null });
      if (request.headers.authorization !== 'Bearer plugin_session_for_test') {
        response.writeHead(401, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ error: 'unauthorized' }));
        return;
      }
      if (request.method === 'POST' && url.pathname === '/api/plugin/mcp-connections') {
        response.writeHead(201, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ connection, token: 'nmc_shown_once_only' }));
        return;
      }
      if (request.method === 'GET' && url.pathname === '/api/plugin/mcp-connections') {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ connections: [connection] }));
        return;
      }
      if (request.method === 'DELETE' && url.pathname === '/api/plugin/mcp-connections/mcp_conn_01') {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ connection: { ...connection, revokedAt: '2026-09-04T01:00:00.000Z' } }));
        return;
      }
      response.writeHead(404, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'not found' }));
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
    await fs.writeFile(configFile, JSON.stringify({
      apiUrl: base, token: 'plugin_session_for_test', user: { name: 'Maya', role: 'team_lead' }, session: { surface: 'Codex' }
    }));
  });

  after(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
    if (root) await fs.rm(root, { recursive: true, force: true });
  });

  async function cli(args) {
    const result = await execFileAsync(process.execPath, [cliFile, ...args, '--json'], {
      cwd: root,
      env: { ...process.env, NITRATE_CONFIG_FILE: configFile }
    });
    assert.equal(result.stderr, '');
    return JSON.parse(result.stdout);
  }

  it('creates, lists, and revokes a dedicated MCP token without persisting it', async () => {
    const created = await cli(['mcp:connect', '--days', '7']);
    assert.equal(created.token, 'nmc_shown_once_only');
    assert.equal(created.connection.id, connection.id);
    assert.equal(created.endpoint, `${base}/mcp`);
    assert.deepEqual(requests[0], {
      method: 'POST', path: '/api/plugin/mcp-connections', authorization: 'Bearer plugin_session_for_test',
      body: { label: 'Higgsfield Supercomputer', client: 'Higgsfield Supercomputer', expiresInSeconds: 604800 }
    });
    assert.doesNotMatch(await fs.readFile(configFile, 'utf8'), /nmc_shown_once_only/);

    const listed = await cli(['mcp:list']);
    assert.equal(listed.connections[0].id, connection.id);
    assert.equal(Object.hasOwn(listed.connections[0], 'token'), false);

    const revoked = await cli(['mcp:disconnect', connection.id]);
    assert.equal(revoked.connection.revokedAt, '2026-09-04T01:00:00.000Z');
  });

  it('rejects unsafe remote MCP credential lifetimes', async () => {
    await assert.rejects(
      execFileAsync(process.execPath, [cliFile, 'mcp:connect', '--days', '31', '--json'], { cwd: root, env: { ...process.env, NITRATE_CONFIG_FILE: configFile } }),
      error => /whole number from 1 to 30/.test(error.stderr)
    );
  });
});
