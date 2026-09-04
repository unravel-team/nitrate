'use strict';

const assert = require('node:assert/strict');
const { after, before, describe, it } = require('node:test');
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { start } = require('../lib/http');

class McpClient {
  constructor(serverFile, { cwd, configFile }) {
    this.nextId = 1;
    this.pending = new Map();
    this.stderr = '';
    this.buffer = '';
    this.child = spawn(process.execPath, [serverFile], {
      cwd,
      env: { ...process.env, NITRATE_CONFIG_FILE: configFile },
      stdio: ['pipe', 'pipe', 'pipe']
    });
    this.child.stdout.setEncoding('utf8');
    this.child.stderr.setEncoding('utf8');
    this.child.stderr.on('data', chunk => { this.stderr += chunk; });
    this.child.stdout.on('data', chunk => {
      this.buffer += chunk;
      let newline;
      while ((newline = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, newline).trim();
        this.buffer = this.buffer.slice(newline + 1);
        if (!line) continue;
        const message = JSON.parse(line);
        const waiting = this.pending.get(message.id);
        if (!waiting) continue;
        clearTimeout(waiting.timer);
        this.pending.delete(message.id);
        if (message.error) waiting.reject(new Error(message.error.message));
        else waiting.resolve(message.result);
      }
    });
    this.child.on('error', error => this.rejectAll(error));
    this.child.on('exit', code => {
      if (this.pending.size) this.rejectAll(new Error(`MCP server exited ${code}: ${this.stderr}`));
    });
  }

  rejectAll(error) {
    for (const waiting of this.pending.values()) {
      clearTimeout(waiting.timer);
      waiting.reject(error);
    }
    this.pending.clear();
  }

  request(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP request timed out: ${method}; stderr: ${this.stderr}`));
      }, 10000);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  }

  async initialize() {
    const initialized = await this.request('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'nitrate-test', version: '1.0.0' }
    });
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} })}\n`);
    return initialized;
  }

  async call(name, args = {}) {
    const result = await this.request('tools/call', { name, arguments: args });
    if (result.isError) throw new Error(result.content?.[0]?.text || `MCP tool failed: ${name}`);
    return result.structuredContent;
  }

  async close() {
    if (this.child.exitCode != null) return;
    this.child.stdin.end();
    await Promise.race([
      new Promise(resolve => this.child.once('exit', resolve)),
      new Promise(resolve => setTimeout(() => {
        this.child.kill('SIGTERM');
        resolve();
      }, 1000))
    ]);
  }
}

describe('Nitrate Codex and Claude plugin MCP loop', () => {
  let server;
  let base;
  let root;
  const clients = [];

  before(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'nitrate-mcp-loop-'));
    const started = await start({ dataDir: path.join(root, 'server'), port: 0, seedDemo: false });
    server = started.server;
    base = `http://127.0.0.1:${started.port}`;
  });

  after(async () => {
    await Promise.all(clients.map(client => client.close()));
    if (server) await new Promise(resolve => server.close(resolve));
    if (root) await fs.rm(root, { recursive: true, force: true });
  });

  async function pluginClient(host, identity) {
    const serverFile = host === 'codex'
      ? path.join(__dirname, '..', 'plugins', 'nitrate', 'mcp', 'server.mjs')
      : path.join(__dirname, '..', 'plugins', 'claude-code', 'mcp', 'server.mjs');
    const client = new McpClient(serverFile, {
      cwd: root,
      configFile: path.join(root, identity, 'config.json')
    });
    clients.push(client);
    const initialized = await client.initialize();
    assert.equal(initialized.serverInfo.name, 'nitrate');
    const listed = await client.request('tools/list');
    for (const name of ['nitrate_login', 'nitrate_handoff', 'nitrate_pull', 'nitrate_return', 'nitrate_review', 'nitrate_packets']) {
      assert.ok(listed.tools.some(tool => tool.name === name), `${host} is missing ${name}`);
    }
    return client;
  }

  it('hands off from the Codex bundle, returns from Claude, and reviews in Codex', async () => {
    const leader = await pluginClient('codex', 'leader');
    const login = await leader.call('nitrate_login', {
      apiUrl: base,
      email: 'lead@mcp.test',
      name: 'MCP Lead',
      surface: 'Codex',
      agent: 'lead-codex'
    });
    assert.equal(login.user.role, 'team_lead');

    const inputFile = path.join(root, 'brand-reference.png');
    const inputBytes = Buffer.from('real PNG-like reference bytes for MCP verification');
    await fs.writeFile(inputFile, inputBytes);
    const handoff = await leader.call('nitrate_handoff', {
      name: 'MCP launch ad',
      brief: 'Create one launch frame from the supplied brand reference.',
      inputFiles: [inputFile],
      creators: [{ email: 'creator@mcp.test', name: 'MCP Creator', agent: 'creator-claude', task: 'Return one finished launch frame.' }],
      outputFolders: ['/inputs', '/renders', '/prompts', '/notes', '/handoff'],
      reviewCriteria: ['matches the supplied brand reference']
    });
    assert.equal(handoff.uploads.length, 1);
    assert.ok(handoff.invitations[0].inviteUrl);

    const creator = await pluginClient('claude', 'creator');
    const workspace = path.join(root, 'creator-workspace');
    const pulled = await creator.call('nitrate_pull', {
      invite: handoff.invitations[0].inviteUrl,
      targetDir: workspace,
      name: 'MCP Creator',
      surface: 'Claude Code',
      agent: 'creator-claude'
    });
    assert.equal(pulled.inputs.length, 1);
    assert.deepEqual(await fs.readFile(path.join(workspace, 'inputs', 'brand-reference.png')), inputBytes);

    const returnFile = path.join(workspace, 'renders', 'launch-frame.svg');
    const returnBytes = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><title>MCP launch frame</title></svg>');
    await fs.writeFile(returnFile, returnBytes);
    const returned = await creator.call('nitrate_return', {
      workspaceDir: workspace,
      file: returnFile,
      madeWith: 'Claude Code + Higgsfield Supercomputer',
      prompt: 'Use the supplied reference to create a clean launch frame.',
      notes: 'Ready for lead review.'
    });
    assert.equal(returned.return.validation.complete, true);
    assert.ok(returned.receipt.id);

    const reviewed = await leader.call('nitrate_review', {
      returnId: returned.receipt.id,
      decision: 'approve',
      note: 'Matches the campaign brief.'
    });
    assert.equal(reviewed.reviewed.status, 'approved');

    const packets = await leader.call('nitrate_packets');
    const completed = packets.packets.find(entry => (entry.packet || entry.project).id === handoff.packetId);
    assert.equal(completed.activation.ahaReached, true);
    assert.equal(completed.activation.closedLoop, true);
  });
});

