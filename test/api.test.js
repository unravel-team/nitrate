'use strict';

const assert = require('node:assert/strict');
const { after, before, describe, it } = require('node:test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const { execFile } = require('node:child_process');
const { start } = require('../lib/http');

const execFileAsync = promisify(execFile);

describe('nitrate API', () => {
  let server;
  let base;
  let port;
  let dataDir;

  before(async () => {
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'reel-test-'));
    ({ server, port } = await start({ dataDir, port: 0 }));
    base = `http://127.0.0.1:${port}`;
  });

  after(() => new Promise(resolve => server.close(resolve)));

  it('seeds an inspectable workspace', async () => {
    const response = await fetch(`${base}/api/state`);
    const state = await response.json();
    assert.equal(response.status, 200);
    assert.equal(state.projects.length, 1);
    assert.equal(state.versions.length, 6);
    assert(state.versions.every(version => version.metadata.prompt && version.metadata.model));
  });

  it('commits media with required provenance and deduplicates bytes', async () => {
    const bytes = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><rect width="4" height="4"/></svg>');
    const commit = async () => {
      const form = new FormData();
      form.set('projectId', 'proj_launch_film');
      form.set('assetName', 'Unit test frame');
      form.set('filename', 'unit-frame.svg');
      form.set('mime', 'image/svg+xml');
      form.set('prompt', 'A minimal deterministic frame');
      form.set('model', 'test-model');
      form.set('seed', '42');
      form.append('file', new Blob([bytes]), 'unit-frame.svg');
      return fetch(`${base}/api/uploads`, { method: 'POST', body: form });
    };
    const first = await (await commit()).json();
    const second = await (await commit()).json();
    assert.equal(first.version.hash, second.version.hash);
    assert.equal(second.deduplicated, true);
    assert.notEqual(first.version.id, second.version.id);
  });

  it('rejects a commit without provenance', async () => {
    const form = new FormData();
    form.set('projectId', 'proj_launch_film');
    form.set('filename', 'bad.svg');
    form.set('mime', 'image/svg+xml');
    form.append('file', new Blob([Buffer.from('bad')]), 'bad.svg');
    const response = await fetch(`${base}/api/uploads`, { method: 'POST', body: form });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /Prompt and model/);
  });

  it('manages dedicated remote MCP credentials without exposing their secret again', async () => {
    const login = async (email, name) => (
      await fetch(`${base}/api/plugin/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'leader', email, name, agent: `${name.toLowerCase().replace(/\s+/g, '-')}-agent` })
      })
    ).json();
    const firstLeader = await login('mcp-owner@studio.test', 'MCP Owner');
    const secondLeader = await login('mcp-other@studio.test', 'MCP Other');
    const firstHeaders = {
      Authorization: `Bearer ${firstLeader.session.token}`,
      'Content-Type': 'application/json'
    };

    const createdResponse = await fetch(`${base}/api/plugin/mcp-connections`, {
      method: 'POST',
      headers: firstHeaders,
      body: JSON.stringify({ label: 'Higgsfield Supercomputer', client: 'higgsfield-supercomputer' })
    });
    assert.equal(createdResponse.status, 201);
    const created = await createdResponse.json();
    assert.match(created.token, /^nmc_[A-Za-z0-9_-]+$/);
    assert.equal(created.connection.label, 'Higgsfield Supercomputer');
    assert.equal(created.connection.client, 'higgsfield-supercomputer');
    assert.equal(created.connection.audience, 'nitrate-mcp');
    assert.deepEqual(created.connection.scopes, ['identity:read', 'work:read', 'assets:read', 'returns:review']);
    assert.equal(created.connection.revokedAt, null);
    assert.equal(created.connection.lastUsedAt, null);
    assert.equal(Object.hasOwn(created.connection, 'tokenHash'), false);
    assert.equal(Object.hasOwn(created.connection, 'sourceSessionId'), false);

    const listedResponse = await fetch(`${base}/api/plugin/mcp-connections`, { headers: firstHeaders });
    assert.equal(listedResponse.status, 200);
    const listed = await listedResponse.json();
    assert.equal(listed.connections.length, 1);
    assert.equal(listed.connections[0].id, created.connection.id);
    assert.equal(Object.hasOwn(listed.connections[0], 'tokenHash'), false);
    assert.equal(Object.hasOwn(listed.connections[0], 'token'), false);

    const persisted = await fs.readFile(path.join(dataDir, 'db.json'), 'utf8');
    assert.equal(persisted.includes(created.token), false, 'the MCP bearer secret must never be persisted');
    const persistedDb = JSON.parse(persisted);
    assert.equal(persistedDb.mcpConnections.length, 1);
    assert.match(persistedDb.mcpConnections[0].tokenHash, /^[a-f0-9]{64}$/);

    const scopeEscalation = await fetch(`${base}/api/plugin/mcp-connections`, {
      method: 'POST',
      headers: firstHeaders,
      body: JSON.stringify({ scopes: ['identity:read', 'assignments:pull'] })
    });
    assert.equal(scopeEscalation.status, 422);

    const wrongUserRevoke = await fetch(`${base}/api/plugin/mcp-connections/${created.connection.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${secondLeader.session.token}` }
    });
    assert.equal(wrongUserRevoke.status, 404);

    const connectionTokenOnRestRoute = await fetch(`${base}/api/plugin/packets`, {
      headers: { Authorization: `Bearer ${created.token}` }
    });
    assert.equal(connectionTokenOnRestRoute.status, 401);

    const revokedResponse = await fetch(`${base}/api/plugin/mcp-connections/${created.connection.id}`, {
      method: 'DELETE',
      headers: firstHeaders
    });
    assert.equal(revokedResponse.status, 200);
    const revoked = await revokedResponse.json();
    assert(revoked.connection.revokedAt);
    const repeatedRevoke = await fetch(`${base}/api/plugin/mcp-connections/${created.connection.id}`, {
      method: 'DELETE', headers: firstHeaders
    });
    assert.deepEqual((await repeatedRevoke.json()).connection, revoked.connection);
  });

  it('records decisions, comments, shares, projects, and waitlist entries', async () => {
    const approved = await (
      await fetch(`${base}/api/versions/v_seed_2`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'X-Reel-User': 'Jonas Reyes' },
        body: JSON.stringify({ action: 'approve', note: 'Client selected this one.' })
      })
    ).json();
    assert.equal(approved.status, 'approved');
    assert.equal(approved.decisions.at(-1).actor, 'Jonas Reyes');

    const commented = await (
      await fetch(`${base}/api/versions/${approved.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comment: 'Approved against the brief.' })
      })
    ).json();
    assert.equal(commented.comments.at(-1).body, 'Approved against the brief.');

    const shareResponse = await fetch(`${base}/api/shares`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scope: 'version', targetId: approved.id })
    });
    const share = await shareResponse.json();
    const shared = await (await fetch(`${base}/api/shared/${share.token}`)).json();
    assert.equal(shared.versions[0].id, approved.id);

    const project = await (
      await fetch(`${base}/api/projects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Q4 Launch' })
      })
    ).json();
    assert.equal(project.name, 'Q4 Launch');

    const waitlist = await (
      await fetch(`${base}/api/waitlist`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'producer@studio.test' })
      })
    ).json();
    assert.equal(waitlist.ok, true);

    const browserForm = new URLSearchParams({
      email: 'producer-no-js@studio.test',
      teamSize: '6-20',
      workflow: 'Claude Desktop',
      platform: 'Claude Desktop'
    });
    const browserFormResponse = await fetch(`${base}/api/waitlist`, {
      method: 'POST',
      body: browserForm,
      redirect: 'manual'
    });
    assert.equal(browserFormResponse.status, 303);
    assert.equal(browserFormResponse.headers.get('location'), '/for/thanks/');
  });

  it('closes a real leader-to-creator-to-review loop with verified bytes', async () => {
    const leaderLogin = await (
      await fetch(`${base}/api/plugin/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'leader', name: 'Maya Chen', email: 'maya@studio.test', agent: 'maya-agent', surface: 'Claude Code' })
      })
    ).json();
    assert.equal(leaderLogin.user.role, 'team_lead');
    assert(leaderLogin.session.token);
    const leaderHeaders = {
      Authorization: `Bearer ${leaderLogin.session.token}`,
      'Content-Type': 'application/json'
    };

    const packetResponse = await fetch(`${base}/api/packets`, {
      method: 'POST',
      headers: leaderHeaders,
      body: JSON.stringify({
        name: 'Seltzer social launch',
        client: 'Northwind',
        brief: 'Create a 9:16 launch ad that follows the supplied brand frame.',
        outputStructure: ['/inputs', '/renders', '/prompts', '/notes', '/handoff'],
        reviewCriteria: ['logo remains readable', '9:16 safe areas']
      })
    });
    assert.equal(packetResponse.status, 201);
    const packet = await packetResponse.json();

    const inputBytes = Buffer.from('real brand reference bytes');
    const inputHash = crypto.createHash('sha256').update(inputBytes).digest('hex');
    const inputReservationResponse = await fetch(`${base}/api/plugin/packets/${packet.id}/inputs`, {
      method: 'POST',
      headers: leaderHeaders,
      body: JSON.stringify({ filename: 'brand-guide.pdf', mime: 'application/pdf', size: inputBytes.length, sha256: inputHash })
    });
    assert.equal(inputReservationResponse.status, 201);
    const inputReservation = await inputReservationResponse.json();
    const inputUploadResponse = await fetch(`${base}${inputReservation.uploadPath}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${leaderLogin.session.token}`, 'Content-Type': 'application/pdf' },
      body: inputBytes
    });
    assert.equal(inputUploadResponse.status, 200);
    const duplicateInputUpload = await fetch(`${base}${inputReservation.uploadPath}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${leaderLogin.session.token}`, 'Content-Type': 'application/pdf' },
      body: inputBytes
    });
    assert.equal(duplicateInputUpload.status, 409);

    const pushResponse = await fetch(`${base}/api/plugin/push`, {
      method: 'POST',
      headers: leaderHeaders,
      body: JSON.stringify({
        projectId: packet.id,
        assignments: [{ name: 'Nia Patel', email: 'nia@studio.test', agent: 'nia-agent', task: 'Create the 9:16 hero and return /renders plus /notes.' }]
      })
    });
    assert.equal(pushResponse.status, 201);
    const pushed = await pushResponse.json();
    assert.equal(pushed.assignments.length, 1);
    assert.equal(pushed.assignments[0].status, 'delivered');
    assert.match(pushed.invitations[0].inviteUrl, /\/join\//);
    const leaderCannotFakePull = await fetch(`${base}/api/plugin/assignments/${pushed.assignments[0].id}`, {
      method: 'PATCH', headers: leaderHeaders, body: JSON.stringify({ status: 'pulled' })
    });
    assert.equal(leaderCannotFakePull.status, 403);

    const inviteToken = pushed.invitations[0].token;
    const inviteResponse = await fetch(`${base}/api/plugin/invites/${inviteToken}/accept`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Nia Patel', agent: 'nia-agent', surface: 'Claude Code' })
    });
    assert.equal(inviteResponse.status, 200);
    const memberLogin = await inviteResponse.json();
    const reusedInvite = await fetch(`${base}/api/plugin/invites/${inviteToken}/accept`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}'
    });
    assert.equal(reusedInvite.status, 409);
    const memberHeaders = {
      Authorization: `Bearer ${memberLogin.session.token}`,
      'Content-Type': 'application/json'
    };
    const memberPackets = await (await fetch(`${base}/api/plugin/packets`, { headers: memberHeaders })).json();
    assert.equal(memberPackets.mode, 'team_member');
    assert.equal(memberPackets.packets.length, 1);
    assert.equal(memberPackets.packets[0].assignments[0].agent, 'nia-agent');
    assert.equal(memberPackets.packets[0].project.inputs[0].hash, inputHash);

    const returnBeforePull = await fetch(`${base}/api/plugin/assignments/${pushed.assignments[0].id}/returns`, {
      method: 'POST',
      headers: memberHeaders,
      body: JSON.stringify({
        filename: 'too-early.svg', mime: 'image/svg+xml', size: 1, sha256: 'a'.repeat(64),
        prompt: 'Too early', madeWith: 'Claude Code', relativePath: 'renders/too-early.svg'
      })
    });
    assert.equal(returnBeforePull.status, 409);

    const downloadedInput = await fetch(`${base}${memberPackets.packets[0].project.inputs[0].downloadPath}`, {
      headers: { Authorization: `Bearer ${memberLogin.session.token}` }
    });
    assert.equal(downloadedInput.status, 200);
    assert.deepEqual(Buffer.from(await downloadedInput.arrayBuffer()), inputBytes);

    const pulledResponse = await fetch(`${base}/api/plugin/assignments/${pushed.assignments[0].id}`, {
      method: 'PATCH', headers: memberHeaders, body: JSON.stringify({ status: 'pulled' })
    });
    assert.equal(pulledResponse.status, 200);
    const pulled = await pulledResponse.json();
    assert.equal(pulled.assignment.status, 'pulled');

    const fakeReturned = await fetch(`${base}/api/plugin/assignments/${pushed.assignments[0].id}`, {
      method: 'PATCH', headers: memberHeaders, body: JSON.stringify({ status: 'returned' })
    });
    assert.equal(fakeReturned.status, 409);

    const returnBytes = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><title>real return</title></svg>');
    const returnHash = crypto.createHash('sha256').update(returnBytes).digest('hex');
    const invalidReturn = await fetch(`${base}/api/plugin/assignments/${pushed.assignments[0].id}/returns`, {
      method: 'POST',
      headers: memberHeaders,
      body: JSON.stringify({ filename: 'nia-social.svg', mime: 'image/svg+xml', size: returnBytes.length, sha256: returnHash, relativePath: '../outside.svg' })
    });
    assert.equal(invalidReturn.status, 422);

    const returnReservationResponse = await fetch(`${base}/api/plugin/assignments/${pushed.assignments[0].id}/returns`, {
      method: 'POST',
      headers: memberHeaders,
      body: JSON.stringify({
        filename: 'nia-social.svg', mime: 'image/svg+xml', size: returnBytes.length, sha256: returnHash,
        prompt: 'Social cutdown returned from the nitrate plugin', madeWith: 'Claude Code + Higgsfield Supercomputer',
        notes: 'Kept the logo inside the 9:16 safe area.', relativePath: 'renders/nia-social.svg'
      })
    });
    assert.equal(returnReservationResponse.status, 201);
    const returnReservation = await returnReservationResponse.json();
    const returnUploadResponse = await fetch(`${base}${returnReservation.uploadPath}`, {
      method: 'PUT', headers: { Authorization: `Bearer ${memberLogin.session.token}`, 'Content-Type': 'image/svg+xml' }, body: returnBytes
    });
    assert.equal(returnUploadResponse.status, 201);
    const returned = await returnUploadResponse.json();
    assert.equal(returned.version.metadata.assignmentId, pushed.assignments[0].id);
    assert.equal(returned.version.validation.complete, true);
    const repeatedReturnUpload = await fetch(`${base}${returnReservation.uploadPath}`, {
      method: 'PUT', headers: { Authorization: `Bearer ${memberLogin.session.token}` }, body: returnBytes
    });
    assert.equal(repeatedReturnUpload.status, 404);

    const memberReview = await fetch(`${base}/api/plugin/returns/${returned.version.id}`, {
      method: 'PATCH', headers: memberHeaders, body: JSON.stringify({ action: 'approve' })
    });
    assert.equal(memberReview.status, 403);
    const leaderChanges = await fetch(`${base}/api/plugin/returns/${returned.version.id}`, {
      method: 'PATCH', headers: leaderHeaders, body: JSON.stringify({ action: 'request_changes', note: 'Hold the logo for one more beat.' })
    });
    assert.equal(leaderChanges.status, 200);
    assert.equal((await leaderChanges.json()).status, 'changes_requested');
    const afterChanges = await (await fetch(`${base}/api/plugin/packets`, { headers: memberHeaders })).json();
    assert.equal(afterChanges.packets[0].assignments[0].status, 'working');

    const secondBytes = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><title>longer logo hold</title></svg>');
    const secondHash = crypto.createHash('sha256').update(secondBytes).digest('hex');
    const secondReservation = await (
      await fetch(`${base}/api/plugin/assignments/${pushed.assignments[0].id}/returns`, {
        method: 'POST',
        headers: memberHeaders,
        body: JSON.stringify({
          filename: 'nia-social-v2.svg', mime: 'image/svg+xml', size: secondBytes.length, sha256: secondHash,
          prompt: 'Extend the logo hold while preserving the 9:16 safe area.', madeWith: 'Claude Code + Higgsfield Supercomputer',
          notes: 'Applied the lead note.', relativePath: 'renders/nia-social-v2.svg', parentVersionId: returned.version.id
        })
      })
    ).json();
    const secondUpload = await fetch(`${base}${secondReservation.uploadPath}`, {
      method: 'PUT', headers: { Authorization: `Bearer ${memberLogin.session.token}`, 'Content-Type': 'image/svg+xml' }, body: secondBytes
    });
    assert.equal(secondUpload.status, 201);
    const secondReturn = await secondUpload.json();
    assert.equal(secondReturn.version.metadata.parentVersionId, returned.version.id);
    const leaderReview = await fetch(`${base}/api/plugin/returns/${secondReturn.version.id}`, {
      method: 'PATCH', headers: leaderHeaders, body: JSON.stringify({ action: 'approve', note: 'On brief and ready for client review.' })
    });
    assert.equal(leaderReview.status, 200);
    assert.equal((await leaderReview.json()).status, 'approved');

    const afterReturn = await (await fetch(`${base}/api/plugin/packets`, { headers: memberHeaders })).json();
    assert.equal(afterReturn.packets[0].assignments[0].status, 'returned');
    const leaderPackets = await (await fetch(`${base}/api/plugin/packets`, { headers: leaderHeaders })).json();
    const completed = leaderPackets.packets.find(item => item.project.id === packet.id);
    assert.equal(completed.activation.ahaReached, true);
    assert.equal(completed.activation.closedLoop, true);
  });

  it('logs in a leader CLI with --agent and stores private config', async () => {
    const configFile = path.join(dataDir, 'cli-config.json');
    const { stdout, stderr } = await execFileAsync(process.execPath, [
      path.join(__dirname, '..', 'bin', 'nitrate.mjs'),
      'login',
      '--api', base,
      '--email', 'cli-agent@studio.test',
      '--name', 'CLI Agent',
      '--role', 'leader',
      '--agent', 'cli-agent',
      '--surface', 'Codex'
    ], { env: { ...process.env, NITRATE_CONFIG_FILE: configFile } });
    const config = JSON.parse(await fs.readFile(configFile, 'utf8'));
    assert.equal(stderr, '');
    assert.match(stdout, /Logged in as CLI Agent \(team_lead\) on cli-agent/);
    assert.equal(config.user.agent, 'cli-agent');
    assert.equal(config.session.agent, 'cli-agent');
    assert.equal((await fs.stat(configFile)).mode & 0o777, 0o600);
  });

  it('serves product surfaces and immutable media', async () => {
    for (const route of [
      '/', '/app', '/plugin', '/use/', '/press', '/press/', '/for', '/for/',
      '/for/thanks/',
      '/for/codex', '/for/codex/', '/for/claude-code/', '/for/claude-desktop/',
      '/for/higgsfield-supercomputer/'
    ]) {
      const response = await fetch(`${base}${route}`);
      assert.equal(response.status, 200, route);
    }
    const agentPages = [
      ['/for/codex/', 'Nitrate for Codex'],
      ['/for/claude-code/', 'Nitrate for Claude Code'],
      ['/for/claude-desktop/', 'Nitrate for Claude Desktop'],
      ['/for/higgsfield-supercomputer/', 'Nitrate for Higgsfield Supercomputer']
    ];
    for (const [route, marker] of agentPages) {
      const response = await fetch(`${base}${route}`);
      const html = await response.text();
      assert.match(html, new RegExp(marker));
      assert.match(html, /data-aha-demo/);
      assert.match(html, /At 5:00/);
    }
    const media = await fetch(`${base}/api/media/v_seed_1`);
    assert.equal(media.status, 200);
    assert.match(media.headers.get('content-type'), /^image\/svg\+xml/);
  });
});
