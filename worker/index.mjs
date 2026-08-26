const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'X-Content-Type-Options': 'nosniff'
};

const STATUS = new Set(['delivered', 'pulled', 'working', 'returned', 'blocked']);

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
  const { user } = await requireSession(request, env);
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

async function downloadReturnBlob(request, env, returnId) {
  await requireSession(request, env);
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

async function route(request, env) {
  const url = new URL(request.url);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204 });
  if (request.method === 'GET' && url.pathname === '/healthz') return json({ ok: true });
  if (request.method === 'POST' && url.pathname === '/api/waitlist') return joinWaitlist(request, env);
  if (request.method === 'POST' && url.pathname === '/api/plugin/login') return pluginLogin(request, env);
  if (request.method === 'GET' && url.pathname === '/api/plugin/packets') return packets(request, env);
  if (request.method === 'POST' && url.pathname === '/api/packets') return createPacket(request, env);
  if (request.method === 'POST' && url.pathname === '/api/plugin/push') return pushPacket(request, env);
  const assignment = url.pathname.match(/^\/api\/plugin\/assignments\/([^/]+)$/);
  if (assignment && request.method === 'PATCH') return updateAssignment(request, env, assignment[1]);
  if (request.method === 'POST' && url.pathname === '/api/returns') return createReturn(request, env);
  const upload = url.pathname.match(/^\/api\/returns\/([^/]+)\/blob$/);
  if (upload && request.method === 'PUT') return uploadReturnBlob(request, env, upload[1]);
  if (upload && request.method === 'GET') return downloadReturnBlob(request, env, upload[1]);
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
