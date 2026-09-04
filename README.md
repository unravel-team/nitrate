# nitrate

Nitrate gives AI video agencies one collaboration loop from brief to approved work.

A production lead sends the brief, real source files, required folders, and review criteria as one handoff. Each creator pulls that handoff into Codex or Claude Code, makes the work with tools such as Higgsfield Supercomputer or Runway, and returns the finished media with its prompt and notes. The lead reviews the exact returned file.

Think of it as a DAM for work that your AI tools are still making: the shared context starts before the final asset exists.

## The five-step workflow

```text
LEAD                              CREATOR                         LEAD

login → handoff ── one-time invite ──→ pull → make → return ──→ review
          brief + real inputs       verified local workspace       file + prompt
          folders + criteria                                      + tool + notes
```

1. **Login.** The agency lead signs in from the Nitrate CLI or plugin.
2. **Handoff.** The lead chooses a brief file, adds real input files, defines the required output folders and review criteria, and assigns a creator. Nitrate uploads the bytes before it creates a one-time invite.
3. **Pull.** The creator gives that invite to Nitrate inside Codex or Claude Code. Nitrate signs the creator in, downloads every input, verifies its SHA-256 digest and size, creates the required folders, writes the brief, and records a pull receipt.
4. **Return.** The creator or their agent returns a real image, video, or audio file from the pulled workspace. The return includes the prompt, the tool used, notes, and its expected relative path.
5. **Review.** The lead approves, requests changes, rejects, or reopens the exact returned file. That decision closes the first collaboration loop.

The creator stays in their own tools. Nitrate carries the production context between people.

## Run locally

Requires Node.js 20 or newer.

```sh
npm install
npm start
```

