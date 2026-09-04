#!/usr/bin/env node

import {
  DEFAULT_OUTPUT_STRUCTURE,
  DEFAULT_REVIEW_CRITERIA,
  NitrateClient,
  acceptInviteAndSave,
  createHandoff,
  createPacketWithInputs,
  doctor,
  findWorkspace,
  inferAgent,
  inferName,
  inferSurface,
  loadConfig,
  loginAndSave,
  nextAction,
  packetEntries,
  publicConfig,
  pullWorkspace,
  returnWorkspace,
  reviewReturn,
  updateWorkspaceStatus,
  uploadPacketInput
} from '../lib/nitrate-client.mjs';

const VERSION = '0.2.0';
const objectOutput = { type: 'object', additionalProperties: true };

function schema(properties = {}, required = []) {
  return { type: 'object', properties, required, additionalProperties: false };
}

function annotations(title, { readOnly = false, destructive = false, idempotent = readOnly, openWorld = true } = {}) {
  return { title, readOnlyHint: readOnly, destructiveHint: destructive, idempotentHint: idempotent, openWorldHint: openWorld };
}

const creatorSchema = {
  type: 'object',
  required: ['email'],
  properties: {
    email: { type: 'string', description: 'Creator work email.' },
    name: { type: 'string', description: 'Creator display name; inferred from email when omitted.' },
    agent: { type: 'string', description: 'Agent identity; inferred when omitted.' },
    task: { type: 'string', description: 'The concrete work assigned to this creator.' }
  },
  additionalProperties: false
};

const mcpConnectionSchema = {
  type: 'object',
  required: ['id', 'agencyId', 'userId', 'audience', 'scopes', 'createdAt', 'expiresAt', 'revokedAt', 'lastUsedAt'],
  properties: {
    id: { type: 'string' },
    agencyId: { type: 'string' },
    userId: { type: 'string' },
    label: { type: ['string', 'null'] },
    client: { type: ['string', 'null'] },
    audience: { type: 'string', const: 'nitrate-mcp' },
    scopes: { type: 'array', items: { type: 'string' } },
    createdAt: { type: 'string' },
    expiresAt: { type: ['string', 'null'] },
    revokedAt: { type: ['string', 'null'] },
    lastUsedAt: { type: ['string', 'null'] }
  },
  additionalProperties: false
};

const createMcpConnectionOutput = {
  type: 'object',
  required: ['connection', 'token', 'endpoint'],
  properties: {
    connection: mcpConnectionSchema,
    token: { type: 'string', pattern: '^nmc_' },
    endpoint: { type: 'string', format: 'uri' }
  },
  additionalProperties: false
};

