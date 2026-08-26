#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const CONFIG_FILE = path.join(os.homedir(), '.nitrate', 'config.json');

async function loadConfig() {
  try {
    return JSON.parse(await readFile(CONFIG_FILE, 'utf8'));
  } catch {
    return {};
  }
}

async function api(route, options = {}) {
  const config = await loadConfig();
  const apiUrl = process.env.NITRATE_API_URL || config.apiUrl;
  const token = process.env.NITRATE_TOKEN || config.token;
  if (!apiUrl) throw new Error('NITRATE_API_URL is not configured. Run nitrate login first.');
  const response = await fetch(new URL(route, apiUrl), {
    ...options,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers
    }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`);
  return payload;
}

const tools = [
  {
    name: 'nitrate_packets',
    description: 'List packets visible to the logged-in nitrate clanker plugin session.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'nitrate_assignment_status',
    description: 'Update a clanker assignment status.',
    inputSchema: {
      type: 'object',
      required: ['assignmentId', 'status'],
      properties: {
        assignmentId: { type: 'string' },
        status: { type: 'string', enum: ['delivered', 'pulled', 'working', 'returned', 'blocked'] }
      }
    }
  },
  {
    name: 'nitrate_push_packet',
    description: 'As a leader, push a packet to one creator clanker.',
    inputSchema: {
      type: 'object',
      required: ['packetId', 'email', 'name', 'clanker', 'task'],
      properties: {
        packetId: { type: 'string' },
        email: { type: 'string' },
        name: { type: 'string' },
        clanker: { type: 'string' },
        task: { type: 'string' }
      }
    }
  }
];

async function callTool(name, args) {
  if (name === 'nitrate_packets') return api('/api/plugin/packets');
  if (name === 'nitrate_assignment_status') {
    return api(`/api/plugin/assignments/${args.assignmentId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: args.status })
    });
  }
  if (name === 'nitrate_push_packet') {
    return api('/api/plugin/push', {
      method: 'POST',
      body: JSON.stringify({
        packetId: args.packetId,
        assignments: [{ email: args.email, name: args.name, clanker: args.clanker, task: args.task }]
      })
    });
  }
  throw new Error(`Unknown tool: ${name}`);
}

function send(id, result) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`);
}

function sendError(id, error) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32000, message: error.message } })}\n`);
}

let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  buffer += chunk;
  let index;
  while ((index = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    if (!line) continue;
    handle(line);
  }
});

async function handle(line) {
  let message;
  try {
    message = JSON.parse(line);
    if (message.method === 'initialize') {
      return send(message.id, {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'nitrate', version: '0.1.0' }
      });
    }
    if (message.method === 'notifications/initialized') return;
    if (message.method === 'tools/list') return send(message.id, { tools });
    if (message.method === 'tools/call') {
      const result = await callTool(message.params.name, message.params.arguments || {});
      return send(message.id, {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
      });
    }
    send(message.id, {});
  } catch (error) {
    sendError(message?.id || null, error);
  }
}
