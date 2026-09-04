'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
const ALLOWED_MIME_PREFIXES = ['image/', 'video/', 'audio/'];
const SCHEMA_VERSION = 5;
const DEFAULT_OUTPUT_STRUCTURE = ['/inputs', '/renders', '/stills', '/prompts', '/notes', '/handoff'];
const INVITE_TTL_MS = 72 * 60 * 60 * 1000;
const DEFAULT_MCP_CONNECTION_TTL_SECONDS = 7 * 24 * 60 * 60;
const MAX_MCP_CONNECTION_TTL_SECONDS = 30 * 24 * 60 * 60;
const LOCAL_AGENCY_ID = 'agency_local';

function id(prefix) {
  return `${prefix}_${crypto.randomBytes(7).toString('hex')}`;
}

function slugify(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'project';
}

function now() {
  return new Date().toISOString();
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function parseList(value, fallback = []) {
  const source = value == null || value === '' ? fallback : value;
  if (Array.isArray(source)) return source.map(item => String(item).trim()).filter(Boolean);
  return String(source).split(/\r?\n|,/).map(item => item.trim()).filter(Boolean);
}

function mcpScopesForRole(role) {
  const common = ['identity:read', 'work:read', 'assets:read'];
  return role === 'team_lead'
    ? [...common, 'returns:review']
    : [...common, 'assignments:pull', 'returns:submit'];
}

function publicMcpConnection(connection) {
  const { tokenHash, sourceSessionId, ...publicConnection } = connection;
  return publicConnection;
}

function emptyDb() {
  return {
    schemaVersion: SCHEMA_VERSION,
    seededAt: null,
    users: [],
    projects: [],
    packetInputs: [],
    assets: [],
    versions: [],
    comments: [],
    shares: [],
    pluginSessions: [],
    mcpConnections: [],
    invites: [],
    returnDrafts: [],
    activity: [],
    templates: [
      {
        id: 'tpl_campaign',
        name: 'Campaign film packet',
        description: 'Brief, input assets, creator assignments, review stages, and delivery folders.',
        stages: ['Brief packet', 'Agent dispatch', 'Creator returns', 'Lead review', 'Client approval'],
        defaults: { pipeline: 'nitrate packet', branch: 'Launch' }
      },
      {
        id: 'tpl_music_video',
        name: 'Music video packet',
        description: 'Treatment, references, shot folders, creator returns, and label sign-off.',
        stages: ['Treatment packet', 'Look passes', 'Creator returns', 'Edit selects', 'Label approval'],
        defaults: { pipeline: 'music-video packet', branch: 'Look development' }
      },
      {
        id: 'tpl_product_ads',
        name: 'Product ads packet',
        description: 'Input assets, claim-safe constraints, channel folders, and creator returns.',
        stages: ['Brief packet', 'Creator dispatch', 'Product accuracy', 'Channel adaptation'],
        defaults: { pipeline: 'product-ad packet', branch: 'Launch' }
      }
    ],
    waitlist: []
  };
}

function normalizePersistedAgents(db) {
  let changed = false;
  const normalize = record => {
    if (!record || typeof record !== 'object') return;
    if (!record.agent && record.clanker) {
      record.agent = String(record.clanker).replace(/-clanker$/i, '-agent');
      changed = true;
    }
    if (/-clanker$/i.test(record.agent || '')) {
      record.agent = record.agent.replace(/-clanker$/i, '-agent');
      changed = true;
    }
    if (Object.hasOwn(record, 'clanker')) {
      delete record.clanker;
      changed = true;
    }
    if (record.surface === 'Local clanker') {
      record.surface = 'Local AI coding agent';
      changed = true;
    }
  };
  for (const user of db.users || []) normalize(user);
  for (const session of db.pluginSessions || []) normalize(session);
  for (const project of db.projects || []) {
    for (const assignment of project.assignments || []) normalize(assignment);
  }
  for (const version of db.versions || []) {
    if (version.metadata?.pipeline === 'clanker-return') {
      version.metadata.pipeline = 'agent-return';
      changed = true;
    }
  }
  for (const activity of db.activity || []) {
    if (/clanker/i.test(activity.message || '')) {
      activity.message = activity.message.replace(/clankers/gi, 'AI coding agents').replace(/clanker/gi, 'AI coding agent');
      changed = true;
    }
  }
  for (const template of db.templates || []) {
    template.stages = (template.stages || []).map(stage => {
      if (!/clanker/i.test(stage)) return stage;
      changed = true;
      return stage.replace(/clankers/gi, 'AI coding agents').replace(/clanker/gi, 'Agent');
    });
  }
  return changed;
}

function mediaKind(mime) {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return null;
}

function safeFilename(value, fallback = 'file') {
  return path.basename(String(value || fallback)).replace(/[^\w.\- ]+/g, '_').slice(0, 160) || fallback;
}

function normalizeRelativePath(value, filename) {
  const raw = String(value || filename || '').trim();
  if (!raw || raw.includes('\0') || /^[A-Za-z]:/.test(raw)) {
    throw Object.assign(new Error('Return path must be relative to the packet workspace'), { statusCode: 422 });
  }
  const normalized = raw.replace(/\\/g, '/').replace(/^\/+/, '');
  const parts = normalized.split('/').filter(part => part && part !== '.');
  if (parts.includes('..')) {
    throw Object.assign(new Error('Return path cannot leave the packet workspace'), { statusCode: 422 });
  }
  return parts.join('/') || safeFilename(filename);
}

function normalizeOutputStructure(value) {
  const folders = parseList(value, DEFAULT_OUTPUT_STRUCTURE).slice(0, 20).map(folder => {
    const raw = String(folder).trim();
    if (!raw || raw.includes('\0') || /^[A-Za-z]:/.test(raw)) {
      throw Object.assign(new Error('Output folders must stay inside the packet workspace'), { statusCode: 422 });
    }
    const normalized = raw.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    const parts = normalized.split('/').filter(part => part && part !== '.');
    if (!parts.length || parts.includes('..')) {
      throw Object.assign(new Error('Output folders must stay inside the packet workspace'), { statusCode: 422 });
    }
    return `/${parts.join('/')}`;
  });
  return [...new Set(folders)];
}

function returnValidation(project, input, metadata, bytes) {
  const relativePath = normalizeRelativePath(input.relativePath, input.filename);
  const outputRoots = (project.outputStructure || DEFAULT_OUTPUT_STRUCTURE)
    .map(folder => String(folder).replace(/\\/g, '/').replace(/^\/+|\/+$/g, ''))
    .filter(folder => folder && folder !== 'inputs' && !['prompts', 'notes'].includes(folder));
  const insideOutputFolder = outputRoots.length === 0 || outputRoots.some(folder => relativePath === folder || relativePath.startsWith(`${folder}/`));
  const checks = [
    { key: 'media', label: 'Media file attached', passed: Boolean(bytes?.length) },
    { key: 'prompt', label: 'Creation prompt attached', passed: Boolean(metadata.prompt) },
    { key: 'made_with', label: 'Creation tool attached', passed: Boolean(metadata.model) },
    { key: 'output_folder', label: 'File follows the requested output structure', passed: insideOutputFolder }
  ];
  return {
    complete: checks.every(check => check.passed),
    checks,
    missing: checks.filter(check => !check.passed).map(check => check.key),
    relativePath
  };
}

function frameSvg({ title = 'Untitled take', take = '01', accent = '#2AA79B', ink = '#171A20', paper = '#F5F2EA' }) {
  const safeTitle = String(title).replace(/[<>&]/g, '');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 400" role="img" aria-label="${safeTitle}, take ${take}">
  <rect width="640" height="400" fill="${paper}"/>
  <rect x="28" y="26" width="584" height="348" fill="${ink}" rx="4"/>
  <rect x="46" y="44" width="548" height="312" fill="${accent}" opacity="0.88" rx="2"/>
  <path d="M46 300 L210 168 L330 260 L430 186 L594 292 L594 356 L46 356 Z" fill="${ink}" opacity=".72"/>
  <circle cx="500" cy="112" r="42" fill="${paper}" opacity=".82"/>
  <rect x="24" y="24" width="592" height="352" fill="none" stroke="${ink}" stroke-width="4"/>
  <line x1="320" y1="24" x2="320" y2="376" stroke="${paper}" stroke-opacity=".22"/>
  <line x1="24" y1="200" x2="616" y2="200" stroke="${paper}" stroke-opacity=".22"/>
  <text x="52" y="86" font-family="ui-monospace, monospace" font-size="30" fill="${paper}">TAKE ${take}</text>
  <text x="52" y="122" font-family="Inter, system-ui, sans-serif" font-size="21" fill="${paper}">${safeTitle}</text>
</svg>`;
}

function seedDb() {
  const created = '2026-08-18T09:00:00.000Z';
  const specs = [
    { key: 'maya-hero-v1', title: 'Maya return - hero film wide', take: '014', accent: '#D78143', status: 'approved', model: 'Claude Code + Higgsfield Supercomputer', seed: '184320', assignmentId: 'assign_maya', prompt: 'Use the supplied bottle macro, city plate, and VO scratch to make a wide launch-film opening. Return /renders, /stills, /prompts, /notes, and /handoff.' },
    { key: 'maya-hero-v2', title: 'Maya return - longer hold', take: '015', accent: '#B65F31', status: 'review', model: 'Higgsfield Supercomputer', seed: '184321', assignmentId: 'assign_maya', prompt: 'Extend the opening by two seconds, hold the city reflection, and keep the bottle mark readable.' },
    { key: 'asha-macro-v1', title: 'Asha return - product macro', take: '007', accent: '#2AA79B', status: 'approved', model: 'Claude', seed: '771204', assignmentId: 'assign_asha', prompt: 'Create macro stills from the input bottle plate. Include prompt notes and one handoff frame.' },
    { key: 'jonas-performance-v1', title: 'Jonas return - human beat', take: '023', accent: '#7A66CC', status: 'changes_requested', model: 'Claude Code', seed: '904417', assignmentId: 'assign_jonas', prompt: 'Use the story beat references and generate a human handoff moment before the product reveal.' },
    { key: 'leo-packaging-v1', title: 'Leo draft - packaging stills', take: '031', accent: '#177E75', status: 'queued', model: 'Claude', seed: '228910', assignmentId: 'assign_leo', prompt: 'Explore packaging stills using the supplied lockup and reference color cards. Return stills and prompt notes.' },
    { key: 'asha-logo-v1', title: 'Asha return - mark reveal', take: '004', accent: '#C19A49', status: 'review', model: 'Higgsfield Supercomputer', seed: '550981', assignmentId: 'assign_asha', prompt: 'Make a short mark reveal from the logo input asset. No lens flare. Include /handoff notes.' }
  ];
  const versions = [];
  const assets = [];
  let parent = null;
  specs.forEach((spec, index) => {
    const bytes = Buffer.from(frameSvg({
      title: spec.title,
      take: spec.take,
      accent: spec.accent
    }), 'utf8');
    const hash = sha256(bytes);
    const versionId = `v_seed_${index + 1}`;
    const assetId = `asset_seed_${index + 1}`;
    const createdAt = new Date(Date.parse(created) + index * 3600000).toISOString();
    const version = {
      id: versionId,
      assetId,
      projectId: 'proj_launch_film',
      branch: spec.key === 'desert-v2' ? 'Extended cut' : 'Launch',
      hash,
      size: bytes.length,
      mime: 'image/svg+xml',
      kind: 'image',
      filename: `${spec.key}.svg`,
      status: spec.status,
      metadata: {
        prompt: spec.prompt,
        model: spec.model,
        seed: spec.seed,
        pipeline: index % 2 ? 'agent-return' : 'brief-packet',
        operator: 'Maya Chen',
        parentVersionId: parent,
        assignmentId: spec.assignmentId
      },
      comments: spec.status === 'changes_requested' ? [{
        id: 'cm_1',
        author: 'Jonas Reyes',
        role: 'creative_lead',
        body: 'Hold the face one beat longer before the turn.',
        createdAt
      }] : [],
      decisions: spec.status === 'approved' ? [{
        action: 'approve',
        actor: 'Maya Chen',
        note: 'Locked for the launch film.',
        at: createdAt
      }] : [],
      createdAt,
      previewSpec: { title: spec.title, take: spec.take, accent: spec.accent }
    };
    versions.push(version);
    assets.push({
      id: assetId,
      projectId: 'proj_launch_film',
      name: spec.title,
      currentVersionId: versionId,
      createdAt,
      updatedAt: createdAt
    });
    if (spec.key === 'desert-v1') parent = versionId;
  });
  return {
    schemaVersion: SCHEMA_VERSION,
    seededAt: created,
    users: [
      { id: 'user_maya', name: 'Maya Chen', role: 'team_lead', agent: 'maya-agent' },
      { id: 'user_jonas', name: 'Jonas Reyes', role: 'ai_creator', agent: 'jonas-agent' },
      { id: 'user_asha', name: 'Asha Kapoor', role: 'ai_creator', agent: 'asha-agent' },
      { id: 'user_leo', name: 'Leo Martins', role: 'ai_creator', agent: 'leo-agent' }
    ],
    projects: [{
      id: 'proj_launch_film',
      name: 'Launch Film Packet',
      client: 'Northwind',
      brief: 'Create a 30-second launch-film direction from the supplied bottle macro, city plate, logo mark, and VO scratch. Each creator should explore a different path and return organized outputs for lead review.',
      branches: ['Launch', 'Extended cut'],
      templateId: 'tpl_campaign',
      outputStructure: ['/inputs', '/renders', '/stills', '/prompts', '/notes', '/handoff'],
      reviewCriteria: ['brand fit', 'client-safe', 'prompt captured', 'usable handoff'],
      inputAssets: ['bottle_macro.mov', 'city_plate.exr', 'logo_mark.svg', 'vo_scratch.wav', 'brand_reference.pdf'],
      assignments: [
        { id: 'assign_maya', userId: 'user_maya', agent: 'maya-agent', status: 'returned', task: 'Hero film opening and edit rhythm', pushedAt: created, acceptedAt: created, pulledAt: created, returnedAt: '2026-08-18T12:20:00.000Z' },
        { id: 'assign_jonas', userId: 'user_jonas', agent: 'jonas-agent', status: 'working', task: 'Human performance beat before reveal', pushedAt: created, acceptedAt: created, pulledAt: created, returnedAt: null },
        { id: 'assign_asha', userId: 'user_asha', agent: 'asha-agent', status: 'returned', task: 'Product macro stills and mark reveal', pushedAt: created, acceptedAt: created, pulledAt: created, returnedAt: '2026-08-18T13:05:00.000Z' },
        { id: 'assign_leo', userId: 'user_leo', agent: 'leo-agent', status: 'delivered', task: 'Packaging stills and handoff notes', pushedAt: created, acceptedAt: null, pulledAt: null, returnedAt: null }
      ],
      createdAt: created
    }],
    packetInputs: [],
    assets,
    versions,
    comments: [],
    shares: [],
    pluginSessions: [],
    mcpConnections: [],
    invites: [],
    returnDrafts: [],
    activity: [{
      id: 'act_seed',
      type: 'workspace_seeded',
      message: 'Brief packet pushed to four AI coding agents.',
      actor: 'nitrate',
      at: created
    }],
    templates: [
      {
        id: 'tpl_campaign',
        name: 'Campaign film packet',
        description: 'Brief, input assets, creator assignments, review stages, and delivery folders.',
        stages: ['Brief packet', 'Agent dispatch', 'Creator returns', 'Lead review', 'Client approval'],
        defaults: { pipeline: 'nitrate packet', branch: 'Launch' }
      },
      {
        id: 'tpl_music_video',
        name: 'Music video packet',
        description: 'Treatment, references, shot folders, creator returns, and label sign-off.',
        stages: ['Treatment packet', 'Look passes', 'Creator returns', 'Edit selects', 'Label approval'],
        defaults: { pipeline: 'music-video packet', branch: 'Look development' }
      },
      {
        id: 'tpl_product_ads',
        name: 'Product ads packet',
        description: 'Input assets, claim-safe constraints, channel folders, and creator returns.',
        stages: ['Brief packet', 'Creator dispatch', 'Product accuracy', 'Channel adaptation'],
        defaults: { pipeline: 'product-ad packet', branch: 'Launch' }
      }
    ],
    waitlist: []
  };
}

function migrateDb(db) {
  let changed = false;
  if (!Number.isInteger(db.schemaVersion) || db.schemaVersion < 3) return { db: null, changed: true };
  if (db.schemaVersion < SCHEMA_VERSION) {
    db.packetInputs = db.packetInputs || [];
    db.invites = db.invites || [];
    db.returnDrafts = db.returnDrafts || [];
    db.pluginSessions = db.pluginSessions || [];
    db.mcpConnections = db.mcpConnections || [];
    for (const session of db.pluginSessions) {
      if (!session.agencyId) {
        session.agencyId = LOCAL_AGENCY_ID;
        changed = true;
      }
    }
    for (const project of db.projects || []) {
      project.reviewCriteria = project.reviewCriteria || [];
      project.outputStructure = project.outputStructure?.length ? project.outputStructure : [...DEFAULT_OUTPUT_STRUCTURE];
      for (const assignment of project.assignments || []) {
        assignment.acceptedAt = assignment.acceptedAt || null;
        assignment.pulledAt = assignment.pulledAt || (['pulled', 'working', 'returned'].includes(assignment.status) ? assignment.pushedAt : null);
      }
    }
    db.schemaVersion = SCHEMA_VERSION;
    changed = true;
  }
  return { db, changed };
}

async function ensureStorage(dataDir, options = {}) {
  await fs.mkdir(path.join(dataDir, 'blobs'), { recursive: true });
  const dbFile = path.join(dataDir, 'db.json');
  try {
    const raw = await fs.readFile(dbFile, 'utf8');
    let parsed = JSON.parse(raw);
    const migration = migrateDb(parsed);
    if (!migration.db) {
      const db = options.seedDemo === false ? emptyDb() : seedDb();
      for (const version of db.versions) {
        const bytes = Buffer.from(frameSvg(version.previewSpec), 'utf8');
        version.hash = sha256(bytes);
        version.size = bytes.length;
        await writeBlob(dataDir, version.hash, bytes);
      }
      await saveDb(dataDir, db);
      return db;
    }
    parsed = migration.db;
    const terminologyChanged = normalizePersistedAgents(parsed);
    for (const version of parsed.versions || []) {
      const target = path.join(dataDir, 'blobs', version.hash.slice(0, 2), version.hash);
      await fs.access(target).catch(async () => {
        if (!version.previewSpec) throw new Error(`Missing blob for ${version.hash}`);
        await writeBlob(dataDir, version.hash, Buffer.from(frameSvg(version.previewSpec), 'utf8'));
      });
    }
    if (terminologyChanged || migration.changed) await saveDb(dataDir, parsed);
    return parsed;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const db = options.seedDemo === false ? emptyDb() : seedDb();
    await fs.mkdir(path.join(dataDir, 'blobs'), { recursive: true });
    for (const version of db.versions) {
      const bytes = Buffer.from(frameSvg(version.previewSpec), 'utf8');
      version.hash = sha256(bytes);
      version.size = bytes.length;
      await writeBlob(dataDir, version.hash, bytes);
    }
    await saveDb(dataDir, db);
    return db;
  }
}

async function writeBlob(dataDir, hash, bytes) {
  const dir = path.join(dataDir, 'blobs', hash.slice(0, 2));
  await fs.mkdir(dir, { recursive: true });
  const finalPath = path.join(dir, hash);
  try {
    await fs.access(finalPath);
  } catch {
    const tempPath = `${finalPath}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    await fs.writeFile(tempPath, bytes);
    await fs.rename(tempPath, finalPath);
  }
}

