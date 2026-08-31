const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'X-Content-Type-Options': 'nosniff'
};

const STATUS = new Set(['delivered', 'pulled', 'working', 'returned', 'blocked']);
const REVIEW_ACTIONS = { approve: 'approved', reject: 'rejected', request_changes: 'changes_requested', reopen: 'needs_review' };

function json(value, status = 200, headers = {}) {
  return new Response(JSON.stringify(value), { status, headers: { ...JSON_HEADERS, ...headers } });
}

function fail(status, message) {
  return json({ error: message }, status);
}

function now() {
  return new Date().toISOString();
}

function id(prefix) {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 18)}`;
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function parseJsonList(value, fallback) {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value === 'string' && value.trim()) return value.split(/\r?\n|,/).map(item => item.trim()).filter(Boolean);
  return fallback;
}

function safeJson(value, fallback) {
  try { return JSON.parse(value || ''); } catch { return fallback; }
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

async function bodyJson(request) {
  if (!request.body) return {};
  return request.json().catch(() => ({}));
}

async function sha256Hex(value) {
  const input = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  const digest = await crypto.subtle.digest('SHA-256', input);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function bearer(request) {
  const header = request.headers.get('Authorization') || '';
  return header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
}

async function currentSession(request, env) {
  const token = bearer(request) || new URL(request.url).searchParams.get('token') || request.headers.get('X-Nitrate-Plugin-Token') || '';
  if (!token) return null;
  const tokenHash = await sha256Hex(token);
  const row = await env.DB.prepare(
    `SELECT s.*, u.email, u.name, u.role AS user_role, u.clanker AS user_clanker
     FROM plugin_sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ?`
  ).bind(tokenHash).first();
  if (!row) return null;
  await env.DB.prepare('UPDATE plugin_sessions SET last_seen_at = ? WHERE id = ?').bind(now(), row.id).run();
  return {
    session: {
      id: row.id,
      userId: row.user_id,
      clanker: row.clanker,
      surface: row.surface,
      role: row.role,
      createdAt: row.created_at,
      lastSeenAt: row.last_seen_at
    },
    user: {
      id: row.user_id,
      email: row.email,
      name: row.name,
      role: row.user_role,
      clanker: row.user_clanker
    }
  };
}

async function requireSession(request, env) {
  const session = await currentSession(request, env);
  if (!session) throw Object.assign(new Error('Plugin login required'), { statusCode: 401 });
  return session;
}

async function ensureUser(env, input) {
  const email = normalizeEmail(input.email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw Object.assign(new Error('Enter a valid work email'), { statusCode: 400 });
  const role = input.role === 'leader' || input.role === 'team_lead' ? 'team_lead' : 'ai_creator';
  const clanker = String(input.clanker || `${email.split('@')[0]}-clanker`).trim().slice(0, 80);
  const existing = await env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email).first();
  if (existing) {
    await env.DB.prepare('UPDATE users SET name = ?, role = ?, clanker = ? WHERE id = ?')
      .bind(String(input.name || existing.name).slice(0, 80), role, clanker, existing.id).run();
    return { ...existing, name: String(input.name || existing.name).slice(0, 80), role, clanker };
  }
  const user = {
    id: id('user'),
    email,
    name: String(input.name || email.split('@')[0]).slice(0, 80),
    role,
    clanker,
    created_at: now()
  };
  await env.DB.prepare('INSERT INTO users (id, email, name, role, clanker, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(user.id, user.email, user.name, user.role, user.clanker, user.created_at).run();
  return user;
}

async function actorUser(request, env) {
  const name = String(request.headers.get('X-Reel-User') || 'Maya Chen').slice(0, 80).replace(/[<>\r\n]/g, '') || 'Maya Chen';
  const local = name.toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.+|\.+$/g, '') || 'maya';
  return ensureUser(env, { name, email: `${local}@nitrate.local`, role: 'leader', clanker: `${local}-lead` });
}

async function pluginLogin(request, env) {
  const input = await bodyJson(request);
  const user = await ensureUser(env, input);
  const token = crypto.randomUUID() + crypto.randomUUID();
  const session = {
    id: id('plug'),
    tokenHash: await sha256Hex(token),
    userId: user.id,
    clanker: user.clanker,
    surface: String(input.surface || 'Local clanker').slice(0, 80),
    role: user.role,
    at: now()
  };
  await env.DB.prepare(
    'INSERT INTO plugin_sessions (id, token_hash, user_id, clanker, surface, role, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(session.id, session.tokenHash, session.userId, session.clanker, session.surface, session.role, session.at, session.at).run();
  return json({
    session: { id: session.id, token, clanker: session.clanker, surface: session.surface, role: session.role, createdAt: session.at },
    user: { id: user.id, email: user.email, name: user.name, role: user.role, clanker: user.clanker }
  }, 201);
}

async function joinWaitlist(request, env) {
  const input = await bodyJson(request);
  const email = normalizeEmail(input.email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return fail(400, 'Enter a valid work email.');
  const entry = {
    id: id('wait'),
    email,
    teamSize: String(input.teamSize || '').slice(0, 40),
    workflow: String(input.workflow || '').slice(0, 80),
    at: now()
  };
  await env.DB.prepare(
    `INSERT INTO waitlist (id, email, team_size, workflow, created_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(email) DO UPDATE SET team_size = excluded.team_size, workflow = excluded.workflow`
  ).bind(entry.id, entry.email, entry.teamSize, entry.workflow, entry.at).run();
  return json({ message: 'You are on the Nitrate access list. We will follow up with plugin setup.' });
}

async function createPacket(request, env) {
  const found = await currentSession(request, env);
  const user = found?.user || await actorUser(request, env);
  if (user.role !== 'team_lead') return fail(403, 'Only leaders can create packets');
  const input = await bodyJson(request);
  const name = String(input.name || '').trim();
  const brief = String(input.brief || '').trim();
  if (name.length < 2) return fail(400, 'Packet name is required');
  if (brief.length < 5) return fail(400, 'Packet brief is required');
  const packet = {
    id: id('pkt'),
    name,
    client: String(input.client || '').slice(0, 100),
    brief,
    inputAssets: parseJsonList(input.inputAssets, []),
    outputStructure: parseJsonList(input.outputStructure, ['/inputs', '/renders', '/stills', '/prompts', '/notes', '/handoff']),
    reviewCriteria: parseJsonList(input.reviewCriteria, []),
    at: now()
  };
  await env.DB.prepare(
    `INSERT INTO packets (id, name, client, brief, created_by, input_assets_json, output_structure_json, review_criteria_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(packet.id, packet.name, packet.client, packet.brief, user.id, JSON.stringify(packet.inputAssets), JSON.stringify(packet.outputStructure), JSON.stringify(packet.reviewCriteria), packet.at, packet.at).run();
  return json(packet, 201);
}

async function createProject(request, env) {
  const response = await createPacket(request, env);
  if (!response.ok) return response;
  const packet = await response.json();
  return json({
    id: packet.id,
    name: packet.name,
    client: packet.client,
    brief: packet.brief,
    branches: ['Launch'],
    templateId: 'tpl_campaign',
    outputStructure: packet.outputStructure,
    inputAssets: packet.inputAssets,
    assignments: [],
    createdAt: packet.at
  }, 201);
}

async function pushPacket(request, env) {
  const { user } = await requireSession(request, env);
  if (user.role !== 'team_lead') return fail(403, 'Only leaders can push packets');
  const input = await bodyJson(request);
  const packet = await env.DB.prepare('SELECT * FROM packets WHERE id = ?').bind(input.packetId || input.projectId).first();
  if (!packet) return fail(404, 'Packet not found');
  const entries = Array.isArray(input.assignments) ? input.assignments : [];
  if (!entries.length) return fail(400, 'Add at least one assignment');
  const created = [];
  for (const entry of entries.slice(0, 20)) {
    const assignee = await ensureUser(env, { ...entry, role: 'member' });
    const assignment = {
      id: id('assign'),
      packetId: packet.id,
      userId: assignee.id,
      clanker: assignee.clanker,
      task: String(entry.task || 'Work this packet and return media, prompts, notes, and handoff files.').slice(0, 240),
      status: 'delivered',
      pushedAt: now()
    };
    await env.DB.prepare(
      'INSERT INTO assignments (id, packet_id, user_id, clanker, task, status, pushed_at, returned_at) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)'
    ).bind(assignment.id, assignment.packetId, assignment.userId, assignment.clanker, assignment.task, assignment.status, assignment.pushedAt).run();
    created.push(assignment);
  }
  return json({ packetId: packet.id, assignments: created }, 201);
}

function rowPacket(row) {
  return {
    id: row.id,
    name: row.name,
    client: row.client,
    brief: row.brief,
    inputAssets: JSON.parse(row.input_assets_json || '[]'),
    outputStructure: JSON.parse(row.output_structure_json || '[]'),
    reviewCriteria: JSON.parse(row.review_criteria_json || '[]'),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function rowAssignment(row) {
  return {
    id: row.id,
    userId: row.user_id,
    packetId: row.packet_id,
    clanker: row.clanker,
    task: row.task,
    status: row.status,
    pushedAt: row.pushed_at,
    returnedAt: row.returned_at
  };
}

function rowReturn(row) {
  return {
    id: row.id,
    assetId: `asset_${row.id}`,
    projectId: row.packet_id,
    branch: row.branch || 'Launch',
    hash: row.object_key || row.id,
    size: row.size_bytes || 0,
    mime: row.content_type || 'application/octet-stream',
    kind: mediaKind(row.content_type),
    filename: row.filename || row.name,
    status: appStatus(row.status),
    metadata: {
      prompt: row.prompt,
      model: row.made_with,
      seed: '',
      pipeline: 'nitrate cloud return',
      operator: row.user_id,
      notes: row.notes || '',
      parentVersionId: row.parent_return_id || null,
      assignmentId: row.assignment_id
    },
    comments: safeJson(row.comments_json, []),
    decisions: safeJson(row.decisions_json, []),
    createdAt: row.created_at
  };
}

async function appState(request, env) {
  const [userRows, packetRows, assignmentRows, returnRows, shareRows] = await Promise.all([
    env.DB.prepare('SELECT * FROM users ORDER BY created_at ASC').all(),
    env.DB.prepare('SELECT * FROM packets ORDER BY updated_at DESC').all(),
    env.DB.prepare('SELECT * FROM assignments ORDER BY pushed_at DESC').all(),
    env.DB.prepare('SELECT * FROM returns ORDER BY created_at DESC').all(),
    env.DB.prepare('SELECT * FROM shares ORDER BY created_at DESC').all().catch(() => ({ results: [] }))
  ]);
  const returns = returnRows.results || [];
  const assignmentsByPacket = new Map();
  for (const row of assignmentRows.results || []) {
    const list = assignmentsByPacket.get(row.packet_id) || [];
    list.push(rowAssignment(row));
    assignmentsByPacket.set(row.packet_id, list);
  }
  const projects = (packetRows.results || []).map(row => ({
    ...rowPacket(row),
    branches: [...new Set(['Launch', ...returns.filter(item => item.packet_id === row.id).map(item => item.branch || 'Launch')])],
    templateId: 'tpl_campaign',
    assignments: assignmentsByPacket.get(row.id) || []
  }));
  const versions = returns.map(rowReturn);
  const assets = versions.map(version => ({
    id: version.assetId,
    projectId: version.projectId,
    name: version.filename.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' '),
    currentVersionId: version.id,
    createdAt: version.createdAt,
    updatedAt: version.createdAt
  }));
  const users = (userRows.results || []).map(row => ({
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    clanker: row.clanker
  }));
  const activity = [
    ...returns.slice(0, 30).map(row => ({ id: `act_${row.id}`, type: 'returned', message: `${row.name} returned from ${row.made_with}`, actor: row.user_id, at: row.created_at })),
    ...(assignmentRows.results || []).slice(0, 30).map(row => ({ id: `act_${row.id}`, type: 'assignment', message: `${row.clanker} ${row.status} on packet`, actor: row.user_id, at: row.pushed_at || now() })),
    ...(packetRows.results || []).slice(0, 30).map(row => ({ id: `act_${row.id}`, type: 'packet', message: `${row.name} packet created`, actor: row.created_by || 'nitrate', at: row.created_at }))
  ].sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, 80);
  return json({
    users: users.length ? users : [{ id: 'user_maya', name: 'Maya Chen', role: 'team_lead', clanker: 'maya-lead' }],
    projects,
    assets,
    versions,
    templates: TEMPLATES,
    activity,
    shares: (shareRows.results || []).map(row => ({
      id: row.id,
      scope: row.scope,
      targetId: row.target_id,
      label: row.label,
      allowDownload: Boolean(row.allow_download),
      createdBy: row.created_by,
      createdAt: row.created_at
    }))
  });
}

async function uploadAppReturn(request, env) {
  const user = await actorUser(request, env);
  const form = await request.formData();
  const file = form.get('file');
  if (!file || typeof file === 'string') return fail(400, 'Choose a media file');
  const packet = await env.DB.prepare('SELECT * FROM packets WHERE id = ?').bind(String(form.get('projectId') || '')).first();
  if (!packet) return fail(404, 'Packet not found');
  let assignment = null;
  const assignmentId = String(form.get('assignmentId') || '');
  if (assignmentId) assignment = await env.DB.prepare('SELECT * FROM assignments WHERE id = ?').bind(assignmentId).first();
  if (!assignment) {
    const created = {
      id: id('assign'),
      packetId: packet.id,
      userId: user.id,
      clanker: user.clanker,
      task: 'Direct return from command center',
      status: 'returned',
      at: now()
    };
    await env.DB.prepare(
      'INSERT INTO assignments (id, packet_id, user_id, clanker, task, status, pushed_at, returned_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(created.id, created.packetId, created.userId, created.clanker, created.task, created.status, created.at, created.at).run();
    assignment = { id: created.id, packet_id: created.packetId, user_id: created.userId, clanker: created.clanker };
  }
  const name = String(form.get('assetName') || file.name || 'Untitled return').slice(0, 140);
  const madeWith = String(form.get('model') || '').slice(0, 120);
  const prompt = String(form.get('prompt') || '').slice(0, 4000);
  if (!madeWith || !prompt) return fail(400, 'Prompt and model are required');
  const returnId = id('ret');
  const filename = String(form.get('filename') || file.name || `${returnId}.bin`).replace(/[^\w.\- ]+/g, '_').slice(0, 160);
  const contentType = file.type || String(form.get('mime') || 'application/octet-stream');
  const key = `returns/${packet.id}/${returnId}/${filename}`;
  const object = await env.MEDIA.put(key, await file.arrayBuffer(), {
    httpMetadata: { contentType },
    customMetadata: { returnId, packetId: packet.id, assignmentId: assignment.id }
  });
  const at = now();
  await env.DB.prepare(
    `INSERT INTO returns (id, packet_id, assignment_id, user_id, name, made_with, prompt, notes, status, object_key, filename, content_type, size_bytes, created_at, branch, parent_return_id, decisions_json, comments_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'needs_review', ?, ?, ?, ?, ?, ?, ?, '[]', '[]')`
  ).bind(returnId, packet.id, assignment.id, user.id, name, madeWith, prompt, String(form.get('notes') || '').slice(0, 2000), key, filename, contentType, object?.size || file.size || 0, at, String(form.get('branch') || 'Launch').slice(0, 80), String(form.get('parentVersionId') || '') || null).run();
  await env.DB.prepare('UPDATE assignments SET status = "returned", returned_at = ? WHERE id = ?').bind(at, assignment.id).run();
  const row = await env.DB.prepare('SELECT * FROM returns WHERE id = ?').bind(returnId).first();
  return json({ asset: { id: `asset_${returnId}`, projectId: packet.id, name, currentVersionId: returnId, createdAt: at, updatedAt: at }, version: rowReturn(row), deduplicated: false }, 201);
}

async function packets(request, env) {
  const { user, session } = await requireSession(request, env);
  const leader = user.role === 'team_lead';
  const packetRows = leader
    ? (await env.DB.prepare('SELECT * FROM packets ORDER BY updated_at DESC').all()).results
    : (await env.DB.prepare(
      `SELECT DISTINCT p.* FROM packets p JOIN assignments a ON a.packet_id = p.id
       WHERE a.user_id = ? OR a.clanker = ? ORDER BY p.updated_at DESC`
    ).bind(user.id, user.clanker).all()).results;
  const items = [];
  for (const packetRow of packetRows) {
    const assignmentRows = leader
      ? (await env.DB.prepare('SELECT * FROM assignments WHERE packet_id = ? ORDER BY pushed_at DESC').bind(packetRow.id).all()).results
      : (await env.DB.prepare('SELECT * FROM assignments WHERE packet_id = ? AND (user_id = ? OR clanker = ?) ORDER BY pushed_at DESC').bind(packetRow.id, user.id, user.clanker).all()).results;
    const returnRows = (await env.DB.prepare('SELECT * FROM returns WHERE packet_id = ? ORDER BY created_at DESC').bind(packetRow.id).all()).results;
    items.push({
      packet: rowPacket(packetRow),
      assignments: assignmentRows.map(row => ({
        id: row.id,
        packetId: row.packet_id,
        userId: row.user_id,
        clanker: row.clanker,
        task: row.task,
        status: row.status,
        pushedAt: row.pushed_at,
        returnedAt: row.returned_at
      })),
      returns: returnRows
    });
  }
  return json({
    mode: leader ? 'leader' : 'team_member',
    session,
    user,
    packets: items
  });
}

async function updateAssignment(request, env, assignmentId) {
  const { user } = await requireSession(request, env);
  const input = await bodyJson(request);
  const status = String(input.status || '');
  if (!STATUS.has(status)) return fail(400, 'Unsupported assignment status');
  const assignment = await env.DB.prepare('SELECT * FROM assignments WHERE id = ?').bind(assignmentId).first();
  if (!assignment) return fail(404, 'Assignment not found');
  if (user.role !== 'team_lead' && assignment.user_id !== user.id && assignment.clanker !== user.clanker) return fail(403, 'Assignment is not assigned to this plugin');
  await env.DB.prepare('UPDATE assignments SET status = ?, returned_at = CASE WHEN ? = "returned" THEN ? ELSE returned_at END WHERE id = ?')
    .bind(status, status, now(), assignmentId).run();
  return json({ id: assignmentId, status });
}

async function createReturn(request, env) {
  const { user } = await requireSession(request, env);
  const input = await bodyJson(request);
  const assignment = await env.DB.prepare('SELECT * FROM assignments WHERE id = ?').bind(input.assignmentId).first();
  if (!assignment) return fail(404, 'Assignment not found');
  if (user.role !== 'team_lead' && assignment.user_id !== user.id && assignment.clanker !== user.clanker) return fail(403, 'Assignment is not assigned to this plugin');
  const name = String(input.name || input.assetName || '').trim();
  const prompt = String(input.prompt || '').trim();
  const madeWith = String(input.madeWith || input.model || '').trim();
  if (!name || !prompt || !madeWith) return fail(400, 'Return name, prompt, and madeWith are required');
  const item = {
    id: id('ret'),
    packetId: assignment.packet_id,
    assignmentId: assignment.id,
    userId: user.id,
    name,
    madeWith,
    prompt,
    notes: String(input.notes || '').slice(0, 2000),
    at: now()
  };
  await env.DB.prepare(
    `INSERT INTO returns (id, packet_id, assignment_id, user_id, name, made_with, prompt, notes, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'needs_review', ?)`
  ).bind(item.id, item.packetId, item.assignmentId, item.userId, item.name, item.madeWith, item.prompt, item.notes, item.at).run();
  await env.DB.prepare('UPDATE assignments SET status = "returned", returned_at = ? WHERE id = ?').bind(item.at, assignment.id).run();
  return json(item, 201);
}

async function uploadReturnBlob(request, env, returnId) {
  const session = await requireSession(request, env);
  const item = await env.DB.prepare('SELECT * FROM returns WHERE id = ?').bind(returnId).first();
  if (!item) return fail(404, 'Return not found');
  const assignment = await env.DB.prepare('SELECT * FROM assignments WHERE id = ?').bind(item.assignment_id).first();
  if (session.user.role !== 'team_lead' && assignment.user_id !== session.user.id && assignment.clanker !== session.user.clanker) return fail(403, 'Return is not assigned to this plugin');
  const filename = new URL(request.url).searchParams.get('filename') || `${returnId}.bin`;
  const contentType = request.headers.get('Content-Type') || 'application/octet-stream';
  const key = `returns/${item.packet_id}/${returnId}/${filename.replace(/[^\w.\- ]+/g, '_')}`;
  const object = await env.MEDIA.put(key, request.body, {
    httpMetadata: { contentType },
    customMetadata: { returnId, packetId: item.packet_id, assignmentId: item.assignment_id }
  });
  await env.DB.prepare('UPDATE returns SET object_key = ?, filename = ?, content_type = ?, size_bytes = ? WHERE id = ?')
    .bind(key, filename, contentType, object?.size || null, returnId).run();
  return json({ returnId, key, filename, contentType, size: object?.size || null });
}

async function downloadReturnBlob(request, env, returnId, options = {}) {
  if (options.requireSession) await requireSession(request, env);
  const item = await env.DB.prepare('SELECT * FROM returns WHERE id = ?').bind(returnId).first();
  if (!item?.object_key) return fail(404, 'Return media not found');
  const object = await env.MEDIA.get(item.object_key);
  if (!object) return fail(404, 'Return media not found');
  return new Response(object.body, {
    headers: {
      'Content-Type': object.httpMetadata?.contentType || item.content_type || 'application/octet-stream',
      'Content-Disposition': `inline; filename="${encodeURIComponent(item.filename || returnId)}"`,
      'Cache-Control': 'private, max-age=3600'
    }
  });
}

async function updateAppVersion(request, env, returnId) {
  const user = await actorUser(request, env);
  const input = await bodyJson(request);
  const row = await env.DB.prepare('SELECT * FROM returns WHERE id = ?').bind(returnId).first();
  if (!row) return fail(404, 'Unknown version');
  const comments = safeJson(row.comments_json, []);
  const decisions = safeJson(row.decisions_json, []);
  let status = row.status;
  if (input.action) {
    status = REVIEW_ACTIONS[input.action];
    if (!status) return fail(400, 'Unsupported decision');
    decisions.push({ action: input.action, actor: user.name, note: String(input.note || '').slice(0, 800), at: now() });
  }
  if (input.comment) {
    comments.unshift({ id: id('cm'), author: user.name, role: 'collaborator', body: String(input.comment).slice(0, 2000), createdAt: now() });
  }
  await env.DB.prepare('UPDATE returns SET status = ?, decisions_json = ?, comments_json = ? WHERE id = ?')
    .bind(dbStatus(status), JSON.stringify(decisions), JSON.stringify(comments), returnId).run();
  const updated = await env.DB.prepare('SELECT * FROM returns WHERE id = ?').bind(returnId).first();
  return json(rowReturn(updated));
}

async function createShare(request, env) {
  const user = await actorUser(request, env);
  const input = await bodyJson(request);
  const scope = input.scope === 'project' ? 'project' : 'version';
  const targetId = String(input.targetId || '');
  let label = '';
  if (scope === 'project') {
    const packet = await env.DB.prepare('SELECT * FROM packets WHERE id = ?').bind(targetId).first();
    if (!packet) return fail(404, 'Unknown project');
    label = packet.name;
  } else {
    const row = await env.DB.prepare('SELECT * FROM returns WHERE id = ?').bind(targetId).first();
    if (!row) return fail(404, 'Unknown version');
    label = row.name || row.filename;
  }
  const share = { id: id('share'), token: crypto.randomUUID().replace(/-/g, ''), scope, targetId, label, allowDownload: Boolean(input.allowDownload), at: now() };
  await env.DB.prepare('INSERT INTO shares (id, token, scope, target_id, label, allow_download, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(share.id, share.token, share.scope, share.targetId, share.label, share.allowDownload ? 1 : 0, user.name, share.at).run();
  return json({ ...share, url: `/share/${share.token}` }, 201);
}

async function sharedView(env, token) {
  const share = await env.DB.prepare('SELECT * FROM shares WHERE token = ?').bind(token).first();
  if (!share) return fail(404, 'This share is unavailable');
  const rows = share.scope === 'project'
    ? (await env.DB.prepare('SELECT * FROM returns WHERE packet_id = ? ORDER BY created_at DESC').bind(share.target_id).all()).results
    : (await env.DB.prepare('SELECT * FROM returns WHERE id = ?').bind(share.target_id).all()).results;
  const versions = (rows || []).map(rowReturn);
  const assets = versions.map(version => ({
    id: version.assetId,
    projectId: version.projectId,
    name: version.filename.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' '),
    currentVersionId: version.id,
    createdAt: version.createdAt,
    updatedAt: version.createdAt
  }));
  return json({
    share: {
      label: share.label,
      scope: share.scope,
      allowDownload: Boolean(share.allow_download),
      createdBy: share.created_by
    },
    versions,
    assets
  });
}

async function route(request, env) {
  const url = new URL(request.url);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204 });
  if (request.method === 'GET' && url.pathname === '/healthz') return json({ ok: true });
  if (request.method === 'GET' && url.pathname === '/api/state') return appState(request, env);
  if (request.method === 'POST' && url.pathname === '/api/waitlist') return joinWaitlist(request, env);
  if (request.method === 'POST' && url.pathname === '/api/projects') return createProject(request, env);
  if (request.method === 'POST' && url.pathname === '/api/uploads') return uploadAppReturn(request, env);
  if (request.method === 'POST' && url.pathname === '/api/shares') return createShare(request, env);
  if (request.method === 'POST' && url.pathname === '/api/plugin/login') return pluginLogin(request, env);
  if (request.method === 'GET' && url.pathname === '/api/plugin/packets') return packets(request, env);
  if (request.method === 'POST' && url.pathname === '/api/packets') return createPacket(request, env);
  if (request.method === 'POST' && url.pathname === '/api/plugin/push') return pushPacket(request, env);
  const assignment = url.pathname.match(/^\/api\/plugin\/assignments\/([^/]+)$/);
  if (assignment && request.method === 'PATCH') return updateAssignment(request, env, assignment[1]);
  if (request.method === 'POST' && url.pathname === '/api/returns') return createReturn(request, env);
  const upload = url.pathname.match(/^\/api\/returns\/([^/]+)\/blob$/);
  if (upload && request.method === 'PUT') return uploadReturnBlob(request, env, upload[1]);
  if (upload && request.method === 'GET') return downloadReturnBlob(request, env, upload[1], { requireSession: true });
  const media = url.pathname.match(/^\/api\/media\/([^/]+)$/);
  if (media && request.method === 'GET') return downloadReturnBlob(request, env, media[1]);
  const shared = url.pathname.match(/^\/api\/shared\/([A-Za-z0-9_-]+)$/);
  if (shared && request.method === 'GET') return sharedView(env, shared[1]);
  const version = url.pathname.match(/^\/api\/versions\/([^/]+)$/);
  if (version && request.method === 'PATCH') return updateAppVersion(request, env, version[1]);
  return fail(404, 'Not found');
}

export default {
  async fetch(request, env, ctx) {
    try {
      const response = await route(request, env, ctx);
      response.headers.set('Access-Control-Allow-Origin', '*');
      response.headers.set('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-Nitrate-Plugin-Token');
      response.headers.set('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,OPTIONS');
      return response;
    } catch (error) {
      const status = error.statusCode || 500;
      if (status >= 500) console.log(JSON.stringify({ level: 'error', message: error.message, stack: error.stack }));
      return fail(status, error.message || 'Request failed');
    }
  }
};
