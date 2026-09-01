#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const CONFIG_DIR = path.join(os.homedir(), '.nitrate');
const CONFIG_FILE = process.env.NITRATE_CONFIG_FILE || path.join(CONFIG_DIR, 'config.json');

function usage() {
  console.log(`nitrate

Usage:
  nitrate login --api <url> --email <email> --name <name> --role <leader|member> --clanker <name> [--surface <tool>]
  nitrate whoami
  nitrate next
  nitrate packets
  nitrate init-agency --name <packet> --client <client> --brief <text> [--creator "Name|email|clanker|task"] [--input <file>] [--folder </renders>]
  nitrate packet:create --name <name> --brief <text> [--input <file>] [--folder </renders>]
  nitrate push --packet <id> --email <email> --name <name> --clanker <name> --task <text>
  nitrate pull [--packet <id>] [--assignment <id>] [--dir <path>]
  nitrate status [--assignment <id>] --status <pulled|working|blocked|returned>
  nitrate sync [--packet <id>] [--assignment <id>] --file <path> --name <name> --made-with <tool> --prompt <text> [--notes <text>]

Environment:
  NITRATE_API_URL    Default API URL when --api is omitted.
  NITRATE_CONFIG_FILE Use a separate plugin login profile.
`);
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const args = { _: [] };
  for (let index = 0; index < rest.length; index += 1) {
    const part = rest[index];
    if (part.startsWith('--')) {
      const key = part.slice(2);
      const next = rest[index + 1];
      if (!next || next.startsWith('--')) args[key] = true;
      else {
        if (args[key] == null) args[key] = next;
        else if (Array.isArray(args[key])) args[key].push(next);
        else args[key] = [args[key], next];
        index += 1;
      }
    } else {
      args._.push(part);
    }
  }
  return { command, args };
}

async function loadConfig() {
  try {
    return JSON.parse(await readFile(CONFIG_FILE, 'utf8'));
  } catch {
    return {};
  }
}

async function saveConfig(config) {
  await mkdir(path.dirname(CONFIG_FILE), { recursive: true });
  await writeFile(CONFIG_FILE, JSON.stringify(config, null, 2));
}

