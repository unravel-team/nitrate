# nitrate

nitrate is a clanker plugin and collaboration layer for AI media teams. Creators log in from the plugin, receive assigned brief packets inside their clanker, and sync finished work back for lead review.

## Quick start

Requires Node 20 or newer.

```sh
npm start
```

Open [http://127.0.0.1:4173](http://127.0.0.1:4173) for the landing page. Open `/plugin` for the clanker plugin, `/app` for the lead command center, `/use/` for use cases, and `/press` for the press kit.

The first run creates a demo packet with four clanker assignments, a simulated plugin login flow, and six returned media items. Existing local demo data from the old prototype is automatically reseeded to the nitrate model.

Data lives in `.reel-data` by default for compatibility with the previous prototype. Set `REEL_DATA_DIR` to use another directory and `PORT` to change the port.

## Cloudflare backend

The deployable backend is in [`worker/index.mjs`](worker/index.mjs). It uses:

- Cloudflare Workers for the API.
- D1 for users, plugin sessions, packets, assignments, returns, and comments.
- R2 for input assets and returned media.

Create the resources:

```sh
wrangler d1 create nitrate
wrangler r2 bucket create nitrate-media
```

Put the returned D1 `database_id` into [`wrangler.jsonc`](wrangler.jsonc), then run:

```sh
npm run db:migrate:remote
npm run worker:deploy
```

For local Worker development:

```sh
npm run db:migrate:local
npm run worker:dev
```

## Product flow

1. **Log in from the plugin.** The creator opens the nitrate clanker plugin and signs in.
2. **Create the packet.** The lead defines the brief, input assets, references, expected output folders, and project template.
3. **Pull into clankers.** Each AI creator gets the same production context in their own Claude, Claude Code, Higgsfield Supercomputer, or local clanker workflow.
4. **Return work.** Creators submit media with prompt, tool/model, seed, workflow, notes, and assignment context.
5. **Review.** The lead filters the return queue, compares options, leaves notes, approves, rejects, or requests changes.
6. **Send the next pass.** Any return can become the starting point for another pass.
7. **Share.** Create a local tokenized view for one return or a project.

Keyboard shortcuts in the app: `J` and `K` move through the filtered queue, `A` approves, `R` rejects, `C` requests changes, `I` opens return upload, and `Esc` closes the current surface.

## API

The local API is intended for agents and integrations. See [`docs/openapi.yaml`](docs/openapi.yaml).

Plugin login:

```sh
curl -X POST http://127.0.0.1:4173/api/plugin/login \
  -H 'Content-Type: application/json' \
  -d '{"role":"member","name":"Nia Patel","email":"nia@studio.test","clanker":"nia-clanker","surface":"Claude"}'
```

Pull assigned packets:

```sh
curl 'http://127.0.0.1:4173/api/plugin/packets?token=PLUGIN_TOKEN'
```

## Open-source CLI

The CLI entry point is [`bin/nitrate.mjs`](bin/nitrate.mjs). This is the main plugin surface: agents and creators ask what is next, pull packets into a local clanker workspace, update status, and sync returned media.

Leader:

```sh
nitrate login --api https://nitrate.example.workers.dev --role leader --name "Maya Chen" --email maya@studio.test --clanker maya-lead --surface "Claude Code"
nitrate next
nitrate init-agency --name "Launch Film Packet" --client "Northwind" --brief "Create a 30-second launch-film direction" --input bottle_macro.mov --folder /renders --folder /prompts --folder /notes --folder /handoff --creator "Jonas Reyes|jonas@studio.test|jonas-clanker|Explore the human performance beat before reveal."
```

Team member:

```sh
nitrate login --api https://nitrate.example.workers.dev --role member --name "Jonas Reyes" --email jonas@studio.test --clanker jonas-clanker --surface "Claude Code"
nitrate next
nitrate pull --dir ./launch-film
nitrate status --status working --dir ./launch-film
nitrate sync --dir ./launch-film --file ./launch-film/renders/jonas-v1.mp4 --name "Jonas v1" --made-with "Higgsfield Supercomputer" --prompt "Prompt used for the return"
```

Use `NITRATE_CONFIG_FILE=/path/to/profile.json` when testing multiple plugin users on one machine.

## Codex and Claude Code plugins

- Codex plugin wrapper: [`plugins/nitrate`](plugins/nitrate)
- Claude Code setup: [`plugins/claude-code/README.md`](plugins/claude-code/README.md)
- Shared MCP server: [`mcp/server.mjs`](mcp/server.mjs)

Both wrappers use the same CLI login state in `~/.nitrate/config.json`, and the same Worker API.

Submit a returned file:

```sh
curl -X POST http://127.0.0.1:4173/api/uploads \
  -H 'X-Reel-User: Maya Chen' \
  -F projectId=proj_launch_film \
  -F 'assetName=Maya hero opening' \
  -F 'prompt=Use the packet inputs and return /renders, /stills, /prompts, /notes, /handoff' \
  -F 'model=Claude Code + Higgsfield Supercomputer' \
  -F seed=184320 \
  -F 'branch=Launch' \
  -F 'file=@return.mov'
```

Approve it:

```sh
curl -X PATCH http://127.0.0.1:4173/api/versions/VERSION_ID \
  -H 'Content-Type: application/json' \
  -H 'X-Reel-User: Maya Chen' \
  -d '{"action":"approve","note":"Lead selected this return for client review."}'
```

## How it works

- Media bytes are hashed with SHA-256 and stored under `REEL_DATA_DIR/blobs/`.
- `REEL_DATA_DIR/db.json` stores projects, assets, returned versions, metadata, comments, decisions, shares, templates, assignments, and activity.
- Identical bytes are stored once, while logical returns remain independent.
- Writes serialize through a repository lock and replace the JSON manifest atomically.
- The UI consumes the same domain objects exposed by the API.

The production target keeps these contracts while moving storage and metadata to managed services: Cloudflare Workers for the API, D1 for transactional metadata, R2 for media objects, and Queues for direct clanker sync, thumbnails, filmstrips, waveforms, transcription, and audit jobs.

## Prototype boundaries

This is not a production deployment:

- Direct clanker sync is represented by plugin login, assignments, and file-based returns.
- Identity is represented by a demo user switcher, not authentication.
- Share tokens are local review links, not Internet-safe authorization.
- There is no multi-tenant isolation, malware scanning, signed URL expiry, rate limiting, observability, or backup orchestration.
- C2PA and EU AI Act reporting are roadmap goals, not certifications.

## Tests

```sh
npm test
```

The integration suite verifies seeded packet state, required prompt/model context, byte deduplication, decisions, comments, shares, project creation, waitlist capture, product routes, and immutable media delivery.