describe('Nitrate local MCP remote connection controls', () => {
  let server;
  let base;
  let root;
  let client;
  const connection = {
    id: 'mcp_conn_02', agencyId: 'agency_02', userId: 'user_02', label: 'Higgsfield Supercomputer', client: 'Higgsfield Supercomputer',
    audience: 'nitrate-mcp', scopes: ['creator:work'], createdAt: '2026-09-04T00:00:00.000Z', expiresAt: '2026-09-11T00:00:00.000Z', revokedAt: null, lastUsedAt: null
  };

  before(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'nitrate-mcp-connection-'));
    server = http.createServer(async (request, response) => {
      const url = new URL(request.url, 'http://127.0.0.1');
      let body = '';
      for await (const chunk of request) body += chunk;
      const parsed = body ? JSON.parse(body) : null;
      if (request.headers.authorization !== 'Bearer plugin_session_for_test') {
        response.writeHead(401, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ error: 'unauthorized' }));
        return;
      }
      if (request.method === 'POST' && url.pathname === '/api/plugin/mcp-connections') {
        assert.deepEqual(parsed, { label: 'Higgsfield Supercomputer', client: 'Higgsfield Supercomputer', expiresInSeconds: 604800 });
        response.writeHead(201, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ connection, token: 'nmc_secret_returned_once' }));
        return;
      }
      if (request.method === 'GET' && url.pathname === '/api/plugin/mcp-connections') {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ connections: [connection] }));
        return;
      }
      if (request.method === 'DELETE' && url.pathname === '/api/plugin/mcp-connections/mcp_conn_02') {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ connection: { ...connection, revokedAt: '2026-09-04T01:00:00.000Z' } }));
        return;
      }
      response.writeHead(404, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'not found' }));
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
    const configFile = path.join(root, 'config.json');
    await fs.writeFile(configFile, JSON.stringify({
      apiUrl: base, token: 'plugin_session_for_test', user: { name: 'Maya', role: 'team_lead' }, session: { surface: 'Codex' }
    }));
    client = new McpClient(path.join(__dirname, '..', 'mcp', 'server.mjs'), { cwd: root, configFile });
    await client.initialize();
  });

  after(async () => {
    if (client) await client.close();
    if (server) await new Promise(resolve => server.close(resolve));
    if (root) await fs.rm(root, { recursive: true, force: true });
  });

  it('requires confirmation, exposes a freshly minted token once, then lists and revokes metadata', async () => {
    const listedTools = await client.request('tools/list');
    const createTool = listedTools.tools.find(tool => tool.name === 'nitrate_create_remote_connection');
    assert.equal(createTool.inputSchema.required.includes('confirmed'), true);
    assert.equal(createTool.outputSchema.required.includes('token'), true);
    assert.ok(listedTools.tools.some(tool => tool.name === 'nitrate_list_remote_connections'));
    assert.ok(listedTools.tools.some(tool => tool.name === 'nitrate_revoke_remote_connection'));

    await assert.rejects(client.call('nitrate_create_remote_connection', { confirmed: false }), /Explicit user confirmation/);
    const created = await client.call('nitrate_create_remote_connection', { confirmed: true, expiresInDays: 7 });
    assert.equal(created.token, 'nmc_secret_returned_once');
    assert.equal(created.connection.id, connection.id);
    assert.equal(created.endpoint, `${base}/mcp`);

    const listed = await client.call('nitrate_list_remote_connections');
    assert.equal(listed.connections[0].id, connection.id);
    assert.equal(Object.hasOwn(listed.connections[0], 'token'), false);

    const revoked = await client.call('nitrate_revoke_remote_connection', { connectionId: connection.id, confirmed: true });
    assert.equal(revoked.connection.revokedAt, '2026-09-04T01:00:00.000Z');
  });
});