async function apiFetch(config, route, options = {}) {
  const api = config.apiUrl || process.env.NITRATE_API_URL;
  if (!api) throw new Error('Run nitrate login --api <url> first');
  const headers = {
    ...(config.token ? { Authorization: `Bearer ${config.token}` } : {}),
    ...(config.user?.name ? { 'X-Reel-User': config.user.name } : {}),
    ...(options.body && !(options.body instanceof Uint8Array) && !(typeof FormData !== 'undefined' && options.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
    ...options.headers
  };
  const response = await fetch(new URL(route, api), { ...options, headers });
  const isJson = response.headers.get('content-type')?.includes('application/json');
  const payload = isJson ? await response.json() : await response.text();
  if (!response.ok) throw new Error(payload?.error || payload || `Request failed (${response.status})`);
  return payload;
}

function required(args, key) {
  if (!args[key]) throw new Error(`Missing --${key}`);
  return args[key];
}

function printJson(value) {
  console.log(JSON.stringify(value, null, 2));
}

async function readJsonIfExists(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

async function findWorkspace(start = process.cwd()) {
  let current = path.resolve(start);
  while (true) {
    const marker = path.join(current, '.nitrate', 'assignment.json');
    const data = await readJsonIfExists(marker);
    if (data) return { dir: current, marker, ...data };
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function packetsListPayload(data) {
  return Array.isArray(data?.packets)
    ? data.packets.map(item => ({ ...item, packet: item.packet || item.project }))
    : [];
}

function inferMime(file, fallback = 'application/octet-stream') {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.mp4') return 'video/mp4';
  if (ext === '.mov') return 'video/quicktime';
  if (ext === '.webm') return 'video/webm';
  if (ext === '.mp3') return 'audio/mpeg';
  if (ext === '.wav') return 'audio/wav';
  return fallback;
}

function firstActionForPacket(item, role) {
  const packet = item.packet;
  const assignments = item.assignments || [];
  const returns = item.returns || [];
  if (role === 'team_lead') {
    if (!assignments.length) return `Push "${packet.name}" to the first creator: nitrate push --packet ${packet.id} --email <email> --name <name> --clanker <clanker> --task "<task>"`;
    const waiting = assignments.find(assignment => ['delivered', 'pulled', 'working', 'blocked'].includes(assignment.status));
    if (waiting) return `${waiting.name || waiting.clanker} is ${waiting.status} on "${packet.name}". Ask for a return or adjust the packet.`;
    if (returns.some(item => item.status === 'needs_review')) return `Review returned work for "${packet.name}" in the command center.`;
    return `"${packet.name}" is clean. Start the next packet from what worked.`;
  }
  const assignment = assignments.find(item => item.status === 'delivered') || assignments.find(item => item.status === 'pulled') || assignments.find(item => item.status === 'working') || assignments[0];
  if (!assignment) return `No assignment found for "${packet.name}".`;
  if (assignment.status === 'delivered') return `Pull "${packet.name}": nitrate pull --packet ${packet.id} --assignment ${assignment.id}`;
  if (assignment.status === 'pulled') return `Mark work started: nitrate status --assignment ${assignment.id} --status working`;
  if (assignment.status === 'working') return `Sync your return from the packet folder: nitrate sync --file <render> --name "<return name>" --made-with "<tool>" --prompt "<prompt>"`;
  if (assignment.status === 'blocked') return `You are blocked on "${packet.name}". Add notes for your lead before retrying.`;
  return `"${packet.name}" is ${assignment.status}.`;
}

async function login(args) {
  const config = await loadConfig();
  const apiUrl = args.api || process.env.NITRATE_API_URL || config.apiUrl;
  if (!apiUrl) throw new Error('Missing --api');
  const input = {
    email: required(args, 'email'),
    name: args.name || args.email.split('@')[0],
    role: args.role || 'member',
    clanker: required(args, 'clanker'),
    surface: args.surface || 'Local clanker'
  };
  const result = await apiFetch({ apiUrl }, '/api/plugin/login', {
    method: 'POST',
    body: JSON.stringify(input)
  });
  await saveConfig({
    apiUrl,
    token: result.session.token,
    user: result.user,
    session: { ...result.session, token: undefined }
  });
  console.log(`Logged in as ${result.user.name} (${result.user.role}) on ${result.user.clanker}`);
}

async function whoami() {
  const config = await loadConfig();
  printJson({ apiUrl: config.apiUrl, user: config.user, session: config.session });
}

async function packets() {
  const config = await loadConfig();
  printJson(await apiFetch(config, '/api/plugin/packets'));
}

async function nextAction() {
  const config = await loadConfig();
  const workspace = await findWorkspace();
  if (workspace) {
    console.log(`Workspace: ${workspace.packet.name}`);
    console.log(`Assignment: ${workspace.assignment.id} (${workspace.assignment.status})`);
    console.log(`Next: sync a return when ready: nitrate sync --file <path> --name "<name>" --made-with "<tool>" --prompt "<prompt>"`);
    return;
  }
  const data = await apiFetch(config, '/api/plugin/packets');
  const items = packetsListPayload(data);
  if (!items.length) {
    console.log(data.mode === 'leader'
      ? 'Next: create your first agency packet with nitrate init-agency --name "<client campaign>" --client "<client>" --brief "<brief>"'
      : 'No packets assigned to this AI agent yet. Ask the lead to push a packet.');
    return;
  }
  console.log(firstActionForPacket(items[0], data.user?.role || data.mode));
}

async function createPacket(args) {
  const config = await loadConfig();
  const body = {
    name: required(args, 'name'),
    brief: required(args, 'brief'),
    client: args.client || '',
    inputAssets: [].concat(args.input || []).filter(Boolean),
    outputStructure: [].concat(args.folder || []).filter(Boolean),
    reviewCriteria: [].concat(args.review || []).filter(Boolean)
  };
  printJson(await apiFetch(config, '/api/packets', { method: 'POST', body: JSON.stringify(body) }));
}

function parseCreator(value) {
  const [name, email, clanker, ...taskParts] = String(value || '').split('|');
  if (!email || !clanker) throw new Error('Creator must use "Name|email|clanker|task"');
  return {
    name: name || email.split('@')[0],
    email,
    clanker,
    task: taskParts.join('|') || 'Work this packet and return media, prompts, notes, and handoff files.'
  };
}

async function initAgency(args) {
  const config = await loadConfig();
  const packet = await apiFetch(config, '/api/packets', {
    method: 'POST',
    body: JSON.stringify({
      name: required(args, 'name'),
      client: args.client || '',
      brief: required(args, 'brief'),
      inputAssets: [].concat(args.input || []).filter(Boolean),
      outputStructure: [].concat(args.folder || ['/inputs', '/renders', '/stills', '/prompts', '/notes', '/handoff']).filter(Boolean),
      reviewCriteria: [].concat(args.review || ['brand fit', 'client-safe', 'prompt captured', 'usable handoff']).filter(Boolean)
    })
  });
  const packetId = packet.id || packet.packet?.id || packet.project?.id;
  if (!packetId) throw new Error('Packet creation did not return an id');
  const creators = [].concat(args.creator || []).filter(Boolean).map(parseCreator);
  let pushed = null;
  if (creators.length) {
    pushed = await apiFetch(config, '/api/plugin/push', {
      method: 'POST',
      body: JSON.stringify({ packetId, projectId: packetId, assignments: creators })
    });
  }
  console.log(`Created packet: ${packet.name || packet.packet?.name || packet.project?.name || args.name} (${packetId})`);
  if (pushed) console.log(`Pushed to ${pushed.assignments.length} creator agent(s).`);
  console.log('Activation target: one creator pulls the packet, returns one output, and the lead makes one review decision.');
  printJson({ packet, pushed });
}

async function push(args) {
  const config = await loadConfig();
  const body = {
    packetId: required(args, 'packet'),
    assignments: [{
      email: required(args, 'email'),
      name: args.name || args.email.split('@')[0],
      clanker: required(args, 'clanker'),
      task: required(args, 'task')
    }]
  };
  printJson(await apiFetch(config, '/api/plugin/push', { method: 'POST', body: JSON.stringify(body) }));
}

async function pull(args) {
  const config = await loadConfig();
  const data = await apiFetch(config, '/api/plugin/packets');
  const items = packetsListPayload(data);
  const first = items[0];
  const packetId = args.packet || first?.packet?.id;
  const assignmentId = args.assignment || first?.assignments?.[0]?.id;
  if (!packetId) throw new Error('No packet supplied and no packet is assigned to this plugin');
  if (!assignmentId) throw new Error('No assignment supplied and no assignment is visible to this plugin');
  const target = path.resolve(args.dir || `nitrate-${packetId}`);
  const packet = items.find(item => item.packet.id === packetId);
  if (!packet) throw new Error('Packet not found in this plugin inbox');
  const assignment = packet.assignments.find(item => item.id === assignmentId);
  if (!assignment) throw new Error('Assignment not found in this plugin inbox');
  const folders = packet.packet.outputStructure?.length ? packet.packet.outputStructure : ['/inputs', '/renders', '/stills', '/prompts', '/notes', '/handoff'];
  await mkdir(target, { recursive: true });
  await mkdir(path.join(target, '.nitrate'), { recursive: true });
  for (const folder of folders) {
    await mkdir(path.join(target, folder.replace(/^\/+/, '')), { recursive: true });
  }
  const workspace = { apiUrl: config.apiUrl, packet: packet.packet, assignment, pulledAt: new Date().toISOString() };
  await writeFile(path.join(target, 'packet.json'), JSON.stringify(workspace, null, 2));
  await writeFile(path.join(target, '.nitrate', 'assignment.json'), JSON.stringify(workspace, null, 2));
  await writeFile(path.join(target, 'AGENT_BRIEF.md'), `# ${packet.packet.name}

${packet.packet.brief}

## Assignment

${assignment.task}

## Input assets

${(packet.packet.inputAssets || []).map(item => `- ${item}`).join('\n') || '- Add supplied assets to /inputs'}

## Required return folders

${folders.map(item => `- ${item}`).join('\n')}

## Before syncing back

- Put final media in /renders or /stills.
- Save prompts in /prompts.
- Add notes in /notes.
- Keep handoff files in /handoff.
- Run: nitrate sync --file <path> --name "<return name>" --made-with "<tool>" --prompt "<prompt>"
`);
  await writeFile(path.join(target, 'README.md'), `# Nitrate workspace

This folder was created by the Nitrate plugin.

Next commands:

\`\`\`sh
nitrate status --status working
nitrate sync --file <path> --name "<return name>" --made-with "<tool>" --prompt "<prompt>"
\`\`\`
`);
  await apiFetch(config, `/api/plugin/assignments/${assignmentId}`, { method: 'PATCH', body: JSON.stringify({ status: 'pulled' }) });
  console.log(`Pulled ${packet.packet.name} into ${target}`);
}

async function status(args) {
  const config = await loadConfig();
  const workspace = await findWorkspace(args.dir || process.cwd());
  const assignmentId = args.assignment || workspace?.assignment?.id;
  if (!assignmentId) throw new Error('Missing --assignment and no Nitrate workspace found');
  printJson(await apiFetch(config, `/api/plugin/assignments/${assignmentId}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: required(args, 'status') })
  }));
}

async function sync(args) {
  const config = await loadConfig();
  const workspace = await findWorkspace(args.dir || process.cwd());
  const file = path.resolve(required(args, 'file'));
  if (!existsSync(file)) throw new Error(`File not found: ${file}`);
  const packetId = args.packet || workspace?.packet?.id;
  const assignmentId = args.assignment || workspace?.assignment?.id;
  if (!packetId) throw new Error('Missing --packet and no Nitrate workspace found');
  if (!assignmentId) throw new Error('Missing --assignment and no Nitrate workspace found');
  const bytes = await readFile(file);
  const filename = path.basename(file);
  const contentType = args.type || inferMime(file);
  const form = new FormData();
  form.set('projectId', packetId);
  form.set('assignmentId', assignmentId);
  form.set('assetName', required(args, 'name'));
  form.set('filename', filename);
  form.set('mime', contentType);
  form.set('model', required(args, 'made-with'));
  form.set('prompt', required(args, 'prompt'));
  form.set('notes', args.notes || '');
  form.set('file', new Blob([bytes], { type: contentType }), filename);
  const upload = await apiFetch(config, '/api/uploads', {
    method: 'POST',
    body: form
  });
  printJson(upload);
}

const { command, args } = parseArgs(process.argv.slice(2));

try {
  if (!command || command === 'help' || command === '--help') usage();
  else if (command === 'login') await login(args);
  else if (command === 'whoami') await whoami();
  else if (command === 'next') await nextAction(args);
  else if (command === 'packets') await packets();
  else if (command === 'init-agency') await initAgency(args);
  else if (command === 'packet:create') await createPacket(args);
  else if (command === 'push') await push(args);
  else if (command === 'pull') await pull(args);
  else if (command === 'status') await status(args);
  else if (command === 'sync') await sync(args);
  else {
    usage();
    process.exitCode = 1;
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
