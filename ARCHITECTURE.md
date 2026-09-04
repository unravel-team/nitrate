# Architecture

## Product boundary

Nitrate coordinates one handoff between an AI video agency lead and a creator:

```text
lead login
    ↓
packet + verified inputs + creator assignment
    ↓ one-time invite
creator session + verified local workspace
    ↓
verified media return + prompt + tool + notes
    ↓
leader review decision
```

The system does not generate media or replace Runway, Higgsfield Supercomputer, Fal, Replicate, Codex, or Claude Code. It preserves the brief, actual source files, assignment, required output shape, return context, and decision while work moves between people and tools.

## Domain model

- **User:** a lead or invited creator.
- **Plugin session:** a bearer-token session tied to one user and one agent surface.
- **Packet/project:** campaign name, client, brief, expected output folders, review criteria, creator assignments, and input references.
- **Packet input:** immutable bytes plus filename, MIME type, size, SHA-256 digest, creator, and timestamps.
- **Assignment:** packet-to-creator handoff with task, agent identity, invite state, and `delivered`, `pulled`, `working`, `returned`, or `blocked` status.
- **Invite:** a random, hashed, single-use token scoped to one assignment, creator, and packet, with an expiry.
- **Return reservation:** expected media metadata and digest before bytes are accepted.
- **Return/version:** immutable media bytes, prompt, tool/model, notes, relative path, assignment, review state, and optional parent return.
- **Decision:** `approve`, `request_changes`, `reject`, or `reopen`, attached to one exact return with actor, note, and time.
- **Activity:** append-oriented workflow events used for history and activation timing.

The packet response embeds downloadable uploaded inputs and decorates assignments with creator and invitation state. A creator receives only assignments attached to their invited account. A lead receives only packets they own.

## Authentication and authorization

Lead login bootstraps a lead plugin session. Creator sessions can only be issued by accepting a valid one-time assignment invite. All ordinary plugin workflow endpoints require `Authorization: Bearer <token>` and explicitly reject tokens beginning with `nmc_`.

Authorization is checked at the packet, input, assignment, return, and review boundaries:

- only the owning lead can create input reservations, upload those input bytes, assign creators, or review returns;
- an invited creator can read only the packet and inputs assigned to them;
- a creator can update or return only their own assignment;
- creator sessions cannot record leader decisions;
- accepting an invite a second time fails.

The local bootstrap login is intentionally simpler than production authentication. Production must pair sessions with verified identity and durable agency memberships; a caller-provided role is never sufficient authorization.

## Two-phase byte uploads

Inputs and returns share one transfer pattern:

1. The authenticated client computes SHA-256 and byte size locally.
2. It posts JSON metadata to create a reservation.
3. The API returns an opaque record ID and `uploadPath`.
4. The client sends the original bytes with `PUT`.
5. The API verifies ownership, size, checksum, MIME constraints, and one-time use before committing the object.

Packet inputs become downloadable only after verification. Returns become reviewable only after the media object exists. Retrying a completed raw upload is rejected, so an immutable return cannot be overwritten.

The creator's pull path downloads each input, recomputes its SHA-256 digest, checks its size, writes only safe relative paths, and saves a local receipt before marking the assignment pulled.

## Activation semantics

Status labels alone do not count as activation.

- `ahaReached` requires at least one successfully uploaded packet input and at least one creator pull timestamp.
- `closedLoop` additionally requires a committed returned media object and a leader decision on a return.

The API also exposes the first assignment, pull, return, and decision timestamps so product analytics can measure time to handoff, time to shared context, time to first return, and time to decision.

## Local reference service

`npm start` runs a dependency-free Node.js 20 server. Metadata is atomically persisted in `REEL_DATA_DIR/db.json`; immutable bytes are content-addressed under `REEL_DATA_DIR/blobs/`. The default remains `.reel-data` for prototype compatibility.

The local service implements the authenticated plugin contract as well as demo web routes. The CLI and both plugin bundles use the authenticated routes. Legacy demo routes such as `/api/state`, `/api/projects`, `/api/uploads`, `/api/versions/:id`, and local shares remain for the browser prototype and must not be treated as production authorization examples.

## Cloudflare runtime

The production-shaped runtime keeps the same contract:

- **Cloudflare Worker:** HTTP validation, authentication boundary, packet orchestration, and streaming byte transfer.
- **D1:** users, sessions, agencies/memberships, packets, inputs, assignments, hashed invites, return reservations, returns, decisions, and activity.
- **R2:** immutable packet inputs and returned media, addressed by server-generated keys.
- **Queues, optional:** thumbnails, filmstrips, waveforms, transcription, malware scanning, and media inspection after the core upload commits.
- **Durable Objects, optional:** live review presence only if real-time collaboration becomes necessary.

The Worker must stream request and response bodies rather than buffer large media, scope every D1 query to the authenticated agency/user, use prepared statements, and complete critical writes in the request lifecycle. Clients verify downloaded input bytes independently.

Production deployment is handled by the repository's GitHub Actions workflow. Local Wrangler deployment is intentionally not part of the operating instructions. Always confirm the target Cloudflare account before enabling or running deployment automation. No Cloudflare deployment was performed as part of this implementation.

## Plugin packaging

Codex and Claude Code bundles are generated from shared skills and runtime code, but each built plugin is self-contained:

