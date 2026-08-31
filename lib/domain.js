'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
const ALLOWED_MIME_PREFIXES = ['image/', 'video/', 'audio/'];

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

function mediaKind(mime) {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return null;
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
        pipeline: index % 2 ? 'clanker-return' : 'brief-packet',
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
    schemaVersion: 3,
    seededAt: created,
    users: [
      { id: 'user_maya', name: 'Maya Chen', role: 'team_lead', clanker: 'maya-clanker' },
      { id: 'user_jonas', name: 'Jonas Reyes', role: 'ai_creator', clanker: 'jonas-clanker' },
      { id: 'user_asha', name: 'Asha Kapoor', role: 'ai_creator', clanker: 'asha-clanker' },
      { id: 'user_leo', name: 'Leo Martins', role: 'ai_creator', clanker: 'leo-clanker' }
    ],
    projects: [{
      id: 'proj_launch_film',
      name: 'Launch Film Packet',
      client: 'Northwind',
      brief: 'Create a 30-second launch-film direction from the supplied bottle macro, city plate, logo mark, and VO scratch. Each creator should explore a different path and return organized outputs for lead review.',
      branches: ['Launch', 'Extended cut'],
      templateId: 'tpl_campaign',
      outputStructure: ['/inputs', '/renders', '/stills', '/prompts', '/notes', '/handoff'],
      inputAssets: ['bottle_macro.mov', 'city_plate.exr', 'logo_mark.svg', 'vo_scratch.wav', 'brand_reference.pdf'],
      assignments: [
        { id: 'assign_maya', userId: 'user_maya', clanker: 'maya-clanker', status: 'returned', task: 'Hero film opening and edit rhythm', pushedAt: created, returnedAt: '2026-08-18T12:20:00.000Z' },
        { id: 'assign_jonas', userId: 'user_jonas', clanker: 'jonas-clanker', status: 'working', task: 'Human performance beat before reveal', pushedAt: created, returnedAt: null },
        { id: 'assign_asha', userId: 'user_asha', clanker: 'asha-clanker', status: 'returned', task: 'Product macro stills and mark reveal', pushedAt: created, returnedAt: '2026-08-18T13:05:00.000Z' },
        { id: 'assign_leo', userId: 'user_leo', clanker: 'leo-clanker', status: 'delivered', task: 'Packaging stills and handoff notes', pushedAt: created, returnedAt: null }
      ],
      createdAt: created
    }],
    assets,
    versions,
    comments: [],
    shares: [],
    pluginSessions: [],
    activity: [{
      id: 'act_seed',
      type: 'workspace_seeded',
      message: 'Brief packet pushed to four clankers.',
      actor: 'nitrate',
      at: created
    }],
    templates: [
      {
        id: 'tpl_campaign',
        name: 'Campaign film packet',
        description: 'Brief, input assets, creator assignments, review stages, and delivery folders.',
        stages: ['Brief packet', 'Clanker dispatch', 'Creator returns', 'Lead review', 'Client approval'],
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

async function ensureStorage(dataDir) {
  await fs.mkdir(path.join(dataDir, 'blobs'), { recursive: true });
  const dbFile = path.join(dataDir, 'db.json');
  try {
    const raw = await fs.readFile(dbFile, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed.schemaVersion !== 3) {
      const db = seedDb();
      for (const version of db.versions) {
        const bytes = Buffer.from(frameSvg(version.previewSpec), 'utf8');
        version.hash = sha256(bytes);
        version.size = bytes.length;
        await writeBlob(dataDir, version.hash, bytes);
      }
      await saveDb(dataDir, db);
      return db;
    }
    for (const version of parsed.versions || []) {
      const target = path.join(dataDir, 'blobs', version.hash.slice(0, 2), version.hash);
      await fs.access(target).catch(async () => {
        if (!version.previewSpec) throw new Error(`Missing blob for ${version.hash}`);
        await writeBlob(dataDir, version.hash, Buffer.from(frameSvg(version.previewSpec), 'utf8'));
      });
    }
    return parsed;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const db = seedDb();
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
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.lock = Promise.resolve();
  }

  async init() {
    this.db = await ensureStorage(this.dataDir);
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

  createProject(input, actor) {
    const name = String(input.name || '').trim();
    if (name.length < 2 || name.length > 80) throw new Error('Project name must be 2–80 characters');
    return this.mutate(db => {
      const project = {
        id: id('proj'),
        name,
        client: String(input.client || '').slice(0, 100),
        brief: String(input.brief || '').slice(0, 600),
        branches: ['Launch'],
        templateId: input.templateId || null,
        outputStructure: parseList(input.outputStructure, ['/inputs', '/renders', '/stills', '/prompts', '/notes', '/handoff']).slice(0, 20),
        inputAssets: parseList(input.inputAssets).slice(0, 50),
        assignments: [],
        createdAt: now()
      };
      db.projects.push(project);
      db.activity.unshift({ id: id('act'), type: 'project_created', message: `${actor} created packet ${name}`, actor, at: now() });
      return project;
    });
  }

  pluginLogin(input) {
    return this.mutate(db => {
      const email = normalizeEmail(input.email);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw new Error('Enter a valid work email');
      const role = input.role === 'leader' || input.role === 'team_lead' ? 'team_lead' : 'ai_creator';
      const clanker = String(input.clanker || `${email.split('@')[0]}-clanker`).trim().slice(0, 80);
      let user = db.users.find(item => normalizeEmail(item.email) === email || item.clanker === clanker);
      if (!user) {
        user = {
          id: id('user'),
          name: String(input.name || email.split('@')[0]).trim().slice(0, 80),
          email,
          role,
          clanker
        };
        db.users.push(user);
      } else {
        user.email = user.email || email;
        user.name = String(input.name || user.name).trim().slice(0, 80);
        user.role = role;
        user.clanker = clanker;
      }
      const session = {
        id: id('plug'),
        token: crypto.randomBytes(18).toString('base64url'),
        userId: user.id,
        clanker,
        surface: String(input.surface || 'Local clanker').slice(0, 80),
        role,
        createdAt: now(),
        lastSeenAt: now()
      };
      db.pluginSessions = db.pluginSessions || [];
      db.pluginSessions.unshift(session);
      db.activity.unshift({ id: id('act'), type: 'plugin_login', message: `${user.name} logged in from ${clanker}`, actor: user.name, at: session.createdAt });
      return { session: { ...session, token: session.token }, user };
    });
  }

  pluginSession(token) {
    const db = this.snapshot();
    const session = (db.pluginSessions || []).find(item => item.token === token);
    if (!session) return null;
    const user = db.users.find(item => item.id === session.userId);
    return { session, user };
  }

  pluginPackets(token) {
    const found = this.pluginSession(token);
    if (!found) throw Object.assign(new Error('Plugin login required'), { statusCode: 401 });
    const db = this.snapshot();
    const { session, user } = found;
    const isLeader = user.role === 'team_lead' || session.role === 'team_lead';
    const projects = isLeader ? db.projects : db.projects.filter(project =>
      (project.assignments || []).some(assignment => assignment.userId === user.id || assignment.clanker === user.clanker)
    );
    return {
      session: { ...session, token: undefined },
      user,
      mode: isLeader ? 'leader' : 'team_member',
      packets: projects.map(project => {
        const assignments = (project.assignments || []).filter(assignment =>
          isLeader || assignment.userId === user.id || assignment.clanker === user.clanker
        );
        return {
          project,
          assignments,
          returns: db.versions.filter(version => version.projectId === project.id && assignments.some(assignment => assignment.id === version.metadata.assignmentId))
        };
      })
    };
  }

  pushPacket(input, actor) {
    return this.mutate(db => {
      const packetId = input.packetId || input.projectId;
      const project = db.projects.find(item => item.id === packetId);
      if (!project) throw new Error('Unknown packet');
      const entries = Array.isArray(input.assignments) ? input.assignments : [];
      if (!entries.length) throw new Error('Add at least one creator assignment');
      const created = [];
      for (const entry of entries.slice(0, 20)) {
        const email = normalizeEmail(entry.email);
        let user = entry.userId ? db.users.find(item => item.id === entry.userId) : null;
        if (!user && email) user = db.users.find(item => normalizeEmail(item.email) === email);
        if (!user) {
          user = {
            id: id('user'),
            name: String(entry.name || email.split('@')[0] || entry.clanker || 'Creator').slice(0, 80),
            email,
            role: 'ai_creator',
            clanker: String(entry.clanker || `${email.split('@')[0]}-clanker`).slice(0, 80)
          };
          db.users.push(user);
        }
        const assignment = {
          id: id('assign'),
          userId: user.id,
          clanker: String(entry.clanker || user.clanker || `${user.name}-clanker`).slice(0, 80),
          status: 'delivered',
          task: String(entry.task || 'Work this packet and return media, prompts, notes, and handoff files.').slice(0, 240),
          pushedAt: now(),
          returnedAt: null
        };
        user.clanker = assignment.clanker;
        project.assignments = project.assignments || [];
        project.assignments.push(assignment);
        created.push(assignment);
      }
      db.activity.unshift({ id: id('act'), type: 'packet_pushed', message: `${actor} pushed ${project.name} to ${created.length} clankers`, actor, at: now() });
      return { packetId: project.id, project, assignments: created };
    });
  }

  updateAssignment(assignmentId, input, actor) {
    return this.mutate(db => {
      for (const project of db.projects) {
        const assignment = (project.assignments || []).find(item => item.id === assignmentId);
        if (!assignment) continue;
        const allowed = new Set(['delivered', 'pulled', 'working', 'returned', 'blocked']);
        const status = String(input.status || '').trim();
        if (!allowed.has(status)) throw new Error('Unsupported assignment status');
        assignment.status = status;
        if (status === 'returned') assignment.returnedAt = now();
        db.activity.unshift({ id: id('act'), type: 'assignment_status', message: `${actor} marked ${assignment.clanker} ${status} on ${project.name}`, actor, at: now() });
        return { project, assignment };
      }
      throw new Error('Unknown assignment');
    });
  }

  commit(input, bytes, actor) {
    return this.mutate(db => {
      const project = db.projects.find(item => item.id === input.projectId);
      if (!project) throw new Error('Unknown project');
      const mime = String(input.mime || 'application/octet-stream').toLowerCase();
      if (!ALLOWED_MIME_PREFIXES.some(prefix => mime.startsWith(prefix))) throw new Error('Only image, video, and audio files are supported');
      if (!bytes?.length) throw new Error('Empty files cannot be committed');
      if (bytes.length > MAX_UPLOAD_BYTES) throw new Error('File exceeds the 100 MiB prototype limit');
      const hash = sha256(bytes);
      const filename = path.basename(String(input.filename || 'upload')).replace(/[^\w.\- ]+/g, '_').slice(0, 160) || 'upload';
      const metadata = {
        prompt: String(input.prompt || '').slice(0, 4000),
        model: String(input.model || '').slice(0, 120),
        seed: String(input.seed || '').slice(0, 120),
        pipeline: String(input.pipeline || '').slice(0, 120),
        operator: actor,
        notes: String(input.notes || '').slice(0, 2000),
        parentVersionId: input.parentVersionId || null,
        assignmentId: input.assignmentId || null
      };
      if (!metadata.prompt || !metadata.model) throw new Error('Prompt and model are required provenance');

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
        if (assignment) {
          assignment.status = 'returned';
          assignment.returnedAt = now();
        }
      }
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
        db.activity.unshift({
          id: id('act'), type: patch.action, message: `${actor} marked ${version.filename} ${status.replace('_', ' ')}`,
          actor, versionId, at: now()
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
