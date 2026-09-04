'use strict';

const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { promisify } = require('node:util');
const { after, before, describe, it } = require('node:test');

const execFileAsync = promisify(execFile);
const cliFile = path.join(__dirname, '..', 'bin', 'nitrate.mjs');

describe('nitrate protected leader setup', () => {
  let base;
  let configFile;
  let root;
  let server;
  let received;

  before(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'nitrate-leader-setup-'));
    configFile = path.join(root, 'config.json');
    server = http.createServer(async (request, response) => {
      let body = '';
      for await (const chunk of request) body += chunk;
      received = {
        header: request.headers['x-nitrate-bootstrap-secret'],
        body: JSON.parse(body)
      };
      response.writeHead(201, { 'content-type': 'application/json' });
      response.end(JSON.stringify({
        session: {
          id: 'session_setup_test',
          token: 'plugin_session_setup_test',
          userId: 'user_setup_test',
          agencyId: 'agency_setup_test',
          role: 'team_lead',
          surface: 'Codex',
          agent: 'lead-codex'
        },
        user: { id: 'user_setup_test', email: 'lead@agency.test', name: 'Lead', role: 'team_lead', agent: 'lead-codex' },
        agency: { id: 'agency_setup_test', name: 'Agency' }
      }));
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
    if (root) await fs.rm(root, { recursive: true, force: true });
  });

  it('sends the setup code only as a request header and never saves it', async () => {
    const setupCode = 'workspace_setup_test_value';
    const result = await execFileAsync(process.execPath, [
      cliFile,
      'login',
      '--api', base,
      '--email', 'lead@agency.test',
      '--name', 'Lead',
      '--surface', 'Codex',
      '--agent', 'lead-codex',
      '--setup-code', setupCode,
      '--json'
    ], {
      cwd: root,
      env: { ...process.env, NITRATE_CONFIG_FILE: configFile }
    });

    assert.equal(result.stderr, '');
    assert.equal(JSON.parse(result.stdout).user.role, 'team_lead');
    assert.equal(received.header, setupCode);
    assert.equal(Object.hasOwn(received.body, 'setupCode'), false);
    assert.equal(Object.hasOwn(received.body, 'bootstrapSecret'), false);
    const saved = await fs.readFile(configFile, 'utf8');
    assert.doesNotMatch(saved, new RegExp(setupCode));
    assert.match(saved, /plugin_session_setup_test/);
  });
});
