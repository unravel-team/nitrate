#!/usr/bin/env node

import {
  DEFAULT_OUTPUT_STRUCTURE,
  DEFAULT_REVIEW_CRITERIA,
  NitrateClient,
  acceptInviteAndSave,
  configFilePath,
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
  updateWorkspaceStatus
} from '../lib/nitrate-client.mjs';

const HELP = `nitrate — get a real creative handoff into another AI agent intact

Golden path:
  nitrate login --email <email> [--role leader] [--api <url>] [--setup-code <code>]
  nitrate handoff --name <campaign> --brief <text> --input <file> --to <email> [--task <text>]
  nitrate pull [invite-url] [--dir <folder>]
  nitrate return [file] [--dir <workspace>]
  nitrate review [return-id] --decision <approve|request-changes|reject|reopen>
  nitrate mcp:connect [--name "Higgsfield Supercomputer"] [--days 7]
  nitrate mcp:list
  nitrate mcp:disconnect <connection-id>
  nitrate next
  nitrate whoami
  nitrate doctor

Useful options:
  --json                    Print one machine-readable JSON value.
  --surface <name>          Override inferred Codex/Claude Code surface.
  --agent <name>            Override the inferred agent identity.
  --setup-code <code>       Agency setup code for the first leader login.
  --input <file>            Attach a real input file (repeatable).
  --review <criterion>      Add a review criterion (repeatable).
  --folder </path>          Add an output folder (repeatable).
  --force                   On pull, preserve a non-empty target as a backup.
  --days <1-30>             Lifetime in days for a dedicated remote MCP connection.

Compatibility aliases:
  init-agency, packet:create, push, status, sync, packets

Environment:
  NITRATE_API_URL, NITRATE_TOKEN, NITRATE_CONFIG_FILE, NITRATE_SURFACE, NITRATE_AGENT, NITRATE_SETUP_CODE
`;

function parseArgs(argv) {
  const commandIndex = argv.findIndex(part => !part.startsWith('-'));
  if (commandIndex < 0) return { command: '', args: parseOptions(argv) };
  const command = argv[commandIndex];
  return { command, args: parseOptions([...argv.slice(0, commandIndex), ...argv.slice(commandIndex + 1)]) };
}

function parseOptions(parts) {
  const args = { _: [] };
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    if (part === '-h') {
      args.help = true;
      continue;
    }
    if (!part.startsWith('--')) {
      args._.push(part);
      continue;
    }
    const equals = part.indexOf('=');
    const key = part.slice(2, equals >= 0 ? equals : undefined);
    let value = equals >= 0 ? part.slice(equals + 1) : undefined;
    if (value === undefined) {
      const next = parts[index + 1];
      if (next != null && !next.startsWith('--')) {
        value = next;
        index += 1;
      } else value = true;
    }
    if (args[key] == null) args[key] = value;
    else if (Array.isArray(args[key])) args[key].push(value);
    else args[key] = [args[key], value];
  }
  return args;
}

function values(value) {
  return value == null ? [] : Array.isArray(value) ? value : [value];
}

function required(args, key, description = `--${key}`) {
  const value = args[key];
  if (value == null || value === true || String(value).trim() === '') throw new Error(`Missing ${description}`);
  return value;
}

function jsonSafe(value) {
  return JSON.parse(JSON.stringify(value, (key, item) => key === 'token' ? undefined : item));
}

