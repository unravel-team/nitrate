import { handleMcpAssetRequest, handleRemoteMcp } from './remote-mcp.mjs';

const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'X-Content-Type-Options': 'nosniff'
};

const MAX_JSON_BYTES = 1024 * 1024;
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
const INVITE_TTL_MS = 72 * 60 * 60 * 1000;
const DEFAULT_OUTPUT_STRUCTURE = ['/inputs', '/renders', '/stills', '/prompts', '/notes', '/handoff'];
const ASSIGNMENT_STATUSES = new Set(['delivered', 'pulled', 'working', 'blocked']);
const ALLOWED_RETURN_MIME_PREFIXES = ['image/', 'video/', 'audio/'];
const REVIEW_ACTIONS = {
  approve: 'approved',
  reject: 'rejected',
  request_changes: 'changes_requested',
  reopen: 'needs_review'
};
const MCP_AUDIENCE = 'nitrate-mcp';
const MCP_DEFAULT_LIFETIME_SECONDS = 7 * 24 * 60 * 60;
const MCP_MAX_LIFETIME_SECONDS = 30 * 24 * 60 * 60;
const MCP_IMPORT_LEASE_MS = 30 * 60 * 1000;
const MCP_COMMON_SCOPES = ['identity:read', 'work:read', 'assets:read'];
const MCP_ROLE_SCOPES = {
  team_lead: [...MCP_COMMON_SCOPES, 'returns:review'],
  ai_creator: [...MCP_COMMON_SCOPES, 'assignments:pull', 'returns:submit']
};

function json(value, status = 200, headers = {}) {
  return new Response(JSON.stringify(value), { status, headers: { ...JSON_HEADERS, ...headers } });
}

function fail(status, message) {
  return json({ error: message }, status);
}

function httpError(statusCode, message) {
  return Object.assign(new Error(message), { statusCode });
}

function now() {
  return new Date().toISOString();
}

