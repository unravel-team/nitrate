import { McpServer } from '@modelcontextprotocol/server';
import { createMcpHandler } from 'agents/mcp/server';
import { z } from 'zod';

const MAX_MEDIA_BYTES = 100 * 1024 * 1024;
const MAX_MCP_JSON_BYTES = 256 * 1024;
const ASSET_CAPABILITY_TTL_SECONDS = 15 * 60;
const ALLOWED_MEDIA_TYPES = new Set([
  'image/avif',
  'image/bmp',
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/tiff',
  'image/webp',
  'video/mp4',
  'video/mpeg',
  'video/quicktime',
  'video/webm',
  'video/x-matroska',
  'audio/aac',
  'audio/flac',
  'audio/mp4',
  'audio/mpeg',
  'audio/ogg',
  'audio/wav',
  'audio/webm',
  'audio/x-wav'
]);

function problem(status, message, headers = {}) {
  return Response.json(
    { error: message },
    {
      status,
      headers: {
        'Cache-Control': 'no-store',
        'Content-Type': 'application/json; charset=utf-8',
        'X-Content-Type-Options': 'nosniff',
        ...headers
      }
    }
  );
}

function unauthorized(message = 'A valid Nitrate MCP connection token is required') {
  return problem(401, message, {
    'WWW-Authenticate': 'Bearer realm="nitrate-mcp", error="invalid_token"'
  });
}

function toBase64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64Url(value) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid capability encoding');
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

