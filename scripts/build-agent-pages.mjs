#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const publicRoot = path.join(root, 'public');

const arrow = `<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M5 12h13M13 6l6 6-6 6"/></svg>`;

const agents = [
  {
    slug: 'codex',
    name: 'Codex',
    shortName: 'Codex',
    state: 'Available now',
    stateClass: 'ready',
    nativeUi: 'terminal',
    logo: 'openai',
    title: 'Nitrate for Codex — shared AI video briefs inside Codex',
    description: 'Give Codex the exact AI video campaign brief, approved inputs, output structure, and review rules. Return finished creative work to the agency lead in context.',
    headline: 'Stop rebuilding the brief in every Codex session.',
    promise: 'Nitrate turns the creator’s current Codex workspace into the campaign workspace. The approved inputs, named deliverable, and review rules arrive together, ready to use.',
    creatorLabel: 'Nia / Codex',
    creatorAsk: 'Pull my Winter Sale assignment into this workspace.',
    agentReply: 'Hook A is ready: six approved inputs, a 9:16 output, and three review rules.',
    readyLine: 'Workspace ready · brief + 6 inputs received',
    transferProof: 'Six approved inputs verified in Nia’s workspace',
    leadProof: 'Nia pulled Hook A · 6 inputs verified',
    creatorProof: 'A ready-to-work folder with one unambiguous task',
    afterTitle: 'Codex stays useful after the handoff.',
    afterBody: 'The creator makes the variation with their preferred media tools, then asks Codex to return the selected file. Nitrate sends the render, prompt, production notes, and assignment back to the lead’s review queue.',
    returnPrompt: 'Return hook-a-v1.mp4 to Maya for review. Include the Higgsfield prompt and note that the approved end card is unchanged.',
    returnTool: 'Codex + Higgsfield',
    reviewAlt: 'Fictional Winter Sale frame of a futuristic vehicle above a coastal city',
    setupTitle: 'Two commands. Then speak normally.',
    setupBody: 'Add the Nitrate marketplace and install the self-contained plugin. It brings the handoff, pull, return, and review workflows into Codex without giving creators another project dashboard.',
    command: 'codex plugin marketplace add unravel-team/nitrate\ncodex plugin add nitrate@nitrate-local',
    setupLines: ['Add the Nitrate marketplace.', 'Install the Nitrate plugin.', 'Ask: “Pull my Nitrate assignment.”'],
    docsHref: 'https://developers.openai.com/codex/build-plugins',
    docsLabel: 'How Codex plugins work',
    pilotTitle: 'Run one live client handoff through Codex.',
    pilotBody: 'We’ll help your lead package a real brief, get it into one creator’s Codex workspace, and verify the first return together.',
    cta: 'Use Nitrate in Codex'
  },
  {
    slug: 'claude-code',
    name: 'Claude Code',
    shortName: 'Claude Code',
    state: 'Available now',
    stateClass: 'ready',
    nativeUi: 'terminal',
    logo: 'claude',
    title: 'Nitrate for Claude Code — AI video collaboration in Claude Code',
    description: 'Pull the campaign brief, approved media, output folders, and review rules into Claude Code. Return every finished creative to the agency lead with its context.',
    headline: 'Give Claude Code the campaign, not another Slack message.',
    promise: 'The Nitrate plugin gives Claude the exact work a creator was assigned. Approved references land beside the brief, expected folders, and the rules the lead will review against.',
    creatorLabel: 'Nia / Claude Code',
    creatorAsk: 'Pull my assigned Winter Sale creative.',
    agentReply: 'I found Hook A. I’ll create the requested folders and bring in all six approved references.',
    readyLine: 'Project ready · brief + 6 inputs received',
    transferProof: 'Six approved inputs verified in Nia’s project',
    leadProof: 'Nia pulled Hook A · 6 inputs verified',
    creatorProof: 'The complete campaign context inside the project already open',
    afterTitle: 'Claude returns the work to the same brief.',
    afterBody: 'When the draft is ready, the creator asks Claude Code to return it. Nitrate attaches the actual media, prompt, tool, notes, and expected path so the lead reviews the right file against the right instructions.',
    returnPrompt: 'Return this 9:16 cut as Hook A. Tell Maya the logo lockup and seven-word copy rule are both satisfied.',
    returnTool: 'Claude Code + Runway',
    reviewAlt: 'Fictional Winter Sale frame of a futuristic vehicle above a coastal city',
    setupTitle: 'Install once for the whole production loop.',
    setupBody: 'The Claude Code bundle is self-contained. Once enabled, the creator can accept a one-time invite, pull the working folder, and return media through ordinary language.',
    command: 'claude plugin marketplace add unravel-team/nitrate\nclaude plugin install nitrate@nitrate-local',
    setupLines: ['Add the Nitrate marketplace.', 'Install the Claude Code plugin.', 'Ask: “What Nitrate work is assigned to me?”'],
    docsHref: 'https://code.claude.com/docs/en/plugins-reference',
    docsLabel: 'How Claude Code plugins work',
    pilotTitle: 'Run one live client handoff through Claude Code.',
    pilotBody: 'We’ll package the actual campaign, invite one creator, and stay with your team until the first reviewable file comes back.',
    cta: 'Use Nitrate in Claude Code'
  },
  {
    slug: 'claude-desktop',
    name: 'Claude Desktop',
    shortName: 'Claude Desktop',
    state: 'Private preview',
    stateClass: 'preview',
    nativeUi: 'chat',
    logo: 'claude',
    title: 'Nitrate for Claude Desktop — shared AI video briefs in Claude',
    description: 'A chat-native Nitrate workflow for AI video teams: ask what is assigned, see the approved campaign context, and send completed creative work back for review.',
    headline: 'Give every creator the same brief without another dashboard.',
    promise: 'Nitrate for Claude Desktop is the chat-native path for creators who do not live in a terminal. They ask what is assigned and receive the exact brief, approved references, deliverable, and review checklist.',
    creatorLabel: 'Nia / Claude Desktop',
    creatorAsk: 'What am I making for the Winter Sale campaign?',
    agentReply: 'You own Hook A: a 9:16 product reveal using these six approved references. Keep copy under seven words.',
    readyLine: 'Assignment understood · approved references ready',
    transferProof: 'Six approved input links issued to Nia',
    leadProof: 'Nia pulled Hook A · receipt recorded',
    creatorProof: 'One conversation with the assignment and review checklist intact',
    afterTitle: 'The conversation becomes accountable production.',
    afterBody: 'In the private preview, a creator can bring back the selected output with its prompt and notes instead of leaving the result buried in chat. The lead receives a reviewable item tied to the original assignment.',
    returnPrompt: 'Send this selected cut back as Hook A and include the prompt I used.',
    returnTool: 'Claude Desktop preview',
    reviewAlt: 'Fictional Winter Sale frame of a figure in a warm transit hall',
    setupTitle: 'We are piloting the one-click Desktop path.',
    setupBody: 'Claude Desktop supports local extensions and remote MCP connectors. Nitrate’s Desktop workflow is in private preview while we finish the production authentication and one-click package. Join the pilot rather than configuring a developer connection.',
    command: '',
    setupLines: ['Join the Claude Desktop preview.', 'Connect with guided setup.', 'Run one real creator handoff with us.'],
    docsHref: 'https://support.anthropic.com/en/articles/10949351-getting-started-with-local-mcp-servers-on-claude-desktop',
    docsLabel: 'How Claude Desktop extensions work',
    pilotTitle: 'Bring your non-technical creators into the same production loop.',
    pilotBody: 'Join the Claude Desktop preview. We’ll set up one real campaign and use your feedback to finish the shortest possible creator experience.',
    cta: 'Join the Claude Desktop preview'
  },
  {
    slug: 'higgsfield-supercomputer',
    name: 'Higgsfield Supercomputer',
    shortName: 'Supercomputer',
    state: 'Connector pilot',
    stateClass: 'connector',
    nativeUi: 'chat',
    logo: 'higgsfield',
    title: 'Nitrate for Higgsfield Supercomputer — briefs in, reviewable work out',
    description: 'Pull the approved AI video campaign into Higgsfield Supercomputer, generate from the right references, and return the selected result to the agency lead for review.',
    headline: 'Make the assigned creative, not another random variation.',
    promise: 'Nitrate brings the campaign brief, approved references, named variation, and review rules into a compatible Supercomputer workflow. The creator starts from the agency’s intent, not an empty chat.',
    creatorLabel: 'Nia / Supercomputer',
    creatorAsk: 'Pull Hook A from Nitrate and make the 9:16 Winter Sale variation.',
    agentReply: 'Hook A has six approved references available. I’ll keep the end card and route the product reveal through the selected video model.',
    readyLine: 'Brief loaded · generation plan ready',
    transferProof: 'Six secure input links issued to Nia',
    leadProof: 'Nia pulled Hook A · receipt recorded',
    creatorProof: 'The right references and constraints beside the generation plan',
    afterTitle: 'The selected generation comes back ready to review.',
    afterBody: 'The creator chooses the result and asks Supercomputer to return it through Nitrate. Nitrate imports the actual media, records its Higgsfield asset identity, and places it on the matching assignment for the lead.',
    returnPrompt: 'Return the selected Hook A result to Nitrate with this generation prompt and my review note.',
    returnTool: 'Higgsfield Supercomputer',
    reviewAlt: 'Fictional Winter Sale frame of two figures in a bright brutalist atrium',
    setupTitle: 'Add Nitrate as the collaboration connector.',
    setupBody: 'Create a scoped, expiring Nitrate connection from a logged-in account, then add the endpoint and one-time authorization value to a compatible custom connector. The connection can be revoked without signing the creator out of Nitrate.',
    command: 'nitrate mcp:connect --name "Higgsfield Supercomputer" --days 7',
    setupLines: ['Create the expiring connection.', 'Add it to the compatible connector.', 'Ask: “Pull my Nitrate brief.”'],
    setupNote: 'Pilot requirement: the Supercomputer connector must accept a custom remote MCP endpoint and authorization header. Higgsfield publicly documents built-in app connectors, but not arbitrary third-party MCP servers inside Supercomputer, so we verify compatibility account by account.',
    docsHref: 'https://higgsfield.ai/creator-hub/help-center/tools/how-do-i-use-supercomputer',
    docsLabel: 'How Supercomputer workflows work',
    pilotTitle: 'Run one accountable Supercomputer campaign.',
    pilotBody: 'We’ll connect one creator, pull a real brief into their workflow, and make sure the chosen generation returns to the right review queue.',
    cta: 'Join the connector pilot'
  }
];