function humanResult(command, result) {
  if (command === 'login') return `Logged in as ${result.user?.name} (${result.user?.role}) on ${result.agent}.`;
  if (command === 'whoami') {
    if (!result.authenticated) return 'Not logged in. Run: nitrate login --email <email>';
    return `${result.user?.name || 'Unknown user'} · ${result.user?.role || 'unknown role'} · ${result.session?.surface || inferSurface()} · ${result.session?.agent || result.user?.agent || 'unknown agent'}\nAPI: ${result.apiUrl}${result.workspace ? `\nWorkspace: ${result.workspace}` : ''}`;
  }
  if (command === 'handoff' || command === 'init-agency') {
    const invitationLines = (result.invitations || []).map(invite => `Invite: ${invite.inviteUrl || invite.url || invite.token || '(created)'}`);
    return [`Handoff ready: ${result.packet?.name || result.packetId} (${result.packetId})`, `${result.uploads.length} input${result.uploads.length === 1 ? '' : 's'} uploaded and verified.`, ...invitationLines].join('\n');
  }
  if (command === 'packet:create') return `Packet created: ${result.packet?.name || result.packetId} (${result.packetId}); ${result.uploads.length} input${result.uploads.length === 1 ? '' : 's'} uploaded.`;
  if (command === 'push') return [`Sent ${result.assignments?.length || 0} assignment${result.assignments?.length === 1 ? '' : 's'}.`, ...(result.invitations || []).map(invite => `Invite: ${invite.inviteUrl || invite.url || invite.token || '(created)'}`)].join('\n');
  if (command === 'pull') return [`Pulled ${result.project?.name || result.project?.id} into ${result.target}`, `${result.inputs.length} input${result.inputs.length === 1 ? '' : 's'} downloaded and SHA-256 verified.`, `Assignment ${result.assignment.id} acknowledged as pulled.`, ...(result.backupPath ? [`Previous target preserved at ${result.backupPath}`] : [])].join('\n');
  if (command === 'return' || command === 'sync') return `Returned ${result.receipt.file} (${result.receipt.id || 'created'}) with prompt, notes, tool, and SHA-256 receipt.`;
  if (command === 'review') return `Return ${result.returnId}: ${result.decision}.`;
  if (command === 'status') return `Assignment ${result.assignmentId} marked ${result.status}.`;
  if (command === 'packets') {
    if (!result.packets?.length) return 'No packets are visible to this agent.';
    return packetEntries(result).map(entry => `${entry.project.name} (${entry.project.id}) · ${(entry.assignments || []).map(item => `${item.id}:${item.status}`).join(', ') || 'no assignments'} · ${(entry.returns || []).length} returns`).join('\n');
  }
  if (command === 'next') return [result.message, result.command ? `Next: ${result.command}` : ''].filter(Boolean).join('\n');
  if (command === 'doctor') return [`Nitrate doctor: ${result.ok ? 'ready' : 'needs attention'}`, ...result.checks.map(check => `${check.ok ? '✓' : '✗'} ${check.name}: ${check.message || check.apiUrl || (check.found ? check.path : 'ok')}`)].join('\n');
  if (command === 'mcp:connect') {
    const connection = result.connection || {};
    return [
      `Remote MCP connection created: ${connection.label || connection.id || 'Higgsfield Supercomputer'}`,
      connection.id ? `Connection ID: ${connection.id}` : '',
      connection.expiresAt ? `Expires: ${connection.expiresAt}` : '',
      `Endpoint: ${result.endpoint}`,
      `Authorization (shown once): Bearer ${result.token}`,
      'Paste both values into your supported custom remote MCP connector. The credential is not saved locally.'
    ].filter(Boolean).join('\n');
  }
  if (command === 'mcp:list') {
    const connections = result.connections || [];
    if (!connections.length) return 'No remote MCP connections.';
    return connections.map(connection => [
      connection.id,
      connection.label || connection.client || 'Remote MCP client',
      connection.revokedAt ? `revoked ${connection.revokedAt}` : connection.expiresAt ? `expires ${connection.expiresAt}` : 'no expiry'
    ].filter(Boolean).join(' · ')).join('\n');
  }
  if (command === 'mcp:disconnect') {
    const connection = result.connection || result;
    return `Remote MCP connection revoked: ${connection.label || connection.id || 'connection'}.`;
  }
  return JSON.stringify(jsonSafe(result), null, 2);
}

async function configured() {
  const config = await loadConfig();
  return { config, client: await NitrateClient.fromConfig({ config }) };
}

function assertLeader(config, action) {
  if (config.user?.role && config.user.role !== 'team_lead') throw new Error(`Only a Nitrate leader can ${action}`);
}

function creatorFromPacked(value, fallbackTask, surface) {
  const [name, email, agent, ...task] = String(value || '').split('|');
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw new Error('Creator must use "Name|email|agent|task" with a valid email');
  return { name: inferName(email, name), email, agent: agent || inferAgent({ email, name, surface }), task: task.join('|') || fallbackTask };
}

