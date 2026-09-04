#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { cp, mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDir, '..');
const buildScript = path.join(scriptDir, 'build-plugin-bundles.mjs');
const expectedTools = [
  'nitrate_login',
  'nitrate_handoff',
  'nitrate_pull',
  'nitrate_return',
  'nitrate_review',
  'nitrate_packets',
  'nitrate_create_remote_connection',
  'nitrate_list_remote_connections',
  'nitrate_revoke_remote_connection'
];
const bundles = [
  { host: 'Codex', source: path.join(repositoryRoot, 'plugins', 'nitrate') },
  { host: 'Claude Code', source: path.join(repositoryRoot, 'plugins', 'claude-code') }
];

function fail(message) {
  throw new Error(`Plugin verification failed: ${message}`);
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: repositoryRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
      ...options
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', chunk => { stdout += chunk; });
    child.stderr?.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', code => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${path.basename(command)} exited ${code}: ${stderr || stdout}`.trim()));
    });
  });
}

function createRpcClient(child, host) {
  let buffer = '';
  let fatalError = null;
  const pending = new Map();
  const stderr = [];

  function rejectPending(error) {
    fatalError = fatalError || error;
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(fatalError);
    }
    pending.clear();
  }

  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', chunk => stderr.push(chunk));
  child.stdout.on('data', chunk => {
    buffer += chunk;
    let newline;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        rejectPending(new Error(`${host} MCP wrote non-JSON data to stdout: ${line}`));
        return;
      }
      const request = pending.get(String(message.id));
      if (!request) continue;
      pending.delete(String(message.id));
      clearTimeout(request.timer);
      if (message.error) request.reject(new Error(`${host} MCP error: ${message.error.message || JSON.stringify(message.error)}`));
      else request.resolve(message.result);
    }
  });
  child.on('error', error => rejectPending(error));
  child.on('exit', code => {
    if (pending.size) {
      rejectPending(new Error(`${host} MCP exited ${code}; stderr: ${stderr.join('').trim() || '(empty)'}`));
    }
  });

  return {
    request(id, method, params = {}) {
      if (fatalError) return Promise.reject(fatalError);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(String(id));
          reject(new Error(`${host} MCP timed out answering ${method}; stderr: ${stderr.join('').trim() || '(empty)'}`));
        }, 5000);
        pending.set(String(id), { resolve, reject, timer });
        child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
      });
    },
    notify(method, params = {}) {
      if (fatalError) throw fatalError;
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
    },
    stderr() {
      return stderr.join('').trim();
    }
  };
}

async function stopServer(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.stdin.end();
  await new Promise(resolve => {
    const timer = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    }, 1000);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function verifyIsolatedBundle(bundle, temporaryRoot) {
  const hostDirectory = path.join(temporaryRoot, bundle.host.toLowerCase().replaceAll(' ', '-'));
  const pluginDirectory = path.join(hostDirectory, 'plugin');
  const unrelatedDirectory = path.join(hostDirectory, 'unrelated-cwd');
  await mkdir(unrelatedDirectory, { recursive: true });
  await cp(bundle.source, pluginDirectory, { recursive: true, preserveTimestamps: true });

  const environment = {
    ...process.env,
    NITRATE_CONFIG_FILE: path.join(hostDirectory, 'isolated-config.json')
  };
  delete environment.NITRATE_API_URL;
  delete environment.NITRATE_TOKEN;
  delete environment.NODE_PATH;

  const cli = await run(process.execPath, [path.join(pluginDirectory, 'bin', 'nitrate'), '--help'], {
    cwd: unrelatedDirectory,
    env: environment
  });
  if (!/nitrate/i.test(`${cli.stdout}\n${cli.stderr}`)) {
    fail(`${bundle.host} bundled CLI did not return Nitrate help output`);
  }

  const child = spawn(process.execPath, [path.join(pluginDirectory, 'mcp', 'server.mjs')], {
    cwd: unrelatedDirectory,
    env: environment,
    stdio: ['pipe', 'pipe', 'pipe']
  });
  const rpc = createRpcClient(child, bundle.host);
  try {
    const initialized = await rpc.request(1, 'initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'nitrate-plugin-verifier', version: '0.2.0' }
    });
    if (!initialized?.serverInfo?.name || !initialized?.protocolVersion) {
      fail(`${bundle.host} MCP returned an incomplete initialize response`);
    }
    rpc.notify('notifications/initialized');
    const listed = await rpc.request(2, 'tools/list');
    if (!Array.isArray(listed?.tools)) fail(`${bundle.host} MCP tools/list did not return a tools array`);
    const actualTools = new Set(listed.tools.map(tool => tool?.name));
    const missing = expectedTools.filter(tool => !actualTools.has(tool));
    if (missing.length) fail(`${bundle.host} MCP is missing golden-path tools: ${missing.join(', ')}`);
  } finally {
    await stopServer(child);
  }
}

async function main() {
  const build = await run(process.execPath, [buildScript]);
  if (build.stderr.trim()) fail(`bundle builder wrote to stderr: ${build.stderr.trim()}`);

  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'nitrate-plugin-verify-'));
  try {
    for (const bundle of bundles) await verifyIsolatedBundle(bundle, temporaryRoot);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }

  for (const bundle of bundles) console.log(`Verified isolated ${bundle.host} plugin MCP`);
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