function id(prefix) {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 18)}`;
}

function randomToken(byteLength = 32) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function publicAgentName(value) {
  return String(value || 'agent').replace(/clanker/gi, 'agent');
}

function parseJsonList(value, fallback = []) {
  const source = value == null || value === '' ? fallback : value;
  if (Array.isArray(source)) return source.map(item => String(item).trim()).filter(Boolean);
  return String(source).split(/\r?\n|,/).map(item => item.trim()).filter(Boolean);
}

function safeJson(value, fallback) {
  try {
    return JSON.parse(value || '');
  } catch {
    return fallback;
  }
}

function safeFilename(value, fallback = 'file') {
  const source = String(value || fallback).replace(/\\/g, '/').split('/').pop() || fallback;
  return source.replace(/[^\w.\- ]+/g, '_').slice(0, 160) || fallback;
}

function mediaKind(mime) {
  const value = String(mime || '').toLowerCase();
  if (value.startsWith('image/')) return 'image';
  if (value.startsWith('video/')) return 'video';
  if (value.startsWith('audio/')) return 'audio';
  return 'file';
}

function appStatus(status) {
  return status === 'needs_review' ? 'review' : status;
}

function dbStatus(status) {
  return status === 'review' ? 'needs_review' : status;
}

function resultRows(result) {
  return result?.results || [];
}

function changedRows(result) {
  return Number(result?.meta?.changes || 0);
}

function normalizeOutputStructure(value) {
  const source = typeof value === 'string' ? safeJson(value, value) : value;
  const folders = parseJsonList(source, DEFAULT_OUTPUT_STRUCTURE).slice(0, 20);
  if (!folders.length) return [...DEFAULT_OUTPUT_STRUCTURE];
  return [...new Set(folders.map(folder => {
    const raw = String(folder).trim().replace(/\\/g, '/');
    const parts = raw.replace(/^\/+|\/+$/g, '').split('/');
    if (!parts.length || parts.some(part => !part || part === '.' || part === '..')) {
      throw httpError(400, 'Output folders must be safe relative paths');
    }
    return `/${parts.join('/')}`;
  }))];
}

function normalizeReturnPath(value, filename, outputStructure) {
  const raw = String(value || '').trim().replace(/\\/g, '/');
  if (!raw || raw.includes('\0')) throw httpError(422, 'Return relativePath is required');
  const parts = raw.replace(/^\/+/, '').split('/');
  if (!parts.length || parts.some(part => {
    if (!part || part === '.' || part === '..') return true;
    try {
      const decoded = decodeURIComponent(part);
      return decoded === '.' || decoded === '..' || decoded.includes('/') || decoded.includes('\\');
    } catch {
      return true;
    }
  })) throw httpError(422, 'Return relativePath cannot traverse outside the packet workspace');

  const normalized = parts.join('/');
  const roots = normalizeOutputStructure(outputStructure)
    .map(folder => folder.replace(/^\/+|\/+$/g, ''))
    .filter(folder => folder && !['inputs', 'prompts', 'notes'].includes(folder));
  if (!roots.some(root => normalized.startsWith(`${root}/`))) {
    throw httpError(422, 'Return relativePath must be inside the packet output structure');
  }
  if (safeFilename(parts.at(-1), '') !== filename) {
    throw httpError(422, 'Return relativePath must end with the return filename');
  }
  return normalized;
}

function validateExpectedFile(input, kind, status = 400) {
  const size = Number(input.size ?? input.sizeBytes ?? 0);
  if (!Number.isSafeInteger(size) || size <= 0) throw httpError(status, `${kind} size must be a positive integer`);
  if (size > MAX_UPLOAD_BYTES) throw httpError(413, `${kind} exceeds the 100 MiB upload limit`);
  const hash = String(input.sha256 || input.hash || '').trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(hash)) throw httpError(status, `A valid ${kind.toLowerCase()} SHA-256 hash is required`);
  return { size, hash };
}

function hexBytes(value) {
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function bytesHex(value) {
  return [...new Uint8Array(value)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function bodyJson(request) {
  if (!request.body) return {};
  const declared = Number(request.headers.get('Content-Length') || 0);
  if (Number.isFinite(declared) && declared > MAX_JSON_BYTES) throw httpError(413, 'JSON body is too large');
  try {
    return await request.json();
  } catch {
    throw httpError(400, 'Request body must be valid JSON');
  }
}

async function sha256Hex(value) {
  const input = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  const digest = await crypto.subtle.digest('SHA-256', input);
  return bytesHex(digest);
}

async function secretsMatch(left, right) {
  const leftHash = new TextEncoder().encode(await sha256Hex(String(left || '')));
  const rightHash = new TextEncoder().encode(await sha256Hex(String(right || '')));
  let mismatch = leftHash.byteLength ^ rightHash.byteLength;
  const length = Math.max(leftHash.byteLength, rightHash.byteLength);
  for (let index = 0; index < length; index += 1) {
    mismatch |= (leftHash[index] || 0) ^ (rightHash[index] || 0);
  }
  return mismatch === 0;
}

function bearer(request) {
  const header = request.headers.get('Authorization') || '';
  return header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
}

const TEMPLATES = [
  {
    id: 'tpl_campaign',
    name: 'Agency campaign packet',
    description: 'Client brief, inputs, creator assignments, review stages, and delivery folders.',
    stages: ['Client brief', 'Agent dispatch', 'Creator returns', 'Lead review', 'Client selects'],
    defaults: { pipeline: 'agency campaign packet', branch: 'Launch' }
  },
  {
    id: 'tpl_social_volume',
    name: 'Paid social volume packet',
    description: 'Channel variants, claim-safe constraints, fast returns, and approval memory.',
    stages: ['Brief', 'Variant generation', 'QA', 'Channel cutdowns'],
    defaults: { pipeline: 'social volume packet', branch: 'Launch' }
  },
  {
    id: 'tpl_lookdev',
    name: 'Look-development packet',
    description: 'Reference boards, prompt exploration, model settings, and rejected paths.',
    stages: ['Visual territory', 'Agent runs', 'Comparisons', 'Winning recipe'],
    defaults: { pipeline: 'lookdev packet', branch: 'Look development' }
  }
];

async function ensureUser(env, input, options = {}) {
  const email = normalizeEmail(input.email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw httpError(400, 'Enter a valid work email');
  const desiredRole = input.role === 'leader' || input.role === 'team_lead' ? 'team_lead' : 'ai_creator';
  const agent = String(input.agent || `${email.split('@')[0]}-agent`).trim().slice(0, 80) || 'nitrate-agent';
  const displayName = String(input.name || email.split('@')[0]).trim().slice(0, 80) || email.split('@')[0];
  const createdAt = now();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO users (id, email, name, role, clanker, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(id('user'), email, displayName, desiredRole, agent, createdAt).run();
  const existing = await env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email).first();
  if (!existing) throw httpError(500, 'User could not be created');
  const role = options.updateRole === false ? existing.role : desiredRole;
  const updateProfile = options.updateProfile !== false;
  await env.DB.prepare('UPDATE users SET name = ?, role = ?, clanker = ? WHERE id = ?')
    .bind(updateProfile ? displayName : existing.name, role, updateProfile ? agent : existing.clanker, existing.id).run();
  return {
    id: existing.id, email,
    name: updateProfile ? displayName : existing.name,
    role,
    agent: updateProfile ? agent : existing.clanker,
    created_at: existing.created_at || createdAt
  };
}

async function ensureLeaderAgency(env, user, input = {}) {
  const requestedAgencyId = String(input.agencyId || '').trim();
  if (requestedAgencyId) {
    const requested = await env.DB.prepare(
      `SELECT a.* FROM agencies a JOIN agency_memberships m ON m.agency_id = a.id
       WHERE a.id = ? AND m.user_id = ? AND m.role = 'team_lead'`
    ).bind(requestedAgencyId, user.id).first();
    if (requested) return requested;
    const anyMembership = await env.DB.prepare(
      `SELECT 1 AS found FROM agency_memberships WHERE user_id = ? AND role = 'team_lead' LIMIT 1`
    ).bind(user.id).first();
    if (anyMembership) throw httpError(403, 'This leader does not belong to that agency');
  }
  const existing = await env.DB.prepare(
    `SELECT a.* FROM agencies a JOIN agency_memberships m ON m.agency_id = a.id
     WHERE m.user_id = ? AND m.role = 'team_lead' ORDER BY m.created_at ASC LIMIT 1`
  ).bind(user.id).first();
  if (existing) return existing;
  const agency = {
    id: id('agency'),
    name: String(input.agencyName || input.workspace || `${user.name}'s agency`).trim().slice(0, 100) || `${user.name}'s agency`,
    createdAt: now()
  };
  await env.DB.batch([
    env.DB.prepare('INSERT INTO agencies (id, name, created_by, created_at) VALUES (?, ?, ?, ?)')
      .bind(agency.id, agency.name, user.id, agency.createdAt),
    env.DB.prepare("INSERT INTO agency_memberships (agency_id, user_id, role, created_at) VALUES (?, ?, 'team_lead', ?)")
      .bind(agency.id, user.id, agency.createdAt)
  ]);
  return { id: agency.id, name: agency.name, created_by: user.id, created_at: agency.createdAt };
}

async function currentSession(request, env) {
  const token = bearer(request) || request.headers.get('X-Nitrate-Plugin-Token') || '';
  if (!token) return null;
  if (token.startsWith('nmc_')) return null;
  const row = await env.DB.prepare(
    `SELECT s.*, u.email, u.name, u.role AS user_role, u.clanker AS user_agent,
            m.role AS membership_role, a.name AS agency_name, a.created_at AS agency_created_at
     FROM plugin_sessions s
     JOIN users u ON u.id = s.user_id
     JOIN agencies a ON a.id = s.agency_id
     JOIN agency_memberships m ON m.agency_id = s.agency_id AND m.user_id = s.user_id
     WHERE s.token_hash = ?`
  ).bind(await sha256Hex(token)).first();
  if (!row) return null;
  const effectiveRole = row.role === 'team_lead' && row.membership_role === 'team_lead' ? 'team_lead' : 'ai_creator';
  const seenAt = now();
  await env.DB.prepare('UPDATE plugin_sessions SET last_seen_at = ? WHERE id = ?').bind(seenAt, row.id).run();
  return {
    session: {
      id: row.id,
      userId: row.user_id,
      agencyId: row.agency_id,
      inviteId: row.invite_id || null,
      agent: publicAgentName(row.clanker),
      storageAgent: row.clanker,
      surface: row.surface,
      role: effectiveRole,
      createdAt: row.created_at,
      lastSeenAt: seenAt
    },
    user: {
      id: row.user_id,
      email: row.email,
      name: row.name,
      role: effectiveRole,
      agent: publicAgentName(row.user_agent),
      storageAgent: row.user_agent
    },
    agency: { id: row.agency_id, name: row.agency_name, createdAt: row.agency_created_at }
  };
}

function normalizedMcpScopes(value, role, statusCode = 400) {
  const allowed = new Set(MCP_ROLE_SCOPES[role] || []);
  const requested = value == null ? [...allowed] : value;
  if (!Array.isArray(requested) || !requested.length || requested.length > allowed.size) {
    throw httpError(statusCode, 'MCP scopes must be a non-empty array allowed for this role');
  }
  const scopes = [...new Set(requested.map(scope => String(scope || '').trim()))];
  if (scopes.some(scope => !allowed.has(scope))) {
    throw httpError(statusCode, 'One or more MCP scopes are not allowed for this role');
  }
  return scopes;
}

function mcpConnectionPayload(row) {
  return {
    id: row.id,
    agencyId: row.agency_id,
    userId: row.user_id,
    label: row.label,
    client: row.client,
    audience: row.audience,
    scopes: safeJson(row.scopes_json, []),
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at || null,
    lastUsedAt: row.last_used_at || null
  };
}

async function createMcpConnection(request, env) {
  const found = await requireSession(request, env);
  const input = await bodyJson(request);
  const lifetime = input.expiresInSeconds == null
    ? MCP_DEFAULT_LIFETIME_SECONDS
    : Number(input.expiresInSeconds);
  if (!Number.isSafeInteger(lifetime) || lifetime < 300 || lifetime > MCP_MAX_LIFETIME_SECONDS) {
    throw httpError(422, 'expiresInSeconds must be between 300 seconds and 30 days');
  }
  const scopes = normalizedMcpScopes(input.scopes, found.session.role, 422);
  const createdAt = now();
  const expiresAt = new Date(Date.now() + lifetime * 1000).toISOString();
  const token = `nmc_${randomToken(32)}`;
  const connection = {
    id: id('mcp'),
    agencyId: found.agency.id,
    userId: found.user.id,
    label: String(input.label || 'Higgsfield Supercomputer').trim().slice(0, 100) || 'Higgsfield Supercomputer',
    client: String(input.client || 'Higgsfield Supercomputer').trim().slice(0, 100) || 'Higgsfield Supercomputer',
    audience: MCP_AUDIENCE,
    scopes,
    createdAt,
    expiresAt,
    revokedAt: null,
    lastUsedAt: null
  };
  await env.DB.prepare(
    `INSERT INTO mcp_connections
       (id, agency_id, user_id, source_session_id, token_hash, label, client, audience,
        scopes_json, created_at, expires_at, revoked_at, last_used_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)`
  ).bind(connection.id, connection.agencyId, connection.userId, found.session.id,
    await sha256Hex(token), connection.label, connection.client, connection.audience,
    JSON.stringify(connection.scopes), createdAt, expiresAt).run();
  return json({ connection, token }, 201);
}

async function listMcpConnections(request, env) {
  const found = await requireSession(request, env);
  const rows = resultRows(await env.DB.prepare(
    `SELECT * FROM mcp_connections
     WHERE agency_id = ? AND user_id = ? ORDER BY created_at DESC`
  ).bind(found.agency.id, found.user.id).all());
  return json({ connections: rows.map(mcpConnectionPayload) });
}

async function revokeMcpConnection(request, env, connectionId) {
  const found = await requireSession(request, env);
  const existing = await env.DB.prepare(
    'SELECT * FROM mcp_connections WHERE id = ? AND agency_id = ? AND user_id = ?'
  ).bind(connectionId, found.agency.id, found.user.id).first();
  if (!existing) throw httpError(404, 'MCP connection not found');
  if (!existing.revoked_at) {
    await env.DB.prepare(
      'UPDATE mcp_connections SET revoked_at = ? WHERE id = ? AND agency_id = ? AND user_id = ? AND revoked_at IS NULL'
    ).bind(now(), connectionId, found.agency.id, found.user.id).run();
  }
  const row = await env.DB.prepare('SELECT * FROM mcp_connections WHERE id = ?').bind(connectionId).first();
  return json({ connection: mcpConnectionPayload(row) });
}

async function authenticateMcpConnection(env, token) {
  if (!/^nmc_[A-Za-z0-9_-]{30,200}$/.test(String(token || ''))) return null;
  const checkedAt = now();
  const row = await env.DB.prepare(
    `SELECT c.*, u.email, u.name, u.role AS user_role, u.clanker AS user_agent,
            m.role AS membership_role, a.name AS agency_name, a.created_at AS agency_created_at
     FROM mcp_connections c
     JOIN users u ON u.id = c.user_id
     JOIN agencies a ON a.id = c.agency_id
     JOIN agency_memberships m ON m.agency_id = c.agency_id AND m.user_id = c.user_id
     WHERE c.token_hash = ? AND c.audience = ? AND c.revoked_at IS NULL AND c.expires_at > ?
     LIMIT 1`
  ).bind(await sha256Hex(token), MCP_AUDIENCE, checkedAt).first();
  if (!row) return null;
  const effectiveRole = row.user_role === 'team_lead' && row.membership_role === 'team_lead'
    ? 'team_lead'
    : 'ai_creator';
  const roleScopes = new Set(MCP_ROLE_SCOPES[effectiveRole] || []);
  const storedScopes = safeJson(row.scopes_json, []);
  if (!Array.isArray(storedScopes)) return null;
  const scopes = [...new Set(storedScopes.filter(scope => roleScopes.has(scope)))];
  if (!scopes.length) return null;
  const updated = await env.DB.prepare(
    `UPDATE mcp_connections SET last_used_at = ?
     WHERE id = ? AND token_hash = ? AND audience = ? AND revoked_at IS NULL AND expires_at > ?`
  ).bind(checkedAt, row.id, await sha256Hex(token), MCP_AUDIENCE, checkedAt).run();
  if (changedRows(updated) !== 1) return null;
  return {
    connection: { ...mcpConnectionPayload({ ...row, last_used_at: checkedAt }), scopes },
    session: {
      id: row.source_session_id || row.id,
      userId: row.user_id,
      agencyId: row.agency_id,
      inviteId: null,
      agent: publicAgentName(row.user_agent),
      storageAgent: row.user_agent,
      surface: row.client,
      role: effectiveRole,
      createdAt: row.created_at,
      lastSeenAt: checkedAt
    },
    user: {
      id: row.user_id,
      email: row.email,
      name: row.name,
      role: effectiveRole,
      agent: publicAgentName(row.user_agent),
      storageAgent: row.user_agent
    },
    agency: { id: row.agency_id, name: row.agency_name, createdAt: row.agency_created_at }
  };
}

async function requireSession(request, env) {
  const found = await currentSession(request, env);
  if (!found) throw httpError(401, 'Plugin login required');
  return found;
}

async function requireLeader(request, env) {
  const found = await requireSession(request, env);
  if (found.session.role !== 'team_lead') throw httpError(403, 'Only leaders can do that');
  return found;
}

function sessionPayload(found, token) {
  return {
    session: {
      id: found.session.id,
      ...(token ? { token } : {}),
      userId: found.session.userId,
      agencyId: found.session.agencyId,
      agent: found.session.agent,
      surface: found.session.surface,
      role: found.session.role,
      createdAt: found.session.createdAt,
      lastSeenAt: found.session.lastSeenAt
    },
    user: { id: found.user.id, email: found.user.email, name: found.user.name, role: found.user.role, agent: found.user.agent },
    agency: found.agency
  };
}

async function pluginLogin(request, env) {
  const input = await bodyJson(request);
  if (!['leader', 'team_lead'].includes(String(input.role || ''))) {
    throw httpError(403, 'Creators join Nitrate by accepting a leader invitation');
  }
  const email = normalizeEmail(input.email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw httpError(400, 'Enter a valid work email');
  const configuredSecret = String(env.NITRATE_BOOTSTRAP_SECRET || '');
  if (!configuredSecret) throw httpError(503, 'Leader bootstrap is not configured');
  const suppliedSecret = request.headers.get('X-Nitrate-Bootstrap-Secret') || String(input.bootstrapSecret || '');
  if (!(await secretsMatch(suppliedSecret, configuredSecret))) throw httpError(403, 'Leader bootstrap credentials are invalid');
  const user = await ensureUser(env, { ...input, role: 'team_lead' });
  const agency = await ensureLeaderAgency(env, user, input);
  const token = randomToken();
  const at = now();
  const session = {
    id: id('plug'), userId: user.id, agencyId: agency.id, agent: user.agent,
    surface: String(input.surface || 'Local AI coding agent').slice(0, 80),
    role: 'team_lead', createdAt: at, lastSeenAt: at
  };
  await env.DB.prepare(
    `INSERT INTO plugin_sessions
       (id, token_hash, user_id, clanker, surface, role, created_at, last_seen_at, agency_id, invite_id)
     VALUES (?, ?, ?, ?, ?, 'team_lead', ?, ?, ?, NULL)`
  ).bind(session.id, await sha256Hex(token), session.userId, session.agent, session.surface, at, at, agency.id).run();
  return json(sessionPayload({
    session,
    user: { ...user, role: 'team_lead' },
    agency: { id: agency.id, name: agency.name, createdAt: agency.created_at || agency.createdAt }
  }, token), 201);
}

async function acceptInvite(request, env, rawToken) {
  if (!/^[A-Za-z0-9_-]{20,200}$/.test(rawToken)) throw httpError(404, 'This invitation is invalid');
  const tokenHash = await sha256Hex(rawToken);
  let invite = await env.DB.prepare(
    `SELECT i.*, p.name AS packet_name, u.email, u.name AS user_name, u.clanker AS user_agent,
            a.task, a.status AS assignment_status, a.clanker AS assignment_agent,
            g.name AS agency_name, g.created_at AS agency_created_at
     FROM plugin_invitations i
     JOIN packets p ON p.id = i.packet_id AND p.agency_id = i.agency_id
     JOIN assignments a ON a.id = i.assignment_id AND a.packet_id = p.id AND a.user_id = i.user_id
     JOIN users u ON u.id = i.user_id JOIN agencies g ON g.id = i.agency_id
     WHERE i.token_hash = ?`
  ).bind(tokenHash).first();
  if (!invite) throw httpError(404, 'This invitation is invalid');
  if (invite.revoked_at) throw httpError(410, 'This invitation is no longer available');
  if (invite.accepted_at) throw httpError(409, 'This invitation has already been accepted');
  const acceptedAt = now();
  if (invite.expires_at <= acceptedAt) throw httpError(410, 'This invitation has expired');
  const input = await bodyJson(request);
  const agent = String(input.agent || invite.assignment_agent || invite.user_agent || `${invite.email.split('@')[0]}-agent`).trim().slice(0, 80) || 'nitrate-agent';
  const displayName = String(input.name || invite.user_name).trim().slice(0, 80) || invite.user_name;
  const surface = String(input.surface || 'AI coding agent').trim().slice(0, 80) || 'AI coding agent';
  const sessionToken = randomToken();
  const sessionId = id('plug');
  const sessionHash = await sha256Hex(sessionToken);
  const results = await env.DB.batch([
    env.DB.prepare(
      `UPDATE plugin_invitations SET accepted_at = ?, accepted_session_id = ?
       WHERE id = ? AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > ?`
    ).bind(acceptedAt, sessionId, invite.id, acceptedAt),
    env.DB.prepare(
      `INSERT OR IGNORE INTO agency_memberships (agency_id, user_id, role, created_at)
       SELECT ?, ?, 'ai_creator', ?
       WHERE EXISTS (
         SELECT 1 FROM plugin_invitations WHERE id = ? AND accepted_session_id = ? AND accepted_at = ?
       )`
    ).bind(invite.agency_id, invite.user_id, acceptedAt, invite.id, sessionId, acceptedAt),
    env.DB.prepare(
      `UPDATE users SET name = ?, clanker = ?
       WHERE id = ? AND EXISTS (
         SELECT 1 FROM plugin_invitations WHERE id = ? AND accepted_session_id = ? AND accepted_at = ?
       )`
    ).bind(displayName, agent, invite.user_id, invite.id, sessionId, acceptedAt),
    env.DB.prepare(
      `UPDATE assignments SET clanker = ?, accepted_at = ?
       WHERE id = ? AND user_id = ? AND EXISTS (
         SELECT 1 FROM plugin_invitations WHERE id = ? AND accepted_session_id = ? AND accepted_at = ?
       )`
    ).bind(agent, acceptedAt, invite.assignment_id, invite.user_id, invite.id, sessionId, acceptedAt),
    env.DB.prepare(
      `INSERT INTO plugin_sessions
         (id, token_hash, user_id, clanker, surface, role, created_at, last_seen_at, agency_id, invite_id)
       SELECT ?, ?, ?, ?, ?, 'ai_creator', ?, ?, ?, ?
       WHERE EXISTS (
         SELECT 1 FROM plugin_invitations WHERE id = ? AND accepted_session_id = ? AND accepted_at = ?
       )`
    ).bind(sessionId, sessionHash, invite.user_id, agent, surface, acceptedAt, acceptedAt,
      invite.agency_id, invite.id, invite.id, sessionId, acceptedAt),
    env.DB.prepare(
      `INSERT INTO activation_events
         (id, agency_id, packet_id, assignment_id, event_type, actor_user_id, occurred_at, metadata_json)
       SELECT ?, ?, ?, ?, 'invite_accepted', ?, ?, ?
       WHERE EXISTS (
         SELECT 1 FROM plugin_invitations WHERE id = ? AND accepted_session_id = ? AND accepted_at = ?
       )`
    ).bind(id('event'), invite.agency_id, invite.packet_id, invite.assignment_id, invite.user_id,
      acceptedAt, JSON.stringify({ surface, agent }), invite.id, sessionId, acceptedAt)
  ]);
  if (changedRows(results[0]) !== 1) {
    invite = await env.DB.prepare('SELECT accepted_at, revoked_at, expires_at FROM plugin_invitations WHERE id = ?').bind(invite.id).first();
    if (invite?.accepted_at) throw httpError(409, 'This invitation has already been accepted');
    throw httpError(410, 'This invitation is no longer available');
  }
  const packetRow = await env.DB.prepare('SELECT * FROM packets WHERE id = ? AND agency_id = ?').bind(invite.packet_id, invite.agency_id).first();
  const assignmentRow = await env.DB.prepare(
    `SELECT a.*, u.id AS assignee_id, u.name AS assignee_name, u.email AS assignee_email
     FROM assignments a JOIN users u ON u.id = a.user_id WHERE a.id = ?`
  ).bind(invite.assignment_id).first();
  const found = {
    session: { id: sessionId, userId: invite.user_id, agencyId: invite.agency_id, inviteId: invite.id,
      agent: publicAgentName(agent), surface, role: 'ai_creator', createdAt: acceptedAt, lastSeenAt: acceptedAt },
    user: { id: invite.user_id, email: invite.email, name: displayName, role: 'ai_creator', agent: publicAgentName(agent) },
    agency: { id: invite.agency_id, name: invite.agency_name, createdAt: invite.agency_created_at }
  };
  return json({ ...sessionPayload(found, sessionToken), packet: rowPacket(packetRow), project: rowPacket(packetRow), assignment: rowAssignment(assignmentRow) }, 201);
}

async function joinWaitlist(request, env) {
  const contentType = String(request.headers.get('Content-Type') || '').toLowerCase();
  const isBrowserForm = contentType.includes('application/x-www-form-urlencoded');
  const input = isBrowserForm
    ? Object.fromEntries(await request.formData())
    : await bodyJson(request);
  const email = normalizeEmail(input.email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return fail(400, 'Enter a valid work email.');
  const entry = { id: id('wait'), email, teamSize: String(input.teamSize || '').slice(0, 40), workflow: String(input.workflow || '').slice(0, 80), at: now() };
  await env.DB.prepare(
    `INSERT INTO waitlist (id, email, team_size, workflow, created_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(email) DO UPDATE SET team_size = excluded.team_size, workflow = excluded.workflow`
  ).bind(entry.id, entry.email, entry.teamSize, entry.workflow, entry.at).run();
  if (isBrowserForm) return Response.redirect(new URL('/for/thanks/', request.url), 303);
  return json({ ok: true, message: 'You are on the Nitrate access list. We will follow up with plugin setup.' });
}

function rowPacket(row) {
  if (!row) return null;
  return {
    id: row.id,
    agencyId: row.agency_id || null,
    name: row.name,
    client: row.client || '',
    brief: row.brief,
    inputAssets: safeJson(row.input_assets_json, []),
    outputStructure: safeJson(row.output_structure_json, DEFAULT_OUTPUT_STRUCTURE),
    reviewCriteria: safeJson(row.review_criteria_json, []),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    at: row.created_at
  };
}

function rowInput(row) {
  const ready = Boolean(row.uploaded_at && row.object_key);
  return {
    id: row.id, packetId: row.packet_id, projectId: row.packet_id, name: row.name,
    filename: row.filename, mime: row.content_type, contentType: row.content_type,
    size: Number(row.size_bytes), sizeBytes: Number(row.size_bytes), sha256: row.sha256, hash: row.sha256,
    createdAt: row.created_at, uploadedAt: row.uploaded_at || null, ready,
    ...(ready ? { downloadPath: `/api/plugin/inputs/${row.id}/raw` } : {})
  };
}

function invitationState(row) {
  if (!row.invitation_id) return null;
  let status = 'pending';
  if (row.invitation_revoked_at) status = 'revoked';
  else if (row.invitation_accepted_at) status = 'accepted';
  else if (row.invitation_expires_at <= now()) status = 'expired';
  return { id: row.invitation_id, status, expiresAt: row.invitation_expires_at, acceptedAt: row.invitation_accepted_at || null };
}

function rowAssignment(row) {
  return {
    id: row.id, userId: row.user_id, packetId: row.packet_id, projectId: row.packet_id,
    agent: publicAgentName(row.clanker), task: row.task, status: row.status,
    pushedAt: row.pushed_at, acceptedAt: row.accepted_at || null,
    pulledAt: row.pulled_at || null, returnedAt: row.returned_at || null,
    assignee: row.assignee_id ? { id: row.assignee_id, name: row.assignee_name, email: row.assignee_email || '' } : null,
    invitation: invitationState(row)
  };
}

function fallbackReturnValidation(packet, row) {
  const relativePath = row.relative_path || row.filename || '';
  const roots = safeJson(packet?.output_structure_json, DEFAULT_OUTPUT_STRUCTURE)
    .map(folder => String(folder).replace(/\\/g, '/').replace(/^\/+|\/+$/g, ''))
    .filter(folder => folder && !['inputs', 'prompts', 'notes'].includes(folder));
  const insideOutput = roots.some(root => relativePath === root || relativePath.startsWith(`${root}/`));
  const checks = [
    { key: 'media', label: 'Media file attached', passed: Boolean(row.uploaded_at && row.object_key) },
    { key: 'prompt', label: 'Creation prompt attached', passed: Boolean(row.prompt) },
    { key: 'made_with', label: 'Creation tool attached', passed: Boolean(row.made_with) },
    { key: 'output_folder', label: 'File follows the requested output structure', passed: insideOutput }
  ];
  return { complete: checks.every(check => check.passed), checks, missing: checks.filter(check => !check.passed).map(check => check.key), relativePath };
}

function rowReturn(row, packet = null) {
  const validation = safeJson(row.validation_json, null) || fallbackReturnValidation(packet, row);
  return {
    id: row.id, assetId: `asset_${row.id}`, projectId: row.packet_id, packetId: row.packet_id,
    branch: row.branch || 'Launch', hash: row.sha256 || '', sha256: row.sha256 || '',
    size: Number(row.size_bytes || 0), sizeBytes: Number(row.size_bytes || 0),
    mime: row.content_type || 'application/octet-stream', kind: mediaKind(row.content_type),
    filename: row.filename || row.name, status: appStatus(row.status), uploadedAt: row.uploaded_at || null,
    validation,
    metadata: {
      prompt: row.prompt, model: row.made_with, madeWith: row.made_with, seed: '', pipeline: 'nitrate cloud return',
      operator: row.user_id, notes: row.notes || '', parentVersionId: row.parent_return_id || null,
      assignmentId: row.assignment_id, relativePath: row.relative_path || validation.relativePath || ''
    },
    comments: safeJson(row.comments_json, []), decisions: safeJson(row.decisions_json, []),
    reservedAt: row.created_at, createdAt: row.uploaded_at || row.created_at,
    ...(row.uploaded_at && row.object_key ? { downloadPath: `/api/plugin/returns/${row.id}/raw` } : {})
  };
}

async function createPacketRecord(env, input, user, agencyId) {
  const name = String(input.name || '').trim();
  const brief = String(input.brief || '').trim();
  if (name.length < 2 || name.length > 80) throw httpError(400, 'Packet name must be 2–80 characters');
  if (brief.length < 5) throw httpError(400, 'Packet brief is required');
  const at = now();
  const packet = {
    id: id('pkt'), agencyId, name, client: String(input.client || '').trim().slice(0, 100), brief: brief.slice(0, 20000),
    inputAssets: parseJsonList(input.inputAssets, []).slice(0, 50), outputStructure: normalizeOutputStructure(input.outputStructure),
    reviewCriteria: parseJsonList(input.reviewCriteria, []).slice(0, 30), createdAt: at, updatedAt: at, at
  };
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO packets
         (id, name, client, brief, created_by, input_assets_json, output_structure_json, review_criteria_json, created_at, updated_at, agency_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(packet.id, packet.name, packet.client, packet.brief, user.id, JSON.stringify(packet.inputAssets),
      JSON.stringify(packet.outputStructure), JSON.stringify(packet.reviewCriteria), at, at, agencyId),
    env.DB.prepare(
      `INSERT INTO activation_events
         (id, agency_id, packet_id, event_type, actor_user_id, occurred_at, metadata_json)
       VALUES (?, ?, ?, 'packet_created', ?, ?, '{}')`
    ).bind(`event_packet_created_${packet.id}`, agencyId, packet.id, user.id, at)
  ]);
  return packet;
}

async function createPacket(request, env) {
  const found = await requireLeader(request, env);
  return json(await createPacketRecord(env, await bodyJson(request), found.user, found.agency.id), 201);
}

async function createProject(request, env) {
  const found = await requireLeader(request, env);
  const input = await bodyJson(request);
  const packet = await createPacketRecord(
    env,
    { ...input, brief: String(input.brief || 'Created from the Nitrate command center.') },
    found.user,
    found.agency.id
  );
  return json({ ...packet, branches: ['Launch'], templateId: input.templateId || 'tpl_campaign', assignments: [] }, 201);
}

async function reservePacketInput(request, env, packetId) {
  const found = await requireLeader(request, env);
  const packet = await env.DB.prepare('SELECT * FROM packets WHERE id = ? AND agency_id = ?')
    .bind(packetId, found.agency.id).first();
  if (!packet) throw httpError(404, 'Packet not found');
  const input = await bodyJson(request);
  const { size, hash } = validateExpectedFile(input, 'Input');
  const filename = safeFilename(input.filename || input.name, 'input');
  const at = now();
  const item = {
    id: id('input'), agencyId: found.agency.id, packetId,
    name: String(input.name || filename).trim().slice(0, 140) || filename,
    filename,
    contentType: String(input.mime || input.contentType || 'application/octet-stream').trim().toLowerCase().slice(0, 120),
    size, hash, createdAt: at
  };
  await env.DB.prepare(
    `INSERT INTO packet_inputs
       (id, agency_id, packet_id, name, filename, content_type, size_bytes, sha256,
        object_key, created_by, created_at, uploaded_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, NULL)`
  ).bind(item.id, item.agencyId, item.packetId, item.name, item.filename, item.contentType, item.size,
    item.hash, found.user.id, item.createdAt).run();
  const payload = {
    id: item.id, packetId, projectId: packetId, name: item.name, filename,
    mime: item.contentType, contentType: item.contentType, size, sizeBytes: size,
    sha256: hash, hash, createdAt: at, uploadedAt: null, ready: false,
    uploadPath: `/api/plugin/inputs/${item.id}/raw`
  };
  return json({ ...payload, input: payload }, 201);
}

async function putVerifiedObject(request, env, details) {
  if (!request.body) throw httpError(400, `${details.label} bytes are required`);
  const contentLength = request.headers.get('Content-Length');
  if (contentLength != null) {
    const declared = Number(contentLength);
    if (!Number.isSafeInteger(declared) || declared < 0) throw httpError(400, 'Content-Length must be a valid integer');
    if (declared > MAX_UPLOAD_BYTES) throw httpError(413, `${details.label} exceeds the 100 MiB upload limit`);
    if (declared !== details.size) throw httpError(400, `${details.label} size mismatch: expected ${details.size} bytes`);
  }
  let object;
  let adopted = false;
  try {
    object = await env.MEDIA.put(details.key, request.body, {
      onlyIf: new Headers({ 'If-None-Match': '*' }),
      sha256: hexBytes(details.hash).buffer,
      httpMetadata: { contentType: details.contentType },
      customMetadata: details.customMetadata
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/checksum|digest|sha-?256|hash/i.test(message)) throw httpError(400, `${details.label} checksum mismatch`);
    throw error;
  }
  if (!object) {
    const existing = await env.MEDIA.head(details.key);
    const existingHash = existing?.checksums?.sha256 ? bytesHex(existing.checksums.sha256) : '';
    const metadataMatches = existing && Object.entries(details.customMetadata).every(
      ([key, value]) => existing.customMetadata?.[key] === String(value)
    );
    if (!existing || Number(existing.size) !== details.size || existingHash !== details.hash || !metadataMatches) {
      throw httpError(409, `${details.label} object key is already occupied by different bytes`);
    }
    object = existing;
    adopted = true;
  }
  if (Number(object.size) !== details.size) {
    await env.MEDIA.delete(details.key);
    throw httpError(400, `${details.label} size mismatch: expected ${details.size} bytes`);
  }
  const storedChecksum = object.checksums?.sha256;
  if (storedChecksum && bytesHex(storedChecksum) !== details.hash) {
    await env.MEDIA.delete(details.key);
    throw httpError(400, `${details.label} checksum mismatch`);
  }
  return { object, adopted };
}

async function uploadPacketInput(request, env, inputId) {
  const found = await requireLeader(request, env);
  const item = await env.DB.prepare(
    `SELECT i.*, p.input_assets_json FROM packet_inputs i
     JOIN packets p ON p.id = i.packet_id AND p.agency_id = i.agency_id
     WHERE i.id = ? AND i.agency_id = ?`
  ).bind(inputId, found.agency.id).first();
  if (!item) throw httpError(404, 'Input reservation not found');
  if (item.uploaded_at || item.object_key) throw httpError(409, 'This input has already been uploaded');
  const key = `inputs/${item.agency_id}/${item.packet_id}/${item.id}/${safeFilename(item.filename, item.id)}`;
  const storage = await putVerifiedObject(request, env, {
    label: 'Input', key, size: Number(item.size_bytes), hash: item.sha256, contentType: item.content_type,
    customMetadata: { inputId: item.id, packetId: item.packet_id, agencyId: item.agency_id }
  });
  const uploadedAt = now();
  const inputAssets = [...new Set([...safeJson(item.input_assets_json, []), item.filename])].slice(0, 50);
  let results;
  try {
    results = await env.DB.batch([
      env.DB.prepare(
        `UPDATE packet_inputs SET object_key = ?, uploaded_at = ?
         WHERE id = ? AND agency_id = ? AND uploaded_at IS NULL AND object_key IS NULL`
      ).bind(key, uploadedAt, item.id, found.agency.id),
      env.DB.prepare(
        `INSERT OR IGNORE INTO activation_events
           (id, agency_id, packet_id, event_type, actor_user_id, occurred_at, metadata_json)
         SELECT ?, agency_id, packet_id, 'packet_input_uploaded', ?, ?, ?
         FROM packet_inputs WHERE id = ? AND object_key = ? AND uploaded_at = ?`
      ).bind(`event_input_uploaded_${item.id}`, found.user.id, uploadedAt,
        JSON.stringify({ inputId: item.id, sha256: item.sha256, size: item.size_bytes }), item.id, key, uploadedAt),
      env.DB.prepare('UPDATE packets SET input_assets_json = ?, updated_at = ? WHERE id = ? AND agency_id = ?')
        .bind(JSON.stringify(inputAssets), uploadedAt, item.packet_id, found.agency.id)
    ]);
  } catch (error) {
    throw error;
  }
  const completed = await env.DB.prepare('SELECT * FROM packet_inputs WHERE id = ?').bind(item.id).first();
  if (!completed?.uploaded_at || completed.object_key !== key) {
    throw httpError(409, 'This input could not be finalized; retry the same upload');
  }
  const duplicate = await env.DB.prepare(
    `SELECT 1 AS found FROM packet_inputs
     WHERE agency_id = ? AND sha256 = ? AND uploaded_at IS NOT NULL AND id <> ? LIMIT 1`
  ).bind(item.agency_id, item.sha256, item.id).first();
  const payload = rowInput(completed);
  return json({ ...payload, input: payload, deduplicated: Boolean(duplicate), recovered: storage.adopted });
}

async function canAccessPacket(env, found, packetId) {
  if (found.session.role === 'team_lead') return true;
  const assignment = await env.DB.prepare(
    `SELECT 1 AS found FROM assignments a JOIN packets p ON p.id = a.packet_id
     WHERE a.packet_id = ? AND a.user_id = ? AND p.agency_id = ? LIMIT 1`
  ).bind(packetId, found.user.id, found.agency.id).first();
  return Boolean(assignment);
}

function objectResponse(object, filename, fallbackContentType) {
  const headers = new Headers();
  if (typeof object.writeHttpMetadata === 'function') object.writeHttpMetadata(headers);
  if (!headers.has('Content-Type')) headers.set('Content-Type', object.httpMetadata?.contentType || fallbackContentType || 'application/octet-stream');
  headers.set('Content-Length', String(object.size));
  headers.set('Content-Disposition', `inline; filename="${encodeURIComponent(filename)}"`);
  headers.set('Cache-Control', 'private, max-age=31536000, immutable');
  headers.set('X-Content-Type-Options', 'nosniff');
  if (object.httpEtag) headers.set('ETag', object.httpEtag);
  return new Response(object.body, { headers });
}

async function downloadPacketInput(request, env, inputId) {
  const found = await requireSession(request, env);
  const item = await env.DB.prepare(
    `SELECT i.* FROM packet_inputs i JOIN packets p ON p.id = i.packet_id AND p.agency_id = i.agency_id
     WHERE i.id = ? AND i.agency_id = ? AND i.uploaded_at IS NOT NULL`
  ).bind(inputId, found.agency.id).first();
  if (!item || !item.object_key) throw httpError(404, 'Input file not found');
  if (!(await canAccessPacket(env, found, item.packet_id))) throw httpError(403, 'This input is not available to this user');
  const object = await env.MEDIA.get(item.object_key);
  if (!object) throw httpError(404, 'Input bytes are unavailable');
  return objectResponse(object, item.filename, item.content_type);
}

async function pushPacket(request, env) {
  const found = await requireLeader(request, env);
  const input = await bodyJson(request);
  const packetId = String(input.packetId || input.projectId || '');
  const packet = await env.DB.prepare('SELECT * FROM packets WHERE id = ? AND agency_id = ?')
    .bind(packetId, found.agency.id).first();
  if (!packet) throw httpError(404, 'Packet not found');
  const uploadedInput = await env.DB.prepare(
    'SELECT 1 AS found FROM packet_inputs WHERE packet_id = ? AND agency_id = ? AND uploaded_at IS NOT NULL LIMIT 1'
  ).bind(packet.id, found.agency.id).first();
  if (!uploadedInput) throw httpError(409, 'Upload at least one packet input before pushing it to a creator');
  const entries = Array.isArray(input.assignments) ? input.assignments.slice(0, 20) : [];
  if (!entries.length) throw httpError(400, 'Add at least one creator assignment');
  for (const entry of entries) {
    const email = normalizeEmail(entry.email);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw httpError(400, 'Each creator needs a valid work email');
    if (email === found.user.email) throw httpError(422, 'A leader cannot invite themselves as the creator');
    const agencyLeader = await env.DB.prepare(
      `SELECT 1 AS found FROM users u JOIN agency_memberships m ON m.user_id = u.id
       WHERE u.email = ? AND m.agency_id = ? AND m.role = 'team_lead' LIMIT 1`
    ).bind(email, found.agency.id).first();
    if (agencyLeader) throw httpError(422, 'An agency leader cannot be assigned as the invited creator');
  }
  const created = [];
  const invitations = [];
  const statements = [];
  const baseUrl = String(env.NITRATE_PUBLIC_BASE_URL || new URL(request.url).origin).replace(/\/$/, '');
  for (const entry of entries) {
    const assignee = await ensureUser(env, { ...entry, role: 'ai_creator' }, { updateRole: false, updateProfile: false });
    const pushedAt = now();
    const assignmentId = id('assign');
    const inviteId = id('invite');
    const token = randomToken();
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS).toISOString();
    const agent = String(entry.agent || assignee.agent || `${assignee.name}-agent`).trim().slice(0, 80) || 'nitrate-agent';
    const task = String(entry.task || 'Work this packet and return media, prompts, notes, and handoff files.').trim().slice(0, 1000);
    statements.push(
      env.DB.prepare(
        `INSERT INTO assignments
           (id, packet_id, user_id, clanker, task, status, pushed_at, returned_at, accepted_at, pulled_at)
         VALUES (?, ?, ?, ?, ?, 'delivered', ?, NULL, NULL, NULL)`
      ).bind(assignmentId, packet.id, assignee.id, agent, task, pushedAt),
      env.DB.prepare(
        `INSERT INTO plugin_invitations
           (id, agency_id, packet_id, assignment_id, user_id, invited_email, token_hash,
            created_by, created_at, expires_at, accepted_at, accepted_session_id, revoked_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL)`
      ).bind(inviteId, found.agency.id, packet.id, assignmentId, assignee.id, assignee.email,
        await sha256Hex(token), found.user.id, pushedAt, expiresAt),
      env.DB.prepare(
        `INSERT INTO activation_events
           (id, agency_id, packet_id, assignment_id, event_type, actor_user_id, occurred_at, metadata_json)
         VALUES (?, ?, ?, ?, 'assignment_delivered', ?, ?, ?)`
      ).bind(`event_assignment_delivered_${assignmentId}`, found.agency.id, packet.id, assignmentId,
        found.user.id, pushedAt, JSON.stringify({ inviteId, email: assignee.email }))
    );
    const assignment = {
      id: assignmentId, packetId: packet.id, projectId: packet.id, userId: assignee.id,
      agent: publicAgentName(agent), task, status: 'delivered', pushedAt,
      acceptedAt: null, pulledAt: null, returnedAt: null,
      assignee: { id: assignee.id, name: assignee.name, email: assignee.email },
      invitation: { id: inviteId, status: 'pending', expiresAt, acceptedAt: null }
    };
    created.push(assignment);
    invitations.push({
      id: inviteId, assignmentId, token, expiresAt,
      inviteUrl: `${baseUrl}/join/${token}`,
      url: `${baseUrl}/join/${token}`,
      acceptPath: `/api/plugin/invites/${token}/accept`,
      acceptUrl: `${baseUrl}/api/plugin/invites/${token}/accept`
    });
  }
  const pushedAt = created.at(-1)?.pushedAt || now();
  statements.push(env.DB.prepare('UPDATE packets SET updated_at = ? WHERE id = ? AND agency_id = ?')
    .bind(pushedAt, packet.id, found.agency.id));
  await env.DB.batch(statements);
  const project = rowPacket(packet);
  return json({ packetId: packet.id, packet: project, project, assignments: created, invitations }, 201);
}

function activationForPacket(packet, eventRows, uploadedInputCount) {
  const first = eventType => eventRows
    .filter(event => event.event_type === eventType)
    .sort((left, right) => left.occurred_at.localeCompare(right.occurred_at))[0]?.occurred_at || null;
  const firstInputAt = first('packet_input_uploaded');
  const creatorPull = eventRows
    .filter(event => event.event_type === 'assignment_pulled' && event.assignment_id && event.actor_user_id
      && event.actor_user_id !== packet.created_by)
    .sort((left, right) => left.occurred_at.localeCompare(right.occurred_at))[0];
  const firstPullAt = creatorPull?.occurred_at || null;
  const firstReturnAt = first('return_uploaded');
  const firstDecisionAt = first('return_decided');
  const ahaReached = Boolean(firstInputAt && firstPullAt);
  return {
    packetCreatedAt: first('packet_created') || packet.created_at,
    firstInputAt,
    firstAssignmentAt: first('assignment_delivered'),
    firstPullAt,
    firstReturnAt,
    firstDecisionAt,
    uploadedInputCount,
    ahaReached,
    closedLoop: Boolean(ahaReached && firstReturnAt && firstDecisionAt)
  };
}

async function packets(request, env) {
  const found = await requireSession(request, env);
  return json(await packetsForFound(env, found));
}

async function packetsForFound(env, found) {
  const leader = found.session.role === 'team_lead';
  const packetRows = leader
    ? resultRows(await env.DB.prepare('SELECT * FROM packets WHERE agency_id = ? ORDER BY updated_at DESC').bind(found.agency.id).all())
    : resultRows(await env.DB.prepare(
      `SELECT DISTINCT p.* FROM packets p JOIN assignments a ON a.packet_id = p.id
       WHERE p.agency_id = ? AND a.user_id = ? ORDER BY p.updated_at DESC`
    ).bind(found.agency.id, found.user.id).all());
  const items = [];
  for (const packetRow of packetRows) {
    const assignmentsStatement = leader
      ? env.DB.prepare(
        `SELECT a.*, u.id AS assignee_id, u.name AS assignee_name, u.email AS assignee_email,
                i.id AS invitation_id, i.expires_at AS invitation_expires_at,
                i.accepted_at AS invitation_accepted_at, i.revoked_at AS invitation_revoked_at
         FROM assignments a JOIN users u ON u.id = a.user_id
         LEFT JOIN plugin_invitations i ON i.assignment_id = a.id
         WHERE a.packet_id = ? ORDER BY a.pushed_at ASC`
      ).bind(packetRow.id)
      : env.DB.prepare(
        `SELECT a.*, u.id AS assignee_id, u.name AS assignee_name, u.email AS assignee_email,
                i.id AS invitation_id, i.expires_at AS invitation_expires_at,
                i.accepted_at AS invitation_accepted_at, i.revoked_at AS invitation_revoked_at
         FROM assignments a JOIN users u ON u.id = a.user_id
         LEFT JOIN plugin_invitations i ON i.assignment_id = a.id
         WHERE a.packet_id = ? AND a.user_id = ? ORDER BY a.pushed_at ASC`
      ).bind(packetRow.id, found.user.id);
    const inputsStatement = leader
      ? env.DB.prepare('SELECT * FROM packet_inputs WHERE packet_id = ? AND agency_id = ? ORDER BY created_at ASC')
        .bind(packetRow.id, found.agency.id)
      : env.DB.prepare(
        'SELECT * FROM packet_inputs WHERE packet_id = ? AND agency_id = ? AND uploaded_at IS NOT NULL ORDER BY created_at ASC'
      ).bind(packetRow.id, found.agency.id);
    const returnsStatement = leader
      ? env.DB.prepare('SELECT * FROM returns WHERE packet_id = ? AND uploaded_at IS NOT NULL ORDER BY uploaded_at DESC').bind(packetRow.id)
      : env.DB.prepare(
        `SELECT r.* FROM returns r JOIN assignments a ON a.id = r.assignment_id
         WHERE r.packet_id = ? AND a.user_id = ? AND r.uploaded_at IS NOT NULL ORDER BY r.uploaded_at DESC`
      ).bind(packetRow.id, found.user.id);
    const [assignmentResult, inputResult, returnResult, eventResult] = await Promise.all([
      assignmentsStatement.all(), inputsStatement.all(), returnsStatement.all(),
      env.DB.prepare('SELECT * FROM activation_events WHERE packet_id = ? AND agency_id = ? ORDER BY occurred_at ASC')
        .bind(packetRow.id, found.agency.id).all()
    ]);
    const assignmentItems = resultRows(assignmentResult).map(rowAssignment);
    const inputItems = resultRows(inputResult).map(rowInput);
    const returnItems = resultRows(returnResult).map(row => rowReturn(row, packetRow));
    const packet = { ...rowPacket(packetRow), inputs: inputItems };
    const validation = {
      complete: returnItems.length > 0 && returnItems.every(item => item.validation.complete),
      returns: returnItems.map(item => ({ returnId: item.id, ...item.validation }))
    };
    items.push({ packet, project: packet, inputs: inputItems, assignments: assignmentItems, returns: returnItems,
      validation, activation: activationForPacket(packetRow, resultRows(eventResult), inputItems.filter(item => item.ready).length) });
  }
  return { ...sessionPayload(found), mode: leader ? 'leader' : 'team_member', packets: items };
}

async function assignmentForSession(env, found, assignmentId) {
  const row = await env.DB.prepare(
    `SELECT a.*, p.agency_id, p.name AS packet_name, p.output_structure_json,
            u.id AS assignee_id, u.name AS assignee_name, u.email AS assignee_email
     FROM assignments a JOIN packets p ON p.id = a.packet_id JOIN users u ON u.id = a.user_id
     WHERE a.id = ? AND p.agency_id = ?`
  ).bind(assignmentId, found.agency.id).first();
  if (!row) throw httpError(404, 'Assignment not found');
  if (found.session.role !== 'team_lead' && row.user_id !== found.user.id) {
    throw httpError(403, 'This assignment is not assigned to this creator');
  }
  return row;
}

async function updateAssignment(request, env, assignmentId) {
  const found = await requireSession(request, env);
  if (found.session.role !== 'ai_creator') throw httpError(403, 'Only the assigned creator can update assignment status');
  const assignment = await assignmentForSession(env, found, assignmentId);
  const status = String((await bodyJson(request)).status || '').trim();
  if (status === 'returned') throw httpError(409, 'An assignment is returned only after verified return bytes are uploaded');
  if (!ASSIGNMENT_STATUSES.has(status)) throw httpError(400, 'Unsupported assignment status');
  if (found.session.role !== 'team_lead' && status === 'delivered') throw httpError(403, 'Creators cannot reset an assignment to delivered');
  if (assignment.status === 'returned') throw httpError(409, 'Returned assignments are immutable until a leader requests another pass');
  const at = now();
  const pulledAt = ['pulled', 'working'].includes(status) ? (assignment.pulled_at || at) : assignment.pulled_at;
  await env.DB.batch([
    env.DB.prepare('UPDATE assignments SET status = ?, pulled_at = ? WHERE id = ?').bind(status, pulledAt || null, assignment.id),
    env.DB.prepare(
      `INSERT OR IGNORE INTO activation_events
         (id, agency_id, packet_id, assignment_id, event_type, actor_user_id, occurred_at, metadata_json)
       SELECT ?, ?, ?, ?, 'assignment_pulled', ?, ?, '{}' WHERE ? IS NOT NULL`
    ).bind(`event_assignment_pulled_${assignment.id}`, found.agency.id, assignment.packet_id,
      assignment.id, found.user.id, pulledAt || at, pulledAt || null),
    env.DB.prepare(
      `INSERT INTO activation_events
         (id, agency_id, packet_id, assignment_id, event_type, actor_user_id, occurred_at, metadata_json)
       VALUES (?, ?, ?, ?, 'assignment_status', ?, ?, ?)`
    ).bind(id('event'), found.agency.id, assignment.packet_id, assignment.id, found.user.id, at, JSON.stringify({ status })),
    env.DB.prepare('UPDATE packets SET updated_at = ? WHERE id = ? AND agency_id = ?').bind(at, assignment.packet_id, found.agency.id)
  ]);
  const updated = await env.DB.prepare(
    `SELECT a.*, u.id AS assignee_id, u.name AS assignee_name, u.email AS assignee_email
     FROM assignments a JOIN users u ON u.id = a.user_id WHERE a.id = ?`
  ).bind(assignment.id).first();
  const packetRow = await env.DB.prepare('SELECT * FROM packets WHERE id = ?').bind(assignment.packet_id).first();
  const payload = rowAssignment(updated);
  return json({ id: payload.id, status: payload.status, assignment: payload, packet: rowPacket(packetRow), project: rowPacket(packetRow) });
}

function completeValidation(relativePath) {
  const checks = [
    { key: 'media', label: 'Media file attached', passed: true },
    { key: 'prompt', label: 'Creation prompt attached', passed: true },
    { key: 'made_with', label: 'Creation tool attached', passed: true },
    { key: 'output_folder', label: 'File follows the requested output structure', passed: true }
  ];
  return { complete: true, checks, missing: [], relativePath };
}

async function reserveReturn(request, env, assignmentId, authorizedFound = null, authorizedInput = null) {
  const found = authorizedFound || await requireSession(request, env);
  if (found.session.role !== 'ai_creator') throw httpError(403, 'Only the assigned creator can reserve a return');
  const assignment = await assignmentForSession(env, found, assignmentId);
  if (assignment.user_id !== found.user.id) throw httpError(403, 'This assignment belongs to another creator');
  if (assignment.status === 'returned') throw httpError(409, 'This assignment is not accepting a new return');
  if (!assignment.pulled_at || !['pulled', 'working', 'blocked'].includes(assignment.status)) {
    throw httpError(409, 'Pull the assignment before reserving a return');
  }
  const pending = await env.DB.prepare(
    'SELECT id FROM returns WHERE assignment_id = ? AND reservation_active = 1 AND uploaded_at IS NULL LIMIT 1'
  ).bind(assignment.id).first();
  if (pending) throw httpError(409, 'This assignment already has a pending return upload');
  const input = authorizedInput || await bodyJson(request);
  const filename = safeFilename(input.filename || input.name, 'return');
  const name = String(input.name || input.assetName || filename).trim().slice(0, 140) || filename;
  const prompt = String(input.prompt || '').trim().slice(0, 4000);
  const madeWith = String(input.madeWith || input.model || input.tool || '').trim().slice(0, 120);
  if (!prompt) throw httpError(422, 'Return prompt is required');
  if (!madeWith) throw httpError(422, 'Return madeWith/tool is required');
  const relativePath = normalizeReturnPath(input.relativePath ?? input.output?.relativePath, filename, assignment.output_structure_json);
  const { size, hash } = validateExpectedFile(input, 'Return', 422);
  const mime = String(input.mime || input.contentType || 'application/octet-stream').trim().toLowerCase().slice(0, 120);
  if (!ALLOWED_RETURN_MIME_PREFIXES.some(prefix => mime.startsWith(prefix))) {
    throw httpError(422, 'Only image, video, and audio returns are supported');
  }
  const parentReturnId = String(input.parentVersionId || input.parentReturnId || '').trim() || null;
  if (parentReturnId) {
    const parent = await env.DB.prepare(
      'SELECT 1 AS found FROM returns WHERE id = ? AND packet_id = ? AND uploaded_at IS NOT NULL'
    ).bind(parentReturnId, assignment.packet_id).first();
    if (!parent) throw httpError(422, 'Parent return does not belong to this packet');
  }
  const at = now();
  const returnId = id('ret');
  const pendingValidation = completeValidation(relativePath);
  pendingValidation.complete = false;
  pendingValidation.checks[0].passed = false;
  pendingValidation.missing = ['media'];
  try {
    await env.DB.prepare(
      `INSERT INTO returns
         (id, packet_id, assignment_id, user_id, name, made_with, prompt, notes, status,
          object_key, filename, content_type, size_bytes, created_at, branch, parent_return_id,
          decisions_json, comments_json, sha256, relative_path, uploaded_at, validation_json, reservation_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'needs_review', NULL, ?, ?, ?, ?, ?, ?, '[]', '[]', ?, ?, NULL, ?, 1)`
    ).bind(returnId, assignment.packet_id, assignment.id, found.user.id, name, madeWith, prompt,
      String(input.notes || '').slice(0, 2000), filename, mime, size, at,
      String(input.branch || 'Launch').slice(0, 80), parentReturnId, hash, relativePath,
      JSON.stringify(pendingValidation)).run();
  } catch (error) {
    if (/unique|constraint/i.test(error instanceof Error ? error.message : String(error))) {
      throw httpError(409, 'This assignment already has a pending return upload');
    }
    throw error;
  }
  const row = await env.DB.prepare('SELECT * FROM returns WHERE id = ?').bind(returnId).first();
  const payload = { ...rowReturn(row), uploadPath: `/api/plugin/returns/${returnId}/raw` };
  return json({ ...payload, return: payload, version: payload }, 201);
}

async function uploadReservedReturn(request, env, returnId, authorizedFound = null) {
  const found = authorizedFound || await requireSession(request, env);
  if (found.session.role !== 'ai_creator') throw httpError(403, 'Only the assigned creator can upload a return');
  const item = await env.DB.prepare(
    `SELECT r.*, p.agency_id, p.output_structure_json, a.user_id AS assignment_user_id,
            a.status AS assignment_status, a.pulled_at AS assignment_pulled_at
     FROM returns r JOIN packets p ON p.id = r.packet_id
     JOIN assignments a ON a.id = r.assignment_id AND a.packet_id = r.packet_id
     WHERE r.id = ? AND p.agency_id = ?`
  ).bind(returnId, found.agency.id).first();
  if (!item) throw httpError(404, 'Return reservation not found');
  if (item.assignment_user_id !== found.user.id || item.user_id !== found.user.id) {
    throw httpError(403, 'This return belongs to another creator');
  }
  if (item.uploaded_at || item.object_key) throw httpError(409, 'Return bytes are immutable and have already been uploaded');
  if (!item.assignment_pulled_at || !['pulled', 'working', 'blocked'].includes(item.assignment_status)) {
    throw httpError(409, 'This assignment is not accepting return bytes');
  }
  const key = `returns/${item.agency_id}/${item.packet_id}/${item.id}/${safeFilename(item.filename, item.id)}`;
  const storage = await putVerifiedObject(request, env, {
    label: 'Return', key, size: Number(item.size_bytes), hash: item.sha256, contentType: item.content_type,
    customMetadata: { returnId: item.id, packetId: item.packet_id, assignmentId: item.assignment_id, agencyId: item.agency_id }
  });
  const uploadedAt = now();
  const validation = completeValidation(item.relative_path);
  let results;
  try {
    results = await env.DB.batch([
      env.DB.prepare(
        `UPDATE returns SET object_key = ?, uploaded_at = ?, validation_json = ?, reservation_active = 0
         WHERE id = ? AND reservation_active = 1 AND uploaded_at IS NULL AND object_key IS NULL
           AND EXISTS (
             SELECT 1 FROM assignments
             WHERE id = ? AND user_id = ? AND pulled_at IS NOT NULL
               AND status IN ('pulled', 'working', 'blocked')
           )`
      ).bind(key, uploadedAt, JSON.stringify(validation), item.id, item.assignment_id, found.user.id),
      env.DB.prepare(
        `UPDATE assignments SET status = 'returned', returned_at = ?
         WHERE id = ? AND user_id = ? AND pulled_at IS NOT NULL
           AND status IN ('pulled', 'working', 'blocked') AND EXISTS (
           SELECT 1 FROM returns WHERE id = ? AND object_key = ? AND uploaded_at = ?
         )`
      ).bind(uploadedAt, item.assignment_id, found.user.id, item.id, key, uploadedAt),
      env.DB.prepare(
        `INSERT OR IGNORE INTO activation_events
           (id, agency_id, packet_id, assignment_id, return_id, event_type, actor_user_id, occurred_at, metadata_json)
         SELECT ?, ?, ?, ?, ?, 'return_uploaded', ?, ?, ?
         WHERE EXISTS (SELECT 1 FROM returns WHERE id = ? AND object_key = ? AND uploaded_at = ?)
           AND EXISTS (
             SELECT 1 FROM assignments
             WHERE id = ? AND user_id = ? AND status = 'returned' AND returned_at = ?
           )`
      ).bind(`event_return_uploaded_${item.id}`, item.agency_id, item.packet_id, item.assignment_id,
        item.id, found.user.id, uploadedAt, JSON.stringify({ sha256: item.sha256, size: item.size_bytes }),
        item.id, key, uploadedAt, item.assignment_id, found.user.id, uploadedAt),
      env.DB.prepare('UPDATE packets SET updated_at = ? WHERE id = ? AND agency_id = ?')
        .bind(uploadedAt, item.packet_id, item.agency_id)
  ]);
  } catch (error) {
    throw error;
  }
  let completed = await env.DB.prepare('SELECT * FROM returns WHERE id = ?').bind(item.id).first();
  let assignmentRow = await env.DB.prepare(
    `SELECT a.*, u.id AS assignee_id, u.name AS assignee_name, u.email AS assignee_email
     FROM assignments a JOIN users u ON u.id = a.user_id WHERE a.id = ?`
  ).bind(item.assignment_id).first();
  const finalized = completed?.uploaded_at && completed.object_key === key
    && assignmentRow?.status === 'returned' && assignmentRow.returned_at;
  if (!finalized) {
    if (changedRows(results[0]) === 1) {
      await env.DB.batch([
        env.DB.prepare(
          `UPDATE returns SET object_key = NULL, uploaded_at = NULL, validation_json = ?, reservation_active = 1
           WHERE id = ? AND object_key = ? AND uploaded_at = ?`
        ).bind(item.validation_json, item.id, key, uploadedAt),
        env.DB.prepare(
          `DELETE FROM activation_events
           WHERE return_id = ? AND event_type = 'return_uploaded' AND occurred_at = ?`
        ).bind(item.id, uploadedAt)
      ]);
    }
    throw httpError(409, 'This return could not be finalized; retry after the assignment is accepting work');
  }
  const duplicate = await env.DB.prepare(
    `SELECT 1 AS found FROM returns r JOIN packets p ON p.id = r.packet_id
     WHERE p.agency_id = ? AND r.sha256 = ? AND r.uploaded_at IS NOT NULL AND r.id <> ? LIMIT 1`
  ).bind(item.agency_id, item.sha256, item.id).first();
  const version = rowReturn(completed, item);
  const asset = {
    id: version.assetId, projectId: version.projectId, name: completed.name,
    currentVersionId: version.id, createdAt: version.createdAt, updatedAt: version.createdAt
  };
  return json({ id: version.id, return: version, version, asset, assignment: rowAssignment(assignmentRow),
    deduplicated: Boolean(duplicate), recovered: storage.adopted });
}

async function downloadReturn(request, env, returnId, requireAuth = true) {
  const found = requireAuth ? await requireSession(request, env) : null;
  const item = await env.DB.prepare(
    `SELECT r.*, p.agency_id FROM returns r JOIN packets p ON p.id = r.packet_id
     WHERE r.id = ? AND r.uploaded_at IS NOT NULL`
  ).bind(returnId).first();
  if (!item?.object_key) throw httpError(404, 'Return media not found');
  if (found) {
    if (item.agency_id !== found.agency.id) throw httpError(404, 'Return media not found');
    if (found.session.role !== 'team_lead' && item.user_id !== found.user.id) {
      throw httpError(403, 'This return belongs to another creator');
    }
  } else {
    const shareToken = new URL(request.url).searchParams.get('share') || '';
    if (!shareToken) throw httpError(401, 'A plugin session or share token is required');
    const share = await env.DB.prepare(
      `SELECT 1 AS allowed FROM shares
       WHERE token = ? AND (
         (scope = 'version' AND target_id = ?) OR
         (scope = 'project' AND target_id = ?)
       ) LIMIT 1`
    ).bind(shareToken, item.id, item.packet_id).first();
    if (!share) throw httpError(403, 'This share does not include that return');
  }
  const object = await env.MEDIA.get(item.object_key);
  if (!object) throw httpError(404, 'Return media not found');
  return objectResponse(object, item.filename || returnId, item.content_type);
}

async function reviewReturn(request, env, returnId, authorizedFound = null, authorizedInput = null) {
  const found = authorizedFound || await requireLeader(request, env);
  if (found.session.role !== 'team_lead') throw httpError(403, 'Only leaders can review returns');
  const row = await env.DB.prepare(
    `SELECT r.*, p.agency_id, p.output_structure_json
     FROM returns r JOIN packets p ON p.id = r.packet_id
     WHERE r.id = ? AND p.agency_id = ? AND r.uploaded_at IS NOT NULL`
  ).bind(returnId, found.agency.id).first();
  if (!row) throw httpError(404, 'Return not found');
  const input = authorizedInput || await bodyJson(request);
  const action = String(input.action || '').trim();
  const comment = String(input.comment || '').trim().slice(0, 2000);
  if (!action && !comment) throw httpError(400, 'Add a review decision or comment');
  if (action && !REVIEW_ACTIONS[action]) throw httpError(400, 'Unsupported decision');
  const at = now();
  const comments = safeJson(row.comments_json, []);
  const decisions = safeJson(row.decisions_json, []);
  let status = row.status;
  let decision = null;
  const statements = [];
  if (action) {
    status = REVIEW_ACTIONS[action];
    decision = { id: id('decision'), action, actor: found.user.name, note: String(input.note || '').slice(0, 800), at };
    decisions.push(decision);
    statements.push(
      env.DB.prepare(
        `INSERT INTO review_decisions
           (id, agency_id, packet_id, return_id, actor_user_id, action, note, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(decision.id, found.agency.id, row.packet_id, row.id, found.user.id, action, decision.note, at),
      env.DB.prepare(
        `INSERT INTO activation_events
           (id, agency_id, packet_id, assignment_id, return_id, event_type, actor_user_id, occurred_at, metadata_json)
         VALUES (?, ?, ?, ?, ?, 'return_decided', ?, ?, ?)`
      ).bind(`event_${decision.id}`, found.agency.id, row.packet_id, row.assignment_id, row.id,
        found.user.id, at, JSON.stringify({ action }))
    );
    if (action === 'request_changes' || action === 'reopen') {
      statements.push(env.DB.prepare(
        `UPDATE assignments SET status = ?, returned_at = NULL WHERE id = ? AND packet_id = ?`
      ).bind('working', row.assignment_id, row.packet_id));
    }
  }
  if (comment) comments.push({ id: id('cm'), author: found.user.name, role: 'collaborator', body: comment, createdAt: at });
  statements.unshift(
    env.DB.prepare('UPDATE returns SET status = ?, decisions_json = ?, comments_json = ? WHERE id = ? AND uploaded_at IS NOT NULL')
      .bind(status, JSON.stringify(decisions), JSON.stringify(comments), row.id)
  );
  statements.push(env.DB.prepare('UPDATE packets SET updated_at = ? WHERE id = ? AND agency_id = ?').bind(at, row.packet_id, found.agency.id));
  await env.DB.batch(statements);
  const updated = await env.DB.prepare('SELECT * FROM returns WHERE id = ?').bind(row.id).first();
  const assignment = await env.DB.prepare(
    `SELECT a.*, u.id AS assignee_id, u.name AS assignee_name, u.email AS assignee_email
     FROM assignments a JOIN users u ON u.id = a.user_id WHERE a.id = ?`
  ).bind(row.assignment_id).first();
  const version = rowReturn(updated, row);
  return json({ ...version, return: version, version, decision, assignment: rowAssignment(assignment) });
}