```text
plugins/nitrate/              # Codex manifest, MCP config/runtime, skills
plugins/claude-code/          # Claude manifest, MCP config/runtime, skills
.agents/plugins/              # Codex repository marketplace
.claude-plugin/               # Claude Code repository marketplace
```

Marketplace installation may copy a plugin to a cache, so neither MCP configuration may traverse outside its own plugin root. The CLI, Codex plugin, and Claude Code plugin all call the same authenticated HTTP contract.

## Remote MCP transport

`POST /mcp` is a stateless Streamable HTTP MCP endpoint for production workspaces that support a custom remote MCP connection. It accepts only a dedicated Nitrate MCP connection token, not the normal plugin session:

```http
Authorization: Bearer nmc_<opaque-one-time-secret>
```

An authenticated local plugin or CLI mints the connection through `POST /api/plugin/mcp-connections`. The default expiry is seven days, the maximum is 30 days, and the one-time response includes the `nmc_…` secret plus connection metadata. The CLI derives and prints the `/mcp` endpoint with the one-time `Authorization` value; it deliberately never persists that secret. `GET /api/plugin/mcp-connections` lists metadata only, and `DELETE /api/plugin/mcp-connections/:connectionId` immediately revokes one connection. A connection token is invalid on all ordinary REST routes, while `/mcp` rejects a plugin session token.

Connections are tied to one agency, user, role, client label, expiry, and an allowed scope subset. The server checks expiry, revocation, membership, role, and scope for every MCP request, then records last use. A reduced-scope connection does not register tools it cannot use:

| Role | Available scopes |
| --- | --- |
| Creator | `identity:read`, `work:read`, `assets:read`, `assignments:pull`, `returns:submit` |
| Lead | `identity:read`, `work:read`, `assets:read`, `returns:review` |

The server exposes a deliberately narrow collaboration surface:

| Tool | Caller | Effect |
| --- | --- | --- |
| `nitrate_whoami` | Scoped lead or creator | Returns the current Nitrate identity, role, and connection scopes. |
| `nitrate_list_work` | Scoped lead or creator | Lists only work visible through that connection. |
| `nitrate_pull_assignment` | Assigned creator | Returns the packet context and temporary input capabilities. |
| `nitrate_submit_return_from_url` | Assigned creator | Safely imports one idempotently identified Higgsfield asset from an approved source URL into R2. |
| `nitrate_review_return` | Owning lead | Records a decision on an exact immutable return. |

The remote transport does not expose login, invite acceptance, packet creation, or arbitrary R2 access. The CLI and self-contained Codex/Claude Code stdio MCP servers remain the portable local-agent path.

### Remote media capabilities

`nitrate_pull_assignment` issues signed, short-lived asset URLs for inputs rather than embedding media bytes in an MCP result. The capability encodes the asset and connection context, cannot outlive the connection, and is checked again for expiry, revocation, `assets:read`, membership, and packet access when it is redeemed. It never contains a bearer token or user-facing personal data.

`nitrate_submit_return_from_url` requires a stable `externalAssetId` for each Higgsfield asset. Before the Worker downloads the source URL, it verifies creator ownership, pulled assignment state, safe filename/output path, optional parent return, and that no conflicting import or pending return exists. A repeated call for a completed matching import returns that immutable result; a collision with different work is rejected. The Worker accepts only an HTTPS URL whose origin exactly matches `NITRATE_MCP_IMPORT_ORIGINS`, rejects redirects, credentials, unsafe document types, missing/invalid content length, oversized files, and failures to stream, hash, and persist the asset in R2.

Each import holds a 30-minute lease. If a Worker is interrupted, a retry claims an expired lease atomically before cleaning and reusing the deterministic staging location. The D1 record keeps the staging key and any cleanup error; metadata is not deleted when R2 deletion fails. A production deployment still needs an R2 lifecycle policy and reconciliation process for repeatedly failed `mcp-staging/` cleanup.

This endpoint is standards-compliant and can be used from Higgsfield Supercomputer where a custom remote MCP with static bearer credentials is supported and enabled. Nitrate does not claim a vendor-specific OAuth flow or native connection UI.

### Required production configuration

- `NITRATE_BOOTSTRAP_SECRET` is mandatory for the lead bootstrap endpoint. The CLI sends the matching agency setup code only in the login request and never persists it.
- `NITRATE_MCP_ASSET_SIGNING_KEY` signs remote MCP asset capabilities.
- `NITRATE_MCP_IMPORT_ORIGINS` is a comma-separated exact-origin HTTPS allowlist for remote return imports.

These belong in deployment-managed Worker configuration. They must not be committed, shown in packet data, or placed in a creator prompt. R2 lifecycle and reconciliation for `mcp-staging/` remain operational controls for failures recorded in D1.

## Hardening before public production

- verified external identity and session expiry/rotation;
- durable agency membership and auditable invitations;
- rate limits, idempotency keys, replay protection, and upload expiry;
- malware scanning, content moderation policy, and safe media previews;
- R2 object lifecycle and abandoned-reservation cleanup;
- logs, traces, metrics, alerting, and activation funnels without leaking prompts or media;
- backup/restore drills and data deletion/export workflows;
- privacy, terms, retention, and client-IP/licensing review.