const tools = [
  {
    name: 'nitrate_login',
    title: 'Log in to Nitrate',
    description: 'Start a Nitrate leader session and securely save it for this CLI/MCP installation. Surface and agent are inferred for Codex or Claude Code when omitted. Creators authenticate by pulling their invite URL.',
    inputSchema: schema({
      email: { type: 'string', description: 'Work email.' },
      role: { type: 'string', enum: ['leader'], default: 'leader', description: 'Leader login only; creators pull an invite URL.' },
      apiUrl: { type: 'string', description: 'Nitrate API base URL; uses existing config, environment, or localhost when omitted.' },
      setupCode: { type: 'string', description: 'One-time agency setup code for the first leader login. Treat as sensitive and never repeat or persist it.' },
      name: { type: 'string' },
      surface: { type: 'string' },
      agent: { type: 'string' }
    }, ['email']),
    outputSchema: objectOutput,
    annotations: annotations('Log in to Nitrate')
  },
  {
    name: 'nitrate_whoami',
    title: 'Inspect Nitrate identity',
    description: 'Show the current Nitrate identity, agent surface, API, and local assignment workspace without exposing the session token.',
    inputSchema: schema({ workspaceDir: { type: 'string', description: 'Directory to search upward from for a pulled assignment.' } }),
    outputSchema: objectOutput,
    annotations: annotations('Inspect Nitrate identity', { readOnly: true, openWorld: false })
  },
  {
    name: 'nitrate_next_action',
    title: 'Get the next Nitrate action',
    description: 'Inspect the inbox and local receipt, then return one concrete next action: create a handoff, pull, work, return, review, or wait.',
    inputSchema: schema({ workspaceDir: { type: 'string' } }),
    outputSchema: objectOutput,
    annotations: annotations('Get next Nitrate action', { readOnly: true })
  },
  {
    name: 'nitrate_packets',
    title: 'List Nitrate packets',
    description: 'List every packet, exact assignment, verified input manifest, return, and activation state visible to this session.',
    inputSchema: schema(),
    outputSchema: objectOutput,
    annotations: annotations('List Nitrate packets', { readOnly: true })
  },
  {
    name: 'nitrate_handoff',
    title: 'Create and send a complete handoff',
    description: 'Leader golden path: create a real packet, hash and upload every local input file, then send exact assignments and return invite URLs. Invitations are not sent until all input bytes are stored.',
    inputSchema: schema({
      name: { type: 'string', description: 'Campaign or packet name.' },
      brief: { type: 'string', description: 'The real creative brief.' },
      client: { type: 'string' },
      inputFiles: { type: 'array', minItems: 1, items: { type: 'string' }, description: 'Absolute or working-directory-relative local files to upload.' },
      creators: { type: 'array', minItems: 1, items: creatorSchema },
      outputFolders: { type: 'array', items: { type: 'string' } },
      reviewCriteria: { type: 'array', items: { type: 'string' } }
    }, ['name', 'brief', 'inputFiles', 'creators']),
    outputSchema: objectOutput,
    annotations: annotations('Create and send a handoff')
  },
  {
    name: 'nitrate_create_packet',
    title: 'Create a Nitrate packet',
    description: 'Create a leader-owned packet and upload any local input files, without sending it yet.',
    inputSchema: schema({
      name: { type: 'string' },
      brief: { type: 'string' },
      client: { type: 'string' },
      inputFiles: { type: 'array', items: { type: 'string' } },
      outputFolders: { type: 'array', items: { type: 'string' } },
      reviewCriteria: { type: 'array', items: { type: 'string' } }
    }, ['name', 'brief']),
    outputSchema: objectOutput,
    annotations: annotations('Create a Nitrate packet')
  },
  {
    name: 'nitrate_add_packet_input',
    title: 'Upload a packet input',
    description: 'Hash a real local file, reserve its packet input, and upload the exact bytes.',
    inputSchema: schema({ packetId: { type: 'string' }, file: { type: 'string' }, name: { type: 'string' }, mime: { type: 'string' } }, ['packetId', 'file']),
    outputSchema: objectOutput,
    annotations: annotations('Upload a packet input')
  },
  {
    name: 'nitrate_push_packet',
    title: 'Push a packet to creators',
    description: 'Send an existing packet with uploaded inputs to one or more creators and return their pre-authorized invite URLs.',
    inputSchema: schema({ packetId: { type: 'string' }, creators: { type: 'array', minItems: 1, items: creatorSchema } }, ['packetId', 'creators']),
    outputSchema: objectOutput,
    annotations: annotations('Push packet to creators')
  },
  {
    name: 'nitrate_pull',
    title: 'Pull a Nitrate assignment',
    description: 'Optionally accept an invite URL, select the exact assignment, validate safe folders, download and SHA-256 verify every real input, write AGENT_BRIEF.md plus receipts, and only then acknowledge the pull.',
    inputSchema: schema({
      invite: { type: 'string', description: 'Invite URL or token. Omit when already logged in.' },
      packetId: { type: 'string' },
      assignmentId: { type: 'string' },
      targetDir: { type: 'string', description: 'Empty destination; inferred from packet name when omitted.' },
      force: { type: 'boolean', default: false, description: 'Preserve a non-empty target as a timestamped backup before replacing it.' },
      name: { type: 'string' },
      surface: { type: 'string' },
      agent: { type: 'string' }
    }),
    outputSchema: objectOutput,
    annotations: annotations('Pull Nitrate assignment')
  },
  {
    name: 'nitrate_update_assignment_status',
    title: 'Update assignment status',
    description: 'Mark the exact assignment delivered, pulled, working, or blocked; when inside a pulled workspace the assignment id is read from its receipt and the marker is updated too. Use nitrate_return for returned work so real bytes are required.',
    inputSchema: schema({
      assignmentId: { type: 'string' },
      status: { type: 'string', enum: ['delivered', 'pulled', 'working', 'blocked'] },
      workspaceDir: { type: 'string' }
    }, ['status']),
    outputSchema: objectOutput,
    annotations: annotations('Update assignment status')
  },
  {
    name: 'nitrate_return',
    title: 'Return completed media',
    description: 'Return real media bytes from a pulled workspace. The newest output, exact assignment, prompt/notes sidecars, requested output path, and Codex/Claude tool identity are inferred when omitted; a local SHA-256 return receipt is written.',
    inputSchema: schema({
      workspaceDir: { type: 'string', description: 'Pulled workspace or a directory inside it.' },
      file: { type: 'string', description: 'Media file. The newest output is selected when omitted.' },
      name: { type: 'string' },
      madeWith: { type: 'string' },
      prompt: { type: 'string' },
      notes: { type: 'string' },
      mime: { type: 'string' },
      branch: { type: 'string' },
      parentVersionId: { type: 'string' }
    }),
    outputSchema: objectOutput,
    annotations: annotations('Return completed media')
  },
  {
    name: 'nitrate_review',
    title: 'Review returned work',
    description: 'Leader-only: approve, request changes, reject, or reopen one returned version. If exactly one return awaits review, its id can be inferred.',
    inputSchema: schema({
      returnId: { type: 'string' },
      decision: { type: 'string', enum: ['approve', 'request_changes', 'request-changes', 'reject', 'reopen'] },
      note: { type: 'string' }
    }, ['decision']),
    outputSchema: objectOutput,
    annotations: annotations('Review returned work')
  },
  {
    name: 'nitrate_create_remote_connection',
    title: 'Create a remote MCP connection',
    description: 'Create a scoped, expiring, independently revocable Nitrate remote-MCP bearer credential for a supported custom connector. Ask the user to explicitly confirm the label and lifetime first; the secret is shown exactly once and must not be repeated in chat or saved to local config.',
    inputSchema: schema({
      label: { type: 'string', minLength: 1, maxLength: 120, default: 'Higgsfield Supercomputer', description: 'Human-readable connection name.' },
      client: { type: 'string', minLength: 1, maxLength: 120, default: 'Higgsfield Supercomputer', description: 'Connector client name.' },
      expiresInDays: { type: 'integer', minimum: 1, maximum: 30, default: 7, description: 'Credential lifetime in whole days.' },
      scopes: { type: 'array', items: { type: 'string' }, description: 'Optional requested scopes. Omit to use the server-side role default.' },
      confirmed: { type: 'boolean', const: true, description: 'Set true only after the user explicitly confirmed minting this credential.' }
    }, ['confirmed']),
    outputSchema: createMcpConnectionOutput,
    annotations: annotations('Create remote MCP connection', { idempotent: false })
  },
  {
    name: 'nitrate_list_remote_connections',
    title: 'List remote MCP connections',
    description: 'List remote MCP connection metadata for the current Nitrate session. Secrets are never returned.',
    inputSchema: schema(),
    outputSchema: {
      type: 'object',
      required: ['connections'],
      properties: { connections: { type: 'array', items: mcpConnectionSchema } },
      additionalProperties: false
    },
    annotations: annotations('List remote MCP connections', { readOnly: true, openWorld: false })
  },
  {
    name: 'nitrate_revoke_remote_connection',
    title: 'Revoke a remote MCP connection',
    description: 'Immediately revoke one remote MCP connection. Ask the user to explicitly confirm the connection id before revoking it; this stops the connector from using the credential.',
    inputSchema: schema({
      connectionId: { type: 'string', minLength: 1, description: 'The remote MCP connection id to revoke.' },
      confirmed: { type: 'boolean', const: true, description: 'Set true only after the user explicitly confirmed revocation.' }
    }, ['connectionId', 'confirmed']),
    outputSchema: { type: 'object', required: ['connection'], properties: { connection: mcpConnectionSchema }, additionalProperties: false },
    annotations: annotations('Revoke remote MCP connection', { destructive: true, idempotent: false })
  },
  {
    name: 'nitrate_doctor',
    title: 'Check Nitrate setup',
    description: 'Check Node, private config permissions, API health, session validity, and local workspace discovery.',
    inputSchema: schema({ workspaceDir: { type: 'string' } }),
    outputSchema: objectOutput,
    annotations: annotations('Check Nitrate setup', { readOnly: true })
  }
];