async function appState(request, env) {
  const found = await requireLeader(request, env);
  const [userRows, packetRows, assignmentRows, returnRows, shareRows, eventRows] = await Promise.all([
    env.DB.prepare(
      `SELECT u.*, m.role AS membership_role FROM users u JOIN agency_memberships m ON m.user_id = u.id
       WHERE m.agency_id = ? ORDER BY m.created_at ASC`
    ).bind(found.agency.id).all(),
    env.DB.prepare('SELECT * FROM packets WHERE agency_id = ? ORDER BY updated_at DESC').bind(found.agency.id).all(),
    env.DB.prepare(
      `SELECT a.*, u.id AS assignee_id, u.name AS assignee_name, u.email AS assignee_email
       FROM assignments a JOIN packets p ON p.id = a.packet_id JOIN users u ON u.id = a.user_id
       WHERE p.agency_id = ? ORDER BY a.pushed_at DESC`
    ).bind(found.agency.id).all(),
    env.DB.prepare(
      `SELECT r.* FROM returns r JOIN packets p ON p.id = r.packet_id
       WHERE p.agency_id = ? AND r.uploaded_at IS NOT NULL ORDER BY r.uploaded_at DESC`
    ).bind(found.agency.id).all(),
    env.DB.prepare(
      `SELECT s.* FROM shares s
       WHERE (s.scope = 'project' AND EXISTS (
         SELECT 1 FROM packets p WHERE p.id = s.target_id AND p.agency_id = ?
       )) OR (s.scope = 'version' AND EXISTS (
         SELECT 1 FROM returns r JOIN packets p ON p.id = r.packet_id
         WHERE r.id = s.target_id AND p.agency_id = ?
       )) ORDER BY s.created_at DESC`
    ).bind(found.agency.id, found.agency.id).all().catch(() => ({ results: [] })),
    env.DB.prepare('SELECT * FROM activation_events WHERE agency_id = ? ORDER BY occurred_at DESC LIMIT 80')
      .bind(found.agency.id).all().catch(() => ({ results: [] }))
  ]);
  const packetMap = new Map(resultRows(packetRows).map(row => [row.id, row]));
  const returns = resultRows(returnRows);
  const assignmentsByPacket = new Map();
  for (const row of resultRows(assignmentRows)) {
    const list = assignmentsByPacket.get(row.packet_id) || [];
    list.push(rowAssignment(row));
    assignmentsByPacket.set(row.packet_id, list);
  }
  const projects = resultRows(packetRows).map(row => ({
    ...rowPacket(row),
    branches: [...new Set(['Launch', ...returns.filter(item => item.packet_id === row.id).map(item => item.branch || 'Launch')])],
    templateId: 'tpl_campaign',
    assignments: assignmentsByPacket.get(row.id) || []
  }));
  const versions = returns.map(row => rowReturn(row, packetMap.get(row.packet_id)));
  const assets = versions.map(version => ({
    id: version.assetId, projectId: version.projectId,
    name: version.filename.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' '),
    currentVersionId: version.id, createdAt: version.createdAt, updatedAt: version.createdAt
  }));
  const users = resultRows(userRows).map(row => ({
    id: row.id, email: row.email, name: row.name, role: row.membership_role, agent: publicAgentName(row.clanker)
  }));
  const activity = resultRows(eventRows).map(row => ({
    id: row.id, type: row.event_type, message: row.event_type.replace(/_/g, ' '),
    actor: row.actor_user_id || 'nitrate', projectId: row.packet_id, at: row.occurred_at
  }));
  return json({
    users: users.length ? users : [{ id: 'user_maya', name: 'Maya Chen', role: 'team_lead', agent: 'maya-lead' }],
    projects, assets, versions, templates: TEMPLATES, activity,
    shares: resultRows(shareRows).map(row => ({
      id: row.id, scope: row.scope, targetId: row.target_id, label: row.label,
      allowDownload: Boolean(row.allow_download), createdBy: row.created_by, createdAt: row.created_at
    }))
  });
}