function esc(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function logo(agent, className = 'agent-logo') {
  if (agent.logo === 'openai') {
    return `<span class="${className} logo-openai" aria-hidden="true"><img src="/assets/tool-logos/openai-wordmark.svg" width="564" height="153" alt=""></span>`;
  }
  if (agent.logo === 'higgsfield') {
    return `<span class="${className} logo-higgsfield" aria-hidden="true"><img src="/assets/tool-logos/higgsfield.png" width="300" height="300" alt=""></span>`;
  }
  return `<span class="${className} logo-claude" aria-hidden="true"><img src="/assets/tool-logos/claude.png" width="32" height="32" alt=""></span>`;
}

function pageHead(agent) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${esc(agent.title)}</title>
  <meta name="description" content="${esc(agent.description)}">
  <meta name="theme-color" content="#08080a">
  <meta property="og:type" content="website">
  <meta property="og:title" content="${esc(agent.title)}">
  <meta property="og:description" content="${esc(agent.description)}">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="preload" href="/fonts/league-gothic-latin.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="preload" href="/fonts/manrope-latin.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="stylesheet" href="/styles/nitrate-landing.css">
  <link rel="stylesheet" href="/styles/agent-landing.css">
  <script src="/scripts/agent-landing.js" defer></script>
</head>`;
}

function header(current = '', pilotHref = '#pilot') {
  return `<a class="skip-link" href="#main">Skip to content</a>
  <header class="site-header">
    <a class="wordmark" href="/" aria-label="Nitrate home">nitrate<span aria-hidden="true">.</span></a>
    <nav class="site-nav" aria-label="Primary navigation">
      <a href="/for/"${current === 'for' ? ' aria-current="page"' : ''}>For your agent</a>
      <a href="/plugin/">Plugin</a>
      <a href="/#how-it-works">How it works</a>
      <a class="nav-cta" href="${pilotHref}">Request pilot</a>
    </nav>
  </header>`;
}

function footer() {
  return `<footer class="site-footer">
    <p><strong>nitrate.</strong><span>Collaboration for AI video agencies.</span></p>
    <p><a href="/for/">For your agent</a><a href="/plugin/">Plugin</a><a href="/press/">Press</a><a href="mailto:hello@nitrate.media">hello@nitrate.media</a></p>
  </footer>`;
}

function pilot(agent) {
  const id = agent.slug.replaceAll('-', '_');
  return `<section class="pilot agent-pilot" id="pilot" aria-labelledby="pilot-title-${id}">
      <div class="pilot-copy">
        <h2 id="pilot-title-${id}">${esc(agent.pilotTitle)}</h2>
        <p>${esc(agent.pilotBody)}</p>
      </div>
      <form class="pilot-form" data-pilot-form method="post" action="/api/waitlist">
        <input type="hidden" name="platform" value="${esc(agent.name)}">
        <label for="email-${id}">Work email<input id="email-${id}" name="email" type="email" autocomplete="email" placeholder="you@agency.com" required></label>
        <label for="team-${id}">Agency team size<select id="team-${id}" name="teamSize" required><option value="">Choose a size</option><option>1-5</option><option>6-20</option><option>21-80</option><option>80+</option></select></label>
        <label for="workflow-${id}">Primary creator workflow<select id="workflow-${id}" name="workflow" required><option value="">Choose a workflow</option><option${agent.name === 'Codex' ? ' selected' : ''}>Codex</option><option${agent.name === 'Claude Code' ? ' selected' : ''}>Claude Code</option><option${agent.name === 'Claude Desktop' ? ' selected' : ''}>Claude Desktop</option><option${agent.name === 'Higgsfield Supercomputer' ? ' selected' : ''}>Higgsfield Supercomputer</option><option>Multiple tools</option><option>Other</option></select></label>
        <button class="button button-primary" type="submit"><span>${esc(agent.cta)}</span>${arrow}</button>
        <p class="form-status" data-form-status role="status"></p>
      </form>
    </section>`;
}

function agentSwitcher(activeSlug) {
  return `<nav class="agent-switcher" aria-label="Nitrate agent pages">
      <p>See the five-minute handoff in every workspace.</p>
      <ul>
        ${agents.map(agent => `<li><a href="/for/${agent.slug}/"${agent.slug === activeSlug ? ' aria-current="page"' : ''}><span>${esc(agent.shortName)}</span><small>${esc(agent.state)}</small></a></li>`).join('\n        ')}
      </ul>
    </nav>`;
}

function setup(agent) {
  const command = agent.command
    ? `<div class="setup-command"><pre><code>${esc(agent.command)}</code></pre><button type="button" data-copy-command="${esc(agent.command)}">Copy setup</button></div>`
    : `<a class="button button-primary preview-button" href="#pilot"><span>${esc(agent.setupActionLabel || 'Request preview access')}</span>${arrow}</a>`;
  return `<section class="agent-setup agent-section" id="setup" aria-labelledby="setup-title">
      <div class="setup-copy">
        <h2 id="setup-title">${esc(agent.setupTitle)}</h2>
        <p>${esc(agent.setupBody)}</p>
        <a class="official-link" href="${esc(agent.docsHref)}">${esc(agent.docsLabel)} <span aria-hidden="true">↗</span></a>
      </div>
      <div class="setup-action">
        ${command}
        <ol>
          ${agent.setupLines.map(line => `<li>${esc(line)}</li>`).join('\n          ')}
        </ol>
        ${agent.setupNote ? `<p class="setup-note">${esc(agent.setupNote)}</p>` : ''}
      </div>
    </section>`;
}

function event(message, step, owner) {
  const state = step === 0 ? ' is-seen is-current' : '';
  return `<li class="aha-event${state}" data-event-step="${step}"><span>${owner}</span><p>${esc(message)}</p></li>`;
}

function ahaMachine(agent) {
  const leadEvents = [
    'Package Winter Sale and assign Hook A to Nia.',
    'Invite sent · brief + 6 inputs + 3 review rules',
    'Nia accepted the handoff',
    agent.transferProof,
    agent.leadProof
  ];
  const creatorEvents = [
    'Waiting for campaign context',
    'Winter Sale · Hook A received',
    agent.creatorAsk,
    agent.agentReply,
    agent.readyLine
  ];
  const timeline = [
    ['0:00', 'Assign', 'PT0M'],
    ['1:15', 'Invite', 'PT1M15S'],
    ['2:30', 'Pull', 'PT2M30S'],
    ['4:00', 'Verify', 'PT4M'],
    ['5:00', 'Shared', 'PT5M']
  ];
  const screenId = `aha-screen-${agent.slug}`;
  return `<div class="aha-machine" data-aha-demo data-native-ui="${agent.nativeUi}" role="region" aria-label="Illustrative five-minute Nitrate handoff in ${esc(agent.name)}">
        <div class="aha-topbar">
          <div>${logo(agent)}<p><strong>Nitrate for ${esc(agent.name)}</strong><span>One brief · two people · five minutes</span></p></div>
          <span class="availability ${agent.stateClass}"><i aria-hidden="true"></i>${esc(agent.state)}</span>
        </div>
        <ol class="aha-timeline" aria-label="Five-minute handoff timeline">
          ${timeline.map(([time, label, duration], index) => `<li><button type="button" data-aha-step="${index}" aria-label="${time}: ${label}" aria-controls="${screenId}"${index === 0 ? ' aria-current="step"' : ''}><time datetime="${duration}">${time}</time><span>${label}</span></button></li>`).join('\n          ')}
        </ol>
        <div class="aha-progress" aria-hidden="true"><i></i><b></b></div>
        <div class="aha-screen" id="${screenId}">
          <section class="aha-pane lead-pane" aria-label="What the agency lead sees">
            <header><span>Lead / Nitrate</span><strong>Maya · Winter Sale</strong></header>
            <ol>${leadEvents.map((message, step) => event(message, step, step === 0 ? 'Maya' : 'Nitrate')).join('')}</ol>
          </section>
          <div class="aha-transfer" aria-hidden="true"><span>Brief</span><i></i><span>Receipt</span></div>
          <section class="aha-pane creator-pane" aria-label="What the creator sees in ${esc(agent.name)}">
            <header><span>Creator workspace</span><strong>${esc(agent.creatorLabel)}</strong></header>
            <ol>${creatorEvents.map((message, step) => event(message, step, step === 2 ? 'Nia' : agent.shortName)).join('')}</ol>
          </section>
        </div>
        <div class="aha-outcome">
          <p><span>Creator sees</span><strong>${esc(agent.creatorProof)}</strong></p>
          <p><span>Lead sees</span><strong>${esc(agent.leadProof)}</strong></p>
          <button type="button" data-replay-aha>Replay 5:00</button>
        </div>
      </div>`;
}

function agentPage(agent) {
  const reviewImage = agent.slug === 'higgsfield-supercomputer'
    ? '/assets/nitrate-demo/brutalist-atrium.webp'
    : agent.slug === 'claude-desktop'
      ? '/assets/nitrate-demo/transit-hall.webp'
      : '/assets/nitrate-demo/coastal-city.webp';
  return `${pageHead(agent)}
<body class="agent-page agent-page-${agent.slug}">
  <!--
  THESIS: Nitrate’s five-minute proof is the complete campaign handoff arriving intact inside ${agent.name}; this page refuses generic integration feature lists.
  OWN-WORLD: the established Review Room in projection black and white, electric-violet production state, orange review attention, hard rules, compressed film-title type, and a native ${agent.nativeUi} transcript.
  STORY: an AI video agency lead assigns Hook A, a creator pulls it in ${agent.name}, both sides see the same production truth, and the returned media stays tied to that brief.
  FIRST VIEWPORT: the plain-language promise occupies the left third; a live five-minute lead-to-creator handoff console owns the right and resolves into two explicit proof states.
  FORM: code-led Agent Handoff Reel, an extension of the existing Review Room; inherited seed be4b0602.
  FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, and DESIGN.md
  -->
  ${header()}
  <main id="main">
    <section class="agent-hero" aria-labelledby="agent-title">
      <div class="agent-hero-copy">
        <h1 id="agent-title">${esc(agent.headline)}</h1>
        <p>${esc(agent.promise)}</p>
        <div class="hero-actions">
          <a class="button button-primary" href="#pilot"><span>${esc(agent.cta)}</span>${arrow}</a>
          <a class="text-link" href="#five-minutes">Watch the handoff <span aria-hidden="true">↘</span></a>
        </div>
        <div class="platform-signature">${logo(agent, 'signature-logo')}<p><strong>Nitrate for ${esc(agent.name)}</strong><span>${esc(agent.state)}</span></p></div>
      </div>
      ${ahaMachine(agent)}
    </section>

    <section class="shared-proof agent-section" id="five-minutes" aria-labelledby="proof-title">
      <div class="proof-copy">
        <h2 id="proof-title">At 5:00, nobody has to ask, “Which brief are you using?”</h2>
        <p>The aha is shared context arriving intact. One creator is ready to make the right work, and the lead can see that the handoff actually landed.</p>
      </div>
      <div class="proof-ledger" role="table" aria-label="Shared production truth at minute five">
        <div role="row"><strong role="rowheader">What are we making?</strong><span role="cell">Winter Sale · Hook A · 9:16</span></div>
        <div role="row"><strong role="rowheader">What can we use?</strong><span role="cell">Six lead-approved product references</span></div>
        <div role="row"><strong role="rowheader">What must come back?</strong><span role="cell">renders/hook-a-v1.mp4 + prompt + notes</span></div>
        <div role="row"><strong role="rowheader">What will the lead check?</strong><span role="cell">Safe crop · seven-word copy · approved end card</span></div>
      </div>
    </section>

    <section class="return-loop agent-section" aria-labelledby="return-title">
      <div class="return-media">
        <img src="${reviewImage}" width="1280" height="720" alt="${esc(agent.reviewAlt)}">
        <div class="return-media-top"><span>Winter Sale · Hook A</span><strong>Fictional demo</strong></div>
        <div class="return-media-state"><i aria-hidden="true"></i>Ready for Maya’s review</div>
      </div>
      <div class="return-copy">
        <h2 id="return-title">${esc(agent.afterTitle)}</h2>
        <p>${esc(agent.afterBody)}</p>
        <blockquote><span>Creator asks</span>“${esc(agent.returnPrompt)}”</blockquote>
        <dl>
          <div><dt>File</dt><dd>hook-a-v1.mp4</dd></div>
          <div><dt>Made with</dt><dd>${esc(agent.returnTool)}</dd></div>
          <div><dt>Attached</dt><dd>Prompt · notes · original assignment</dd></div>
          <div class="review-row"><dt>Lead action</dt><dd>Approve or request changes</dd></div>
        </dl>
      </div>
    </section>

    <section class="context-tape agent-section" aria-label="What Nitrate keeps attached">
      <h2>Nitrate keeps the production understanding attached.</h2>
      <p>Think of it as a working DAM for the agent: context starts before the final asset exists and stays with the exact file through review.</p>
      <ol>
        <li><span>Brief</span><strong>What the client asked for</strong></li>
        <li><span>Inputs</span><strong>What the lead approved</strong></li>
        <li><span>Assignment</span><strong>Who owns this variation</strong></li>
        <li><span>Output</span><strong>What must come back</strong></li>
        <li><span>Creation</span><strong>Prompt, tool, and notes</strong></li>
        <li><span>Review</span><strong>The decision on the exact file</strong></li>
      </ol>
    </section>

    ${setup(agent)}
    ${agentSwitcher(agent.slug)}
    ${pilot(agent)}
  </main>
  ${footer()}
</body>
</html>
`;
}

function hubPage() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Nitrate for AI agents — one brief across every creator workspace</title>
  <meta name="description" content="See how Nitrate gives Codex, Claude Code, Claude Desktop, and Higgsfield Supercomputer the same AI video brief and returns every result to one review workflow.">
  <meta name="theme-color" content="#08080a">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="preload" href="/fonts/league-gothic-latin.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="preload" href="/fonts/manrope-latin.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="stylesheet" href="/styles/nitrate-landing.css">
  <link rel="stylesheet" href="/styles/agent-landing.css">
  <script src="/scripts/agent-landing.js" defer></script>
</head>
<body class="agent-page agent-hub">
  <!--
  THESIS: every creator’s agent should begin from the same production truth; this page refuses the logo-cloud integration directory.
  OWN-WORLD: the Review Room becomes a one-brief-to-four-workspaces routing wall, using hard rails, platform stamps, violet handoff state, and orange review arrival.
  STORY: the agency lead recognizes the collaboration problem, sees the five-minute shared-context proof, chooses the agent their team already uses, and requests a live pilot.
  FIRST VIEWPORT: a large promise and CTA sit beside one campaign brief visibly routed into four named agent workspaces and back to one review queue.
  FORM: code-led Agent Routing Wall, an extension of the existing Review Room; inherited seed be4b0602.
  FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, and DESIGN.md
  -->
  ${header('for')}
  <main id="main">
    <section class="hub-hero" aria-labelledby="hub-title">
      <div class="hub-copy">
        <h1 id="hub-title">Your lead sets the work once. Every creator’s agent starts right.</h1>
        <p>Nitrate gives AI video agencies one collaboration workflow across the agents their creators use. It is available now for Codex and Claude Code, with Claude Desktop and Supercomputer paths in pilot.</p>
        <div class="hero-actions"><a class="button button-primary" href="#choose-agent"><span>Choose your agent</span>${arrow}</a><a class="text-link" href="#pilot">Run a client project <span aria-hidden="true">↘</span></a></div>
      </div>
      <div class="hub-routing" role="region" aria-label="One Nitrate brief routed to four creator agents and one lead review queue">
        <div class="hub-brief"><span>Lead / Nitrate</span><strong>Winter Sale campaign</strong><p>Hook A · 9:16<br>6 approved references<br>3 review rules</p><small><i aria-hidden="true"></i>Handoff ready</small></div>
        <div class="hub-rail" aria-hidden="true"><i></i><b></b></div>
        <ol>
          ${agents.map(agent => `<li>${logo(agent, 'hub-logo')}<p><strong>${esc(agent.shortName)}</strong><span>${esc(agent.state)}</span></p><i aria-hidden="true"></i></li>`).join('\n          ')}
        </ol>
        <div class="hub-rail return-rail" aria-hidden="true"><i></i><b></b></div>
        <div class="hub-review"><span>Lead review</span><strong>4 routes · one standard</strong><p>Files + prompts + notes<br>tied to the original brief</p><small><i aria-hidden="true"></i>Context intact</small></div>
      </div>
    </section>

    <section class="hub-aha agent-section" aria-labelledby="hub-aha-title">
      <div><h2 id="hub-aha-title">The five-minute aha: a second person has the same brief inside their own agent.</h2><p>No Drive scavenger hunt. No Slack archaeology. No guessing which output folder or end card the lead meant.</p></div>
      <ol>
        <li><time datetime="PT0M">0:00</time><strong>Lead assigns one real variation</strong><span>Brief, approved inputs, output, and review rules.</span></li>
        <li><time datetime="PT1M15S">1:15</time><strong>Creator receives one invite</strong><span>The invite knows the person and the work.</span></li>
        <li><time datetime="PT2M30S">2:30</time><strong>Creator asks their agent to pull</strong><span>One ordinary sentence, in the workspace they already use.</span></li>
        <li><time datetime="PT4M">4:00</time><strong>Nitrate records the handoff</strong><span>Local plugins verify inputs; connector paths issue secure links.</span></li>
        <li><time datetime="PT5M">5:00</time><strong>Both sides have proof</strong><span>The creator has the assignment; the lead has the pull receipt.</span></li>
      </ol>
    </section>

    <section class="agent-directory agent-section" id="choose-agent" aria-labelledby="directory-title">
      <header><h2 id="directory-title">See Nitrate in your team’s agent.</h2><p>Same collaboration loop. Different native moment.</p></header>
      <ol>
        ${agents.map(agent => `<li><a href="/for/${agent.slug}/">${logo(agent, 'directory-logo')}<span><strong>${esc(agent.name)}</strong><small>${esc(agent.state)}</small></span><p>${esc(agent.creatorProof)}</p><b aria-hidden="true">View the 5:00 story →</b></a></li>`).join('\n        ')}
      </ol>
    </section>

    ${pilot({
      slug: 'agent_hub',
      name: 'Multiple tools',
      pilotTitle: 'Run the five-minute test with one creator.',
      pilotBody: 'Use your next live brief. We’ll help your lead package it once, get it into the creator’s preferred agent, and prove the handoff arrived intact.',
      cta: 'Run the five-minute test'
    })}
  </main>
  ${footer()}
</body>
</html>
`;
}

