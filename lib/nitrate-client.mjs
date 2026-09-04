import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  rmdir,
  stat,
  writeFile
} from 'node:fs/promises';

export const DEFAULT_API_URL = 'http://127.0.0.1:4173';
export const DEFAULT_OUTPUT_STRUCTURE = ['/inputs', '/renders', '/stills', '/prompts', '/notes', '/handoff'];
export const DEFAULT_REVIEW_CRITERIA = ['brand fit', 'client-safe', 'prompt captured', 'usable handoff'];
export const WORKSPACE_MARKER = path.join('.nitrate', 'assignment.json');

const MEDIA_MIME = new Map([
  ['.avif', 'image/avif'],
  ['.gif', 'image/gif'],
  ['.jpeg', 'image/jpeg'],
  ['.jpg', 'image/jpeg'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.webp', 'image/webp'],
  ['.m4v', 'video/mp4'],
  ['.mov', 'video/quicktime'],
  ['.mp4', 'video/mp4'],
  ['.webm', 'video/webm'],
  ['.aac', 'audio/aac'],
  ['.m4a', 'audio/mp4'],
  ['.mp3', 'audio/mpeg'],
  ['.ogg', 'audio/ogg'],
  ['.wav', 'audio/wav']
]);

export class NitrateApiError extends Error {
  constructor(message, { status = 0, route = '', payload = null } = {}) {
    super(message);
    this.name = 'NitrateApiError';
    this.status = status;
    this.route = route;
    this.payload = payload;
  }
}

export function configFilePath(env = process.env) {
  return env.NITRATE_CONFIG_FILE || path.join(os.homedir(), '.nitrate', 'config.json');
}

export async function loadConfig({ file = configFilePath() } = {}) {
  try {
    const config = JSON.parse(await readFile(file, 'utf8'));
    if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('expected a JSON object');
    return config;
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    if (error instanceof SyntaxError || /expected a JSON object/.test(error.message)) {
      throw new Error(`Invalid Nitrate config at ${file}: ${error.message}`);
    }
    throw error;
  }
}

export async function saveConfig(config, { file = configFilePath() } = {}) {
  const directory = path.dirname(file);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = path.join(directory, `.config-${process.pid}-${crypto.randomBytes(6).toString('hex')}.tmp`);
  try {
    await writeFile(temporary, `${JSON.stringify(config, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    await chmod(temporary, 0o600);
    await rename(temporary, file);
    await chmod(file, 0o600);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
  return file;
}

export function inferSurface(env = process.env) {
  if (env.NITRATE_SURFACE) return String(env.NITRATE_SURFACE).slice(0, 80);
  if (env.CLAUDE_CODE || env.CLAUDECODE || env.CLAUDE_CODE_ENTRYPOINT || /claude/i.test(env.TERM_PROGRAM || '')) return 'Claude Code';
  if (env.CODEX_HOME || env.CODEX_THREAD_ID || env.CODEX_SANDBOX_NETWORK_DISABLED || /codex/i.test(env.TERM_PROGRAM || '')) return 'Codex';
  if (env.CURSOR_TRACE_ID || /cursor/i.test(env.TERM_PROGRAM || '')) return 'Cursor';
  if (env.WINDSURF_SESSION_ID || /windsurf/i.test(env.TERM_PROGRAM || '')) return 'Windsurf';
  return 'AI coding agent';
}

function slug(value, fallback = 'nitrate') {
  return String(value || '')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || fallback;
}

export function inferAgent({ email = '', name = '', surface = inferSurface(), env = process.env } = {}) {
  if (env.NITRATE_AGENT) return String(env.NITRATE_AGENT).slice(0, 80);
  const identity = String(email).split('@')[0] || name || os.userInfo().username || 'creator';
  const suffix = /^codex$/i.test(surface) ? 'codex' : /claude/i.test(surface) ? 'claude' : 'agent';
  return `${slug(identity, 'creator')}-${suffix}`.slice(0, 80);
}

export function inferName(email, fallback = '') {
  if (fallback) return String(fallback).trim().slice(0, 80);
  const local = String(email || '').split('@')[0].replace(/[._+-]+/g, ' ').trim();
  return (local || 'Creator').replace(/\b\w/g, character => character.toUpperCase()).slice(0, 80);
}

export function inferMime(file, fallback = 'application/octet-stream') {
  return MEDIA_MIME.get(path.extname(file).toLowerCase()) || fallback;
}

export function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function isBytes(value) {
  return Buffer.isBuffer(value) || value instanceof Uint8Array || value instanceof ArrayBuffer;
}

function normalizeApiUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`Invalid Nitrate API URL: ${value}`);
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Nitrate API URL must use http or https');
  parsed.pathname = parsed.pathname.replace(/\/+$/, '') || '/';
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString().replace(/\/$/, '');
}

export class NitrateClient {
  constructor({ apiUrl, token = '', user = null, session = null, fetchImpl = globalThis.fetch } = {}) {
    if (!apiUrl) throw new Error('Nitrate API URL is not configured. Run nitrate login first.');
    if (typeof fetchImpl !== 'function') throw new Error('This version of Node does not provide fetch');
    this.apiUrl = normalizeApiUrl(apiUrl);
    this.token = token;
    this.user = user;
    this.session = session;
    this.fetchImpl = fetchImpl;
  }

  static async fromConfig(options = {}) {
    const config = options.config || await loadConfig({ file: options.configFile || configFilePath() });
    return new NitrateClient({
      apiUrl: options.apiUrl || process.env.NITRATE_API_URL || config.apiUrl,
      token: options.token || process.env.NITRATE_TOKEN || config.token,
      user: config.user,
      session: config.session,
      fetchImpl: options.fetchImpl
    });
  }

  async request(route, { method = 'GET', body, headers = {}, raw = false, auth = true } = {}) {
    const url = route instanceof URL || /^https?:\/\//i.test(String(route))
      ? new URL(route)
      : new URL(String(route), `${this.apiUrl}/`);
    const requestHeaders = {
      ...(auth && this.token ? { Authorization: `Bearer ${this.token}` } : {}),
      ...(this.user?.name ? { 'X-Reel-User': this.user.name } : {}),
      ...headers
    };
    let requestBody = body;
    if (body != null && !isBytes(body) && typeof body !== 'string') {
      requestBody = JSON.stringify(body);
      if (!Object.keys(requestHeaders).some(key => key.toLowerCase() === 'content-type')) {
        requestHeaders['Content-Type'] = 'application/json';
      }
    }
    const response = await this.fetchImpl(url, { method, headers: requestHeaders, ...(body != null ? { body: requestBody } : {}) });
    if (raw && response.ok) return Buffer.from(await response.arrayBuffer());
    const contentType = response.headers.get('content-type') || '';
    let payload;
    if (/json/i.test(contentType)) payload = await response.json().catch(() => null);
    else payload = await response.text().catch(() => '');
    if (!response.ok) {
      const message = payload?.error || payload?.message || (typeof payload === 'string' && payload) || `Nitrate request failed (${response.status})`;
      throw new NitrateApiError(message, { status: response.status, route: url.pathname, payload });
    }
    return payload;
  }

  login(input, { setupCode } = {}) {
    return this.request('/api/plugin/login', {
      method: 'POST',
      body: input,
      headers: setupCode ? { 'X-Nitrate-Bootstrap-Secret': setupCode } : {},
      auth: false
    });
  }

  health() {
    return this.request('/healthz', { auth: false });
  }

  packets() {
    return this.request('/api/plugin/packets');
  }

  createPacket(input) {
    return this.request('/api/packets', { method: 'POST', body: input });
  }

  reserveInput(packetId, input) {
    return this.request(`/api/plugin/packets/${encodeURIComponent(packetId)}/inputs`, { method: 'POST', body: input });
  }

  uploadBytes(uploadPath, bytes, mime = 'application/octet-stream') {
    return this.request(uploadPath, { method: 'PUT', body: bytes, headers: { 'Content-Type': mime } });
  }

  push(input) {
    return this.request('/api/plugin/push', { method: 'POST', body: input });
  }

  acceptInvite(token, input) {
    return this.request(`/api/plugin/invites/${encodeURIComponent(token)}/accept`, { method: 'POST', body: input, auth: false });
  }

  setAssignmentStatus(assignmentId, status) {
    return this.request(`/api/plugin/assignments/${encodeURIComponent(assignmentId)}`, { method: 'PATCH', body: { status } });
  }

  reserveReturn(assignmentId, input) {
    return this.request(`/api/plugin/assignments/${encodeURIComponent(assignmentId)}/returns`, { method: 'POST', body: input });
  }

  reviewReturn(returnId, input) {
    return this.request(`/api/plugin/returns/${encodeURIComponent(returnId)}`, { method: 'PATCH', body: input });
  }

  /**
   * Mint a short-lived, independently revocable bearer credential for the remote
   * Nitrate MCP endpoint. The server returns the bearer secret exactly once; this
   * client deliberately does not add it to the persisted Nitrate session config.
   */
  createMcpConnection(input = {}) {
    return this.request('/api/plugin/mcp-connections', { method: 'POST', body: input });
  }

  listMcpConnections() {
    return this.request('/api/plugin/mcp-connections');
  }

  revokeMcpConnection(connectionId) {
    if (!connectionId || !String(connectionId).trim()) throw new Error('MCP connection id is required');
    return this.request(`/api/plugin/mcp-connections/${encodeURIComponent(connectionId)}`, { method: 'DELETE' });
  }

  download(downloadPath) {
    return this.request(downloadPath, { raw: true });
  }
}

export async function loginAndSave({ apiUrl, email, name, role = 'leader', agent, surface, setupCode, configFile } = {}) {
  const resolvedApiUrl = apiUrl || process.env.NITRATE_API_URL || (await loadConfig({ file: configFile || configFilePath() })).apiUrl || DEFAULT_API_URL;
  if (!email) throw new Error('Email is required');
  const resolvedSurface = surface || inferSurface();
  const resolvedName = inferName(email, name);
  const resolvedAgent = agent || inferAgent({ email, name: resolvedName, surface: resolvedSurface });
  const client = new NitrateClient({ apiUrl: resolvedApiUrl });
  const result = await client.login({
    email,
    name: resolvedName,
    role: role === 'leader' || role === 'team_lead' ? 'leader' : 'member',
    agent: resolvedAgent,
    surface: resolvedSurface
  }, { setupCode });
  const token = result?.session?.token || result?.token;
  if (!token) throw new Error('Nitrate login did not return a session token');
  const config = {
    apiUrl: client.apiUrl,
    token,
    user: result.user || null,
    session: { ...(result.session || {}), token: undefined }
  };
  await saveConfig(config, { file: configFile || configFilePath() });
  return { ...result, apiUrl: client.apiUrl, surface: resolvedSurface, agent: resolvedAgent };
}

export function packetEntries(data) {
  if (!Array.isArray(data?.packets)) return [];
  return data.packets.map(item => ({ ...item, project: item.project || item.packet, packet: item.packet || item.project }));
}

export function packetIdOf(value) {
  return value?.id || value?.packet?.id || value?.project?.id || value?.packetId || value?.projectId || null;
}

export function returnIdOf(value) {
  return value?.version?.id || value?.return?.id || value?.id || value?.versionId || value?.returnId || null;
}

async function fileUploadDescriptor(file, overrides = {}) {
  const absolute = path.resolve(file);
  const info = await stat(absolute).catch(error => {
    if (error.code === 'ENOENT') throw new Error(`Input file not found: ${absolute}`);
    throw error;
  });
  if (!info.isFile()) throw new Error(`Expected a file: ${absolute}`);
  if (info.size <= 0) throw new Error(`File is empty: ${absolute}`);
  const bytes = await readFile(absolute);
  return {
    absolute,
    bytes,
    filename: path.basename(absolute),
    name: overrides.name || path.basename(absolute),
    mime: overrides.mime || inferMime(absolute),
    size: bytes.length,
    sha256: sha256(bytes)
  };
}

export async function uploadPacketInput(client, packetId, file, overrides = {}) {
  const descriptor = await fileUploadDescriptor(file, overrides);
  const reservation = await client.reserveInput(packetId, {
    name: descriptor.name,
    filename: descriptor.filename,
    mime: descriptor.mime,
    size: descriptor.size,
    sha256: descriptor.sha256
  });
  if (!reservation?.uploadPath) throw new Error(`Input reservation for ${descriptor.filename} did not include uploadPath`);
  const uploaded = await client.uploadBytes(reservation.uploadPath, descriptor.bytes, descriptor.mime);
  return { file: descriptor.absolute, reservation, uploaded, sha256: descriptor.sha256, size: descriptor.size };
}

export async function createPacketWithInputs(client, input) {
  const files = [...new Set((input.inputs || input.files || []).map(file => path.resolve(file)))];
  // Read and hash everything before mutating remote state. This catches missing files early.
  const descriptors = [];
  for (const file of files) descriptors.push(await fileUploadDescriptor(file));
  const packet = await client.createPacket({
    name: input.name,
    client: input.client || '',
    brief: input.brief,
    inputAssets: descriptors.map(item => item.filename),
    outputStructure: input.outputStructure?.length ? input.outputStructure : DEFAULT_OUTPUT_STRUCTURE,
    reviewCriteria: input.reviewCriteria?.length ? input.reviewCriteria : DEFAULT_REVIEW_CRITERIA
  });
  const packetId = packetIdOf(packet);
  if (!packetId) throw new Error('Packet creation did not return an id');
  const uploads = [];
  for (const descriptor of descriptors) {
    const reservation = await client.reserveInput(packetId, {
      name: descriptor.name,
      filename: descriptor.filename,
      mime: descriptor.mime,
      size: descriptor.size,
      sha256: descriptor.sha256
    });
    if (!reservation?.uploadPath) throw new Error(`Input reservation for ${descriptor.filename} did not include uploadPath`);
    const uploaded = await client.uploadBytes(reservation.uploadPath, descriptor.bytes, descriptor.mime);
    uploads.push({ file: descriptor.absolute, reservation, uploaded, sha256: descriptor.sha256, size: descriptor.size });
  }
  return { packet, packetId, uploads };
}

export async function createHandoff(client, input) {
  if (!(input.inputs || input.files || []).length) throw new Error('Handoff requires at least one real --input file');
  const created = await createPacketWithInputs(client, input);
  const assignments = input.assignments || [];
  if (!assignments.length) throw new Error('Handoff requires at least one creator');
  // Invitations are intentionally issued only after every input byte is committed.
  const pushed = await client.push({ packetId: created.packetId, projectId: created.packetId, assignments });
  return { ...created, pushed, invitations: pushed?.invitations || pushed?.invites || [] };
}

export function parseInvite(value) {
  const source = String(value || '').trim();
  if (!source) return null;
  if (/^[A-Za-z0-9_-]+$/.test(source)) return { token: source, apiUrl: null };
  let url;
  try {
    url = new URL(source);
  } catch {
    throw new Error('Invitation must be a Nitrate invite URL or token');
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Invitation URL must use http or https');
  const parts = url.pathname.split('/').filter(Boolean);
  let token = url.searchParams.get('token');
  if (!token) {
    const joinIndex = parts.lastIndexOf('join');
    const inviteIndex = parts.lastIndexOf('invites');
    token = joinIndex >= 0 ? parts[joinIndex + 1] : inviteIndex >= 0 ? parts[inviteIndex + 1] : parts.at(-1);
  }
  if (!/^[A-Za-z0-9_-]+$/.test(token || '')) throw new Error('Invitation URL does not contain a valid token');
  return { token, apiUrl: url.origin };
}

export async function acceptInviteAndSave(value, { name, agent, surface, apiUrl, configFile } = {}) {
  const invite = parseInvite(value);
  if (!invite) throw new Error('Invitation is required');
  const prior = await loadConfig({ file: configFile || configFilePath() });
  const resolvedApiUrl = apiUrl || invite.apiUrl || process.env.NITRATE_API_URL || prior.apiUrl || DEFAULT_API_URL;
  const resolvedSurface = surface || inferSurface();
  // With an invite-only creator we deliberately let the API infer from the
  // invited email rather than inventing an identity from the local OS user.
  const resolvedAgent = agent || prior.session?.agent || prior.user?.agent || null;
  const client = new NitrateClient({ apiUrl: resolvedApiUrl });
  const result = await client.acceptInvite(invite.token, {
    ...(name ? { name } : {}),
    ...(resolvedAgent ? { agent: resolvedAgent } : {}),
    surface: resolvedSurface
  });
  const token = result?.session?.token || result?.token;
  if (!token) throw new Error('Accepting the invitation did not return a session token');
  const config = {
    apiUrl: client.apiUrl,
    token,
    user: result.user || prior.user || null,
    session: { ...(result.session || {}), token: undefined }
  };
  await saveConfig(config, { file: configFile || configFilePath() });
  return { result, config, invite, project: result.project || result.packet, assignment: result.assignment };
}

export async function readJsonIfExists(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw new Error(`Could not read ${file}: ${error.message}`);
  }
}

export async function findWorkspace(start = process.cwd()) {
  let current = path.resolve(start);
  try {
    const info = await stat(current);
    if (info.isFile()) current = path.dirname(current);
  } catch {}
  while (true) {
    const markerPath = path.join(current, WORKSPACE_MARKER);
    const marker = await readJsonIfExists(markerPath);
    if (marker) return { dir: current, markerPath, marker };
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function normalizeFolder(folder) {
  const source = String(folder || '').trim().replace(/\\/g, '/');
  if (!source || source.includes('\0') || /^[A-Za-z]:/.test(source) || source.startsWith('//')) {
    throw new Error(`Unsafe output folder: ${folder}`);
  }
  const relative = source.replace(/^\/+/, '').replace(/\/+$/, '');
  const parts = relative.split('/');
  if (!relative || parts.some(part => !part || part === '.' || part === '..') || parts[0] === '.nitrate') {
    throw new Error(`Unsafe output folder: ${folder}`);
  }
  return parts.join('/');
}

export function safeOutputFolders(project = {}) {
  const source = project.outputStructure?.length ? project.outputStructure : DEFAULT_OUTPUT_STRUCTURE;
  return [...new Set(source.map(normalizeFolder))];
}

function safeInputFilename(value) {
  const source = String(value || '').trim();
  const base = path.basename(source.replace(/\\/g, '/'));
  if (!base || base === '.' || base === '..' || base.includes('\0')) throw new Error(`Unsafe input filename: ${value}`);
  return base;
}

function assignmentCandidates(entries, { packetId, assignmentId } = {}) {
  const candidates = [];
  for (const entry of entries) {
    const project = entry.project || entry.packet;
    if (!project) continue;
    if (packetId && project.id !== packetId) continue;
    for (const assignment of entry.assignments || []) {
      if (assignmentId && assignment.id !== assignmentId) continue;
      if (!assignmentId && !['delivered', 'pulled', 'working', 'blocked'].includes(assignment.status)) continue;
      candidates.push({ entry, project, assignment });
    }
  }
  return candidates;
}

export function selectAssignment(data, selectors = {}) {
  const entries = packetEntries(data);
  const candidates = assignmentCandidates(entries, selectors);
  if (!candidates.length) {
    const description = selectors.assignmentId ? `assignment ${selectors.assignmentId}` : selectors.packetId ? `an actionable assignment in packet ${selectors.packetId}` : 'an actionable assignment';
    throw new Error(`Could not find ${description} in this Nitrate inbox`);
  }
  if (candidates.length > 1) {
    const options = candidates.map(({ project, assignment }) => `${project.id}/${assignment.id}`).join(', ');
    throw new Error(`More than one assignment matches. Choose --assignment explicitly: ${options}`);
  }
  return candidates[0];
}

async function targetState(target) {
  try {
    const info = await lstat(target);
    if (info.isSymbolicLink()) throw new Error(`Refusing symlink workspace target: ${target}`);
    if (!info.isDirectory()) throw new Error(`Workspace target is not a directory: ${target}`);
    const contents = await readdir(target);
    return { exists: true, nonempty: contents.length > 0 };
  } catch (error) {
    if (error.code === 'ENOENT') return { exists: false, nonempty: false };
    throw error;
  }
}

function ensureInside(root, relative, label) {
  const absolute = path.resolve(root, relative);
  if (absolute !== root && !absolute.startsWith(`${root}${path.sep}`)) throw new Error(`Unsafe ${label}: ${relative}`);
  return absolute;
}

function briefMarkdown(project, assignment, inputs, folders, receipt) {
  const lines = [
    `# ${project.name || 'Nitrate assignment'}`,
    '',
    project.client ? `Client: ${project.client}` : '',
    project.brief || 'No brief was supplied.',
    '',
    '## Assignment',
    '',
    assignment.task || 'Complete the packet and return reviewable media.',
    '',
    '## Supplied inputs',
    '',
    ...(inputs.length ? inputs.map(item => `- \`${item.localPath}\` — ${item.size} bytes — SHA-256 \`${item.sha256}\``) : ['- No input files were attached.']),
    '',
    '## Review criteria',
    '',
    ...((project.reviewCriteria || []).length ? project.reviewCriteria.map(item => `- ${item}`) : ['- Match the brief and return complete provenance.']),
    '',
    '## Required workspace folders',
    '',
    ...folders.map(folder => `- \`/${folder}\``),
    '',
    '## Return',
    '',
    'Put final media in a requested output folder. Save the creation prompt in `/prompts` and notes in `/notes`, then run:',
    '',
    '```sh',
    'nitrate return',
    '```',
    '',
    '## Pull receipt',
    '',
    `- Packet: \`${project.id}\``,
    `- Assignment: \`${assignment.id}\``,
    `- Pulled: ${receipt.pulledAt}`,
    `- Inputs verified: ${inputs.length}`,
    `- Agent: ${receipt.agent || 'unknown'}`,
    `- Surface: ${receipt.surface || 'AI coding agent'}`,
    ''
  ];
  return lines.filter((line, index) => line || (index > 0 && lines[index - 1] !== '')).join('\n');
}

export async function pullWorkspace({ client, data, packetId, assignmentId, targetDir, force = false, exact = null, surface, agent } = {}) {
  if (!client) throw new Error('A Nitrate client is required');
  let selected;
  if (exact?.project && exact?.assignment) {
    selected = { project: exact.project, assignment: exact.assignment, entry: exact.entry || { project: exact.project, assignments: [exact.assignment] } };
  } else {
    const inbox = data || await client.packets();
    selected = selectAssignment(inbox, { packetId, assignmentId });
  }
  const { project, assignment, entry } = selected;
  const folders = safeOutputFolders(project);
  if (!folders.includes('inputs')) folders.unshift('inputs');
  const target = path.resolve(targetDir || slug(project.name || project.id, `nitrate-${project.id}`));
  const forbiddenTargets = new Set([path.parse(target).root, path.resolve(os.homedir()), path.resolve(process.cwd())]);
  if (forbiddenTargets.has(target)) throw new Error(`Refusing unsafe Nitrate workspace target: ${target}`);
  const state = await targetState(target);
  if (state.nonempty && !force) throw new Error(`Workspace target is not empty: ${target}. Choose an empty folder or pass --force to preserve it as a backup.`);
  const parent = path.dirname(target);
  await mkdir(parent, { recursive: true });
  const stage = await mkdtemp(path.join(parent, `.nitrate-${slug(project.name || project.id)}-`));
  let backupPath = null;
  try {
    await mkdir(path.join(stage, '.nitrate'), { recursive: true });
    for (const folder of folders) await mkdir(ensureInside(stage, folder, 'output folder'), { recursive: true });
    const inputs = [];
    const usedNames = new Set();
    for (const remote of project.inputs || entry.inputs || []) {
      if (!remote.downloadPath) throw new Error(`Input ${remote.filename || remote.id || 'unknown'} has no downloadPath`);
      let filename = safeInputFilename(remote.filename || remote.name || remote.id);
      if (usedNames.has(filename.toLowerCase())) filename = `${remote.id || inputs.length + 1}-${filename}`;
      usedNames.add(filename.toLowerCase());
      const bytes = await client.download(remote.downloadPath);
      const digest = sha256(bytes);
      if (!Number.isSafeInteger(Number(remote.size)) || Number(remote.size) <= 0) throw new Error(`Input ${filename} does not include a valid size`);
      if (Number(remote.size) !== bytes.length) {
        throw new Error(`Input size mismatch for ${filename}: expected ${remote.size}, received ${bytes.length}`);
      }
      const expectedHash = String(remote.hash || remote.sha256 || '').toLowerCase();
      if (!/^[a-f0-9]{64}$/.test(expectedHash)) throw new Error(`Input ${filename} does not include a valid SHA-256 checksum`);
      if (expectedHash !== digest) throw new Error(`Input checksum mismatch for ${filename}`);
      const relative = path.posix.join('inputs', filename);
      await writeFile(ensureInside(stage, relative, 'input path'), bytes, { flag: 'wx' });
      inputs.push({ id: remote.id, filename, localPath: relative, size: bytes.length, sha256: digest, mime: remote.mime || inferMime(filename) });
    }
    const pulledAt = new Date().toISOString();
    const receipt = {
      schemaVersion: 1,
      apiUrl: client.apiUrl,
      packetId: project.id,
      assignmentId: assignment.id,
      pulledAt,
      acknowledgedAt: null,
      inputCount: inputs.length,
      inputsVerified: true,
      agent: agent || client.session?.agent || assignment.agent,
      surface: surface || client.session?.surface || inferSurface()
    };
    const marker = {
      schemaVersion: 1,
      apiUrl: client.apiUrl,
      project,
      packet: project,
      assignment: { ...assignment },
      inputs,
      folders,
      receipt,
      returns: []
    };
    await writeFile(path.join(stage, 'AGENT_BRIEF.md'), `${briefMarkdown(project, assignment, inputs, folders, receipt)}\n`, 'utf8');
    await writeFile(path.join(stage, 'packet.json'), `${JSON.stringify({ project, packet: project, assignment, receipt }, null, 2)}\n`, 'utf8');
    await writeFile(path.join(stage, '.nitrate', 'receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
    await writeFile(path.join(stage, WORKSPACE_MARKER), `${JSON.stringify(marker, null, 2)}\n`, 'utf8');

    if (state.exists) {
      if (state.nonempty) {
        backupPath = `${target}.nitrate-backup-${Date.now()}`;
        await rename(target, backupPath);
      } else {
        await rmdir(target);
      }
    }
    await rename(stage, target);
    const acknowledged = await client.setAssignmentStatus(assignment.id, 'pulled');
    marker.assignment = { ...marker.assignment, ...(acknowledged?.assignment || {}), status: 'pulled' };
    marker.receipt.acknowledgedAt = new Date().toISOString();
    await writeFile(path.join(target, '.nitrate', 'receipt.json'), `${JSON.stringify(marker.receipt, null, 2)}\n`, 'utf8');
    await writeFile(path.join(target, WORKSPACE_MARKER), `${JSON.stringify(marker, null, 2)}\n`, 'utf8');
    return { target, backupPath, project, assignment: marker.assignment, inputs, folders, receipt: marker.receipt, acknowledged };
  } catch (error) {
    await rm(stage, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

async function listFilesRecursive(root, { skip = new Set() } = {}) {
  const files = [];
  async function walk(directory) {
    const entries = await readdir(directory, { withFileTypes: true }).catch(error => {
      if (error.code === 'ENOENT') return [];
      throw error;
    });
    for (const entry of entries) {
      if (entry.isSymbolicLink() || skip.has(entry.name)) continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(absolute);
      else if (entry.isFile()) files.push(absolute);
    }
  }
  await walk(root);
  return files;
}

function mediaFile(file) {
  return MEDIA_MIME.has(path.extname(file).toLowerCase());
}

async function newestFile(files) {
  const decorated = await Promise.all(files.map(async file => ({ file, info: await stat(file) })));
  decorated.sort((a, b) => b.info.mtimeMs - a.info.mtimeMs || a.file.localeCompare(b.file));
  return decorated[0]?.file || null;
}

async function inferLatestMedia(workspace) {
  const project = workspace.marker.project || workspace.marker.packet || {};
  const folderNames = safeOutputFolders(project).filter(folder => !['inputs', 'prompts', 'notes'].includes(folder.split('/')[0]));
  const roots = folderNames.map(folder => path.join(workspace.dir, folder));
  const files = [];
  for (const root of roots) files.push(...await listFilesRecursive(root));
  if (!files.length) {
    files.push(...await listFilesRecursive(workspace.dir, { skip: new Set(['.nitrate', 'inputs', 'prompts', 'notes', 'handoff', 'node_modules', '.git']) }));
  }
  return newestFile(files.filter(mediaFile));
}

async function readSmallText(file) {
  const info = await stat(file).catch(() => null);
  if (!info?.isFile() || info.size > 1024 * 1024) return '';
  return (await readFile(file, 'utf8')).trim();
}

async function inferSidecar(workspace, media, kind) {
  const extension = path.extname(media);
  const stem = path.basename(media, extension);
  const candidates = [
    path.join(path.dirname(media), `${stem}.${kind}.md`),
    path.join(path.dirname(media), `${stem}.${kind}.txt`),
    path.join(path.dirname(media), `${stem}.${kind}`),
    path.join(workspace.dir, kind === 'prompt' ? 'prompts' : 'notes', `${stem}.md`),
    path.join(workspace.dir, kind === 'prompt' ? 'prompts' : 'notes', `${stem}.txt`),
    path.join(workspace.dir, kind === 'prompt' ? 'prompts' : 'notes', `${kind}.md`),
    path.join(workspace.dir, kind === 'prompt' ? 'PROMPT.md' : 'NOTES.md')
  ];
  for (const candidate of candidates) {
    const text = await readSmallText(candidate);
    if (text) return { text, file: candidate };
  }
  const directory = path.join(workspace.dir, kind === 'prompt' ? 'prompts' : 'notes');
  const files = await listFilesRecursive(directory);
  const latest = await newestFile(files.filter(file => /\.(md|txt|prompt|notes)$/i.test(file)));
  return latest ? { text: await readSmallText(latest), file: latest } : { text: '', file: null };
}

function returnRelativePath(workspace, media) {
  const project = workspace.marker.project || workspace.marker.packet || {};
  const mediaFolders = safeOutputFolders(project).filter(folder => !['inputs', 'prompts', 'notes'].includes(folder.split('/')[0]));
  const preferred = mediaFolders.find(folder => folder === 'renders' || folder.startsWith('renders/'))
    || mediaFolders.find(folder => folder === 'stills' || folder.startsWith('stills/'))
    || mediaFolders.find(folder => folder === 'handoff' || folder.startsWith('handoff/'))
    || mediaFolders[0];
  if (!preferred) throw new Error('The packet does not define a media output folder');
  const local = path.relative(workspace.dir, media);
  if (local && local !== '..' && !local.startsWith(`..${path.sep}`) && !path.isAbsolute(local)) {
    const normalized = local.split(path.sep).join('/');
    if (mediaFolders.some(folder => normalized === folder || normalized.startsWith(`${folder}/`))) return normalized;
  }
  return path.posix.join(preferred, path.basename(media));
}

export async function returnWorkspace({ client, workspaceDir = process.cwd(), file, name, madeWith, prompt, notes, mime, branch, parentVersionId } = {}) {
  if (!client) throw new Error('A Nitrate client is required');
  const workspace = await findWorkspace(workspaceDir);
  if (!workspace) throw new Error('No pulled Nitrate workspace found. Run this inside the workspace or pass --dir.');
  let media = file ? path.resolve(file) : await inferLatestMedia(workspace);
  if (file && !(await stat(media).catch(() => null))) {
    const withinWorkspace = path.resolve(workspace.dir, file);
    if (await stat(withinWorkspace).catch(() => null)) media = withinWorkspace;
  }
  if (!media) throw new Error('No returnable image, video, or audio file found in the workspace');
  const mediaInfo = await stat(media);
  if (!mediaInfo.isFile() || mediaInfo.size <= 0) throw new Error(`Return file is empty or invalid: ${media}`);
  const contentType = mime || inferMime(media);
  if (!/^(image|video|audio)\//.test(contentType)) throw new Error(`Unsupported return media type: ${contentType}`);
  // A dropped-in draft can live at the workspace root (or be explicitly selected
  // elsewhere); its logical return path still follows the packet's folder contract.
  const relativePath = returnRelativePath(workspace, media);
  const promptSidecar = prompt ? { text: prompt, file: null } : await inferSidecar(workspace, media, 'prompt');
  const notesSidecar = notes ? { text: notes, file: null } : await inferSidecar(workspace, media, 'notes');
  const marker = workspace.marker;
  const assignmentId = marker.assignment?.id || marker.receipt?.assignmentId;
  if (!assignmentId) throw new Error('Workspace receipt does not contain an assignment id');
  const inferredPrompt = promptSidecar.text || marker.lastPrompt;
  if (!inferredPrompt) throw new Error('No creation prompt was found. Add a prompt sidecar or pass --prompt.');
  const inferredTool = madeWith || marker.surface || marker.receipt?.surface || client.session?.surface || inferSurface();
  const inferredParentVersionId = parentVersionId || marker.lastReturn?.id || null;
  const bytes = await readFile(media);
  const digest = sha256(bytes);
  const reservation = await client.reserveReturn(assignmentId, {
    name: name || path.basename(media, path.extname(media)),
    filename: path.basename(media),
    mime: contentType,
    size: bytes.length,
    sha256: digest,
    madeWith: inferredTool,
    prompt: inferredPrompt,
    notes: notesSidecar.text || `Returned from ${inferredTool} with the Nitrate plugin.`,
    relativePath,
    branch: branch || 'Launch',
    ...(inferredParentVersionId ? { parentVersionId: inferredParentVersionId } : {})
  });
  if (!reservation?.uploadPath) throw new Error('Return reservation did not include uploadPath');
  const uploaded = await client.uploadBytes(reservation.uploadPath, bytes, contentType);
  const returned = uploaded?.version || uploaded?.return || uploaded;
  const receipt = {
    id: returnIdOf(uploaded),
    reservationId: reservation.id,
    file: relativePath,
    name: name || path.basename(media, path.extname(media)),
    mime: contentType,
    size: bytes.length,
    sha256: digest,
    madeWith: inferredTool,
    promptSource: promptSidecar.file ? path.relative(workspace.dir, promptSidecar.file).split(path.sep).join('/') : prompt ? 'argument' : 'assignment',
    notesSource: notesSidecar.file ? path.relative(workspace.dir, notesSidecar.file).split(path.sep).join('/') : notes ? 'argument' : 'automatic',
    returnedAt: new Date().toISOString(),
    status: returned?.status || 'review'
  };
  marker.assignment = { ...marker.assignment, status: 'returned', returnedAt: receipt.returnedAt };
  marker.returns = [...(marker.returns || []), receipt];
  marker.lastReturn = receipt;
  await writeFile(workspace.markerPath, `${JSON.stringify(marker, null, 2)}\n`, 'utf8');
  await writeFile(path.join(workspace.dir, '.nitrate', 'last-return.json'), `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
  return { workspace: workspace.dir, file: media, reservation, uploaded, return: returned, receipt };
}

export async function updateWorkspaceStatus({ client, assignmentId, status, workspaceDir = process.cwd() } = {}) {
  if (!client) throw new Error('A Nitrate client is required');
  if (!['delivered', 'pulled', 'working', 'blocked'].includes(status)) {
    throw new Error('Status must be delivered, pulled, working, or blocked; use nitrate return to submit real media');
  }
  const workspace = await findWorkspace(workspaceDir);
  const resolvedId = assignmentId || workspace?.marker?.assignment?.id || workspace?.marker?.receipt?.assignmentId;
  if (!resolvedId) throw new Error('Assignment id is required (or run this inside a pulled Nitrate workspace)');
  const result = await client.setAssignmentStatus(resolvedId, status);
  if (workspace && (workspace.marker.assignment?.id === resolvedId || workspace.marker.receipt?.assignmentId === resolvedId)) {
    workspace.marker.assignment = { ...workspace.marker.assignment, ...(result?.assignment || {}), status };
    workspace.marker.lastStatusAt = new Date().toISOString();
    await writeFile(workspace.markerPath, `${JSON.stringify(workspace.marker, null, 2)}\n`, 'utf8');
  }
  return { assignmentId: resolvedId, status, result, workspace: workspace?.dir || null };
}

export function normalizeDecision(value) {
  const decision = String(value || '').trim().toLowerCase().replace(/[ -]+/g, '_');
  const aliases = { approved: 'approve', changes: 'request_changes', change: 'request_changes', request_change: 'request_changes', requested_changes: 'request_changes', rejected: 'reject' };
  const normalized = aliases[decision] || decision;
  if (!['approve', 'reject', 'request_changes', 'reopen'].includes(normalized)) {
    throw new Error('Decision must be approve, request-changes, reject, or reopen');
  }
  return normalized;
}

export async function reviewReturn(client, { returnId, decision, note = '' } = {}) {
  if (client.user?.role && client.user.role !== 'team_lead') throw new Error('Only a Nitrate leader can review returned work');
  let selectedId = returnId;
  if (!selectedId) {
    const entries = packetEntries(await client.packets());
    const candidates = entries.flatMap(entry => (entry.returns || []).filter(item => ['review', 'needs_review'].includes(item.status)).map(item => ({ entry, item })));
    if (!candidates.length) throw new Error('No returned work is waiting for review');
    if (candidates.length > 1) throw new Error(`More than one return needs review. Choose one: ${candidates.map(({ item }) => returnIdOf(item)).join(', ')}`);
    selectedId = returnIdOf(candidates[0].item);
  }
  if (!selectedId) throw new Error('Return id is required');
  const action = normalizeDecision(decision);
  const reviewed = await client.reviewReturn(selectedId, { action, note });
  return { returnId: selectedId, decision: action, reviewed: reviewed?.version || reviewed?.return || reviewed };
}

export async function nextAction(client, { workspaceDir = process.cwd() } = {}) {
  const workspace = await findWorkspace(workspaceDir);
  const data = await client.packets();
  const entries = packetEntries(data);
  if (workspace) {
    const assignmentId = workspace.marker.assignment?.id || workspace.marker.receipt?.assignmentId;
    const current = assignmentCandidates(entries, { assignmentId })[0];
    const assignment = current?.assignment || workspace.marker.assignment;
    const project = current?.project || workspace.marker.project || workspace.marker.packet;
    if (assignment?.status === 'returned') return { action: 'wait_for_review', command: 'nitrate next', project, assignment, workspace: workspace.dir, message: 'Your return is with the lead for review.' };
    if (assignment?.status === 'pulled') return { action: 'start_work', command: 'nitrate status --status working', project, assignment, workspace: workspace.dir, message: 'Read AGENT_BRIEF.md, then mark the assignment working.' };
    if (assignment?.status === 'working' || assignment?.status === 'blocked') return { action: 'return_work', command: 'nitrate return', project, assignment, workspace: workspace.dir, message: 'Place completed media in an output folder and return it.' };
  }
  if (!entries.length) {
    const leader = data.mode === 'leader' || data.user?.role === 'team_lead';
    return leader
      ? { action: 'create_handoff', command: 'nitrate handoff --name <name> --brief <brief> --to <email>', message: 'Create and send the first real handoff.' }
      : { action: 'wait_for_assignment', command: 'nitrate next', message: 'No packet is assigned to this agent yet.' };
  }
  const leader = data.mode === 'leader' || data.user?.role === 'team_lead';
  if (leader) {
    const reviews = entries.flatMap(entry => (entry.returns || []).filter(item => ['review', 'needs_review'].includes(item.status)).map(item => ({ project: entry.project, return: item })));
    if (reviews.length) return { action: 'review_return', command: `nitrate review ${returnIdOf(reviews[0].return)} --decision approve`, ...reviews[0], message: `${reviews.length} return${reviews.length === 1 ? '' : 's'} waiting for a decision.` };
    const waiting = entries.flatMap(entry => (entry.assignments || []).filter(item => ['delivered', 'pulled', 'working', 'blocked'].includes(item.status)).map(item => ({ project: entry.project, assignment: item })));
    if (waiting.length) return { action: 'wait_for_creator', ...waiting[0], message: `${waiting[0].assignment.agent || 'Creator'} is ${waiting[0].assignment.status}.` };
    return { action: 'create_handoff', command: 'nitrate handoff --name <name> --brief <brief> --to <email>', message: 'The current loop is clear; start the next real handoff.' };
  }
  const candidates = assignmentCandidates(entries);
  if (candidates.length === 1) {
    const current = candidates[0];
    if (current.assignment.status === 'delivered') return { action: 'pull_assignment', command: `nitrate pull --assignment ${current.assignment.id}`, ...current, message: `Pull ${current.project.name} into a workspace.` };
    return { action: current.assignment.status === 'pulled' ? 'start_work' : 'return_work', command: current.assignment.status === 'pulled' ? 'nitrate status --status working' : 'nitrate return', ...current };
  }
  return { action: 'choose_assignment', choices: candidates.map(({ project, assignment }) => ({ packetId: project.id, packet: project.name, assignmentId: assignment.id, status: assignment.status })), message: 'Choose an assignment explicitly.' };
}

export async function doctor({ configFile = configFilePath(), workspaceDir = process.cwd() } = {}) {
  const checks = [];
  let config = {};
  try {
    config = await loadConfig({ file: configFile });
    const mode = (await stat(configFile).catch(() => null))?.mode;
    const permissions = mode == null ? null : mode & 0o777;
    checks.push({ name: 'config', ok: Boolean(config.apiUrl && config.token), path: configFile, permissions: permissions == null ? null : permissions.toString(8).padStart(3, '0'), message: config.apiUrl && config.token ? 'Login config is present.' : 'Run nitrate login.' });
    checks.push({ name: 'config_permissions', ok: permissions == null || permissions === 0o600, message: permissions == null || permissions === 0o600 ? 'Config token file is private.' : `Config mode is ${(permissions || 0).toString(8)}; run nitrate login to repair it.` });
  } catch (error) {
    checks.push({ name: 'config', ok: false, path: configFile, message: error.message });
  }
  checks.push({ name: 'node', ok: Number(process.versions.node.split('.')[0]) >= 20, version: process.versions.node, message: 'Node 20 or newer is required.' });
  if (config.apiUrl) {
    try {
      const client = await NitrateClient.fromConfig({ config });
      const health = await client.health();
      checks.push({ name: 'api', ok: Boolean(health?.ok), apiUrl: client.apiUrl, health });
      if (config.token) {
        const inbox = await client.packets();
        checks.push({ name: 'session', ok: true, role: inbox.user?.role, packets: inbox.packets?.length || 0, message: 'Plugin session is valid.' });
      }
    } catch (error) {
      checks.push({ name: error.status === 401 ? 'session' : 'api', ok: false, message: error.message, status: error.status || null });
    }
  }
  const workspace = await findWorkspace(workspaceDir).catch(() => null);
  checks.push({ name: 'workspace', ok: true, found: Boolean(workspace), path: workspace?.dir || null, assignmentId: workspace?.marker?.assignment?.id || null });
  return { ok: checks.filter(item => item.name !== 'workspace').every(item => item.ok), checks };
}

export function publicConfig(config) {
  return {
    apiUrl: config.apiUrl || null,
    authenticated: Boolean(config.token),
    user: config.user || null,
    session: config.session || null
  };
}