async function updateAppVersion(request, env, returnId) {
  const found = await requireLeader(request, env);
  const user = found.user;
  const input = await bodyJson(request);
  const row = await env.DB.prepare(
    `SELECT r.*, p.agency_id, p.output_structure_json FROM returns r JOIN packets p ON p.id = r.packet_id
     WHERE r.id = ? AND p.agency_id = ? AND r.uploaded_at IS NOT NULL`
  ).bind(returnId, found.agency.id).first();
  if (!row) throw httpError(404, 'Unknown version');
  const comments = safeJson(row.comments_json, []);
  const decisions = safeJson(row.decisions_json, []);
  let status = row.status;
  const at = now();
  const statements = [];
  if (input.action) {
    status = REVIEW_ACTIONS[input.action];
    if (!status) throw httpError(400, 'Unsupported decision');
    const decision = { id: id('decision'), action: input.action, actor: user.name, note: String(input.note || '').slice(0, 800), at };
    decisions.push(decision);
    statements.push(
      env.DB.prepare(
        `INSERT INTO review_decisions
           (id, agency_id, packet_id, return_id, actor_user_id, action, note, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(decision.id, row.agency_id, row.packet_id, row.id, user.id, decision.action, decision.note, at),
      env.DB.prepare(
        `INSERT INTO activation_events
           (id, agency_id, packet_id, assignment_id, return_id, event_type, actor_user_id, occurred_at, metadata_json)
         VALUES (?, ?, ?, ?, ?, 'return_decided', ?, ?, ?)`
      ).bind(`event_${decision.id}`, row.agency_id, row.packet_id, row.assignment_id, row.id, user.id, at, JSON.stringify({ action: decision.action }))
    );
    if (input.action === 'request_changes' || input.action === 'reopen') {
      statements.push(env.DB.prepare('UPDATE assignments SET status = ?, returned_at = NULL WHERE id = ? AND packet_id = ?')
        .bind('working', row.assignment_id, row.packet_id));
    }
  }
  if (input.comment) comments.push({ id: id('cm'), author: user.name, role: 'collaborator', body: String(input.comment).slice(0, 2000), createdAt: at });
  statements.unshift(env.DB.prepare('UPDATE returns SET status = ?, decisions_json = ?, comments_json = ? WHERE id = ?')
    .bind(dbStatus(status), JSON.stringify(decisions), JSON.stringify(comments), returnId));
  await env.DB.batch(statements);
  const updated = await env.DB.prepare('SELECT * FROM returns WHERE id = ?').bind(returnId).first();
  return json(rowReturn(updated, row));
}

async function createShare(request, env) {
  const found = await requireLeader(request, env);
  const user = found.user;
  const input = await bodyJson(request);
  const scope = input.scope === 'project' ? 'project' : 'version';
  const targetId = String(input.targetId || '');
  let label = '';
  if (scope === 'project') {
    const packet = await env.DB.prepare('SELECT * FROM packets WHERE id = ? AND agency_id = ?')
      .bind(targetId, found.agency.id).first();
    if (!packet) throw httpError(404, 'Unknown project');
    label = packet.name;
  } else {
    const row = await env.DB.prepare(
      `SELECT r.* FROM returns r JOIN packets p ON p.id = r.packet_id
       WHERE r.id = ? AND p.agency_id = ? AND r.uploaded_at IS NOT NULL`
    ).bind(targetId, found.agency.id).first();
    if (!row) throw httpError(404, 'Unknown version');
    label = row.name || row.filename;
  }
  const share = { id: id('share'), token: randomToken(24), scope, targetId, label, allowDownload: Boolean(input.allowDownload), at: now() };
  await env.DB.prepare(
    'INSERT INTO shares (id, token, scope, target_id, label, allow_download, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(share.id, share.token, share.scope, share.targetId, share.label, share.allowDownload ? 1 : 0, user.name, share.at).run();
  return json({ ...share, url: `/share/${share.token}` }, 201);
}

async function sharedView(env, token) {
  const share = await env.DB.prepare('SELECT * FROM shares WHERE token = ?').bind(token).first();
  if (!share) throw httpError(404, 'This share is unavailable');
  const rows = share.scope === 'project'
    ? resultRows(await env.DB.prepare(
      `SELECT r.*, p.output_structure_json FROM returns r JOIN packets p ON p.id = r.packet_id
       WHERE r.packet_id = ? AND r.uploaded_at IS NOT NULL ORDER BY r.uploaded_at DESC`
    ).bind(share.target_id).all())
    : resultRows(await env.DB.prepare(
      `SELECT r.*, p.output_structure_json FROM returns r JOIN packets p ON p.id = r.packet_id
       WHERE r.id = ? AND r.uploaded_at IS NOT NULL`
    ).bind(share.target_id).all());
  const versions = rows.map(row => ({
    ...rowReturn(row, row),
    downloadPath: `/api/media/${row.id}?share=${encodeURIComponent(token)}`
  }));
  const assets = versions.map(version => ({
    id: version.assetId, projectId: version.projectId,
    name: version.filename.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' '),
    currentVersionId: version.id, createdAt: version.createdAt, updatedAt: version.createdAt
  }));
  return json({
    share: { label: share.label, scope: share.scope, allowDownload: Boolean(share.allow_download), createdBy: share.created_by },
    versions, assets
  });
}

async function createLegacyReturnReservation(request, env) {
  const input = await bodyJson(request);
  const assignmentId = String(input.assignmentId || '');
  if (!assignmentId) throw httpError(400, 'assignmentId is required');
  const headers = new Headers(request.headers);
  headers.delete('Content-Length');
  return reserveReturn(new Request(request.url, { method: 'POST', headers, body: JSON.stringify(input) }), env, assignmentId);
}

function internalRequest(request, method, pathname, body) {
  const headers = new Headers({ Authorization: request.headers.get('Authorization') || '' });
  if (body !== undefined) headers.set('Content-Type', 'application/json');
  return new Request(new URL(pathname, request.url), {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
}

async function responsePayload(response) {
  const payload = await response.json();
  if (!response.ok) throw httpError(response.status, payload?.error || 'Nitrate operation failed');
  return payload;
}

async function pullAssignmentForMcp(env, found, assignmentId) {
  if (found.session.role !== 'ai_creator') throw httpError(403, 'Only creators can pull assignments');
  let assignment = await assignmentForSession(env, found, assignmentId);
  if (assignment.user_id !== found.user.id) throw httpError(403, 'This assignment belongs to another creator');
  if (assignment.status === 'returned') throw httpError(409, 'This assignment has already been returned');
  if (!['delivered', 'pulled', 'working', 'blocked'].includes(assignment.status)) {
    throw httpError(409, 'This assignment cannot be pulled in its current state');
  }
  if (!assignment.pulled_at) {
    const pulledAt = now();
    const results = await env.DB.batch([
      env.DB.prepare(
        `UPDATE assignments SET status = 'pulled', pulled_at = ?
         WHERE id = ? AND user_id = ? AND pulled_at IS NULL AND status = 'delivered'`
      ).bind(pulledAt, assignment.id, found.user.id),
      env.DB.prepare(
        `INSERT OR IGNORE INTO activation_events
           (id, agency_id, packet_id, assignment_id, event_type, actor_user_id, occurred_at, metadata_json)
         SELECT ?, ?, ?, ?, 'assignment_pulled', ?, ?, '{}'
         WHERE EXISTS (
           SELECT 1 FROM assignments
           WHERE id = ? AND user_id = ? AND pulled_at = ? AND status = 'pulled'
         )`
      ).bind(`event_assignment_pulled_${assignment.id}`, found.agency.id, assignment.packet_id,
        assignment.id, found.user.id, pulledAt, assignment.id, found.user.id, pulledAt),
      env.DB.prepare('UPDATE packets SET updated_at = ? WHERE id = ? AND agency_id = ?')
        .bind(pulledAt, assignment.packet_id, found.agency.id)
    ]);
    if (changedRows(results[0]) !== 1) {
      assignment = await assignmentForSession(env, found, assignmentId);
      if (!assignment.pulled_at) throw httpError(409, 'This assignment could not be pulled');
    }
  }
  const [updated, packet, inputRows] = await Promise.all([
    env.DB.prepare(
      `SELECT a.*, u.id AS assignee_id, u.name AS assignee_name, u.email AS assignee_email
       FROM assignments a JOIN users u ON u.id = a.user_id WHERE a.id = ?`
    ).bind(assignment.id).first(),
    env.DB.prepare('SELECT * FROM packets WHERE id = ? AND agency_id = ?')
      .bind(assignment.packet_id, found.agency.id).first(),
    env.DB.prepare(
      `SELECT * FROM packet_inputs
       WHERE packet_id = ? AND agency_id = ? AND uploaded_at IS NOT NULL
       ORDER BY created_at ASC`
    ).bind(assignment.packet_id, found.agency.id).all()
  ]);
  return {
    packet: rowPacket(packet),
    assignment: rowAssignment(updated),
    inputs: resultRows(inputRows).map(rowInput)
  };
}

async function prepareRemoteReturnImport(env, found, connection, input) {
  if (found.session.role !== 'ai_creator') throw httpError(403, 'Only creators can submit returns');
  const provider = 'Higgsfield Supercomputer';
  const externalAssetId = String(input.externalAssetId || '').trim();
  if (!externalAssetId) throw httpError(422, 'externalAssetId is required for retry-safe imports');

  const existing = await env.DB.prepare(
    `SELECT x.*, r.uploaded_at, r.object_key
     FROM mcp_external_asset_imports x
     LEFT JOIN returns r ON r.id = x.return_id
     WHERE x.agency_id = ? AND x.provider = ? AND x.external_asset_id = ? LIMIT 1`
  ).bind(found.agency.id, provider, externalAssetId).first();
  if (existing) {
    if (existing.user_id !== found.user.id || existing.assignment_id !== input.assignmentId) {
      throw httpError(409, 'This Higgsfield asset is already attached to different agency work');
    }
  }

  const assignment = await assignmentForSession(env, found, String(input.assignmentId || ''));
  if (assignment.user_id !== found.user.id) throw httpError(403, 'This assignment belongs to another creator');
  const filename = safeFilename(input.filename, 'return');
  if (filename !== input.filename) throw httpError(422, 'filename must be a plain safe filename');
  const relativePath = normalizeReturnPath(input.relativePath, filename, assignment.output_structure_json);
  const parentReturnId = String(input.parentReturnId || '').trim() || null;
  if (parentReturnId) {
    const parent = await env.DB.prepare(
      'SELECT 1 AS found FROM returns WHERE id = ? AND packet_id = ? AND uploaded_at IS NOT NULL'
    ).bind(parentReturnId, assignment.packet_id).first();
    if (!parent) throw httpError(422, 'Parent return does not belong to this packet');
  }

  if (existing?.return_id && existing.uploaded_at && existing.object_key) {
    if (existing.status !== 'committed') {
      await env.DB.prepare(
        `UPDATE mcp_external_asset_imports SET status = 'committed', updated_at = ?, cleanup_error = NULL
         WHERE id = ? AND status = 'pending'`
      ).bind(now(), existing.id).run();
    }
    const returned = await env.DB.prepare('SELECT * FROM returns WHERE id = ?').bind(existing.return_id).first();
    return { existing: rowReturn(returned) };
  }

  if (assignment.status === 'returned') throw httpError(409, 'This assignment is not accepting a new return');
  if (!assignment.pulled_at || !['pulled', 'working', 'blocked'].includes(assignment.status)) {
    throw httpError(409, 'Pull the assignment before importing a return');
  }
  const pending = await env.DB.prepare(
    `SELECT id FROM returns
     WHERE assignment_id = ? AND reservation_active = 1 AND uploaded_at IS NULL
       AND id <> COALESCE(?, '') LIMIT 1`
  ).bind(assignment.id, existing?.return_id || null).first();
  if (pending) throw httpError(409, 'This assignment already has a pending return upload');

  const startedAt = now();
  const leaseExpiresAt = new Date(Date.now() + MCP_IMPORT_LEASE_MS).toISOString();
  if (existing) {
    if (existing.status !== 'pending' || existing.lease_expires_at > startedAt) {
      throw httpError(409, 'This Higgsfield asset import is already in progress');
    }
    const stagingKey = `mcp-staging/${found.agency.id}/${existing.id}`;
    const claimed = await env.DB.prepare(
      `UPDATE mcp_external_asset_imports
       SET connection_id = ?, lease_expires_at = ?, cleanup_error = NULL, updated_at = ?
       WHERE id = ? AND agency_id = ? AND user_id = ? AND status = 'pending'
         AND updated_at = ? AND lease_expires_at <= ?`
    ).bind(connection.id, leaseExpiresAt, startedAt, existing.id, found.agency.id,
      found.user.id, existing.updated_at, startedAt).run();
    if (changedRows(claimed) !== 1) throw httpError(409, 'This Higgsfield asset import was reclaimed by another request');
    try {
      if (existing.return_id) await cleanupPendingMcpReturn(env, existing.return_id, existing.id);
      if (existing.staging_key) await env.MEDIA.delete(existing.staging_key);
      const reset = await env.DB.prepare(
        `UPDATE mcp_external_asset_imports
         SET return_id = NULL, staging_key = ?, cleanup_error = NULL, updated_at = ?
         WHERE id = ? AND agency_id = ? AND user_id = ? AND status = 'pending' AND updated_at = ?`
      ).bind(stagingKey, now(), existing.id, found.agency.id, found.user.id, startedAt).run();
      if (changedRows(reset) !== 1) throw new Error('The reclaimed import could not be reset');
    } catch (error) {
      await noteRemoteImportCleanupFailure(env, found, existing.id, 'stale import cleanup failed; metadata retained');
      throw Object.assign(new Error('The previous import could not be recovered safely'), {
        statusCode: 503,
        cause: error
      });
    }
    return { reservationId: existing.id, stagingKey, filename, relativePath, parentReturnId };
  }

  const reservation = { id: id('mcpimport'), createdAt: startedAt };
  const stagingKey = `mcp-staging/${found.agency.id}/${reservation.id}`;
  try {
    await env.DB.prepare(
      `INSERT INTO mcp_external_asset_imports
         (id, agency_id, user_id, connection_id, assignment_id, provider, external_asset_id,
          return_id, staging_key, lease_expires_at, cleanup_error, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, NULL, 'pending', ?, ?)`
    ).bind(reservation.id, found.agency.id, found.user.id, connection.id, assignment.id,
      provider, externalAssetId, stagingKey, leaseExpiresAt, reservation.createdAt, reservation.createdAt).run();
  } catch (error) {
    if (/unique|constraint/i.test(error instanceof Error ? error.message : String(error))) {
      throw httpError(409, 'This Higgsfield asset import was already started');
    }
    throw error;
  }
  return { reservationId: reservation.id, stagingKey, filename, relativePath, parentReturnId };
}

async function markRemoteImportStaged(env, found, reservationId, stagingKey) {
  const result = await env.DB.prepare(
    `UPDATE mcp_external_asset_imports SET staging_key = ?, updated_at = ?
     WHERE id = ? AND agency_id = ? AND user_id = ? AND status = 'pending' AND staging_key = ?`
  ).bind(stagingKey, now(), reservationId, found.agency.id, found.user.id, stagingKey).run();
  if (changedRows(result) !== 1) throw httpError(409, 'The Higgsfield import reservation is no longer active');
}

async function attachRemoteImportReturn(env, found, reservationId, returnId) {
  const result = await env.DB.prepare(
    `UPDATE mcp_external_asset_imports SET return_id = ?, updated_at = ?
     WHERE id = ? AND agency_id = ? AND user_id = ? AND status = 'pending' AND return_id IS NULL`
  ).bind(returnId, now(), reservationId, found.agency.id, found.user.id).run();
  if (changedRows(result) !== 1) throw httpError(409, 'The Higgsfield import reservation is no longer active');
}

async function commitRemoteImport(env, found, reservationId, returnId) {
  const result = await env.DB.prepare(
    `UPDATE mcp_external_asset_imports SET status = 'committed', updated_at = ?
     WHERE id = ? AND agency_id = ? AND user_id = ? AND return_id = ? AND status = 'pending'
       AND EXISTS (SELECT 1 FROM returns WHERE id = ? AND uploaded_at IS NOT NULL)`
  ).bind(now(), reservationId, found.agency.id, found.user.id, returnId, returnId).run();
  if (changedRows(result) !== 1) throw httpError(409, 'The Higgsfield import could not be committed');
}

async function clearRemoteImportStaging(env, found, reservationId, stagingKey) {
  await env.DB.prepare(
    `UPDATE mcp_external_asset_imports SET staging_key = NULL, cleanup_error = NULL, updated_at = ?
     WHERE id = ? AND agency_id = ? AND user_id = ? AND staging_key = ?`
  ).bind(now(), reservationId, found.agency.id, found.user.id, stagingKey).run();
}

async function noteRemoteImportCleanupFailure(env, found, reservationId, message) {
  await env.DB.prepare(
    `UPDATE mcp_external_asset_imports SET cleanup_error = ?, updated_at = ?
     WHERE id = ? AND agency_id = ? AND user_id = ?`
  ).bind(String(message || 'cleanup failed').slice(0, 500), now(), reservationId,
    found.agency.id, found.user.id).run();
}

async function cleanupRemoteImport(env, found, reservationId) {
  await env.DB.prepare(
    `DELETE FROM mcp_external_asset_imports
     WHERE id = ? AND agency_id = ? AND user_id = ? AND status = 'pending'
       AND (return_id IS NULL OR NOT EXISTS (
         SELECT 1 FROM returns WHERE id = mcp_external_asset_imports.return_id AND uploaded_at IS NOT NULL
       ))`
  ).bind(reservationId, found.agency.id, found.user.id).run();
}

export async function cleanupPendingMcpReturn(env, returnId, reservationId = null) {
  const row = await env.DB.prepare(
    `SELECT r.*, p.agency_id FROM returns r JOIN packets p ON p.id = r.packet_id
     WHERE r.id = ? LIMIT 1`
  ).bind(returnId).first();
  if (!row || row.uploaded_at) return;
  const key = row.object_key || `returns/${row.agency_id}/${row.packet_id}/${row.id}/${safeFilename(row.filename, row.id)}`;
  await env.MEDIA.delete(key);
  if (reservationId) {
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE mcp_external_asset_imports SET return_id = NULL
         WHERE id = ? AND return_id = ? AND status = 'pending'`
      ).bind(reservationId, returnId),
      env.DB.prepare('DELETE FROM returns WHERE id = ? AND uploaded_at IS NULL').bind(returnId)
    ]);
  } else {
    await env.DB.prepare('DELETE FROM returns WHERE id = ? AND uploaded_at IS NULL').bind(returnId).run();
  }
}