function creatorsFromArgs(args, config) {
  const task = args.task || 'Use the supplied packet, return reviewable media, and include prompt, notes, and handoff context.';
  const surface = args['creator-surface'] || config.session?.surface || inferSurface();
  const packed = values(args.creator);
  if (packed.length) return packed.map(item => creatorFromPacked(item, task, surface));
  const emails = values(args.to || args.email);
  return emails.map((email, index) => {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw new Error(`Invalid creator email: ${email}`);
    const suppliedAgents = values(args.agent);
    const suppliedNames = values(args['creator-name']);
    return {
      email,
      name: inferName(email, suppliedNames[index] || suppliedNames[0]),
      agent: suppliedAgents[index] || suppliedAgents[0] || inferAgent({ email, surface }),
      task
    };
  });
}

async function commandLogin(args) {
  const config = await loadConfig();
  const email = args.email || process.env.NITRATE_EMAIL || config.user?.email;
  if (!email) throw new Error('Missing --email');
  return loginAndSave({
    apiUrl: args.api,
    email,
    name: args.name,
    role: args.role || config.user?.role || 'leader',
    agent: args.agent,
    surface: args.surface,
    setupCode: args['setup-code'] || process.env.NITRATE_SETUP_CODE
  });
}

async function commandWhoami(args) {
  const config = await loadConfig();
  const workspace = await findWorkspace(args.dir || process.cwd());
  return { ...publicConfig(config), configFile: configFilePath(), workspace: workspace?.dir || null, assignment: workspace?.marker?.assignment || null };
}

async function commandHandoff(args) {
  const { config, client } = await configured();
  assertLeader(config, 'create a handoff');
  const assignments = creatorsFromArgs(args, config);
  if (!assignments.length) throw new Error('Missing creator: pass --to <email> (or --creator "Name|email|agent|task")');
  const inputs = values(args.input);
  if (!inputs.length) throw new Error('Handoff requires at least one real --input file');
  return createHandoff(client, {
    name: required(args, 'name'),
    client: args.client || '',
    brief: required(args, 'brief'),
    inputs,
    outputStructure: values(args.folder).length ? values(args.folder) : DEFAULT_OUTPUT_STRUCTURE,
    reviewCriteria: values(args.review).length ? values(args.review) : DEFAULT_REVIEW_CRITERIA,
    assignments
  });
}

async function commandCreatePacket(args) {
  const { config, client } = await configured();
  assertLeader(config, 'create a packet');
  return createPacketWithInputs(client, {
    name: required(args, 'name'), client: args.client || '', brief: required(args, 'brief'), inputs: values(args.input),
    outputStructure: values(args.folder).length ? values(args.folder) : DEFAULT_OUTPUT_STRUCTURE,
    reviewCriteria: values(args.review).length ? values(args.review) : DEFAULT_REVIEW_CRITERIA
  });
}

async function commandInitAgency(args) {
  const { config, client } = await configured();
  assertLeader(config, 'create an agency packet');
  const assignments = creatorsFromArgs(args, config);
  const input = {
    name: required(args, 'name'), client: args.client || '', brief: required(args, 'brief'), inputs: values(args.input),
    outputStructure: values(args.folder).length ? values(args.folder) : DEFAULT_OUTPUT_STRUCTURE,
    reviewCriteria: values(args.review).length ? values(args.review) : DEFAULT_REVIEW_CRITERIA,
    assignments
  };
  return assignments.length ? createHandoff(client, input) : createPacketWithInputs(client, input);
}

async function commandPush(args) {
  const { config, client } = await configured();
  assertLeader(config, 'push a packet');
  const assignments = creatorsFromArgs(args, config);
  if (!assignments.length) throw new Error('Missing creator: pass --to <email> or --email <email>');
  return client.push({ packetId: required(args, 'packet'), projectId: args.packet, assignments });
}

async function commandPull(args) {
  const inviteValue = args.invite || args._[0];
  let config;
  let client;
  let packetId = args.packet;
  let assignmentId = args.assignment;
  if (inviteValue) {
    const accepted = await acceptInviteAndSave(inviteValue, { name: args.name, agent: args.agent, surface: args.surface, apiUrl: args.api });
    config = accepted.config;
    client = new NitrateClient({ apiUrl: config.apiUrl, token: config.token, user: config.user, session: config.session });
    packetId = accepted.project?.id || accepted.result?.packet?.id || packetId;
    assignmentId = accepted.assignment?.id || assignmentId;
  } else ({ config, client } = await configured());
  const data = await client.packets();
  return pullWorkspace({
    client, data, packetId, assignmentId, targetDir: args.dir, force: Boolean(args.force),
    surface: args.surface || config.session?.surface || inferSurface(),
    agent: args.agent || config.session?.agent || config.user?.agent
  });
}

