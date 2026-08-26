'use strict';

const assert = require('node:assert/strict');
const { after, before, describe, it } = require('node:test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { start } = require('../lib/http');

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
  });

  it('supports leader and team-member clanker plugin workflow', async () => {
    const leaderLogin = await (
      await fetch(`${base}/api/plugin/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'leader', name: 'Maya Chen', email: 'maya@studio.test', clanker: 'maya-clanker', surface: 'Claude Code' })
      })
    ).json();
    assert.equal(leaderLogin.user.role, 'team_lead');
    assert(leaderLogin.session.token);

    const leaderPackets = await (await fetch(`${base}/api/plugin/packets?token=${leaderLogin.session.token}`)).json();
    assert.equal(leaderPackets.mode, 'leader');
    assert(leaderPackets.packets.some(packet => packet.project.id === 'proj_launch_film'));

    const pushed = await (
      await fetch(`${base}/api/plugin/push`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Reel-User': 'Maya Chen' },
        body: JSON.stringify({
          projectId: 'proj_launch_film',
          assignments: [{ name: 'Nia Patel', email: 'nia@studio.test', clanker: 'nia-clanker', task: 'Create social cutdowns and return /renders plus /notes.' }]
        })
      })
    ).json();
    assert.equal(pushed.assignments.length, 1);
    assert.equal(pushed.assignments[0].status, 'delivered');

    const memberLogin = await (
      await fetch(`${base}/api/plugin/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'member', name: 'Nia Patel', email: 'nia@studio.test', clanker: 'nia-clanker', surface: 'Claude' })
      })
    ).json();
    const memberPackets = await (await fetch(`${base}/api/plugin/packets?token=${memberLogin.session.token}`)).json();
    assert.equal(memberPackets.mode, 'team_member');
    assert.equal(memberPackets.packets.length, 1);
    assert.equal(memberPackets.packets[0].assignments[0].clanker, 'nia-clanker');

    const pulled = await (
      await fetch(`${base}/api/plugin/assignments/${pushed.assignments[0].id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'X-Reel-User': 'Nia Patel' },
        body: JSON.stringify({ status: 'pulled' })
      })
    ).json();
    assert.equal(pulled.assignment.status, 'pulled');

    const form = new FormData();
    form.set('projectId', 'proj_launch_film');
    form.set('assignmentId', pushed.assignments[0].id);
    form.set('assetName', 'Nia social cutdown');
    form.set('filename', 'nia-social.svg');
    form.set('mime', 'image/svg+xml');
    form.set('prompt', 'Social cutdown returned from the nitrate plugin');
    form.set('model', 'Claude');
    form.append('file', new Blob([Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><title>return</title></svg>')]), 'nia-social.svg');
    const returned = await (
      await fetch(`${base}/api/uploads`, {
        method: 'POST',
        headers: { 'X-Reel-User': 'Nia Patel' },
        body: form
      })
    ).json();
    assert.equal(returned.version.metadata.assignmentId, pushed.assignments[0].id);
    const afterReturn = await (await fetch(`${base}/api/plugin/packets?token=${memberLogin.session.token}`)).json();
    assert.equal(afterReturn.packets[0].assignments[0].status, 'returned');
  });

  it('serves product surfaces and immutable media', async () => {
    for (const route of ['/', '/app', '/plugin', '/use/', '/press']) {
      const response = await fetch(`${base}${route}`);
      assert.equal(response.status, 200, route);
    }
    const media = await fetch(`${base}/api/media/v_seed_1`);
    assert.equal(media.status, 200);
    assert.match(media.headers.get('content-type'), /^image\/svg\+xml/);
  });
});
