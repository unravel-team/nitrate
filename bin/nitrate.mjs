#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const CONFIG_DIR = path.join(os.homedir(), '.nitrate');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

function usage() {
  console.log(`nitrate

Usage:
  nitrate login --api <url> --email <email> --name <name> --role <leader|member> --clanker <name> [--surface <tool>]
  nitrate whoami
  nitrate packets
  nitrate packet:create --name <name> --brief <text> [--input <file>] [--folder </renders>]
  nitrate push --packet <id> --email <email> --name <name> --clanker <name> --task <text>
  nitrate pull --packet <id> --assignment <id> [--dir <path>]
  nitrate status --assignment <id> --status <pulled|working|blocked|returned>
  nitrate sync --packet <id> --assignment <id> --file <path> --name <name> --made-with <tool> --prompt <text> [--notes <text>]

Environment:
  NITRATE_API_URL    Default API URL when --api is omitted.
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
  await mkdir(CONFIG_DIR, { recursive: true });
  await writeFile(CONFIG_FILE, JSON.stringify(config, null, 2));
}

async function apiFetch(config, route, options = {}) {
  const api = config.apiUrl || process.env.NITRATE_API_URL;
  if (!api) throw new Error('Run nitrate login --api <url> first');
  const headers = {
    ...(config.token ? { Authorization: `Bearer ${config.token}` } : {}),
    ...(options.body && !(options.body instanceof Uint8Array) ? { 'Content-Type': 'application/json' } : {}),
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
  const packetId = required(args, 'packet');
  const assignmentId = required(args, 'assignment');
  const target = path.resolve(args.dir || `nitrate-${packetId}`);
  const data = await apiFetch(config, '/api/plugin/packets');
  const packet = data.packets.find(item => item.packet.id === packetId);
  if (!packet) throw new Error('Packet not found in this plugin inbox');
  const assignment = packet.assignments.find(item => item.id === assignmentId);
  if (!assignment) throw new Error('Assignment not found in this plugin inbox');
  const folders = packet.packet.outputStructure?.length ? packet.packet.outputStructure : ['/inputs', '/renders', '/stills', '/prompts', '/notes', '/handoff'];
  await mkdir(target, { recursive: true });
  for (const folder of folders) {
    await mkdir(path.join(target, folder.replace(/^\/+/, '')), { recursive: true });
  }
  await writeFile(path.join(target, 'packet.json'), JSON.stringify({ packet: packet.packet, assignment }, null, 2));
  await apiFetch(config, `/api/plugin/assignments/${assignmentId}`, { method: 'PATCH', body: JSON.stringify({ status: 'pulled' }) });
  console.log(`Pulled ${packet.packet.name} into ${target}`);
}

async function status(args) {
  const config = await loadConfig();
  printJson(await apiFetch(config, `/api/plugin/assignments/${required(args, 'assignment')}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: required(args, 'status') })
  }));
}

async function sync(args) {
  const config = await loadConfig();
  const file = path.resolve(required(args, 'file'));
  if (!existsSync(file)) throw new Error(`File not found: ${file}`);
  const created = await apiFetch(config, '/api/returns', {
    method: 'POST',
    body: JSON.stringify({
      packetId: required(args, 'packet'),
      assignmentId: required(args, 'assignment'),
      name: required(args, 'name'),
      madeWith: required(args, 'made-with'),
      prompt: required(args, 'prompt'),
      notes: args.notes || ''
    })
  });
  const bytes = await readFile(file);
  const filename = path.basename(file);
  const contentType = args.type || 'application/octet-stream';
  const upload = await apiFetch(config, `/api/returns/${created.id}/blob?filename=${encodeURIComponent(filename)}`, {
    method: 'PUT',
    headers: { 'Content-Type': contentType },
    body: bytes
  });
  printJson({ return: created, upload });
}

const { command, args } = parseArgs(process.argv.slice(2));

try {
  if (!command || command === 'help' || command === '--help') usage();
  else if (command === 'login') await login(args);
  else if (command === 'whoami') await whoami();
  else if (command === 'packets') await packets();
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