function remoteMcpServices(request, env) {
  return {
    authenticate: token => authenticateMcpConnection(env, token),
    listWork: found => packetsForFound(env, found),
    pullAssignment: (found, assignmentId) => pullAssignmentForMcp(env, found, assignmentId),
    prepareReturnImport: (found, input) => prepareRemoteReturnImport(env, found, found.connection, input),
    markImportStaged: (found, reservationId, stagingKey) => markRemoteImportStaged(env, found, reservationId, stagingKey),
    async reserveReturn(found, input) {
      return responsePayload(await reserveReturn(
        internalRequest(request, 'POST', `/api/plugin/assignments/${encodeURIComponent(input.assignmentId)}/returns`),
        env,
        input.assignmentId,
        found,
        input
      ));
    },
    async uploadReturn(found, returnId, body, size, contentType) {
      const headers = new Headers({
        'Content-Length': String(size),
        'Content-Type': contentType
      });
      const uploadRequest = new Request(
        new URL(`/api/plugin/returns/${encodeURIComponent(returnId)}/raw`, request.url),
        { method: 'PUT', headers, body }
      );
      return responsePayload(await uploadReservedReturn(uploadRequest, env, returnId, found));
    },
    async reviewReturn(found, returnId, action, note) {
      return responsePayload(await reviewReturn(
        internalRequest(request, 'PATCH', `/api/plugin/returns/${encodeURIComponent(returnId)}`),
        env,
        returnId,
        found,
        { action, note }
      ));
    },
    attachImportReturn: (found, reservationId, returnId) => attachRemoteImportReturn(env, found, reservationId, returnId),
    commitImport: (found, reservationId, returnId) => commitRemoteImport(env, found, reservationId, returnId),
    clearImportStaging: (found, reservationId, stagingKey) => clearRemoteImportStaging(env, found, reservationId, stagingKey),
    noteImportCleanupFailure: (found, reservationId, message) => noteRemoteImportCleanupFailure(env, found, reservationId, message),
    cleanupImport: (found, reservationId) => cleanupRemoteImport(env, found, reservationId),
    cleanupPendingReturn: (returnId, reservationId) => cleanupPendingMcpReturn(env, returnId, reservationId)
  };
}