function requiredString(args, key) {
  const value = args?.[key];
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${key} is required`);
  return value;
}

function safe(value, { allowConnectionToken = false } = {}) {
  const connectionToken = allowConnectionToken && typeof value?.token === 'string' && value.token.startsWith('nmc_')
    ? value.token
    : null;
  const sanitized = JSON.parse(JSON.stringify(value, (key, item) => key === 'token' ? undefined : item));
  return connectionToken ? { ...sanitized, token: connectionToken } : sanitized;
}

async function configured() {
  const config = await loadConfig();
  return { config, client: await NitrateClient.fromConfig({ config }) };
}

function leader(config, action) {
  if (config.user?.role && config.user.role !== 'team_lead') throw new Error(`Only a Nitrate leader can ${action}`);
}

function creators(input, surface) {
  if (!Array.isArray(input) || !input.length) throw new Error('creators must contain at least one creator');
  return input.map(item => {
    const email = requiredString(item, 'email');
    return {
      email,
      name: inferName(email, item.name),
      agent: item.agent || inferAgent({ email, name: item.name, surface }),
      task: item.task || 'Use the supplied packet and return reviewable media with prompt, notes, and handoff context.'
    };
  });
}

async function callTool(name, args = {}) {
  if (name === 'nitrate_login') {
    return loginAndSave({
      email: requiredString(args, 'email'),
      role: args.role,
      apiUrl: args.apiUrl,
      name: args.name,
      surface: args.surface,
      agent: args.agent,
      setupCode: args.setupCode || process.env.NITRATE_SETUP_CODE
    });
  }
  if (name === 'nitrate_whoami') {
    const config = await loadConfig();
    const workspace = await findWorkspace(args.workspaceDir || process.cwd());
    return { ...publicConfig(config), workspace: workspace?.dir || null, assignment: workspace?.marker?.assignment || null };
  }
  if (name === 'nitrate_doctor') return doctor({ workspaceDir: args.workspaceDir || process.cwd() });

  if (name === 'nitrate_pull' && args.invite) {
    const accepted = await acceptInviteAndSave(args.invite, { name: args.name, surface: args.surface, agent: args.agent });
    const config = accepted.config;
    const client = new NitrateClient({ apiUrl: config.apiUrl, token: config.token, user: config.user, session: config.session });
    const data = await client.packets();
    return pullWorkspace({
      client,
      data,
      packetId: accepted.project?.id || accepted.result?.packet?.id || args.packetId,
      assignmentId: accepted.assignment?.id || args.assignmentId,
      targetDir: args.targetDir,
      force: Boolean(args.force),
      surface: args.surface || config.session?.surface,
      agent: args.agent || config.session?.agent
    });
  }

  const { config, client } = await configured();
  if (name === 'nitrate_next_action') return nextAction(client, { workspaceDir: args.workspaceDir || process.cwd() });
  if (name === 'nitrate_packets') return client.packets();
  if (name === 'nitrate_handoff') {
    leader(config, 'create a handoff');
    const surface = config.session?.surface || inferSurface();
    return createHandoff(client, {
      name: requiredString(args, 'name'),
      brief: requiredString(args, 'brief'),
      client: args.client || '',
      inputs: Array.isArray(args.inputFiles) ? args.inputFiles : [],
      assignments: creators(args.creators, surface),
      outputStructure: args.outputFolders?.length ? args.outputFolders : DEFAULT_OUTPUT_STRUCTURE,
      reviewCriteria: args.reviewCriteria?.length ? args.reviewCriteria : DEFAULT_REVIEW_CRITERIA
    });
  }
  if (name === 'nitrate_create_packet') {
    leader(config, 'create a packet');
    return createPacketWithInputs(client, {
      name: requiredString(args, 'name'),
      brief: requiredString(args, 'brief'),
      client: args.client || '',
      inputs: Array.isArray(args.inputFiles) ? args.inputFiles : [],
      outputStructure: args.outputFolders?.length ? args.outputFolders : DEFAULT_OUTPUT_STRUCTURE,
      reviewCriteria: args.reviewCriteria?.length ? args.reviewCriteria : DEFAULT_REVIEW_CRITERIA
    });
  }
  if (name === 'nitrate_add_packet_input') {
    leader(config, 'upload a packet input');
    return uploadPacketInput(client, requiredString(args, 'packetId'), requiredString(args, 'file'), { name: args.name, mime: args.mime });
  }
  if (name === 'nitrate_push_packet') {
    leader(config, 'push a packet');
    const packetId = requiredString(args, 'packetId');
    return client.push({ packetId, projectId: packetId, assignments: creators(args.creators, config.session?.surface || inferSurface()) });
  }
  if (name === 'nitrate_pull') {
    const data = await client.packets();
    return pullWorkspace({
      client,
      data,
      packetId: args.packetId,
      assignmentId: args.assignmentId,
      targetDir: args.targetDir,
      force: Boolean(args.force),
      surface: args.surface || config.session?.surface,
      agent: args.agent || config.session?.agent
    });
  }
  if (name === 'nitrate_update_assignment_status') {
    return updateWorkspaceStatus({ client, assignmentId: args.assignmentId, status: requiredString(args, 'status'), workspaceDir: args.workspaceDir || process.cwd() });
  }
  if (name === 'nitrate_return') {
    return returnWorkspace({
      client,
      workspaceDir: args.workspaceDir || process.cwd(),
      file: args.file,
      name: args.name,
      madeWith: args.madeWith,
      prompt: args.prompt,
      notes: args.notes,
      mime: args.mime,
      branch: args.branch,
      parentVersionId: args.parentVersionId
    });
  }
  if (name === 'nitrate_review') {
    leader(config, 'review returned work');
    return reviewReturn(client, { returnId: args.returnId, decision: requiredString(args, 'decision'), note: args.note || '' });
  }
  if (name === 'nitrate_create_remote_connection') {
    if (args.confirmed !== true) throw new Error('Explicit user confirmation is required before creating a remote MCP connection');
    const expiresInDays = args.expiresInDays == null ? 7 : args.expiresInDays;
    if (!Number.isInteger(expiresInDays) || expiresInDays < 1 || expiresInDays > 30) throw new Error('expiresInDays must be a whole number from 1 to 30');
    const label = args.label == null ? 'Higgsfield Supercomputer' : requiredString(args, 'label');
    const clientName = args.client == null ? 'Higgsfield Supercomputer' : requiredString(args, 'client');
    const result = await client.createMcpConnection({
      label,
      client: clientName,
      expiresInSeconds: expiresInDays * 24 * 60 * 60,
      ...(Array.isArray(args.scopes) ? { scopes: args.scopes } : {})
    });
    if (!result?.token || !String(result.token).startsWith('nmc_')) throw new Error('Nitrate did not return a usable remote MCP connection token');
    return { ...result, endpoint: new URL('/mcp', `${client.apiUrl}/`).toString() };
  }
  if (name === 'nitrate_list_remote_connections') return client.listMcpConnections();
  if (name === 'nitrate_revoke_remote_connection') {
    if (args.confirmed !== true) throw new Error('Explicit user confirmation is required before revoking a remote MCP connection');
    return client.revokeMcpConnection(requiredString(args, 'connectionId'));
  }
  throw Object.assign(new Error(`Unknown tool: ${name}`), { code: -32601 });
}

function resultText(name, value) {
  if (name === 'nitrate_handoff') {
    const urls = (value.invitations || []).map(item => item.inviteUrl || item.url).filter(Boolean);
    return `Handoff ${value.packet?.name || value.packetId} is ready with ${value.uploads?.length || 0} verified inputs.${urls.length ? ` Invite: ${urls.join(', ')}` : ''}`;
  }
  if (name === 'nitrate_pull') return `Pulled ${value.project?.name || value.project?.id} to ${value.target}; ${value.inputs?.length || 0} inputs verified and assignment ${value.assignment?.id} acknowledged.`;
  if (name === 'nitrate_return') return `Returned ${value.receipt?.file}; receipt ${value.receipt?.id || value.receipt?.reservationId} records bytes, prompt, notes, and tool.`;
  if (name === 'nitrate_review') return `Return ${value.returnId} marked ${value.decision}.`;
  if (name === 'nitrate_create_remote_connection') return `Remote MCP connection ${value.connection?.label || value.connection?.id} created. Endpoint: ${value.endpoint}. Authorization (shown once): Bearer ${value.token}`;
  if (name === 'nitrate_list_remote_connections') return `${value.connections?.length || 0} remote MCP connection${value.connections?.length === 1 ? '' : 's'} available; secrets are never listed.`;
  if (name === 'nitrate_revoke_remote_connection') return `Remote MCP connection ${value.connection?.label || value.connection?.id} revoked.`;
  if (name === 'nitrate_next_action') return [value.message, value.command].filter(Boolean).join(' Next: ');
  return JSON.stringify(safe(value), null, 2);
}

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function sendResult(id, result) {
  send({ jsonrpc: '2.0', id, result });
}

function sendError(id, code, message, data) {
  send({ jsonrpc: '2.0', id: id ?? null, error: { code, message, ...(data ? { data } : {}) } });
}

async function handle(message) {
  if (!message || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
    if (message?.id != null) sendError(message.id, -32600, 'Invalid Request');
    return;
  }
  const { id, method, params = {} } = message;
  if (method === 'notifications/initialized' || method === 'notifications/cancelled') return;
  if (method === 'initialize') {
    if (id == null) return;
    sendResult(id, {
      protocolVersion: ['2025-06-18', '2025-03-26', '2024-11-05'].includes(params.protocolVersion) ? params.protocolVersion : '2024-11-05',
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'nitrate', title: 'Nitrate creative handoffs', version: VERSION },
      instructions: 'Use nitrate_next_action first. Leaders create complete handoffs; creators pull exact assignments and return real media with provenance.'
    });
    return;
  }
  if (id == null) return;
  if (method === 'ping') return sendResult(id, {});
  if (method === 'tools/list') return sendResult(id, { tools });
  if (method === 'tools/call') {
    const tool = tools.find(item => item.name === params.name);
    if (!tool) return sendError(id, -32602, `Unknown tool: ${params.name}`);
    try {
      const value = safe(await callTool(params.name, params.arguments || {}), {
        allowConnectionToken: params.name === 'nitrate_create_remote_connection'
      });
      return sendResult(id, {
        content: [{ type: 'text', text: resultText(params.name, value) }],
        structuredContent: value,
        isError: false
      });
    } catch (error) {
      return sendResult(id, {
        content: [{ type: 'text', text: error.message }],
        structuredContent: { ok: false, error: error.message, ...(error.status ? { status: error.status } : {}) },
        isError: true
      });
    }
  }
  sendError(id, -32601, `Method not found: ${method}`);
}

let buffer = '';
let queue = Promise.resolve();
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  buffer += chunk;
  let newline;
  while ((newline = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    if (!line) continue;
    let message;
    try {
      message = JSON.parse(line);
    } catch (error) {
      sendError(null, -32700, 'Parse error', error.message);
      continue;
    }
    queue = queue.then(() => handle(message)).catch(error => sendError(message.id, -32603, error.message));
  }
});

process.stdin.on('end', () => {
  const line = buffer.trim();
  if (!line) return;
  try {
    const message = JSON.parse(line);
    queue = queue.then(() => handle(message)).catch(error => sendError(message.id, -32603, error.message));
  } catch (error) {
    sendError(null, -32700, 'Parse error', error.message);
  }
});
