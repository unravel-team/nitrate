# nitrate press kit

_Private-preview fact sheet. Last updated September 4, 2026._

## One-line description

nitrate is the collaboration layer for AI video agencies: one campaign brief goes out to every creator's AI workspace, and every finished file comes back to one review queue with its context intact.

## Launch facts

- **Status:** Private design-partner preview.
- **Primary users:** AI video agency founders, production leads, creative directors, and AI creators.
- **Works with:** Codex, Higgsfield Supercomputer, and Claude Code.
- **Integration status:** Codex and Claude Code use self-contained Nitrate plugins. Higgsfield Supercomputer can connect to Nitrate's remote MCP with a separate, scoped credential that expires and can be revoked without logging the creator out elsewhere.
- **Entry point:** AI coding agent plugin login.
- **MVP:** An open-source CLI, Codex and Claude Code plugins, a remote MCP for compatible workspaces, and a lead review surface. The verified workflow includes real input files, one-time creator invites, required output folders, returned media, and review decisions.
- **Use-case framing:** "Generating understanding" means turning scattered AI creation into shared direction, clean returns, and reviewable decisions.
- **Production architecture:** Cloudflare Workers for the API and MCP surface, D1 for project records, and R2 for media files.
- **Pricing:** Not announced.
- **Funding:** Not announced.
- **Compliance:** C2PA inspection/export and EU AI Act-oriented reporting are roadmap objectives, not certifications or legal assurances.

## Problem

Everyone on the team can create AI video now, but they are not working from the same project. The brief is in one tool, brand assets in another, creator work in separate agent sessions, and finished media in download folders. Leads repeat direction, creators miss required inputs, and returned videos lose the prompt, assignment, and review context needed to decide.

## Product approach

nitrate starts with the lead's packet: campaign brief, brand inputs, references, constraints, assignments, review criteria, and expected folders. The same project is delivered to each creator's Codex, Claude Code, or Higgsfield Supercomputer workspace. Creators make the work in their preferred tools and return finished media, prompts, notes, and handoff files to one reviewable project.

For Higgsfield Supercomputer, Nitrate exposes a small remote MCP toolset: identify the connected creator, list assigned work, pull a packet with secure input links, and bring a completed Higgsfield asset back by URL. Each connection receives a one-time credential with the minimum role-appropriate permissions; it expires and can be revoked independently.

## Quote

> "AI video creation became individual. nitrate makes it collaborative again: one campaign brief goes out, every creator's work comes back with context."
>
> - nitrate founding team

## Boilerplate

**About nitrate**

nitrate is the collaboration layer and working DAM for an AI video agency's agents. A lead packages the campaign once; creators receive the same brief and source files inside Codex, Higgsfield Supercomputer, or Claude Code; and every result returns with enough context to review. nitrate is onboarding design partners from AI video agencies and AI-native creative studios.

## Media contact

hello@nitrate.media

## Usage notes

Do not imply announced customers, revenue, funding, pricing, legal clearance, insurance, a native vendor partnership, or regulatory certification. Higgsfield Supercomputer connectivity uses the open MCP interface. Do not present roadmap items as shipped features.
