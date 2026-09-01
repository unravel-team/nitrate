# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

The working prototype uses dependency-free Node.js HTTP APIs plus static HTML/CSS/JavaScript so it runs immediately without account or cloud credentials. The production architecture targets Cloudflare Workers, D1 for transactional metadata, R2 for media objects, Queues for async sync/derivative work, and an OpenAPI-described SDK.

## Users

Primary users are agency owners, producers, creative directors, and AI creators at AI video agencies. These teams create client video work across Claude, Claude Code, Runway, Higgsfield Supercomputer, Fal, Replicate, and custom AI workflows.

Secondary users are clients, agency reviewers, GTM teams, and automated workflows that need controlled access to returned work.

## Product Purpose

nitrate is a plugin-first collaboration layer for AI video agencies. The creator entry point is the plugin: it asks the creator to log in, pulls assigned project work into their AI workspace, and returns finished work for review. Team leaders use the command center to define briefs, input references, constraints, creator assignments, and expected output folders.

## Positioning

nitrate is the collaboration layer for AI video agencies and a DAM for the work their AI agents are still making. Traditional DAMs organize approved assets after production; nitrate starts before the final file exists by making the brief, creator assignment, expected return, prompt, notes, and review decision part of one project. It does not replace Claude, Claude Code, Runway, Higgsfield Supercomputer, Fal, Replicate, or custom creator workflows. It coordinates the work around them.

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
- Voice: direct, agency-first, visual, practical, and operational.
- Primary buyer: AI video agency founders, producers, and production leads.
- Hero message: “Set the brief. Assign the team. Review every result in one place.”
- Supporting role: “Nitrate gives your AI video agency one collaboration workflow.”
- Category bridge: “A DAM for the work your AI agents are still making.”
- Workflow framing: start from the founder’s real handoff—brief in Notion, feedback in Slack, videos in Drive, and creators in separate AI tools—then show one project staying intact through review.
- Avoid engineer-only terms in buyer-facing copy. Do not lead with clankers, SHA, repositories, commits, packets, or provenance when talking to agency buyers.

## Product Principles

1. The lead owns the packet.
2. Creators start from the clanker plugin.
3. Output structure is part of the assignment, not a cleanup task.
4. Returned work must arrive with enough context to review.
5. Review decisions should attach to the exact returned work.
6. The next brief should start from what the team already learned.

## Accessibility & Inclusion

Target WCAG 2.2 AA for the web product: keyboard-reachable review actions, visible focus, meaningful alternatives for media, reduced-motion support, readable contrast, and plain-language status labels alongside icons.
