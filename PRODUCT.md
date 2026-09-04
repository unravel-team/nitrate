# Product

<!-- impeccable:product-schema 1 -->

## Product purpose

Nitrate gives AI video agencies one collaboration workflow for work made across different AI tools.

Today, a lead sends a brief in Notion or Slack, source files through Drive, feedback in chat, and folder instructions in another message. Creators make work in separate Codex, Claude Code, Higgsfield Supercomputer, Runway, Fal, Replicate, and local workflows. The lead gets videos back without knowing which brief, source file, prompt, or required handoff each one followed.

Nitrate keeps that handoff intact:

> The lead sends the brief and real inputs once. Each creator pulls the same production context into their own agent. Finished media returns to the lead with the context required to review it.

## Audience

The primary buyer is an AI video agency founder, executive producer, creative director, or production lead. The primary daily user is an AI creator working through Codex, Claude Code, or another AI-enabled production workspace. Clients and account teams are downstream reviewers, not the first activation audience.

## Positioning

Nitrate is the collaboration layer for AI video agencies and a DAM for work that AI tools are still making.

Traditional DAMs organize files after they are approved. Nitrate begins at the handoff, before the final file exists, and preserves:

- what the client asked for;
- which real source files were supplied;
- which creator owns the work;
- where outputs, prompts, and notes must go;
- what the lead will review against;
- which exact returned file received a decision.

It coordinates the work around media-generation tools; it does not replace them.

## Golden path

The complete first-use story is `login → handoff → pull → return → review`.

### Lead: login and handoff

As an agency lead, I can sign in from the Nitrate plugin with my work email and agency workspace setup code, choose a written brief and real campaign assets, define required output folders and review criteria, assign one creator, and receive a one-time invite to send them. The setup code is used only for the first protected login request and is never saved by the CLI.

Success means the packet has at least one fully uploaded input, not merely a filename. Handoff should fail before an invite is created if no input bytes have been verified.

### Creator: pull

As an assigned creator, I can give the invite to Nitrate inside Codex or Claude Code. Nitrate signs me in, downloads every source file, verifies it, creates the agreed folder structure, writes the brief and task, and tells the lead that the handoff arrived.

Success means a different person has the same brief and verified inputs locally. The creator should not need to find files across Slack, Drive, or somebody else's agent history.

### Creator: return

As a creator, I can ask my agent to return the finished media from the pulled workspace. Nitrate includes the file, prompt, production tool, notes, assignment, and expected relative path, and verifies the raw upload before it changes the assignment to returned.

Success means the lead can open the actual output and understand how it was made. A status toggle without media never counts.

### Lead: review

As the lead, I can list returned work and approve, request changes, reject, or reopen the exact file with a note. Creators cannot make this decision for themselves.

Success means the first collaboration loop has a recorded decision and the next pass can begin from what the team learned.

## Activation and retention

The fastest aha moment is shared context arriving intact, not project setup.

- **Aha reached:** one real packet input has been uploaded and a creator has pulled the packet.
- **Closed loop:** aha is reached, a creator has uploaded real returned media, and the lead has recorded a decision.

Useful activation measures are time from lead login to invite, invite to verified pull, pull to first real return, and return to decision.

Retention comes from repeated production passes:

- start the next version from an approved or change-requested return;
- reuse packet structure and review criteria across a client account;
- keep prompt, tool, creator, and feedback attached to each returned asset;
- see what is waiting on a creator versus waiting on the lead;
- preserve the agency's production understanding instead of losing it in individual agent sessions.

## Product principles

1. The lead owns the brief, source files, return structure, and review criteria.
2. Creators enter through their assigned invite in the agent they already use.
3. Actual bytes matter; filenames and status changes cannot fake progress.
4. Pull must prove the creator received every source file intact.
5. Output structure is part of the assignment, not end-of-project cleanup.
6. A return is useful only when the media and enough context to review it arrive together.
7. Decisions attach to exact immutable work.
8. The next pass starts from what the team already learned.

## Language and brand

- Product name: Nitrate.
- Working contact: hello@nitrate.media.
- Voice: direct, agency-first, visual, practical, and operational.
- Hero message: “Set the brief. Assign the team. Review every result in one place.”
- Support: “Nitrate gives your AI video agency one collaboration workflow.”
- Category bridge: “A DAM for the work your AI tools are still making.”

Buyer-facing copy should say what is solved and what the user does. Do not lead with hashes, repositories, commits, packet schemas, MCP, or infrastructure. “Packet” is acceptable inside the product when it clearly means the complete handoff.

## Platform and integrations

The primary surface is the Codex or Claude Code plugin backed by the Nitrate API. A CLI provides the same workflow for automation and portability. The lead dashboard supports review and team visibility. For an AI production workspace that supports custom remote MCP, Nitrate can expose the same assigned-work and review loop directly in that workspace, including Higgsfield Supercomputer when custom remote MCP is available there. The connection is a separately scoped, expiring, revocable credential—not the creator's normal Nitrate session.

Nitrate works around Higgsfield Supercomputer, Runway, Fal, Replicate, and other production tools by moving files and context into and out of the creator's workspace. A creator can use those tools directly, or ask their AI coding agent to orchestrate them. The integration contract is the returned file plus prompt/tool/notes, not a claim that every vendor has a first-party API connection.

The remote MCP surface is deliberately small: it can identify the connected person, show their work, let an assigned creator pull a brief and secure input links, bring back a completed file from an agency-approved source, and let the lead decide. Each import needs the provider's stable asset ID so retrying cannot duplicate or misattach work. It does not turn Nitrate into a media-generation product or require a vendor-specific API integration. A compatible static-bearer MCP connector can use it; Nitrate does not currently claim a native Higgsfield UI or OAuth integration.

## Accessibility and trust

Target WCAG 2.2 AA: keyboard-reachable review actions, visible focus, meaningful media alternatives, reduced-motion support, readable contrast, and plain-language status text. One-time invites, scoped sessions, visible upload verification, explicit external-send confirmation, and auditable decisions should make consequential actions understandable.

## Current boundaries

The local service proves the workflow but does not provide production identity, complete tenant isolation, malware scanning, signed public shares, upload rate limiting, observability, or backup orchestration. C2PA and regulatory reporting are roadmap goals, not certifications. Production hardening must preserve the same simple user journey.