async function commandReturn(args) {
  const { client } = await configured();
  return returnWorkspace({
    client, workspaceDir: args.dir || process.cwd(), file: args.file || args._[0], name: args.name,
    madeWith: args['made-with'] || args.tool, prompt: args.prompt, notes: args.notes, mime: args.type || args.mime,
    branch: args.branch, parentVersionId: args.parent || args['parent-version']
  });
}

async function commandReview(args) {
  const { config, client } = await configured();
  assertLeader(config, 'review returned work');
  return reviewReturn(client, { returnId: args.return || args.id || args._[0], decision: required(args, 'decision'), note: args.note || args.notes || '' });
}

async function commandStatus(args) {
  const { client } = await configured();
  return updateWorkspaceStatus({ client, assignmentId: args.assignment, status: required(args, 'status'), workspaceDir: args.dir || process.cwd() });
}

function connectionDays(value) {
  if (value == null) return 7;
  if (value === true || !/^\d+$/.test(String(value))) throw new Error('--days must be a whole number from 1 to 30');
  const days = Number(value);
  if (!Number.isSafeInteger(days) || days < 1 || days > 30) throw new Error('--days must be a whole number from 1 to 30');
  return days;
}

function connectionName(value) {
  if (value == null) return 'Higgsfield Supercomputer';
  if (value === true || !String(value).trim()) throw new Error('--name must be a non-empty connection name');
  return String(value).trim();
}

async function commandMcpConnect(args) {
  const { client } = await configured();
  const days = connectionDays(args.days);
  const label = connectionName(args.name);
  const result = await client.createMcpConnection({
    label,
    client: args.client && args.client !== true ? String(args.client).trim() : 'Higgsfield Supercomputer',
    expiresInSeconds: days * 24 * 60 * 60
  });
  if (!result?.token || !String(result.token).startsWith('nmc_')) throw new Error('Nitrate did not return a usable remote MCP connection token');
  return { ...result, endpoint: new URL('/mcp', `${client.apiUrl}/`).toString() };
}

async function commandMcpList() {
  return (await configured()).client.listMcpConnections();
}

async function commandMcpDisconnect(args) {
  const { client } = await configured();
  return client.revokeMcpConnection(args._[0] || args.id || args.connection);
}

async function dispatch(command, args) {
  if (!command || command === 'help' || args.help) return { help: HELP };
  if (command === 'login') return commandLogin(args);
  if (command === 'whoami') return commandWhoami(args);
  if (command === 'handoff') return commandHandoff(args);
  if (command === 'packet:create') return commandCreatePacket(args);
  if (command === 'init-agency') return commandInitAgency(args);
  if (command === 'push') return commandPush(args);
  if (command === 'pull') return commandPull(args);
  if (command === 'return' || command === 'sync') return commandReturn(args);
  if (command === 'review') return commandReview(args);
  if (command === 'status') return commandStatus(args);
  if (command === 'mcp:connect') return commandMcpConnect(args);
  if (command === 'mcp:list') return commandMcpList(args);
  if (command === 'mcp:disconnect') return commandMcpDisconnect(args);
  if (command === 'packets') return (await configured()).client.packets();
  if (command === 'next') return nextAction((await configured()).client, { workspaceDir: args.dir || process.cwd() });
  if (command === 'doctor') return doctor({ workspaceDir: args.dir || process.cwd() });
  throw new Error(`Unknown command: ${command}`);
}

const { command, args } = parseArgs(process.argv.slice(2));
try {
  const result = await dispatch(command, args);
  if (result?.help) {
    if (args.json) process.stdout.write(`${JSON.stringify({ command: 'help', usage: result.help })}\n`);
    else process.stdout.write(result.help);
  } else if (args.json) process.stdout.write(`${JSON.stringify(command === 'mcp:connect' ? result : jsonSafe(result))}\n`);
  else process.stdout.write(`${humanResult(command, result)}\n`);
  if (command === 'doctor' && !result.ok) process.exitCode = 1;
} catch (error) {
  const failure = { ok: false, error: error.message, ...(error.status ? { status: error.status } : {}) };
  if (args.json) process.stderr.write(`${JSON.stringify(failure)}\n`);
  else process.stderr.write(`nitrate: ${error.message}\n`);
  process.exitCode = 1;
}
