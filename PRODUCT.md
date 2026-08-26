# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

The working prototype uses dependency-free Node.js HTTP APIs plus static HTML/CSS/JavaScript so it runs immediately without account or cloud credentials. The production architecture targets Cloudflare Workers, D1 for transactional metadata, R2 for media objects, Queues for async sync/derivative work, and an OpenAPI-described SDK.

## Users

Primary users are team leads, producers, creative directors, and AI creators on media teams. These teams create image, video, and audio work in Claude, Claude Code, Higgsfield Supercomputer, and local AI workspaces called clankers.

Secondary users are clients, agency reviewers, GTM teams, and automated workflows that need controlled access to returned work.

## Product Purpose

nitrate is a clanker plugin and collaboration layer for AI media teams. The creator entry point is the plugin: it asks the creator to log in, pulls assigned packets into the clanker, and syncs finished work back. Team leaders use the command center to define brief packets, input assets, references, constraints, creator assignments, and expected output folders.

## Positioning

nitrate is the missing plugin, shared drive, and command center for AI creators. Shared drives store files after the fact; nitrate starts inside the clanker before generation by asking the creator to log in, pulling the team packet, and making the brief, inputs, folder contract, and return path explicit. It does not replace Claude, Claude Code, Higgsfield Supercomputer, or local creator workflows. It coordinates them.

## Operating Context

- Everyone on a media team can create with AI, but work is fragmented across personal chats, local folders, and individual tool histories.
- Team leads need to dictate how a brief is worked upon, not merely collect files after the fact.
- Creators need the same inputs and structure without abandoning their own clanker.
- Returned work must include media, prompts, notes, creator identity, assignment context, and review status.
- Clients and reviewers need controlled links to selected work, not the whole production mess.

## Capabilities and Constraints

Confirmed for the MVP:

- Brief packets with project brief, input assets, expected output structure, and templates.
- Seeded clanker assignments for AI creators.
- Plugin login surface that represents the creator's primary entry point.
- File-based returns from Claude, Claude Code, Higgsfield Supercomputer, and other media tools.
- Review queue, comparison, comments, approvals, rejections, change requests, and share links.
- Returned media stored with prompt, model/tool, seed, workflow, creator, assignment, and parent-return context.
- `/use/` narrative organized around "Generating understanding."

Prototype boundaries:

- Direct clanker sync is represented by plugin login, assignments, and file returns, not live filesystem agents yet.
- Authentication is represented by role switching, not production identity.
- Share tokens are local demo links, not Internet-safe authorization.
- Compliance reporting, C2PA inspection, and product integrations are roadmap items.

## Brand Commitments

- Product name: nitrate.
- Working contact: hello@nitrate.media.
- Voice: direct, media-team-first, practical, and operational.
- Avoid engineer-only terms in buyer-facing copy. Do not lead with SHA, repositories, commits, or provenance when talking to media teams.

## Product Principles

1. The lead owns the packet.
2. Creators start from the clanker plugin.
3. Output structure is part of the assignment, not a cleanup task.
4. Returned work must arrive with enough context to review.
5. Review decisions should attach to the exact returned work.
6. The next brief should start from what the team already learned.

## Accessibility & Inclusion

Target WCAG 2.2 AA for the web product: keyboard-reachable review actions, visible focus, meaningful alternatives for media, reduced-motion support, readable contrast, and plain-language status labels alongside icons.