function bytesHex(value) {
  return [...new Uint8Array(value)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function signingKey(env) {
  const secret = String(env.NITRATE_MCP_ASSET_SIGNING_KEY || '');
  if (secret.length < 32) throw Object.assign(new Error('Nitrate MCP asset signing is not configured'), { statusCode: 503 });
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

async function issueAssetCapability(request, env, connection, kind, assetId) {
  const connectionExpiry = Math.floor(Date.parse(connection.expiresAt) / 1000);
  const claims = {
    v: 1,
    c: connection.id,
    k: kind,
    i: assetId,
    e: Math.min(Math.floor(Date.now() / 1000) + ASSET_CAPABILITY_TTL_SECONDS, connectionExpiry)
  };
  const encodedClaims = toBase64Url(new TextEncoder().encode(JSON.stringify(claims)));
  const signature = await crypto.subtle.sign(
    'HMAC',
    await signingKey(env),
    new TextEncoder().encode(encodedClaims)
  );
  const access = `${encodedClaims}.${toBase64Url(new Uint8Array(signature))}`;
  const baseUrl = String(env.NITRATE_PUBLIC_BASE_URL || new URL(request.url).origin).replace(/\/$/, '');
  return {
    url: `${baseUrl}/api/mcp/assets/${kind}/${encodeURIComponent(assetId)}?access=${encodeURIComponent(access)}`,
    expiresAt: new Date(claims.e * 1000).toISOString()
  };
}

async function verifyAssetCapability(env, access, expectedKind, expectedId) {
  const [encodedClaims, encodedSignature, extra] = String(access || '').split('.');
  if (!encodedClaims || !encodedSignature || extra) return null;
  let signature;
  let claims;
  try {
    signature = fromBase64Url(encodedSignature);
    claims = JSON.parse(new TextDecoder().decode(fromBase64Url(encodedClaims)));
  } catch {
    return null;
  }
  const expectedShape = claims && claims.v === 1
    && typeof claims.c === 'string' && /^[A-Za-z0-9_-]{3,120}$/.test(claims.c)
    && (claims.k === 'input' || claims.k === 'return')
    && typeof claims.i === 'string' && /^[A-Za-z0-9_-]{3,120}$/.test(claims.i)
    && Number.isSafeInteger(claims.e);
  if (!expectedShape || claims.k !== expectedKind || claims.i !== expectedId) return null;
  const currentSeconds = Math.floor(Date.now() / 1000);
  if (claims.e < currentSeconds || claims.e > currentSeconds + ASSET_CAPABILITY_TTL_SECONDS + 60) return null;
  const valid = await crypto.subtle.verify(
    'HMAC',
    await signingKey(env),
    signature,
    new TextEncoder().encode(encodedClaims)
  );
  return valid ? claims : null;
}

async function liveCapabilityConnection(env, connectionId) {
  const row = await env.DB.prepare(
    `SELECT c.id, c.user_id, c.agency_id, c.scopes_json, c.expires_at, c.revoked_at,
            u.role AS user_role, m.role AS membership_role
     FROM mcp_connections c
     JOIN users u ON u.id = c.user_id
     JOIN agency_memberships m ON m.agency_id = c.agency_id AND m.user_id = c.user_id
     WHERE c.id = ? AND c.audience = 'nitrate-mcp' AND c.revoked_at IS NULL AND c.expires_at > ?
     LIMIT 1`
  ).bind(connectionId, new Date().toISOString()).first();
  if (!row) return null;
  let scopes;
  try {
    scopes = JSON.parse(row.scopes_json || '[]');
  } catch {
    return null;
  }
  if (!Array.isArray(scopes) || !scopes.includes('assets:read')) return null;
  return {
    id: row.id,
    userId: row.user_id,
    agencyId: row.agency_id,
    scopes,
    role: row.user_role === 'team_lead' && row.membership_role === 'team_lead' ? 'team_lead' : 'ai_creator'
  };
}

function secureObjectResponse(object, filename, contentType, method) {
  const headers = new Headers({
    'Cache-Control': 'private, no-store',
    'Content-Disposition': `inline; filename="${encodeURIComponent(filename)}"`,
    'Content-Length': String(object.size),
    'Content-Type': contentType || object.httpMetadata?.contentType || 'application/octet-stream',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff'
  });
  if (object.httpEtag) headers.set('ETag', object.httpEtag);
  return new Response(method === 'HEAD' ? null : object.body, { headers });
}

export async function handleMcpAssetRequest(request, env, kind, assetId) {
  if (!['GET', 'HEAD'].includes(request.method)) return problem(405, 'Method not allowed', { Allow: 'GET, HEAD' });
  if (!['input', 'return'].includes(kind) || !/^[A-Za-z0-9_-]{3,120}$/.test(assetId)) {
    return problem(404, 'Asset not found');
  }
  let claims;
  try {
    claims = await verifyAssetCapability(env, new URL(request.url).searchParams.get('access'), kind, assetId);
  } catch (error) {
    const status = Number(error?.statusCode || 500);
    return problem(status, status >= 500 ? 'Asset access failed' : (error instanceof Error ? error.message : 'Asset access failed'));
  }
  if (!claims) return problem(403, 'Asset capability is invalid or expired');
  const session = await liveCapabilityConnection(env, claims.c);
  if (!session) return problem(403, 'Asset capability connection is no longer active');

  let row;
  if (kind === 'input') {
    row = await env.DB.prepare(
      `SELECT i.* FROM packet_inputs i
       JOIN packets p ON p.id = i.packet_id AND p.agency_id = i.agency_id
       WHERE i.id = ? AND i.agency_id = ? AND i.uploaded_at IS NOT NULL
         AND (
           ? = 'team_lead' OR EXISTS (
             SELECT 1 FROM assignments a
             WHERE a.packet_id = i.packet_id AND a.user_id = ?
           )
         ) LIMIT 1`
    ).bind(assetId, session.agencyId, session.role, session.userId).first();
  } else {
    if (session.role !== 'team_lead') return problem(403, 'Only leaders can open return review assets');
    row = await env.DB.prepare(
      `SELECT r.* FROM returns r JOIN packets p ON p.id = r.packet_id
       WHERE r.id = ? AND p.agency_id = ? AND r.uploaded_at IS NOT NULL LIMIT 1`
    ).bind(assetId, session.agencyId).first();
  }
  if (!row?.object_key) return problem(404, 'Asset not found');
  const object = request.method === 'HEAD'
    ? await env.MEDIA.head(row.object_key)
    : await env.MEDIA.get(row.object_key);
  if (!object) return problem(404, 'Asset bytes are unavailable');
  return secureObjectResponse(object, row.filename, row.content_type, request.method);
}

function parseAllowedOrigins(env) {
  const allowHttpForLocalTests = String(env.NITRATE_MCP_ALLOW_HTTP_IMPORTS || '') === 'true';
  const values = String(env.NITRATE_MCP_IMPORT_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean);
  const origins = new Set();
  for (const value of values) {
    let parsed;
    try {
      parsed = new URL(value);
    } catch {
      throw Object.assign(new Error('Nitrate MCP import origins are misconfigured'), { statusCode: 503 });
    }
    if (parsed.username || parsed.password || parsed.hash || parsed.search || (parsed.pathname !== '/' && parsed.pathname !== '')) {
      throw Object.assign(new Error('Nitrate MCP import origins must be exact origins'), { statusCode: 503 });
    }
    const localHttp = allowHttpForLocalTests && parsed.protocol === 'http:'
      && ['127.0.0.1', 'localhost', '::1'].includes(parsed.hostname);
    if (!localHttp && (parsed.protocol !== 'https:' || (parsed.port && parsed.port !== '443'))) {
      throw Object.assign(new Error('Nitrate MCP import origins must use HTTPS on port 443'), { statusCode: 503 });
    }
    origins.add(parsed.origin);
  }
  if (!origins.size) throw Object.assign(new Error('Nitrate MCP import origins are not configured'), { statusCode: 503 });
  return { origins, allowHttpForLocalTests };
}

function validatedSourceUrl(env, value) {
  let source;
  try {
    source = new URL(value);
  } catch {
    throw Object.assign(new Error('sourceUrl must be a valid URL'), { statusCode: 422 });
  }
  if (source.username || source.password || source.hash) {
    throw Object.assign(new Error('sourceUrl cannot contain credentials or a fragment'), { statusCode: 422 });
  }
  const { origins, allowHttpForLocalTests } = parseAllowedOrigins(env);
  const localHttp = allowHttpForLocalTests && source.protocol === 'http:'
    && ['127.0.0.1', 'localhost', '::1'].includes(source.hostname);
  if (!localHttp && (source.protocol !== 'https:' || (source.port && source.port !== '443'))) {
    throw Object.assign(new Error('sourceUrl must use HTTPS on port 443'), { statusCode: 422 });
  }
  if (!origins.has(source.origin)) throw Object.assign(new Error('sourceUrl origin is not allowed'), { statusCode: 403 });
  return source;
}

async function bestEffort(promise, details) {
  try {
    await promise;
    return true;
  } catch (error) {
    console.error(JSON.stringify({
      level: 'error',
      message: 'Nitrate MCP cleanup failed',
      ...details,
      error: error instanceof Error ? error.message : String(error)
    }));
    return false;
  }
}

async function stageRemoteMedia(env, sourceUrl, provider, connectionId, stagingKey, reservationId) {
  const source = validatedSourceUrl(env, sourceUrl);
  let response;
  try {
    response = await fetch(source.href, {
      method: 'GET',
      redirect: 'manual',
      headers: { Accept: [...ALLOWED_MEDIA_TYPES].join(', ') }
    });
  } catch {
    throw Object.assign(new Error('The media provider could not be reached'), { statusCode: 502 });
  }
  if (response.status >= 300 && response.status < 400) {
    if (response.body) await bestEffort(response.body.cancel(), { operation: 'cancel-provider-response', connectionId });
    throw Object.assign(new Error('Redirected media URLs are not accepted'), { statusCode: 422 });
  }
  if (!response.ok || !response.body) {
    if (response.body) await bestEffort(response.body.cancel(), { operation: 'cancel-provider-response', connectionId });
    throw Object.assign(new Error('The media provider did not return downloadable bytes'), { statusCode: 422 });
  }
  const contentType = String(response.headers.get('Content-Type') || '').split(';', 1)[0].trim().toLowerCase();
  if (!ALLOWED_MEDIA_TYPES.has(contentType)) {
    await bestEffort(response.body.cancel(), { operation: 'cancel-provider-response', connectionId });
    throw Object.assign(new Error('The provider response is not a supported raster, video, or audio file'), { statusCode: 415 });
  }
  const declaredHeader = response.headers.get('Content-Length');
  const declaredSize = declaredHeader == null ? null : Number(declaredHeader);
  if (declaredSize == null) {
    await bestEffort(response.body.cancel(), { operation: 'cancel-provider-response', connectionId });
    throw Object.assign(new Error('The provider response must include Content-Length'), { statusCode: 422 });
  }
  if (declaredSize != null && (!Number.isSafeInteger(declaredSize) || declaredSize <= 0)) {
    await bestEffort(response.body.cancel(), { operation: 'cancel-provider-response', connectionId });
    throw Object.assign(new Error('The provider returned an invalid Content-Length'), { statusCode: 422 });
  }
  if (declaredSize != null && declaredSize > MAX_MEDIA_BYTES) {
    await bestEffort(response.body.cancel(), { operation: 'cancel-provider-response', connectionId });
    throw Object.assign(new Error('The provider file exceeds the 100 MiB import limit'), { statusCode: 413 });
  }

  let streamedBytes = 0;
  const limited = response.body.pipeThrough(new TransformStream({
    transform(chunk, controller) {
      const bytes = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
      streamedBytes += bytes.byteLength;
      if (streamedBytes > MAX_MEDIA_BYTES) throw new Error('The provider file exceeds the 100 MiB import limit');
      controller.enqueue(bytes);
    }
  }));
  const [storageBody, digestBody] = limited.tee();
  const digestStream = new crypto.DigestStream('SHA-256');
  const fixedLengthStream = new FixedLengthStream(declaredSize);
  const createdAt = new Date().toISOString();
  const settled = await Promise.allSettled([
    env.MEDIA.put(stagingKey, fixedLengthStream.readable, {
      httpMetadata: { contentType },
      customMetadata: { provider, purpose: 'nitrate-mcp-import', connectionId, reservationId, createdAt }
    }),
    storageBody.pipeTo(fixedLengthStream.writable),
    digestBody.pipeTo(digestStream)
  ]);
  const failure = settled.find(result => result.status === 'rejected');
  if (failure) {
    const cleaned = await bestEffort(env.MEDIA.delete(stagingKey), { operation: 'delete-staging', stagingKey, connectionId });
    const tooLarge = streamedBytes > MAX_MEDIA_BYTES;
    const sizeMismatch = declaredSize !== streamedBytes;
    const message = tooLarge
      ? 'The provider file exceeds the 100 MiB import limit'
      : sizeMismatch
        ? 'The provider response size did not match its Content-Length'
        : 'The provider file could not be imported';
    throw Object.assign(new Error(message), {
      statusCode: tooLarge ? 413 : sizeMismatch ? 422 : 502,
      cleanupFailed: !cleaned
    });
  }
  const size = Number(digestStream.bytesWritten);
  if (size <= 0 || (declaredSize != null && size !== declaredSize)) {
    const cleaned = await bestEffort(env.MEDIA.delete(stagingKey), { operation: 'delete-staging', stagingKey, connectionId });
    throw Object.assign(new Error('The provider response size did not match its Content-Length'), {
      statusCode: 422,
      cleanupFailed: !cleaned
    });
  }
  return {
    stagingKey,
    size,
    sha256: bytesHex(await digestStream.digest),
    contentType
  };
}

const EmptyInput = z.object({}).strict();
const WhoamiOutput = z.object({
  connectionId: z.string(),
  connectionLabel: z.string(),
  client: z.string(),
  scopes: z.array(z.string()),
  agencyId: z.string(),
  agencyName: z.string(),
  userId: z.string(),
  name: z.string(),
  email: z.string(),
  role: z.enum(['team_lead', 'ai_creator']),
  surface: z.string(),
  agent: z.string()
}).strict();
const AssetOutput = z.object({
  id: z.string(),
  filename: z.string(),
  contentType: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  sha256: z.string(),
  downloadUrl: z.string().url(),
  expiresAt: z.string()
}).strict();
const AssignmentOutput = z.object({
  id: z.string(),
  task: z.string(),
  status: z.string(),
  pulledAt: z.string().nullable(),
  inputs: z.array(AssetOutput)
}).strict();
const ReturnOutput = z.object({
  id: z.string(),
  assignmentId: z.string(),
  filename: z.string(),
  status: z.string(),
  contentType: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  sha256: z.string(),
  relativePath: z.string(),
  assetUrl: z.string().url(),
  expiresAt: z.string()
}).strict();
const WorkPacketOutput = z.object({
  packetId: z.string(),
  name: z.string(),
  client: z.string(),
  brief: z.string(),
  outputStructure: z.array(z.string()),
  reviewCriteria: z.array(z.string()),
  assignments: z.array(AssignmentOutput),
  returns: z.array(ReturnOutput)
}).strict();
const ListWorkOutput = z.object({
  role: z.enum(['team_lead', 'ai_creator']),
  packets: z.array(WorkPacketOutput)
}).strict();
const PullOutput = z.object({
  packetId: z.string(),
  name: z.string(),
  client: z.string(),
  brief: z.string(),
  outputStructure: z.array(z.string()),
  reviewCriteria: z.array(z.string()),
  assignment: AssignmentOutput
}).strict();
const SubmitOutput = z.object({
  returnId: z.string(),
  assignmentId: z.string(),
  packetId: z.string(),
  filename: z.string(),
  contentType: z.string(),
  sizeBytes: z.number().int().positive(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  relativePath: z.string(),
  status: z.string(),
  provenance: z.object({
    provider: z.literal('Higgsfield Supercomputer'),
    externalAssetId: z.string()
  }).strict()
}).strict();
const ReviewOutput = z.object({
  returnId: z.string(),
  packetId: z.string(),
  assignmentId: z.string(),
  status: z.string(),
  decision: z.enum(['approve', 'reject', 'request_changes', 'reopen']),
  note: z.string(),
  assetUrl: z.string().url(),
  expiresAt: z.string()
}).strict();

function success(value) {
  return {
    content: [{ type: 'text', text: JSON.stringify(value) }],
    structuredContent: value
  };
}

function safeToolError(error, requestId, tool) {
  const status = Number(error?.statusCode || 500);
  if (Number.isSafeInteger(status) && status >= 400 && status < 500) {
    return {
      content: [{ type: 'text', text: error instanceof Error ? error.message : 'Nitrate rejected this tool call' }],
      isError: true
    };
  }
  console.error(JSON.stringify({
    level: 'error',
    message: 'Nitrate MCP tool failed',
    path: '/mcp',
    requestId,
    tool,
    error: error instanceof Error ? error.message : String(error)
  }));
  return {
    content: [{ type: 'text', text: `Nitrate could not complete this tool call. Reference: ${requestId}` }],
    isError: true
  };
}

function safeToolHandler(requestId, tool, handler) {
  return async args => {
    try {
      return await handler(args);
    } catch (error) {
      return safeToolError(error, requestId, tool);
    }
  };
}

async function boundedMcpRequest(request) {
  const declared = request.headers.get('Content-Length');
  if (declared != null) {
    const size = Number(declared);
    if (!Number.isSafeInteger(size) || size < 0) return problem(400, 'Invalid Content-Length');
    if (size > MAX_MCP_JSON_BYTES) return problem(413, 'MCP request body exceeds the 256 KiB limit');
  }
  if (!request.body) return request;
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = value instanceof Uint8Array ? value : new Uint8Array(value);
      size += chunk.byteLength;
      if (size > MAX_MCP_JSON_BYTES) {
        await reader.cancel().catch(() => {});
        return problem(413, 'MCP request body exceeds the 256 KiB limit');
      }
      chunks.push(chunk);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new Request(request, { body: bytes });
}

async function shapeWork(request, env, found, source) {
  const packets = [];
  for (const item of source.packets || []) {
    const packet = item.packet || item.project;
    const inputs = [];
    for (const input of item.inputs || packet.inputs || []) {
      if (!input.ready) continue;
      const capability = await issueAssetCapability(request, env, found.connection, 'input', input.id);
      inputs.push({
        id: input.id,
        filename: input.filename,
        contentType: input.contentType || input.mime,
        sizeBytes: Number(input.sizeBytes ?? input.size),
        sha256: input.sha256 || input.hash,
        downloadUrl: capability.url,
        expiresAt: capability.expiresAt
      });
    }
    const assignments = (item.assignments || []).map(assignment => ({
      id: assignment.id,
      task: assignment.task,
      status: assignment.status,
      pulledAt: assignment.pulledAt || null,
      inputs
    }));
    const returns = [];
    if (found.session.role === 'team_lead') {
      for (const returned of item.returns || []) {
        const capability = await issueAssetCapability(request, env, found.connection, 'return', returned.id);
        returns.push({
          id: returned.id,
          assignmentId: returned.metadata.assignmentId,
          filename: returned.filename,
          status: returned.status,
          contentType: returned.mime,
          sizeBytes: Number(returned.sizeBytes ?? returned.size),
          sha256: returned.sha256 || returned.hash,
          relativePath: returned.metadata.relativePath,
          assetUrl: capability.url,
          expiresAt: capability.expiresAt
        });
      }
    }
    packets.push({
      packetId: packet.id,
      name: packet.name,
      client: packet.client || '',
      brief: packet.brief,
      outputStructure: packet.outputStructure || [],
      reviewCriteria: packet.reviewCriteria || [],
      assignments,
      returns
    });
  }
  return { role: found.session.role, packets };
}

function submitShape(returned, externalAssetId) {
  return {
    returnId: returned.id,
    assignmentId: returned.metadata.assignmentId,
    packetId: returned.packetId,
    filename: returned.filename,
    contentType: returned.mime,
    sizeBytes: Number(returned.sizeBytes ?? returned.size),
    sha256: returned.sha256 || returned.hash,
    relativePath: returned.metadata.relativePath,
    status: returned.status,
    provenance: { provider: 'Higgsfield Supercomputer', externalAssetId }
  };
}

function createServer(request, env, ctx, found, services, requestId) {
  const server = new McpServer({ name: 'nitrate-higgsfield', version: '0.2.0' });
  const scopes = new Set(found.connection.scopes);
  if (scopes.has('identity:read')) {
    server.registerTool('nitrate_whoami', {
      title: 'Nitrate identity',
      description: 'Show the Nitrate agency identity, role, and scopes attached to this Supercomputer connection.',
      inputSchema: EmptyInput,
      outputSchema: WhoamiOutput,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false }
    }, safeToolHandler(requestId, 'nitrate_whoami', async () => success({
      connectionId: found.connection.id,
      connectionLabel: found.connection.label,
      client: found.connection.client,
      scopes: found.connection.scopes,
      agencyId: found.agency.id,
      agencyName: found.agency.name,
      userId: found.user.id,
      name: found.user.name,
      email: found.user.email,
      role: found.session.role,
      surface: found.session.surface,
      agent: found.session.agent
    })));
  }

  if (scopes.has('work:read') && scopes.has('assets:read')) {
    server.registerTool('nitrate_list_work', {
      title: 'List Nitrate work',
      description: 'List agency packets available to this identity, including short-lived media links.',
      inputSchema: EmptyInput,
      outputSchema: ListWorkOutput,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false }
    }, safeToolHandler(requestId, 'nitrate_list_work', async () => success(
      await shapeWork(request, env, found, await services.listWork(found))
    )));
  }

  if (found.session.role === 'ai_creator' && scopes.has('assignments:pull') && scopes.has('assets:read')) {
    server.registerTool('nitrate_pull_assignment', {
      title: 'Pull Nitrate assignment',
      description: 'Accept an assigned brief and receive its exact input assets as 15-minute download URLs.',
      inputSchema: z.object({ assignmentId: z.string().min(3).max(120) }).strict(),
      outputSchema: PullOutput,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    }, safeToolHandler(requestId, 'nitrate_pull_assignment', async ({ assignmentId }) => {
      const pulled = await services.pullAssignment(found, assignmentId);
      const inputs = [];
      for (const input of pulled.inputs) {
        const capability = await issueAssetCapability(request, env, found.connection, 'input', input.id);
        inputs.push({
          id: input.id,
          filename: input.filename,
          contentType: input.contentType || input.mime,
          sizeBytes: Number(input.sizeBytes ?? input.size),
          sha256: input.sha256 || input.hash,
          downloadUrl: capability.url,
          expiresAt: capability.expiresAt
        });
      }
      return success({
        packetId: pulled.packet.id,
        name: pulled.packet.name,
        client: pulled.packet.client || '',
        brief: pulled.packet.brief,
        outputStructure: pulled.packet.outputStructure || [],
        reviewCriteria: pulled.packet.reviewCriteria || [],
        assignment: {
          id: pulled.assignment.id,
          task: pulled.assignment.task,
          status: pulled.assignment.status,
          pulledAt: pulled.assignment.pulledAt || null,
          inputs
        }
      });
    }));

  }

  if (found.session.role === 'ai_creator' && scopes.has('returns:submit')) {
    server.registerTool('nitrate_submit_return_from_url', {
      title: 'Submit Higgsfield result',
      description: 'Import a finished Higgsfield media URL into Nitrate and send it to the agency leader for review.',
      inputSchema: z.object({
        assignmentId: z.string().min(3).max(120),
        sourceUrl: z.string().url().max(4096),
        filename: z.string().min(1).max(160),
        prompt: z.string().min(1).max(4000),
        relativePath: z.string().min(1).max(500),
        notes: z.string().max(1800).optional(),
        externalAssetId: z.string().min(1).max(200),
        parentReturnId: z.string().min(3).max(120).optional()
      }).strict(),
      outputSchema: SubmitOutput,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    }, safeToolHandler(requestId, 'nitrate_submit_return_from_url', async args => {
      let staged;
      let returnId;
      let reservationId;
      let cleanupSafe = true;
      try {
        const prepared = await services.prepareReturnImport(found, args);
        if (prepared.existing) return success(submitShape(prepared.existing, args.externalAssetId));
        reservationId = prepared.reservationId;
        staged = await stageRemoteMedia(
          env,
          args.sourceUrl,
          'Higgsfield Supercomputer',
          found.connection.id,
          prepared.stagingKey,
          reservationId
        );
        await services.markImportStaged(found, reservationId, staged.stagingKey);
        const reserved = await services.reserveReturn(found, {
          assignmentId: args.assignmentId,
          filename: prepared.filename,
          name: prepared.filename,
          prompt: args.prompt,
          madeWith: 'Higgsfield Supercomputer',
          relativePath: prepared.relativePath,
          notes: [args.notes, `Higgsfield Supercomputer asset: ${args.externalAssetId}`].filter(Boolean).join('\n').slice(0, 2000),
          parentReturnId: prepared.parentReturnId,
          mime: staged.contentType,
          size: staged.size,
          sha256: staged.sha256
        });
        returnId = reserved.return.id;
        await services.attachImportReturn(found, reservationId, returnId);
        const stagingObject = await env.MEDIA.get(staged.stagingKey);
        if (!stagingObject) throw Object.assign(new Error('The staged provider file is unavailable'), { statusCode: 502 });
        const uploaded = await services.uploadReturn(found, returnId, stagingObject.body, staged.size, staged.contentType);
        const returned = uploaded.return || uploaded.version;
        await bestEffort(services.commitImport(found, reservationId, returnId), {
          operation: 'commit-import-reservation', reservationId, returnId, connectionId: found.connection.id
        });
        if (staged?.stagingKey) {
          const stagingKey = staged.stagingKey;
          ctx.waitUntil((async () => {
            const deleted = await bestEffort(env.MEDIA.delete(stagingKey), {
              operation: 'delete-staging', stagingKey, connectionId: found.connection.id
            });
            if (deleted) await bestEffort(services.clearImportStaging(found, reservationId, stagingKey), {
              operation: 'clear-staging-metadata', stagingKey, reservationId, connectionId: found.connection.id
            });
            else await bestEffort(services.noteImportCleanupFailure(found, reservationId, 'staging object deletion failed'), {
              operation: 'record-staging-cleanup-failure', stagingKey, reservationId, connectionId: found.connection.id
            });
          })());
          staged = null;
        }
        return success(submitShape(returned, args.externalAssetId));
      } catch (error) {
        cleanupSafe = !error?.cleanupFailed;
        if (returnId) cleanupSafe = await bestEffort(services.cleanupPendingReturn(returnId, reservationId), {
          operation: 'cleanup-pending-return', returnId, connectionId: found.connection.id
        }) && cleanupSafe;
        if (staged?.stagingKey) cleanupSafe = await bestEffort(env.MEDIA.delete(staged.stagingKey), {
          operation: 'delete-staging', stagingKey: staged.stagingKey, connectionId: found.connection.id
        }) && cleanupSafe;
        if (reservationId && cleanupSafe) {
          const metadataCleaned = await bestEffort(services.cleanupImport(found, reservationId), {
            operation: 'cleanup-import-reservation', reservationId, connectionId: found.connection.id
          });
          if (!metadataCleaned) await bestEffort(
            services.noteImportCleanupFailure(found, reservationId, 'metadata cleanup failed; reservation retained'),
            { operation: 'record-import-cleanup-failure', reservationId, connectionId: found.connection.id }
          );
        } else if (reservationId) await bestEffort(
          services.noteImportCleanupFailure(found, reservationId, 'artifact cleanup failed; metadata retained'),
          { operation: 'record-import-cleanup-failure', reservationId, connectionId: found.connection.id }
        );
        throw error;
      }
    }));
  }

  if (found.session.role === 'team_lead' && scopes.has('returns:review') && scopes.has('assets:read')) {
    server.registerTool('nitrate_review_return', {
      title: 'Review Nitrate return',
      description: 'Approve, reject, reopen, or request changes on a creator return after reviewing its media.',
      inputSchema: z.object({
        returnId: z.string().min(3).max(120),
        decision: z.enum(['approve', 'reject', 'request_changes', 'reopen']),
        note: z.string().max(800).default('')
      }).strict(),
      outputSchema: ReviewOutput,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false }
    }, safeToolHandler(requestId, 'nitrate_review_return', async ({ returnId, decision, note }) => {
      const reviewed = await services.reviewReturn(found, returnId, decision, note);
      const returned = reviewed.return || reviewed.version;
      const capability = await issueAssetCapability(request, env, found.connection, 'return', returned.id);
      return success({
        returnId: returned.id,
        packetId: returned.packetId,
        assignmentId: returned.metadata.assignmentId,
        status: returned.status,
        decision,
        note,
        assetUrl: capability.url,
        expiresAt: capability.expiresAt
      });
    }));
  }
  return server;
}

export async function handleRemoteMcp(request, env, ctx, services, requestId = crypto.randomUUID()) {
  if (new URL(request.url).pathname !== '/mcp') return problem(404, 'Not found');
  if (request.method !== 'POST') return problem(405, 'Method not allowed', { Allow: 'POST' });
  const authorization = request.headers.get('Authorization') || '';
  if (!/^Bearer\s+\S+$/i.test(authorization)) return unauthorized();
  const token = authorization.replace(/^Bearer\s+/i, '');
  const found = await services.authenticate(token);
  if (!found) return unauthorized('The Nitrate MCP connection is invalid, expired, or revoked');
  try {
    await signingKey(env);
  } catch (error) {
    return problem(Number(error?.statusCode || 500), 'MCP is unavailable');
  }
  const bounded = await boundedMcpRequest(request);
  if (bounded instanceof Response) return bounded;
  const handler = createMcpHandler(
    () => createServer(request, env, ctx, found, services, requestId),
    {
      route: '/mcp',
      corsOptions: false,
      legacy: 'stateless',
      responseMode: 'json',
      onerror: error => console.error(JSON.stringify({
        level: 'error', message: 'Nitrate MCP protocol request failed', path: '/mcp', requestId,
        error: error instanceof Error ? error.message : String(error)
      }))
    }
  );
  const response = await handler(bounded, env, ctx);
  if (response.status >= 500) {
    if (response.body) await response.body.cancel().catch(() => {});
    return Response.json(
      { jsonrpc: '2.0', id: null, error: { code: -32603, message: 'Internal MCP error' } },
      {
        status: response.status,
        headers: {
          'Cache-Control': 'no-store',
          'Content-Type': 'application/json; charset=utf-8',
          'Referrer-Policy': 'no-referrer',
          'X-Content-Type-Options': 'nosniff'
        }
      }
    );
  }
  response.headers.set('Cache-Control', 'no-store');
  response.headers.set('Referrer-Policy', 'no-referrer');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.delete('Access-Control-Allow-Origin');
  return response;
}
