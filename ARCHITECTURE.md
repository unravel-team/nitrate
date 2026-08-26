# Architecture

## Prototype

`npm start` runs a dependency-free Node 20 server. State is stored atomically in `REEL_DATA_DIR/db.json`; media bytes are content-addressed under `REEL_DATA_DIR/blobs/`. The default data directory remains `.reel-data` for compatibility with the previous prototype.

The prototype proves the nitrate loop end to end:

1. Simulate the clanker plugin login as the creator entry point.
2. Create a brief packet with input assets and expected output folders.
3. Represent creator clankers as assignments on the project.
4. Submit returned media with prompt, tool/model, seed, workflow, notes, and assignment context.
5. Hash bytes with SHA-256 and deduplicate storage while preserving every logical return.
6. Link child returns to parents for next-pass continuity.
7. Move returns through review, capture comments and decisions, and preserve actor/time.
8. Issue tokenized local shares and audit activity.

Routes:

- `/` marketing site
- `/app` operator application
- `/plugin` clanker plugin
- `/use/` use-case narrative
- `/press` press kit
- `/api/state` workspace snapshot
- `POST /api/plugin/login`
- `GET /api/plugin/packets`
- `POST /api/plugin/push`
- `PATCH /api/plugin/assignments/:id`
- `POST /api/projects`
- `POST /api/uploads`
- `PATCH /api/versions/:id`
- `POST /api/shares`
- `GET /api/shared/:token`
- `POST /api/waitlist`
- `GET /healthz`

Uploads use multipart/form-data and are limited to 100 MiB. Role switching is explicitly a demo control, not authentication.

## Production target

The same contracts move to managed infrastructure without changing the domain model:

- **Cloudflare Workers:** API edge, plugin login callback, request validation, and integration endpoints.
- **D1:** teams, projects, packets, assignments, assets, returns, comments, decisions, memberships, and share grants.
- **R2:** immutable media objects and packet input assets.
- **Queues:** clanker dispatch jobs, return ingestion, thumbnails, filmstrips, waveforms, transcription, and C2PA inspection.
- **Durable Objects (optional):** collaborative review presence, optimistic comments, and live packet status.
- **OpenAPI + SDK:** plugin-facing packet/return APIs for Claude Code and local clanker clients.

Production hardening remains outside this local MVP: real identity/OIDC, signed URLs, per-tenant authorization, object lifecycle policies, malware scanning, key rotation, observability, backup/restore drills, and legal review of compliance claims.