async function route(request, env) {
  const url = new URL(request.url);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204 });
  if (request.method === 'GET' && url.pathname === '/healthz') return json({ ok: true });
  if (request.method === 'GET' && url.pathname === '/api/state') return appState(request, env);
  if (request.method === 'POST' && url.pathname === '/api/waitlist') return joinWaitlist(request, env);
  if (request.method === 'POST' && url.pathname === '/api/projects') return createProject(request, env);
  if (request.method === 'POST' && url.pathname === '/api/uploads') {
    return fail(410, 'Use the authenticated two-step return reservation and raw upload endpoints');
  }
  if (request.method === 'POST' && url.pathname === '/api/shares') return createShare(request, env);
  if (request.method === 'POST' && url.pathname === '/api/plugin/login') return pluginLogin(request, env);
  if (request.method === 'POST' && url.pathname === '/api/plugin/mcp-connections') return createMcpConnection(request, env);
  if (request.method === 'GET' && url.pathname === '/api/plugin/mcp-connections') return listMcpConnections(request, env);
  const mcpConnection = url.pathname.match(/^\/api\/plugin\/mcp-connections\/([A-Za-z0-9_-]+)$/);
  if (mcpConnection && request.method === 'DELETE') return revokeMcpConnection(request, env, mcpConnection[1]);
  if (request.method === 'GET' && url.pathname === '/api/plugin/packets') return packets(request, env);
  if (request.method === 'POST' && url.pathname === '/api/packets') return createPacket(request, env);
  if (request.method === 'POST' && url.pathname === '/api/plugin/push') return pushPacket(request, env);

  const invite = url.pathname.match(/^\/api\/plugin\/invites\/([A-Za-z0-9_-]+)\/accept$/);
  if (invite && request.method === 'POST') return acceptInvite(request, env, invite[1]);
  const packetInput = url.pathname.match(/^\/api\/plugin\/packets\/([^/]+)\/inputs$/);
  if (packetInput && request.method === 'POST') return reservePacketInput(request, env, packetInput[1]);
  const inputRaw = url.pathname.match(/^\/api\/plugin\/inputs\/([^/]+)\/raw$/);
  if (inputRaw && request.method === 'PUT') return uploadPacketInput(request, env, inputRaw[1]);
  if (inputRaw && request.method === 'GET') return downloadPacketInput(request, env, inputRaw[1]);
  const assignmentReturn = url.pathname.match(/^\/api\/plugin\/assignments\/([^/]+)\/returns$/);
  if (assignmentReturn && request.method === 'POST') return reserveReturn(request, env, assignmentReturn[1]);
  const assignment = url.pathname.match(/^\/api\/plugin\/assignments\/([^/]+)$/);
  if (assignment && request.method === 'PATCH') return updateAssignment(request, env, assignment[1]);
  const pluginReturnRaw = url.pathname.match(/^\/api\/plugin\/returns\/([^/]+)\/raw$/);
  if (pluginReturnRaw && request.method === 'PUT') return uploadReservedReturn(request, env, pluginReturnRaw[1]);
  if (pluginReturnRaw && request.method === 'GET') return downloadReturn(request, env, pluginReturnRaw[1], true);
  const pluginReturn = url.pathname.match(/^\/api\/plugin\/returns\/([^/]+)$/);
  if (pluginReturn && request.method === 'PATCH') return reviewReturn(request, env, pluginReturn[1]);

  if (request.method === 'POST' && url.pathname === '/api/returns') return createLegacyReturnReservation(request, env);
  const legacyReturnBlob = url.pathname.match(/^\/api\/returns\/([^/]+)\/blob$/);
  if (legacyReturnBlob && request.method === 'PUT') return uploadReservedReturn(request, env, legacyReturnBlob[1]);
  if (legacyReturnBlob && request.method === 'GET') return downloadReturn(request, env, legacyReturnBlob[1], true);
  const media = url.pathname.match(/^\/api\/media\/([^/]+)$/);
  if (media && request.method === 'GET') return downloadReturn(request, env, media[1], false);
  const shared = url.pathname.match(/^\/api\/shared\/([A-Za-z0-9_-]+)$/);
  if (shared && request.method === 'GET') return sharedView(env, shared[1]);
  const version = url.pathname.match(/^\/api\/versions\/([^/]+)$/);
  if (version && request.method === 'PATCH') return updateAppVersion(request, env, version[1]);
  if (version && request.method === 'GET') {
    const found = await requireSession(request, env);
    const row = await env.DB.prepare(
      `SELECT r.*, p.agency_id, p.output_structure_json FROM returns r JOIN packets p ON p.id = r.packet_id
       WHERE r.id = ? AND p.agency_id = ? AND r.uploaded_at IS NOT NULL`
    ).bind(version[1], found.agency.id).first();
    if (!row) return fail(404, 'Unknown version');
    if (found.session.role !== 'team_lead' && row.user_id !== found.user.id) {
      throw httpError(403, 'This return belongs to another creator');
    }
    return json(rowReturn(row, row));
  }
  return fail(404, 'Not found');
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const requestId = request.headers.get('CF-Ray') || crypto.randomUUID();
    if (url.pathname === '/mcp') {
      try {
        const response = await handleRemoteMcp(request, env, ctx, remoteMcpServices(request, env), requestId);
        response.headers.set('X-Request-Id', requestId);
        return response;
      } catch (error) {
        const status = Number(error?.statusCode || 500);
        console.error(JSON.stringify({
          level: 'error', message: status >= 500 ? 'Nitrate MCP request failed' : 'Nitrate MCP request rejected',
          path: '/mcp', requestId
        }));
        const headers = status === 401
          ? { 'WWW-Authenticate': 'Bearer realm="nitrate-mcp", error="invalid_token"' }
          : {};
        return json({ error: status >= 500 ? 'MCP request failed' : (error instanceof Error ? error.message : 'MCP request failed'), requestId }, status, {
          ...headers, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Request-Id': requestId
        });
      }
    }
    const capabilityAsset = url.pathname.match(/^\/api\/mcp\/assets\/(input|return)\/([A-Za-z0-9_-]+)$/);
    if (capabilityAsset) {
      try {
        const response = await handleMcpAssetRequest(request, env, capabilityAsset[1], capabilityAsset[2]);
        response.headers.set('X-Request-Id', requestId);
        return response;
      } catch (error) {
        const status = Number(error?.statusCode || 500);
        if (status >= 500) console.error(JSON.stringify({
          level: 'error', message: 'Nitrate MCP asset request failed', path: url.pathname, requestId
        }));
        return json({ error: status >= 500 ? 'Asset request failed' : (error instanceof Error ? error.message : 'Asset request failed'), requestId }, status, {
          'Cache-Control': 'private, no-store',
          'Referrer-Policy': 'no-referrer',
          'X-Request-Id': requestId
        });
      }
    }
    try {
      const response = await route(request, env);
      response.headers.set('Access-Control-Allow-Origin', '*');
      response.headers.set('Access-Control-Allow-Headers', 'Content-Type,Content-Length,Authorization,X-Nitrate-Plugin-Token,X-Nitrate-Bootstrap-Secret');
      response.headers.set('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
      return response;
    } catch (error) {
      const status = Number(error?.statusCode || 500);
      if (status >= 500) {
        console.error(JSON.stringify({
          level: 'error', message: error instanceof Error ? error.message : String(error), path: new URL(request.url).pathname
        }));
      }
      const response = fail(status, error instanceof Error ? error.message : 'Request failed');
      response.headers.set('Access-Control-Allow-Origin', '*');
      response.headers.set('Access-Control-Allow-Headers', 'Content-Type,Content-Length,Authorization,X-Nitrate-Plugin-Token,X-Nitrate-Bootstrap-Secret');
      response.headers.set('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
      return response;
    }
  }
};