async function readDb(dataDir) {
  return JSON.parse(await fs.readFile(path.join(dataDir, 'db.json'), 'utf8'));
}

async function saveDb(dataDir, db) {
  const file = path.join(dataDir, 'db.json');
  const temp = `${file}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  await fs.writeFile(temp, JSON.stringify(db, null, 2));
  await fs.rename(temp, file);
}

class Repository {
  constructor(dataDir, options = {}) {
    this.dataDir = dataDir;
    this.options = options;
    this.lock = Promise.resolve();
  }

  async init() {
    this.db = await ensureStorage(this.dataDir, this.options);
    return this;
  }

  mutate(operation) {
    const run = this.lock.then(() => Promise.resolve(operation(this.db)).then(async result => {
      await saveDb(this.dataDir, this.db);
      return result;
    }));
    this.lock = run.catch(() => {});
    return run;
  }

  snapshot() {
    return this.db;
  }

  createProject(input, actor, actorUserId = null) {
    const name = String(input.name || '').trim();
    if (name.length < 2 || name.length > 80) throw new Error('Project name must be 2–80 characters');
    return this.mutate(db => {
      const project = {
        id: id('proj'),
        name,
        client: String(input.client || '').slice(0, 100),
        brief: String(input.brief || '').slice(0, 12000),
        branches: ['Launch'],
        templateId: input.templateId || null,
        outputStructure: normalizeOutputStructure(input.outputStructure),
        reviewCriteria: parseList(input.reviewCriteria).slice(0, 30),
        inputAssets: parseList(input.inputAssets).slice(0, 50),
        assignments: [],
        createdByUserId: actorUserId,
        createdAt: now()
      };
      db.projects.push(project);
      db.activity.unshift({ id: id('act'), type: 'project_created', message: `${actor} created packet ${name}`, actor, projectId: project.id, at: now() });
      return project;
    });
  }

  pluginLogin(input) {
    return this.mutate(db => {
      const email = normalizeEmail(input.email);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw new Error('Enter a valid work email');
      const requestedRole = String(input.role || 'leader').toLowerCase();
      if (!['leader', 'team_lead'].includes(requestedRole)) {
        throw Object.assign(new Error('Creators join by pulling the one-time invitation from their leader'), { statusCode: 403 });
      }
      const role = 'team_lead';
      const agent = String(input.agent || `${email.split('@')[0]}-agent`).trim().slice(0, 80);
      let user = db.users.find(item => normalizeEmail(item.email) === email || item.agent === agent);
      if (!user) {
        user = {
          id: id('user'),
          name: String(input.name || email.split('@')[0]).trim().slice(0, 80),
          email,
          role,
          agent
        };
        db.users.push(user);
      } else {
        if (user.role !== 'team_lead') {
          throw Object.assign(new Error('This creator account cannot be promoted through plugin login'), { statusCode: 403 });
        }
        user.email = user.email || email;
        user.name = String(input.name || user.name).trim().slice(0, 80);
        user.role = role;
        user.agent = agent;
      }
      const session = this.issueSession(user, {
        agent,
        surface: input.surface,
        role
      });
      db.pluginSessions = db.pluginSessions || [];
      db.pluginSessions.unshift(session);
      db.activity.unshift({ id: id('act'), type: 'plugin_login', message: `${user.name} logged in from ${agent}`, actor: user.name, at: session.createdAt });
      return { session: { ...session, token: session.token }, user };
    });
  }

  issueSession(user, input = {}) {
    const createdAt = now();
    return {
      id: id('plug'),
      token: crypto.randomBytes(24).toString('base64url'),
      userId: user.id,
      agencyId: input.agencyId || LOCAL_AGENCY_ID,
      agent: String(input.agent || user.agent || 'nitrate-agent').slice(0, 80),
      surface: String(input.surface || 'AI coding agent').slice(0, 80),
      role: input.role || user.role,
      createdAt,
      lastSeenAt: createdAt
    };
  }

  pluginSession(token) {
    const db = this.snapshot();
    const session = (db.pluginSessions || []).find(item => item.token === token);
    if (!session) return null;
    const user = db.users.find(item => item.id === session.userId);
    return { session, user };
  }

  requirePluginSession(token, role = null) {
    const found = this.pluginSession(token);
    if (!found) throw Object.assign(new Error('Plugin login required'), { statusCode: 401 });
    if (role && found.user.role !== role && found.session.role !== role) {
      throw Object.assign(new Error(role === 'team_lead' ? 'Only leaders can do that' : 'This action is not available for this user'), { statusCode: 403 });
    }
    return found;
  }

  createMcpConnection(token, input = {}) {
    const found = this.requirePluginSession(token);
    const { session, user } = found;
    const role = session.role === 'team_lead' || user.role === 'team_lead' ? 'team_lead' : 'ai_creator';
    const allowedScopes = mcpScopesForRole(role);
    let scopes;
    if (input.scopes == null) {
      scopes = [...allowedScopes];
    } else {
      if (!Array.isArray(input.scopes)) {
        throw Object.assign(new Error('MCP connection scopes must be an array'), { statusCode: 422 });
      }
      scopes = input.scopes.map(scope => String(scope || '').trim());
      if (!scopes.length || scopes.length !== new Set(scopes).size || scopes.some(scope => !allowedScopes.includes(scope))) {
        throw Object.assign(new Error('MCP connection scopes must be a permitted subset of this role’s scopes'), { statusCode: 422 });
      }
    }
    const requestedTtl = input.expiresInSeconds == null ? DEFAULT_MCP_CONNECTION_TTL_SECONDS : Number(input.expiresInSeconds);
    if (!Number.isSafeInteger(requestedTtl) || requestedTtl <= 0 || requestedTtl > MAX_MCP_CONNECTION_TTL_SECONDS) {
      throw Object.assign(new Error('MCP connection expiry must be between 1 second and 30 days'), { statusCode: 422 });
    }
    const label = String(input.label || 'Remote MCP connection').trim().slice(0, 120);
    const client = String(input.client || 'remote-mcp').trim().slice(0, 120);
    if (!label || !client) throw Object.assign(new Error('MCP connection label and client cannot be empty'), { statusCode: 422 });
    const connectionToken = `nmc_${crypto.randomBytes(32).toString('base64url')}`;
    const createdAt = now();
    const agencyId = session.agencyId || LOCAL_AGENCY_ID;
    return this.mutate(db => {
      db.mcpConnections = db.mcpConnections || [];
      const connection = {
        id: id('mcp'),
        agencyId,
        userId: user.id,
        sourceSessionId: session.id,
        tokenHash: sha256(Buffer.from(connectionToken)),
        label,
        client,
        audience: 'nitrate-mcp',
        scopes,
        createdAt,
        expiresAt: new Date(Date.now() + requestedTtl * 1000).toISOString(),
        revokedAt: null,
        lastUsedAt: null
      };
      db.mcpConnections.unshift(connection);
      return { connection: publicMcpConnection(connection), token: connectionToken };
    });
  }

  listMcpConnections(token) {
    const { session, user } = this.requirePluginSession(token);
    const agencyId = session.agencyId || LOCAL_AGENCY_ID;
    return (this.snapshot().mcpConnections || [])
      .filter(connection => connection.agencyId === agencyId && connection.userId === user.id)
      .map(publicMcpConnection);
  }

  revokeMcpConnection(token, connectionId) {
    const { session, user } = this.requirePluginSession(token);
    const agencyId = session.agencyId || LOCAL_AGENCY_ID;
    return this.mutate(db => {
      const connection = (db.mcpConnections || []).find(item => item.id === connectionId
        && item.agencyId === agencyId && item.userId === user.id);
      if (!connection) throw Object.assign(new Error('MCP connection not found'), { statusCode: 404 });
      connection.revokedAt = connection.revokedAt || now();
      return publicMcpConnection(connection);
    });
  }

  canAccessProject(user, project) {
    if (!user || !project) return false;
    if (user.role === 'team_lead') return !project.createdByUserId || project.createdByUserId === user.id;
    return (project.assignments || []).some(assignment => assignment.userId === user.id);
  }

  pluginPackets(token) {
    const found = this.requirePluginSession(token);
    const db = this.snapshot();
    const { session, user } = found;
    const isLeader = user.role === 'team_lead' || session.role === 'team_lead';
    const projects = db.projects.filter(project => isLeader
      ? this.canAccessProject(user, project)
      : (project.assignments || []).some(assignment => assignment.userId === user.id));
    return {
      session: { ...session, token: undefined },
      user,
      mode: isLeader ? 'leader' : 'team_member',
      packets: projects.map(project => {
        const assignments = (project.assignments || []).filter(assignment =>
          isLeader || assignment.userId === user.id
        );
        const decoratedAssignments = assignments.map(assignment => {
          const assignee = db.users.find(item => item.id === assignment.userId);
          const invitation = (db.invites || []).find(item => item.assignmentId === assignment.id);
          return {
            ...assignment,
            assignee: assignee ? { id: assignee.id, name: assignee.name, email: assignee.email || '' } : null,
            invitation: invitation ? {
              status: invitation.acceptedAt ? 'accepted' : new Date(invitation.expiresAt) <= new Date() ? 'expired' : 'pending',
              expiresAt: invitation.expiresAt,
              acceptedAt: invitation.acceptedAt
            } : null
          };
        });
        const inputs = (db.packetInputs || []).filter(item => item.projectId === project.id && item.uploadedAt).map(item => ({
          ...item,
          downloadPath: `/api/plugin/inputs/${item.id}/raw`
        }));
        const returns = db.versions.filter(version => version.projectId === project.id && (isLeader || assignments.some(assignment => assignment.id === version.metadata.assignmentId)));
        const packetView = { ...project, assignments: decoratedAssignments, inputs };
        return {
          project: packetView,
          packet: packetView,
          assignments: decoratedAssignments,
          returns,
          activation: this.activationForProject(project, returns)
        };
      })
    };
  }

  activationForProject(project, returns = null) {
    const db = this.snapshot();
    const projectReturns = returns || db.versions.filter(version => version.projectId === project.id);
    const assignments = project.assignments || [];
    const firstAssignment = assignments.filter(item => item.pushedAt).sort((a, b) => new Date(a.pushedAt) - new Date(b.pushedAt))[0] || null;
    const firstPulled = assignments.filter(item => item.pulledAt).sort((a, b) => new Date(a.pulledAt) - new Date(b.pulledAt))[0] || null;
    const firstReturn = [...projectReturns].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))[0] || null;
    const decisions = projectReturns.flatMap(item => item.decisions || []).sort((a, b) => new Date(a.at) - new Date(b.at));
    const firstDecision = decisions[0] || null;
    const uploadedInputs = (db.packetInputs || []).filter(item => item.projectId === project.id && item.uploadedAt);
    return {
      packetCreatedAt: project.createdAt,
      firstAssignmentAt: firstAssignment?.pushedAt || null,
      firstPullAt: firstPulled?.pulledAt || null,
      firstReturnAt: firstReturn?.createdAt || null,
      firstDecisionAt: firstDecision?.at || null,
      uploadedInputCount: uploadedInputs.length,
      ahaReached: Boolean(uploadedInputs.length && firstPulled),
      closedLoop: Boolean(uploadedInputs.length && firstPulled && firstReturn && firstDecision)
    };
  }

  pushPacket(input, actor, actorUserId = null) {
    return this.mutate(db => {
      const packetId = input.packetId || input.projectId;
      const project = db.projects.find(item => item.id === packetId);
      if (!project) throw new Error('Unknown packet');
      if (project.createdByUserId && actorUserId && project.createdByUserId !== actorUserId) {
        throw Object.assign(new Error('This packet belongs to another leader'), { statusCode: 403 });
      }
      const uploadedInputs = (db.packetInputs || []).filter(item => item.projectId === project.id && item.uploadedAt);
      if (!uploadedInputs.length) {
        throw Object.assign(new Error('Upload at least one real input file before handing off this packet'), { statusCode: 422 });
      }
      const entries = Array.isArray(input.assignments) ? input.assignments : [];
      if (!entries.length) throw new Error('Add at least one creator assignment');
      const created = [];
      const invitations = [];
      for (const entry of entries.slice(0, 20)) {
        const email = normalizeEmail(entry.email);
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw new Error('Each creator needs a valid work email');
        let user = entry.userId ? db.users.find(item => item.id === entry.userId) : null;
        if (!user && email) user = db.users.find(item => normalizeEmail(item.email) === email);
        if (user?.role === 'team_lead') {
          throw Object.assign(new Error(`${email} is already a leader and cannot receive a creator invitation`), { statusCode: 409 });
        }
        if (!user) {
          user = {
            id: id('user'),
            name: String(entry.name || email.split('@')[0] || entry.agent || 'Creator').slice(0, 80),
            email,
            role: 'ai_creator',
            agent: String(entry.agent || `${email.split('@')[0]}-agent`).slice(0, 80)
          };
          db.users.push(user);
        }
        const assignment = {
          id: id('assign'),
          userId: user.id,
          agent: String(entry.agent || user.agent || `${user.name}-agent`).slice(0, 80),
          status: 'delivered',
          task: String(entry.task || 'Work this packet and return media, prompts, notes, and handoff files.').slice(0, 240),
          pushedAt: now(),
          acceptedAt: null,
          pulledAt: null,
          returnedAt: null
        };
        user.agent = assignment.agent;
        project.assignments = project.assignments || [];
        project.assignments.push(assignment);
        created.push(assignment);
        const token = crypto.randomBytes(24).toString('base64url');
        const invite = {
          id: id('invite'),
          tokenHash: sha256(Buffer.from(token)),
          projectId: project.id,
          assignmentId: assignment.id,
          userId: user.id,
          email,
          createdByUserId: actorUserId,
          createdAt: now(),
          expiresAt: new Date(Date.now() + INVITE_TTL_MS).toISOString(),
          acceptedAt: null
        };
        db.invites = db.invites || [];
        db.invites.push(invite);
        invitations.push({ id: invite.id, assignmentId: assignment.id, token, expiresAt: invite.expiresAt });
      }
      db.activity.unshift({ id: id('act'), type: 'packet_pushed', message: `${actor} pushed ${project.name} to ${created.length} AI coding agents`, actor, projectId: project.id, at: now() });
      return { packetId: project.id, project, packet: project, assignments: created, invitations };
    });
  }

  acceptInvite(token, input = {}) {
    return this.mutate(db => {
      const tokenHash = sha256(Buffer.from(String(token || '')));
      const invite = (db.invites || []).find(item => item.tokenHash === tokenHash);
      if (!invite) throw Object.assign(new Error('This invitation is invalid'), { statusCode: 404 });
      if (invite.acceptedAt) throw Object.assign(new Error('This invitation has already been accepted'), { statusCode: 409 });
      if (new Date(invite.expiresAt) <= new Date()) throw Object.assign(new Error('This invitation has expired'), { statusCode: 410 });
      const user = db.users.find(item => item.id === invite.userId);
      const project = db.projects.find(item => item.id === invite.projectId);
      const assignment = project?.assignments?.find(item => item.id === invite.assignmentId);
      if (!user || !project || !assignment) throw Object.assign(new Error('This invitation is no longer available'), { statusCode: 404 });
      const surface = String(input.surface || 'AI coding agent').slice(0, 80);
      const agent = String(input.agent || `${normalizeEmail(user.email).split('@')[0]}-agent`).trim().slice(0, 80);
      if (input.name) user.name = String(input.name).trim().slice(0, 80) || user.name;
      user.agent = agent;
      assignment.agent = agent;
      assignment.acceptedAt = now();
      invite.acceptedAt = assignment.acceptedAt;
      const session = this.issueSession(user, { agent, surface, role: 'ai_creator' });
      db.pluginSessions.unshift(session);
      db.activity.unshift({
        id: id('act'),
        type: 'invite_accepted',
        message: `${user.name} joined ${project.name}`,
        actor: user.name,
        projectId: project.id,
        assignmentId: assignment.id,
        at: invite.acceptedAt
      });
      return { session, user, project, packet: project, assignment };
    });
  }

  reservePacketInput(projectId, input, actor, actorUserId = null) {
    return this.mutate(db => {
      const project = db.projects.find(item => item.id === projectId);
      if (!project) throw Object.assign(new Error('Unknown packet'), { statusCode: 404 });
      if (project.createdByUserId && actorUserId && project.createdByUserId !== actorUserId) {
        throw Object.assign(new Error('This packet belongs to another leader'), { statusCode: 403 });
      }
      const filename = safeFilename(input.filename || input.name, 'input');
      const expectedSize = Number(input.size || 0);
      if (!Number.isSafeInteger(expectedSize) || expectedSize <= 0 || expectedSize > MAX_UPLOAD_BYTES) {
        throw Object.assign(new Error(`Input size must be between 1 and ${MAX_UPLOAD_BYTES} bytes`), { statusCode: expectedSize > MAX_UPLOAD_BYTES ? 413 : 400 });
      }
      const expectedHash = String(input.sha256 || '').toLowerCase();
      if (!/^[a-f0-9]{64}$/.test(expectedHash)) throw new Error('A valid SHA-256 hash is required');
      const item = {
        id: id('input'),
        projectId,
        name: String(input.name || filename).slice(0, 140),
        filename,
        mime: String(input.mime || 'application/octet-stream').slice(0, 120),
        size: expectedSize,
        hash: expectedHash,
        createdBy: actor,
        createdAt: now(),
        uploadedAt: null
      };
      db.packetInputs.push(item);
      project.inputAssets = [...new Set([...(project.inputAssets || []), filename])];
      return { ...item, uploadPath: `/api/plugin/inputs/${item.id}/raw` };
    });
  }

  uploadReservedPacketInput(inputId, bytes, actorUserId = null) {
    return this.mutate(db => {
      const item = db.packetInputs.find(entry => entry.id === inputId);
      if (!item) throw Object.assign(new Error('Input reservation not found'), { statusCode: 404 });
      const project = db.projects.find(entry => entry.id === item.projectId);
      if (project?.createdByUserId && actorUserId && project.createdByUserId !== actorUserId) {
        throw Object.assign(new Error('This packet belongs to another leader'), { statusCode: 403 });
      }
      if (item.uploadedAt) throw Object.assign(new Error('This input has already been uploaded'), { statusCode: 409 });
      if (!bytes?.length || bytes.length !== item.size) throw new Error(`Input size mismatch: expected ${item.size} bytes`);
      const hash = sha256(bytes);
      if (hash !== item.hash) throw new Error('Input checksum mismatch');
      item.uploadedAt = now();
      db.activity.unshift({ id: id('act'), type: 'packet_input_added', message: `${item.filename} added to ${project.name}`, actor: item.createdBy, projectId: project.id, at: item.uploadedAt });
      return { ...item, deduplicated: db.packetInputs.some(existing => existing.id !== item.id && existing.hash === hash && existing.uploadedAt) };
    }).then(async result => {
      await writeBlob(this.dataDir, result.hash, bytes);
      return result;
    });
  }

  addPacketInput(projectId, input, bytes, actor, actorUserId = null) {
    return this.mutate(db => {
      const project = db.projects.find(item => item.id === projectId);
      if (!project) throw Object.assign(new Error('Unknown packet'), { statusCode: 404 });
      if (project.createdByUserId && actorUserId && project.createdByUserId !== actorUserId) {
        throw Object.assign(new Error('This packet belongs to another leader'), { statusCode: 403 });
      }
      if (!bytes?.length) throw new Error('Input files cannot be empty');
      if (bytes.length > MAX_UPLOAD_BYTES) throw Object.assign(new Error('Input file exceeds the 100 MiB prototype limit'), { statusCode: 413 });
      const filename = safeFilename(input.filename || input.name, 'input');
      const hash = sha256(bytes);
      const item = {
        id: id('input'),
        projectId,
        name: String(input.name || filename).slice(0, 140),
        filename,
        mime: String(input.mime || 'application/octet-stream').slice(0, 120),
        size: bytes.length,
        hash,
        createdBy: actor,
        createdAt: now()
      };
      db.packetInputs = db.packetInputs || [];
      db.packetInputs.push(item);
      project.inputAssets = [...new Set([...(project.inputAssets || []), filename])];
      db.activity.unshift({ id: id('act'), type: 'packet_input_added', message: `${actor} added ${filename} to ${project.name}`, actor, projectId, at: item.createdAt });
      return { ...item, deduplicated: db.packetInputs.some(existing => existing.id !== item.id && existing.hash === hash) };
    }).then(async result => {
      await writeBlob(this.dataDir, result.hash, bytes);
      return result;
    });
  }

  packetInput(inputId, token) {
    const found = this.requirePluginSession(token);
    const db = this.snapshot();
    const item = (db.packetInputs || []).find(entry => entry.id === inputId);
    const project = item && db.projects.find(entry => entry.id === item.projectId);
    if (!item || !project || !item.uploadedAt) throw Object.assign(new Error('Input file not found'), { statusCode: 404 });
    if (!this.canAccessProject(found.user, project)) throw Object.assign(new Error('This input is not available to this user'), { statusCode: 403 });
    return item;
  }

  updateAssignment(assignmentId, input, actor, actorUser = null) {
    return this.mutate(db => {
      for (const project of db.projects) {
        const assignment = (project.assignments || []).find(item => item.id === assignmentId);
        if (!assignment) continue;
        if (actorUser?.role === 'team_lead') {
          throw Object.assign(new Error('Only the assigned creator can update pull and work status'), { statusCode: 403 });
        }
        if (actorUser && assignment.userId !== actorUser.id) {
          throw Object.assign(new Error('This assignment is not assigned to this user'), { statusCode: 403 });
        }
        const allowed = new Set(['pulled', 'working', 'blocked']);
        const status = String(input.status || '').trim();
        if (status === 'returned') {
          throw Object.assign(new Error('Upload the real media file to return this assignment'), { statusCode: 409 });
        }
        if (!allowed.has(status)) throw new Error('Unsupported assignment status');
        if (assignment.status === 'returned' && status !== 'returned') {
          throw Object.assign(new Error('Returned assignments cannot be moved backwards'), { statusCode: 409 });
        }
        assignment.status = status;
        if (['pulled', 'working', 'returned'].includes(status) && !assignment.pulledAt) assignment.pulledAt = now();
        if (status === 'returned') assignment.returnedAt = now();
        db.activity.unshift({ id: id('act'), type: status === 'pulled' ? 'assignment_pulled' : 'assignment_status', message: `${actor} marked ${assignment.agent} ${status} on ${project.name}`, actor, projectId: project.id, assignmentId, at: now() });
        return { project, assignment };
      }
      throw new Error('Unknown assignment');
    });
  }

  reserveReturn(assignmentId, input, user) {
    return this.mutate(db => {
      const project = db.projects.find(item => (item.assignments || []).some(assignment => assignment.id === assignmentId));
      const assignment = project?.assignments?.find(item => item.id === assignmentId);
      if (!project || !assignment) throw Object.assign(new Error('Unknown assignment'), { statusCode: 404 });
      if (user.role === 'team_lead') {
        throw Object.assign(new Error('Only the assigned creator can return work'), { statusCode: 403 });
      }
      if (assignment.userId !== user.id) {
        throw Object.assign(new Error('This assignment is not assigned to this user'), { statusCode: 403 });
      }
      if (!['pulled', 'working', 'blocked'].includes(assignment.status)) {
        throw Object.assign(new Error('Pull this assignment before returning work'), { statusCode: 409 });
      }
      const filename = safeFilename(input.filename || input.name, 'return');
      const expectedSize = Number(input.size || 0);
      if (!Number.isSafeInteger(expectedSize) || expectedSize <= 0 || expectedSize > MAX_UPLOAD_BYTES) {
        throw Object.assign(new Error(`Return size must be between 1 and ${MAX_UPLOAD_BYTES} bytes`), { statusCode: expectedSize > MAX_UPLOAD_BYTES ? 413 : 400 });
      }
      const expectedHash = String(input.sha256 || '').toLowerCase();
      if (!/^[a-f0-9]{64}$/.test(expectedHash)) throw new Error('A valid SHA-256 hash is required');
      const mime = String(input.mime || 'application/octet-stream').toLowerCase();
      if (!ALLOWED_MIME_PREFIXES.some(prefix => mime.startsWith(prefix))) throw new Error('Only image, video, and audio files are supported');
      const relativePath = normalizeRelativePath(input.relativePath, filename);
      const draft = {
        id: id('return'),
        projectId: project.id,
        assignmentId,
        userId: user.id,
        name: String(input.name || filename).slice(0, 140),
        filename,
        mime,
        size: expectedSize,
        hash: expectedHash,
        madeWith: String(input.madeWith || input.model || '').slice(0, 120),
        prompt: String(input.prompt || '').slice(0, 4000),
        notes: String(input.notes || '').slice(0, 2000),
        relativePath,
        branch: String(input.branch || 'Launch').slice(0, 80),
        parentVersionId: input.parentVersionId || null,
        createdAt: now()
      };
      const validation = returnValidation(project, { ...input, relativePath, filename }, {
        prompt: draft.prompt,
        model: draft.madeWith
      }, Buffer.from([1]));
      if (!validation.complete) {
        throw Object.assign(new Error(`Return is missing required handoff data: ${validation.missing.join(', ')}`), { statusCode: 422 });
      }
      draft.validation = validation;
      db.returnDrafts.push(draft);
      return { ...draft, uploadPath: `/api/plugin/returns/${draft.id}/raw` };
    });
  }

  async uploadReservedReturn(returnId, bytes, user) {
    const draft = this.snapshot().returnDrafts.find(item => item.id === returnId);
    if (!draft) throw Object.assign(new Error('Return reservation not found'), { statusCode: 404 });
    if (user.role === 'team_lead' || draft.userId !== user.id) throw Object.assign(new Error('This return belongs to another creator'), { statusCode: 403 });
    if (!bytes?.length || bytes.length !== draft.size) throw new Error(`Return size mismatch: expected ${draft.size} bytes`);
    if (sha256(bytes) !== draft.hash) throw new Error('Return checksum mismatch');
    const result = await this.commit({
      projectId: draft.projectId,
      assignmentId: draft.assignmentId,
      assetName: draft.name,
      filename: draft.filename,
      mime: draft.mime,
      prompt: draft.prompt,
      model: draft.madeWith,
      notes: draft.notes,
      relativePath: draft.relativePath,
      branch: draft.branch,
      parentVersionId: draft.parentVersionId
    }, bytes, user.name, { requireProvenance: false, user });
    await this.mutate(db => {
      db.returnDrafts = db.returnDrafts.filter(item => item.id !== returnId);
      return null;
    });
    return { ...result, return: result.version };
  }

  reviewReturn(versionId, patch, user) {
    if (user.role !== 'team_lead') throw Object.assign(new Error('Only leaders can review returned work'), { statusCode: 403 });
    const version = this.snapshot().versions.find(item => item.id === versionId);
    if (!version) throw Object.assign(new Error('Unknown return'), { statusCode: 404 });
    const project = this.snapshot().projects.find(item => item.id === version.projectId);
    if (!this.canAccessProject(user, project)) throw Object.assign(new Error('This return belongs to another leader'), { statusCode: 403 });
    if (!patch.action) throw Object.assign(new Error('Choose approve, request_changes, reject, or reopen'), { statusCode: 422 });
    return this.updateVersion(versionId, patch, user.name);
  }

  commit(input, bytes, actor, options = {}) {
    return this.mutate(db => {
      const project = db.projects.find(item => item.id === input.projectId);
      if (!project) throw new Error('Unknown project');
      if (options.user?.role === 'team_lead' && !this.canAccessProject(options.user, project)) {
        throw Object.assign(new Error('This project belongs to another leader'), { statusCode: 403 });
      }
      const mime = String(input.mime || 'application/octet-stream').toLowerCase();
      if (!ALLOWED_MIME_PREFIXES.some(prefix => mime.startsWith(prefix))) throw new Error('Only image, video, and audio files are supported');
      if (!bytes?.length) throw new Error('Empty files cannot be committed');
      if (bytes.length > MAX_UPLOAD_BYTES) throw new Error('File exceeds the 100 MiB prototype limit');
      const hash = sha256(bytes);
      const filename = safeFilename(input.filename, 'upload');
      const metadata = {
        prompt: String(input.prompt || '').slice(0, 4000),
        model: String(input.model || '').slice(0, 120),
        seed: String(input.seed || '').slice(0, 120),
        pipeline: String(input.pipeline || '').slice(0, 120),
        operator: actor,
        notes: String(input.notes || '').slice(0, 2000),
        parentVersionId: input.parentVersionId || null,
        assignmentId: input.assignmentId || null,
        relativePath: normalizeRelativePath(input.relativePath, filename)
      };
      if (options.requireProvenance !== false && (!metadata.prompt || !metadata.model)) throw new Error('Prompt and model are required provenance');

      let asset = db.assets.find(item => item.id === input.assetId && item.projectId === project.id);
      if (input.assetId && !asset) throw new Error('Unknown asset');
      if (input.parentVersionId) {
        const parent = db.versions.find(item => item.id === input.parentVersionId);
        if (!parent) throw new Error('Unknown parent version');
        if (!asset) asset = db.assets.find(item => item.id === parent.assetId);
        metadata.parentVersionId = parent.id;
      }
      const duplicate = db.versions.some(item => item.hash === hash);
      if (!asset) {
        asset = {
          id: id('asset'),
          projectId: project.id,
          name: String(input.assetName || filename).slice(0, 140),
          currentVersionId: null,
          createdAt: now(),
          updatedAt: now()
        };
        db.assets.push(asset);
      }
      if (input.branch && !project.branches.includes(input.branch)) project.branches.push(input.branch);
      if (metadata.assignmentId) {
        const assignment = (project.assignments || []).find(item => item.id === metadata.assignmentId);
        if (!assignment) throw new Error('Unknown assignment');
        if (options.user && options.user.role !== 'team_lead' && assignment.userId !== options.user.id) {
          throw Object.assign(new Error('This assignment is not assigned to this user'), { statusCode: 403 });
        }
        assignment.status = 'returned';
        assignment.pulledAt = assignment.pulledAt || now();
        assignment.returnedAt = now();
      }
      const validation = returnValidation(project, input, metadata, bytes);
      const version = {
        id: id('v'),
        assetId: asset.id,
        projectId: project.id,
        branch: input.branch || 'Launch',
        hash,
        size: bytes.length,
        mime,
        kind: mediaKind(mime),
        filename,
        status: 'review',
        metadata,
        validation,
        comments: [],
        decisions: [],
        createdAt: now()
      };
      asset.currentVersionId = version.id;
      asset.updatedAt = version.createdAt;
      db.versions.push(version);
      db.activity.unshift({
        id: id('act'),
        type: 'committed',
        message: `${actor} added ${filename}`,
        actor,
        projectId: project.id,
        assignmentId: metadata.assignmentId,
        versionId: version.id,
        at: version.createdAt
      });
      return { asset, version, deduplicated: duplicate };
    }).then(async result => {
      await writeBlob(this.dataDir, result.version.hash, bytes);
      return result;
    });
  }

  updateVersion(versionId, patch, actor) {
    return this.mutate(db => {
      const version = db.versions.find(item => item.id === versionId);
      if (!version) throw new Error('Unknown version');
      const actions = {
        approve: 'approved',
        reject: 'rejected',
        request_changes: 'changes_requested',
        reopen: 'review'
      };
      if (patch.action) {
        const status = actions[patch.action];
        if (!status) throw new Error('Unsupported decision');
        version.status = status;
        version.decisions.push({ action: patch.action, actor, note: String(patch.note || '').slice(0, 800), at: now() });
        if (['request_changes', 'reopen'].includes(patch.action) && version.metadata.assignmentId) {
          const project = db.projects.find(item => item.id === version.projectId);
          const assignment = project?.assignments?.find(item => item.id === version.metadata.assignmentId);
          if (assignment) {
            assignment.status = 'working';
            assignment.returnedAt = null;
          }
        }
        db.activity.unshift({
          id: id('act'), type: patch.action, message: `${actor} marked ${version.filename} ${status.replace('_', ' ')}`,
          actor, projectId: version.projectId, assignmentId: version.metadata.assignmentId, versionId, at: now()
        });
      }
      if (patch.comment) {
        const comment = {
          id: id('cm'),
          author: actor,
          role: patch.role || 'collaborator',
          body: String(patch.comment).slice(0, 2000),
          createdAt: now()
        };
        version.comments.push(comment);
        db.activity.unshift({ id: id('act'), type: 'comment', message: `${actor} commented on ${version.filename}`, actor, versionId, at: comment.createdAt });
      }
      if (patch.metadata) {
        for (const key of ['prompt', 'model', 'seed', 'pipeline', 'notes']) {
          if (patch.metadata[key] != null) version.metadata[key] = String(patch.metadata[key]).slice(0, 4000);
        }
      }
      return version;
    });
  }

  createShare(input, actor) {
    return this.mutate(db => {
      const scope = input.scope === 'project' ? 'project' : 'version';
      let label = '';
      if (scope === 'version') {
        const version = db.versions.find(item => item.id === input.targetId);
        if (!version) throw new Error('Unknown version');
        label = version.filename;
      } else {
        const project = db.projects.find(item => item.id === input.targetId);
        if (!project) throw new Error('Unknown project');
        label = project.name;
      }
      const share = {
        id: id('share'),
        token: crypto.randomBytes(18).toString('base64url'),
        scope,
        targetId: input.targetId,
        label,
        allowDownload: Boolean(input.allowDownload),
        createdBy: actor,
        createdAt: now(),
        views: []
      };
      db.shares.push(share);
      db.activity.unshift({ id: id('act'), type: 'shared', message: `${actor} shared ${label}`, actor, at: share.createdAt });
      return share;
    });
  }

  addToWaitlist(input) {
    return this.mutate(db => {
      const email = String(input.email || '').trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw new Error('Enter a valid work email');
      const existing = db.waitlist.find(item => item.email === email);
      if (!existing) {
        db.waitlist.push({
          email,
          teamSize: String(input.teamSize || '').slice(0, 60),
          workflow: String(input.workflow || '').slice(0, 120),
          createdAt: now()
        });
      }
      return { ok: true, message: 'You are on the list. We will contact design-partner teams in order.' };
    });
  }

  sharedView(token) {
    const db = this.snapshot();
    const share = db.shares.find(item => item.token === token);
    if (!share) return null;
    const projectIds = new Set();
    let versions = [];
    if (share.scope === 'version') {
      versions = db.versions.filter(item => item.id === share.targetId);
    } else {
      versions = db.versions.filter(item => item.projectId === share.targetId);
    }
    versions.forEach(item => projectIds.add(item.projectId));
    return {
      share: { label: share.label, scope: share.scope, allowDownload: share.allowDownload, createdBy: share.createdBy },
      versions,
      assets: db.assets.filter(item => versions.some(version => version.assetId === item.id))
    };
  }
}

module.exports = {
  Repository,
  ensureStorage,
  frameSvg,
  mediaKind,
  now,
  sha256,
  slugify,
  MAX_UPLOAD_BYTES
};