function thanksPage() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Your Nitrate pilot request is in</title>
  <meta name="description" content="Your Nitrate pilot request has been saved.">
  <meta name="theme-color" content="#08080a">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="preload" href="/fonts/league-gothic-latin.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="preload" href="/fonts/manrope-latin.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="stylesheet" href="/styles/nitrate-landing.css">
  <link rel="stylesheet" href="/styles/agent-landing.css">
</head>
<body class="agent-page agent-thanks">
  ${header('', '/for/#pilot')}
  <main id="main">
    <section class="thanks-hero" aria-labelledby="thanks-title">
      <div class="thanks-receipt"><span><i aria-hidden="true"></i>Request saved</span><strong>Nitrate / pilot queue</strong></div>
      <div>
        <p class="eyebrow">Your first handoff starts here</p>
        <h1 id="thanks-title">Let’s prove it on one real brief.</h1>
        <p>We have your request. We’ll follow up to choose one agency lead, one creator, and one active campaign for the five-minute handoff.</p>
        <a class="button button-primary" href="/for/"><span>Explore every agent</span>${arrow}</a>
      </div>
    </section>
  </main>
  ${footer()}
</body>
</html>
`;
}

await mkdir(path.join(publicRoot, 'for'), { recursive: true });
await writeFile(path.join(publicRoot, 'for', 'index.html'), hubPage());

const thanksDirectory = path.join(publicRoot, 'for', 'thanks');
await mkdir(thanksDirectory, { recursive: true });
await writeFile(path.join(thanksDirectory, 'index.html'), thanksPage());

for (const agent of agents) {
  const directory = path.join(publicRoot, 'for', agent.slug);
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, 'index.html'), agentPage(agent));
}

console.log(`Built ${agents.length + 2} agent landing pages.`);