The local API and product site run at [http://127.0.0.1:4173](http://127.0.0.1:4173). The first run creates demo media-team data in `.reel-data`. To test a clean workspace, set a separate data directory:

```sh
REEL_DATA_DIR=/tmp/nitrate-local npm start
```

Useful product routes:

- `/` — landing page
- `/app` — lead command center
- `/plugin` — plugin story
- `/for/` — agent landing-page hub
- `/for/codex/` — Codex five-minute handoff story
- `/for/claude-code/` — Claude Code five-minute handoff story
- `/for/claude-desktop/` — Claude Desktop private-preview story
- `/for/higgsfield-supercomputer/` — Higgsfield Supercomputer connector-pilot story
- `/use/` — use cases
- `/press` — press kit
- `/healthz` — service health

## Complete the loop from the CLI

The executable is `nitrate`. During repository development, use `node bin/nitrate.mjs` in place of `nitrate`, or install/link the package locally.

Use a separate config file for each person when testing two users on one machine:

```sh
export NITRATE_CONFIG_FILE=/tmp/nitrate-lead.json
```

### 1. Lead login

```sh
nitrate login \
  --api http://127.0.0.1:4173 \
  --email maya@northstar.studio \
  --name "Maya Chen" \
  --agent "Maya's Codex" \
  --surface Codex
```

The local reference service accepts this login directly. A production deployment also asks the first agency lead for its workspace setup code:

```sh
nitrate login --api https://YOUR_NITRATE_HOST --email maya@northstar.studio --setup-code "$NITRATE_SETUP_CODE"
```

The CLI sends that code only with the login request and never saves it. Creators do not need the setup code, choose a role, or create an unrelated account; they join through the handoff invite.

### 2. Lead handoff

```sh
nitrate handoff \
  --name "Northwind summer social" \
  --client Northwind \
  --brief "Create three 9:16 launch concepts from the supplied brand system." \
  --input ./campaign/brief.md \
  --input ./campaign/brand-guide.pdf \
  --input ./campaign/product-shot.png \
  --folder renders \
  --folder prompts \
  --folder notes \
  --review "Logo stays readable" \
  --review "Safe for 9:16 crop" \
  --creator "Nia Patel|nia@northstar.studio|Nia's Claude|Create three 9:16 concepts"
```

The command prints a one-time invite URL. Send that URL only to the assigned creator. `--json` returns the machine-readable packet, assignment, input-upload, and invite records.

### 3. Creator pull

```sh
export NITRATE_CONFIG_FILE=/tmp/nitrate-nia.json

nitrate pull 'http://127.0.0.1:4173/join/ONE_TIME_TOKEN' \
  --dir ./northwind-social \
  --name "Nia Patel" \
  --agent "Nia's Claude" \
  --surface "Claude Code"
```

The invite is accepted once. Pull refuses an unsafe path or a non-empty destination, downloads real inputs to the workspace, verifies every byte, and stores an assignment receipt under `.nitrate/`.

### 4. Creator return

After making the media, return it from anywhere inside the pulled workspace:

```sh
cd northwind-social

nitrate return \
  --file renders/northwind-vertical-v1.mp4 \
  --made-with "Higgsfield Supercomputer" \
  --prompt "Bright summer product reveal, vertical composition, preserve the wordmark" \
  --notes "Kept the logo inside the 9:16 safe area."
```

Nitrate reserves the return metadata first and then uploads the raw bytes. It rejects empty media, a checksum or size mismatch, a missing prompt/tool, and files outside the packet's required output structure.

### 5. Lead review

```sh
export NITRATE_CONFIG_FILE=/tmp/nitrate-lead.json

nitrate packets --json
nitrate review RETURN_ID --decision approve \
  --note "On brief and ready for client review."
```

Valid decisions are `approve`, `request_changes`, `reject`, and `reopen`.

Compatibility aliases may remain available while the CLI evolves, but the supported activation path is `login → handoff → pull → return → review`.

## Packet data

A packet is plain data plus immutable input files. The API returns the packet and its inputs together:

```json
{
  "project": {
    "id": "proj_123",
    "name": "Northwind summer social",
    "client": "Northwind",
    "brief": "Create three 9:16 launch concepts.",
    "outputStructure": ["renders", "prompts", "notes"],
    "reviewCriteria": ["Logo stays readable", "Safe for 9:16 crop"],
    "inputs": [
      {
        "id": "input_123",
        "filename": "brand-guide.pdf",
        "mime": "application/pdf",
        "size": 482103,
        "hash": "<64-character-sha256>",
        "downloadPath": "/api/plugin/inputs/input_123/raw"
      }
    ]
  },
  "assignments": [
    {
      "id": "assign_123",
      "task": "Create three 9:16 concepts",
      "status": "delivered",
      "acceptedAt": null,
      "pulledAt": null,
      "returnedAt": null
    }
  ],
  "returns": [],
  "activation": {
    "uploadedInputCount": 1,
    "ahaReached": false,
    "closedLoop": false
  }
}
```

The creator sees only their assigned packet, files, task, expected folders, review criteria, and their returns. The lead sees their packets, every assignment and invite state, all returned work, review state, and activation milestones.

## Authentication and byte transfer

All workflow routes except lead login and one-time invite acceptance use:

```http
Authorization: Bearer <plugin-session-token>
```

Inputs and returns use a two-phase transfer:

1. Send JSON metadata containing `filename`, MIME type, byte `size`, and `sha256` to reserve an object.
2. `PUT` the raw file bytes to the returned `uploadPath` with the same bearer token.

The service verifies size and checksum before making the object available. A return becomes visible only after the byte upload succeeds. See [docs/openapi.yaml](docs/openapi.yaml) for the full contract.

| Workflow action | Method and route | Who |
| --- | --- | --- |
| Lead login | `POST /api/plugin/login` | Lead |
| Accept invite | `POST /api/plugin/invites/:token/accept` | Assigned creator |
| Create packet | `POST /api/packets` | Lead |
| Reserve input | `POST /api/plugin/packets/:packetId/inputs` | Lead |
| Upload/download input | `PUT` / `GET /api/plugin/inputs/:inputId/raw` | Lead / packet member |
| Create assignments and invites | `POST /api/plugin/push` | Lead |
| Read inbox | `GET /api/plugin/packets` | Lead or creator, scoped |
| Mark pull/work state | `PATCH /api/plugin/assignments/:assignmentId` | Assigned creator |
| Reserve return | `POST /api/plugin/assignments/:assignmentId/returns` | Assigned creator |
| Upload return | `PUT /api/plugin/returns/:returnId/raw` | Assigned creator |
| Review return | `PATCH /api/plugin/returns/:returnId` | Lead |

## Codex plugin

The self-contained Codex bundle lives in `plugins/nitrate`, with a repository marketplace at `.agents/plugins/marketplace.json`.

From this repository:

```sh
codex plugin marketplace add "$(pwd)"
codex plugin add nitrate@nitrate-local
codex plugin list
```

Start a new Codex thread after installation. Then ask naturally:

- “Package this brief and send it to Nia.”
- “Pull my Nitrate assignment into this workspace.”
- “Return this draft to the campaign lead.”
- “Show me the work waiting for review.”

## Remote MCP for production workspaces

Nitrate exposes a standards-compliant, remote Streamable HTTP MCP endpoint. It never uses the normal plugin or CLI session as a remote credential. Instead, create a dedicated, independently revocable connection:

```sh
nitrate mcp:connect --name "Higgsfield Supercomputer" --days 7
```

The command prints the only two values a compatible static-bearer connector needs:

```text
Endpoint: https://YOUR_NITRATE_HOST/mcp
Authorization (shown once): Bearer nmc_…
```

```http
POST https://YOUR_NITRATE_HOST/mcp
Authorization: Bearer nmc_…
```

`nmc_…` is shown exactly once and is never saved in the Nitrate CLI configuration. Keep it in the connector's secret store; do not put it in a brief, chat, ticket, or committed configuration. The default lifetime is seven days and the CLI permits up to 30 days. Manage connections with:

```sh
nitrate mcp:list
nitrate mcp:disconnect CONNECTION_ID
```

The connection token works only at `/mcp`; ordinary Nitrate REST routes reject it. Conversely, `/mcp` rejects normal plugin-session tokens. This lets a creator or lead remove a remote connection without signing out their local Codex or Claude Code plugin.

It is ready to connect from a production workspace wherever custom remote MCP servers are supported. That includes a Higgsfield Supercomputer workflow when that workspace has custom remote MCP enabled; Nitrate does not assume or document a specific Higgsfield connection screen, OAuth flow, or native connector UI.

The remote endpoint keeps the same role boundaries as the CLI and local plugins:

- `nitrate_whoami` — confirm the signed-in Nitrate identity.
- `nitrate_list_work` — show the caller's scoped work.
- `nitrate_pull_assignment` — creator-only; retrieve the brief, task, output structure, review criteria, and signed input links.
- `nitrate_submit_return_from_url` — creator-only; bring a finished asset from an approved HTTPS source URL into the assignment.
- `nitrate_review_return` — lead-only; approve, request changes, reject, or reopen a returned asset.

Each connection receives only the role-appropriate scopes. A creator can be granted identity/work/assets plus assignment pull and return submission; a lead can be granted identity/work/assets plus return review. A deliberately narrowed connection exposes only the matching MCP tools.

Input links are short-lived signed permissions, not public URLs. Each link is bound to the connection, expires no later than that connection, and rechecks that the connection is unrevoked, unexpired, has `assets:read`, and still has access to the packet when opened.

For `nitrate_submit_return_from_url`, the creator supplies a stable Higgsfield `externalAssetId`. Nitrate preflights the assignment, output path, and optional parent return before it downloads anything; the external ID makes a completed import retry-safe and prevents attaching the same provider asset to different work. The Worker then fetches only an exact allowlisted HTTPS origin, without credentials or redirects, and streams verified media into R2. Cleanup after a failure is best-effort, so production operations must expire and reconcile the `mcp-staging/` R2 prefix. The local Codex and Claude Code plugins remain available as self-contained stdio MCP bundles; remote MCP is an additional surface, not a replacement.

## Claude Code plugin

The self-contained Claude Code bundle lives in `plugins/claude-code`, with a repository marketplace at `.claude-plugin/marketplace.json`.

```sh
claude plugin marketplace add . --scope local
claude plugin install nitrate@nitrate-local --scope local
claude plugin list
```

Restart Claude Code after installation. Codex and Claude Code use the same Nitrate API and local login state. Each bundle contains its own MCP runtime, so a marketplace cache does not depend on files outside the installed plugin directory.

## Activation

Nitrate records two honest milestones:

- **Aha reached:** the lead uploaded at least one real input file and a creator pulled that packet. This proves that shared production context moved intact to a different creator.
- **Closed loop:** aha is reached, the creator uploaded a real returned media file, and the lead recorded a review decision. A manual status change cannot fake this milestone.

## Verification

```sh
npm test
npm pack --dry-run --json
node scripts/build-plugin-bundles.mjs
node scripts/verify-plugins.mjs
claude plugin validate plugins/claude-code
```

The end-to-end suite uses isolated lead and creator config files and verifies real input bytes, one-time invite acceptance, safe workspace creation, checksums, a real return upload, authorization boundaries, a leader decision, and both activation milestones.

## Cloudflare backend

The production-shaped backend in `worker/index.mjs` uses a Cloudflare Worker for the API, D1 for packet and workflow records, and R2 for packet inputs and returned media. Migrations live in `migrations/`.

For local Worker verification only, use the repository's test scripts or `npm run worker:dev` after applying migrations to a local D1 simulation. Production deployment is owned by GitHub Actions. Do not deploy this project with local Wrangler, and always confirm the target Cloudflare account before enabling or running any deployment workflow.

No Cloudflare deployment was performed as part of this implementation.

### Production Worker configuration

Set these values as Worker secrets or environment configuration in the deployment system—never in the repository or an agent prompt:

| Name | Purpose |
| --- | --- |
| `NITRATE_BOOTSTRAP_SECRET` | Protects the initial lead-session bootstrap flow; give its value to the agency lead as their workspace setup code. |
| `NITRATE_MCP_ASSET_SIGNING_KEY` | Signs the short-lived, permission-rechecked media links issued by remote MCP. |
| `NITRATE_MCP_IMPORT_ORIGINS` | Comma-separated exact HTTPS origins from which remote MCP may import a creator's finished asset. |

The Worker fails closed when `NITRATE_BOOTSTRAP_SECRET` is absent. The CLI accepts the matching value through `--setup-code` or `NITRATE_SETUP_CODE`, sends it as a protected request header, and does not persist it.

`NITRATE_MCP_IMPORT_ORIGINS` should contain only storage or generation domains the agency trusts. It is an allowlist, not a wildcard convenience setting. Imports use a 30-minute lease so an interrupted request can be reclaimed safely. Configure an R2 lifecycle rule and a reconciliation job for repeatedly failed `mcp-staging/` cleanup; the D1 import record retains the staging key and cleanup error for that purpose.

## Prototype boundaries

The local Node service is for product and contract verification. Its lead login is a bootstrap flow, not production identity. Before a public launch, add external identity/OIDC, durable tenant membership, token expiry and rotation, upload rate limits, malware scanning, object lifecycle policies, observability, and backup/restore drills. Local demo share links are not Internet-safe authorization. C2PA and regulatory reporting remain roadmap goals, not certifications.
