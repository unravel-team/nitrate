#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const CONFIG_FILE = process.env.NITRATE_CONFIG_FILE || path.join(os.homedir(), '.nitrate', 'config.json');

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
    name: 'nitrate_next_action',
    description: 'Return the next best action for the logged-in nitrate plugin user.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'nitrate_packets',
    description: 'List packets visible to the logged-in nitrate AI coding agent session.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'nitrate_assignment_status',
    description: 'Update an AI coding agent assignment status.',
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
    name: 'nitrate_create_packet',
    description: 'As a leader, create an agency packet with brief, input assets, output folders, and review criteria.',
    inputSchema: {
      type: 'object',
      required: ['name', 'brief'],
      properties: {
        name: { type: 'string' },
        client: { type: 'string' },
        brief: { type: 'string' },
        inputAssets: { type: 'array', items: { type: 'string' } },
        outputStructure: { type: 'array', items: { type: 'string' } },
        reviewCriteria: { type: 'array', items: { type: 'string' } }
      }
    }
  },
  {
    name: 'nitrate_push_packet',
    description: 'As a leader, push a packet to one AI coding agent.',
    inputSchema: {
      type: 'object',
      required: ['packetId', 'email', 'name', 'agent', 'task'],
      properties: {
        packetId: { type: 'string' },
        email: { type: 'string' },
        name: { type: 'string' },
        agent: { type: 'string' },
        task: { type: 'string' }
      }
    }
  },
  {
    name: 'nitrate_create_return',
    description: 'Create a return record for a completed assignment. Use the CLI nitrate sync for media file upload.',
    inputSchema: {
      type: 'object',
      required: ['assignmentId', 'name', 'madeWith', 'prompt'],
      properties: {
        assignmentId: { type: 'string' },
        name: { type: 'string' },
        madeWith: { type: 'string' },
        prompt: { type: 'string' },
        notes: { type: 'string' }
      }
    }
  }
];

function visiblePackets(data) {
  return Array.isArray(data?.packets)
    ? data.packets.map(item => ({ ...item, packet: item.packet || item.project }))
    : [];
}

async function callTool(name, args) {
  if (name === 'nitrate_next_action') {
    const data = await api('/api/plugin/packets');
    const packets = visiblePackets(data);
    if (!packets.length) {
      return {
        next: data.mode === 'leader'
          ? 'Create the first agency packet, then push it to AI coding agents.'
          : 'No packets are assigned to this AI coding agent yet.'
      };
    }
    const first = packets[0];
    const assignment = first.assignments?.[0];
    return {
      packet: first.packet?.name,
      assignment: assignment?.id,
      status: assignment?.status,
      next: data.mode === 'leader'
        ? 'Check assignment status and review returned work.'
        : assignment?.status === 'delivered'
          ? 'Pull the packet into a local workspace with nitrate pull.'
          : assignment?.status === 'pulled'
            ? 'Mark the assignment working, then sync a return.'
            : 'Sync completed work back with nitrate sync.'
    };
  }
  if (name === 'nitrate_packets') return api('/api/plugin/packets');
  if (name === 'nitrate_create_packet') {
    return api('/api/packets', {
      method: 'POST',
      body: JSON.stringify({
        name: args.name,
        client: args.client || '',
        brief: args.brief,
        inputAssets: args.inputAssets || [],
        outputStructure: args.outputStructure || [],
        reviewCriteria: args.reviewCriteria || []
      })
    });
  }
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
        assignments: [{ email: args.email, name: args.name, agent: args.agent, task: args.task }]
      })
    });
  }
  if (name === 'nitrate_create_return') {
    const packets = visiblePackets(await api('/api/plugin/packets'));
    const entry = packets.find(item => (item.assignments || []).some(assignment => assignment.id === args.assignmentId));
    const assignment = (entry?.assignments || []).find(item => item.id === args.assignmentId);
    if (!assignment || !entry?.packet?.id) throw new Error('Assignment not found in this plugin session');
    return api('/api/returns', {
      method: 'POST',
      body: JSON.stringify({
        packetId: assignment.packetId || entry.packet.id,
        assignmentId: args.assignmentId,
        name: args.name,
        madeWith: args.madeWith,
        prompt: args.prompt,
        notes: args.notes || ''
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
