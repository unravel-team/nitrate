(() => {
  'use strict';

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  const productionMap = document.querySelector('[data-production-map]');
  const replayMap = productionMap?.querySelector('.replay-map');
  let mapHasPlayed = false;

  const playProductionMap = () => {
    if (!productionMap || reducedMotion.matches) return;
    productionMap.classList.remove('is-running');
    void productionMap.offsetWidth;
    productionMap.classList.add('is-running');
    mapHasPlayed = true;
  };

  if (productionMap) {
    replayMap?.addEventListener('click', playProductionMap);

    if (!reducedMotion.matches) {
      const mapObserver = new IntersectionObserver(entries => {
        if (entries.some(entry => entry.isIntersecting) && !mapHasPlayed) {
          playProductionMap();
          mapObserver.disconnect();
        }
      }, { threshold: 0.24 });
      mapObserver.observe(productionMap);
    }
  }

  const stage = document.querySelector('[data-review-stage]');
  const mainStill = document.querySelector('#hero-still');
  const creator = document.querySelector('#return-creator');
  const prompt = document.querySelector('#return-prompt');
  const status = document.querySelector('#return-status');
  const note = document.querySelector('#return-note');
  const timecode = document.querySelector('#demo-timecode');
  const approve = document.querySelector('#approve-demo');
  const thumbs = [...document.querySelectorAll('.return-thumb')];
  let selectedIndex = 0;
  let autoTimer = 0;
  let autoStarted = false;
  let userTookControl = false;

  thumbs.forEach(thumb => {
    const preloader = new Image();
    preloader.src = thumb.dataset.image || '';
  });

  const resetApproval = () => {
    stage?.classList.remove('is-approved');
    approve?.setAttribute('aria-pressed', 'false');
    if (approve) approve.textContent = 'Approve round';
  };

  const selectReturn = (index, options = {}) => {
    const next = thumbs[index];
    if (!next || !mainStill) return;

    selectedIndex = index;
    thumbs.forEach((thumb, thumbIndex) => {
      const isSelected = thumbIndex === index;
      thumb.classList.toggle('is-selected', isSelected);
      thumb.setAttribute('aria-selected', String(isSelected));
      thumb.tabIndex = isSelected ? 0 : -1;
    });

    resetApproval();

    const applyContent = () => {
      mainStill.src = next.dataset.image || mainStill.src;
      mainStill.alt = next.dataset.alt || '';
      if (creator) creator.textContent = `${next.dataset.creator} · ${next.dataset.tool}`;
      if (prompt) prompt.textContent = next.dataset.prompt || 'Attached';
      if (status) status.textContent = next.dataset.status || 'Needs review';
      if (note) note.textContent = next.dataset.note || '';
      if (timecode) timecode.textContent = next.dataset.time || '';
      stage?.classList.remove('is-changing');
    };

    if (options.animate && !reducedMotion.matches) {
      stage?.classList.add('is-changing');
      window.setTimeout(applyContent, 150);
    } else {
      applyContent();
    }
  };

  const stopAutoCycle = () => {
    userTookControl = true;
    window.clearTimeout(autoTimer);
  };

  thumbs.forEach((thumb, index) => {
    thumb.tabIndex = index === 0 ? 0 : -1;
    thumb.addEventListener('click', () => {
      stopAutoCycle();
      selectReturn(index, { animate: true });
    });
    thumb.addEventListener('focus', stopAutoCycle);
    thumb.addEventListener('keydown', event => {
      if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      stopAutoCycle();
      const last = thumbs.length - 1;
      const target = event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? last
          : event.key === 'ArrowRight'
            ? (index + 1) % thumbs.length
            : (index - 1 + thumbs.length) % thumbs.length;
      selectReturn(target, { animate: true });
      thumbs[target]?.focus();
    });
  });

  approve?.setAttribute('aria-pressed', 'false');
  approve?.addEventListener('click', () => {
    stopAutoCycle();
    const willApprove = approve.getAttribute('aria-pressed') !== 'true';
    approve.setAttribute('aria-pressed', String(willApprove));
    approve.textContent = willApprove ? 'Approved' : 'Approve round';
    stage?.classList.toggle('is-approved', willApprove);
    if (status) status.textContent = willApprove ? 'Approved' : (thumbs[selectedIndex]?.dataset.status || 'Needs review');
  });

  const scheduleAutoStep = () => {
    if (userTookControl || document.hidden || selectedIndex >= thumbs.length - 1) return;
    autoTimer = window.setTimeout(() => {
      if (userTookControl || document.hidden) return;
      selectReturn(selectedIndex + 1, { animate: true });
      scheduleAutoStep();
    }, 2700);
  };

  if (stage && !reducedMotion.matches) {
    const stageObserver = new IntersectionObserver(entries => {
      const visible = entries.some(entry => entry.isIntersecting);
      if (visible && !autoStarted && !userTookControl) {
        autoStarted = true;
        autoTimer = window.setTimeout(scheduleAutoStep, 2400);
      } else if (!visible) {
        window.clearTimeout(autoTimer);
      }
    }, { threshold: 0.55 });
    stageObserver.observe(stage);
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) window.clearTimeout(autoTimer);
  });

  const cliJourney = document.querySelector('[data-cli-journey]');

  if (cliJourney) {
    const cliSteps = [
      {
        title: 'Maya connects Nitrate; Nia joins through one invite.',
        description: 'The leader logs in once. A creator’s one-time invite is the entry point to her own AI coding agent workspace.',
        direction: 'both',
        handoffDelay: 3000,
        route: 'Leader connected',
        routeDetail: 'Nia will join from Maya’s one-time invite.',
        status: 'Maya is ready to hand off a real campaign.',
        statusDetail: 'Nia needs no separate setup: the invite will create her working folder when she pulls it.',
        active: ['leader'],
        startDelay: { leader: 80 },
        leader: [
          { kind: 'prompt', speaker: 'Maya', text: 'Connect this Claude Code session to Nitrate as the agency lead.' },
          { kind: 'response', text: 'I’ll connect this AI coding agent to your Nitrate account.' },
          {
            kind: 'tool',
            action: 'login',
            command: 'nitrate login --email maya@northwind.agency --role leader --surface "Claude Code"',
            result: 'Connected · Maya Chen · agency lead'
          }
        ],
        creator: [
          { kind: 'notice', label: 'Nitrate', text: 'Waiting for Maya’s one-time campaign invite.' }
        ]
      },
      {
        title: 'Maya hands off the brief, real files, and one creative route.',
        description: 'Her AI coding agent uploads the actual brand guide and product reference, then makes a single-use invite for Nia.',
        direction: 'out',
        handoffDelay: 2100,
        route: 'Brief + real inputs + one invite',
        routeDetail: 'Nia gets exactly the campaign context she needs.',
        status: 'Maya creates one source of truth for the route.',
        statusDetail: 'The campaign cannot be handed off until real input files are attached and verified.',
        active: ['leader'],
        startDelay: { leader: 80 },
        leader: [
          {
            kind: 'prompt',
            speaker: 'Maya',
            text: 'Set up Northwind’s “Move Closer” campaign. Use the brand guide and product references, then assign three different 15-second creative routes.'
          },
          { kind: 'response', text: 'I’ll package the shared rules once, then give each creator their own route.' },
          {
            kind: 'tool',
            action: 'handoff',
            command: [
              'nitrate handoff --name "Northwind · Move Closer"',
              '  --brief "Create a 15s commuter-story launch ad."',
              '  --input brand-guide.pdf --input product-refs.zip',
              '  --to nia@studio.co --task "Tell the commuter story."',
              '  --folder /renders --folder /prompts --folder /notes'
            ].join('\n'),
            result: 'Handoff ready · inputs verified · one-time invite created'
          }
        ],
        creator: [
          { kind: 'notice', label: 'Nitrate invite', text: 'Northwind · Move Closer · one-time invite ready' }
        ]
      },
      {
        title: 'Nia opens the invite and pulls a ready-to-work folder.',
        description: 'The one-time invite signs her in, downloads the verified input files, and writes the brief, folders, and receipts locally.',
        direction: 'out',
        handoffDelay: 2700,
        route: 'Creator pull acknowledged',
        routeDetail: 'The leader can see that Nia has the source material.',
        status: 'Nia receives the complete handoff, not another link to chase.',
        statusDetail: 'The brief, exact source files, and expected output folders arrive together—with proof that nothing went missing.',
        active: ['creator'],
        startDelay: { creator: 80 },
        leader: [
          { kind: 'notice', label: 'Nitrate handoff', text: 'Nia · commuter story · invite opened' }
        ],
        creator: [
          { kind: 'prompt', speaker: 'Nia', text: 'Open Maya’s Northwind invite and set up the campaign workspace.' },
          { kind: 'response', text: 'I’ll accept the one-time invite and pull the verified source files into this workspace.' },
          {
            kind: 'tool',
            action: 'pull',
            command: 'nitrate pull https://nitrate.media/join/one-time-invite --dir ./move-closer',
            result: 'Workspace ready · inputs verified · AGENT_BRIEF.md + folders'
          }
        ]
      },
      {
        title: 'Nia creates in Higgsfield with the campaign beside the work.',
        description: 'Nitrate does not replace her media tool. It preserves the exact brand rules and output contract while she creates the ad.',
        direction: 'in',
        handoffDelay: 2100,
        route: 'Creation stays in Nia’s tool',
        routeDetail: 'Nitrate keeps the working context intact.',
        status: 'Creation stays with the creator.',
        statusDetail: 'Nitrate coordinates the handoff around Higgsfield, Runway, or whichever media tool Nia chooses.',
        active: ['creator'],
        startDelay: { creator: 80 },
        leader: [
          { kind: 'notice', label: 'Nitrate campaign', text: 'Nia pulled the campaign · source files verified' }
        ],
        creator: [
          {
            kind: 'prompt',
            speaker: 'Nia',
            text: 'Make the commuter-story route in Higgsfield. Keep the Northwind brief and source files beside the work.'
          },
          { kind: 'response', text: 'I’ll use AGENT_BRIEF.md as the source of truth and keep the final render in /renders.' },
          { kind: 'notice', label: 'Creation tool', text: 'Higgsfield Supercomputer · nia-commuter-v1.mp4' }
        ]
      },
      {
        title: 'Nia returns the actual draft with the context Maya needs.',
        description: 'Her AI coding agent uploads the render and keeps the prompt, creation tool, notes, path, and assignment joined to the same return.',
        direction: 'in',
        handoffDelay: 2200,
        route: 'Ad + prompt + notes',
        routeDetail: 'Returned to the same campaign.',
        status: 'The ad arrives ready to review.',
        statusDetail: 'Maya does not have to reconstruct which brief, prompt, or creator produced it.',
        active: ['creator'],
        startDelay: { creator: 80 },
        leader: [
          { kind: 'notice', label: 'Nitrate review inbox', text: 'Waiting for Nia’s first return.' }
        ],
        creator: [
          {
            kind: 'prompt',
            speaker: 'Nia',
            text: 'Return nia-commuter-v1.mp4 with the Higgsfield prompt and my handoff notes.'
          },
          { kind: 'response', text: 'I’ll attach the render, prompt, notes, tool, and assignment before sending it back.' },
          {
            kind: 'tool',
            action: 'return',
            command: [
              'nitrate return ./move-closer/renders/nia-commuter-v1.mp4',
              '  --dir ./move-closer --name "Nia commuter v1"',
              '  --tool "Higgsfield Supercomputer"',
              '  --prompt "Quiet commute; approved craft; warm graphite grade."',
              '  --notes "Approved tagline and logo end card preserved."'
            ].join('\n'),
            result: 'Return uploaded · ready for Maya’s review'
          }
        ]
      },
      {
        title: 'Maya reviews the exact return, then opens the next pass.',
        description: 'The decision stays with Nia’s draft. If Maya requests changes, Nia returns a second pass to the same campaign rather than starting a new thread.',
        direction: 'loop',
        handoffDelay: 2900,
        route: 'Review decision → same return',
        routeDetail: 'The feedback stays with Nia’s actual draft.',
        status: 'Round one closes without losing the thread.',
        statusDetail: 'Nia’s next pass keeps the campaign context and Maya’s change request attached.',
        active: ['leader', 'creator'],
        startDelay: { leader: 80, creator: 3000 },
        leader: [
          {
            kind: 'prompt',
            speaker: 'Maya',
            text: 'Show me Nia’s return. Ask her to warm the grade and keep the approved end card.'
          },
          { kind: 'response', text: 'Nia’s v1 is ready to review with its prompt and notes. I’ll record your decision on this return.' },
          {
            kind: 'tool',
            action: 'review',
            command: 'nitrate review rtn_nia_01 --decision request-changes --note "Warm the grade; keep the approved end card."',
            result: 'Changes requested · Nia can return a second pass to this campaign'
          }
        ],
        creator: [
          { kind: 'notice', label: 'Nitrate review', text: 'Changes requested · warm the grade · approved end card locked' }
        ]
      }
    ];

    const leaderTerminal = cliJourney.querySelector('[data-cli-leader]');
    const creatorTerminal = cliJourney.querySelector('[data-cli-creator]');
    const leaderPane = cliJourney.querySelector('[data-cli-pane="leader"]');
    const creatorPane = cliJourney.querySelector('[data-cli-pane="creator"]');
    const bridge = cliJourney.querySelector('[data-cli-bridge]');
    const route = cliJourney.querySelector('[data-cli-route]');
    const routeDetail = cliJourney.querySelector('[data-cli-route-detail]');
    const counter = cliJourney.querySelector('[data-cli-counter]');
    const title = cliJourney.querySelector('[data-cli-title]');
    const description = cliJourney.querySelector('[data-cli-description]');
    const journeyStatus = cliJourney.querySelector('[data-cli-status]');
    const journeyStatusDetail = cliJourney.querySelector('[data-cli-status-detail]');
    const stepButtons = [...cliJourney.querySelectorAll('[data-cli-step]')];
    const previousButton = cliJourney.querySelector('[data-cli-previous]');
    const playButton = cliJourney.querySelector('[data-cli-play]');
    const nextButton = cliJourney.querySelector('[data-cli-next]');
    let cliIndex = 0;
    let cliTimer = 0;
    let cliPlaying = false;
    let cliVisible = false;
    let cliAutoStarted = false;

    const consoleTimers = new Set();
    const consoleFrames = new Set();

    const scheduleConsole = (callback, delay) => {
      const timer = window.setTimeout(() => {
        consoleTimers.delete(timer);
        callback();
      }, delay);
      consoleTimers.add(timer);
      return timer;
    };

    const queueConsoleFrame = callback => {
      const frame = window.requestAnimationFrame(time => {
        consoleFrames.delete(frame);
        callback(time);
      });
      consoleFrames.add(frame);
      return frame;
    };

    const clearConsoleAnimation = () => {
      consoleTimers.forEach(timer => window.clearTimeout(timer));
      consoleFrames.forEach(frame => window.cancelAnimationFrame(frame));
      consoleTimers.clear();
      consoleFrames.clear();
    };

    const createPromptTurn = (event, animate) => {
      const row = document.createElement('div');
      const mark = document.createElement('span');
      const copy = document.createElement('p');
      const speaker = document.createElement('strong');
      const typed = document.createElement('span');
      const caret = document.createElement('i');

      row.className = 'agent-turn agent-prompt ' + (animate ? 'is-pending' : 'is-visible');
      row.setAttribute('aria-label', event.speaker + ': ' + event.text);
      mark.className = 'agent-prompt-mark';
      mark.setAttribute('aria-hidden', 'true');
      mark.textContent = '›';
      speaker.textContent = event.speaker;
      typed.className = 'agent-typed-text';
      typed.setAttribute('aria-hidden', 'true');
      typed.textContent = animate ? '' : event.text;
      caret.className = 'agent-caret';
      caret.setAttribute('aria-hidden', 'true');
      if (!animate) caret.hidden = true;

      copy.append(speaker, typed, caret);
      row.append(mark, copy);
      return { node: row, typed, caret, kind: event.kind, text: event.text };
    };

    const createResponseTurn = (event, animate) => {
      const row = document.createElement('div');
      const mark = document.createElement('span');
      const copy = document.createElement('p');

      row.className = 'agent-turn agent-response ' + (animate ? 'is-pending' : 'is-visible');
      mark.className = 'agent-response-mark';
      mark.setAttribute('aria-hidden', 'true');
      copy.textContent = event.text;
      row.append(mark, copy);
      return { node: row, kind: event.kind };
    };

    const createNotice = (event, animate) => {
      const row = document.createElement('div');
      const label = document.createElement('span');
      const copy = document.createElement('strong');

      row.className = 'agent-notice ' + (animate ? 'is-pending' : 'is-visible');
      label.textContent = event.label;
      copy.textContent = event.text;
      row.append(label, copy);
      return { node: row, kind: event.kind };
    };

    const createToolCall = (event, animate) => {
      const row = document.createElement('div');
      const head = document.createElement('div');
      const signal = document.createElement('span');
      const name = document.createElement('strong');
      const action = document.createElement('em');
      const state = document.createElement('b');
      const command = document.createElement('code');
      const result = document.createElement('p');

      row.className = 'agent-tool ' + (animate ? 'is-pending' : 'is-visible is-done');
      row.setAttribute('aria-label', 'Nitrate ' + event.action + '. ' + event.result);
      head.className = 'agent-tool-head';
      signal.setAttribute('aria-hidden', 'true');
      name.textContent = 'Nitrate';
      action.textContent = event.action;
      state.textContent = animate ? 'Waiting' : 'Done';
      command.textContent = event.command;
      result.className = 'agent-tool-result';
      result.textContent = event.result;
      head.append(signal, name, action, state);
      row.append(head, command, result);
      return { node: row, kind: event.kind, state };
    };

    const createConsoleEvent = (event, animate) => {
      if (event.kind === 'prompt') return createPromptTurn(event, animate);
      if (event.kind === 'response') return createResponseTurn(event, animate);
      if (event.kind === 'tool') return createToolCall(event, animate);
      return createNotice(event, animate);
    };

    const typePrompt = (item, delay) => {
      const duration = Math.min(1050, Math.max(620, item.text.length * 12));
      scheduleConsole(() => {
        item.node.classList.remove('is-pending');
        item.node.classList.add('is-visible', 'is-typing');
        let startedAt = 0;

        const tick = time => {
          if (!startedAt) startedAt = time;
          const progress = Math.min(1, (time - startedAt) / duration);
          const characterCount = Math.floor(progress * item.text.length);
          item.typed.textContent = item.text.slice(0, characterCount);
          if (progress < 1) {
            queueConsoleFrame(tick);
            return;
          }
          item.typed.textContent = item.text;
          item.node.classList.remove('is-typing');
          item.caret.hidden = true;
        };

        queueConsoleFrame(tick);
      }, delay);
      return duration;
    };

    const revealConsoleEvent = (item, delay) => {
      scheduleConsole(() => {
        item.node.classList.remove('is-pending');
        item.node.classList.add('is-visible');
        if (item.kind !== 'tool') return;
        item.node.classList.add('is-running');
        item.state.textContent = 'Running';
        scheduleConsole(() => {
          item.node.classList.remove('is-running');
          item.node.classList.add('is-done');
          item.state.textContent = 'Done';
        }, 620);
      }, delay);
    };

    const renderAgentConsole = (terminal, events, options = {}) => {
      if (!terminal) return;
      const animate = Boolean(options.animate);
      const fragment = document.createDocumentFragment();
      const rendered = events.map(event => {
        const item = createConsoleEvent(event, animate);
        fragment.append(item.node);
        return item;
      });

      const composer = document.createElement('div');
      const composerMark = document.createElement('span');
      const composerCopy = document.createElement('p');
      const composerKey = document.createElement('kbd');
      composer.className = 'agent-composer';
      composer.setAttribute('aria-hidden', 'true');
      composerMark.textContent = '›';
      composerCopy.textContent = options.placeholder || 'Ask your AI coding agent…';
      composerKey.textContent = 'Enter';
      composer.append(composerMark, composerCopy, composerKey);
      fragment.append(composer);
      terminal.replaceChildren(fragment);

      if (!animate) return;

      let cursor = options.startDelay || 0;
      rendered.forEach(item => {
        if (item.kind === 'prompt') {
          cursor += typePrompt(item, cursor) + 180;
          return;
        }
        revealConsoleEvent(item, cursor);
        cursor += item.kind === 'tool' ? 880 : 420;
      });
    };

    const updateCliControls = () => {
      if (previousButton) previousButton.disabled = cliIndex === 0;
      if (nextButton) nextButton.disabled = cliIndex === cliSteps.length - 1;
      if (playButton) {
        playButton.setAttribute('aria-pressed', String(cliPlaying));
        playButton.textContent = cliPlaying
          ? 'Pause journey'
          : cliIndex === cliSteps.length - 1
            ? 'Replay journey'
            : 'Play journey';
      }
    };

    const renderCliStep = (index, options = {}) => {
      const step = cliSteps[index];
      if (!step) return;
      const shouldAnimate = Boolean(options.animate && !reducedMotion.matches);
      clearConsoleAnimation();
      cliIndex = index;
      cliJourney.dataset.step = String(index);
      if (bridge) {
        bridge.dataset.direction = step.direction;
        bridge.classList.remove('is-moving');
        const moveBridge = () => {
          void bridge.offsetWidth;
          bridge.classList.add('is-moving');
        };
        if (shouldAnimate) scheduleConsole(moveBridge, step.handoffDelay || 2200);
        else moveBridge();
      }
      if (route) route.textContent = step.route;
      if (routeDetail) routeDetail.textContent = step.routeDetail;
      if (counter) counter.textContent = `Step ${index + 1} of ${cliSteps.length}`;
      if (title) title.textContent = step.title;
      if (description) description.textContent = step.description;
      if (journeyStatus) journeyStatus.textContent = step.status;
      if (journeyStatusDetail) journeyStatusDetail.textContent = step.statusDetail;
      leaderPane?.classList.toggle('is-active', step.active.includes('leader'));
      creatorPane?.classList.toggle('is-active', step.active.includes('creator'));
      leaderPane?.classList.toggle('is-idle', !step.active.includes('leader'));
      creatorPane?.classList.toggle('is-idle', !step.active.includes('creator'));
      renderAgentConsole(leaderTerminal, step.leader, {
        animate: shouldAnimate && step.active.includes('leader'),
        startDelay: step.startDelay?.leader || 0,
        placeholder: 'Ask Claude Code…'
      });
      renderAgentConsole(creatorTerminal, step.creator, {
        animate: shouldAnimate && step.active.includes('creator'),
        startDelay: step.startDelay?.creator || 0,
        placeholder: 'Ask Codex…'
      });
      stepButtons.forEach((button, buttonIndex) => {
        if (buttonIndex === index) button.setAttribute('aria-current', 'step');
        else button.removeAttribute('aria-current');
      });
      updateCliControls();
    };

    const clearCliTimer = () => {
      window.clearTimeout(cliTimer);
      cliTimer = 0;
    };

    const scheduleCliStep = () => {
      clearCliTimer();
      if (!cliPlaying || !cliVisible || document.hidden || reducedMotion.matches) return;
      cliTimer = window.setTimeout(() => {
        const nextIndex = cliIndex + 1;
        if (nextIndex >= cliSteps.length) {
          cliPlaying = false;
          updateCliControls();
          return;
        }
        renderCliStep(nextIndex, { animate: true });
        if (nextIndex === cliSteps.length - 1) {
          cliPlaying = false;
          updateCliControls();
          return;
        }
        scheduleCliStep();
      }, 5200);
    };

    const setCliPlaying = playing => {
      cliPlaying = playing && !reducedMotion.matches;
      updateCliControls();
      if (cliPlaying) scheduleCliStep();
      else clearCliTimer();
    };

    stepButtons.forEach((button, index) => {
      button.addEventListener('click', () => {
        cliAutoStarted = true;
        setCliPlaying(false);
        renderCliStep(index, { animate: true });
      });
    });

    previousButton?.addEventListener('click', () => {
      cliAutoStarted = true;
      setCliPlaying(false);
      renderCliStep(Math.max(0, cliIndex - 1), { animate: true });
    });

    nextButton?.addEventListener('click', () => {
      cliAutoStarted = true;
      setCliPlaying(false);
      renderCliStep(Math.min(cliSteps.length - 1, cliIndex + 1), { animate: true });
    });

    playButton?.addEventListener('click', () => {
      cliAutoStarted = true;
      if (cliPlaying) {
        setCliPlaying(false);
        return;
      }
      if (cliIndex === cliSteps.length - 1) renderCliStep(0, { animate: true });
      setCliPlaying(true);
    });

    renderCliStep(0);

    if (!reducedMotion.matches && 'IntersectionObserver' in window) {
      const cliObserver = new IntersectionObserver(entries => {
        cliVisible = entries.some(entry => entry.isIntersecting);
        if (cliVisible && !cliAutoStarted) {
          cliAutoStarted = true;
          renderCliStep(cliIndex, { animate: true });
          setCliPlaying(true);
        } else if (cliVisible && cliPlaying) scheduleCliStep();
        else if (!cliVisible) {
          clearCliTimer();
          renderCliStep(cliIndex);
        }
      }, { threshold: 0.01 });
      cliObserver.observe(cliJourney);
    } else if (!reducedMotion.matches) {
      cliVisible = true;
    }

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        clearCliTimer();
        renderCliStep(cliIndex);
      }
      else if (cliPlaying && cliVisible) scheduleCliStep();
    });

    reducedMotion.addEventListener?.('change', event => {
      if (event.matches) {
        setCliPlaying(false);
        renderCliStep(cliIndex);
      }
    });
  }

  const revealTargets = [
    '.dam-heading',
    '.dam-explanation',
    '.break-copy',
    '.problem-evidence',
    '.workflow-heading',
    '.cli-journey',
    '.tool-section > div',
    '.tool-section > ul',
    '.pilot-copy',
    '.pilot-form'
  ].flatMap(selector => [...document.querySelectorAll(selector)]);

  if (reducedMotion.matches || !('IntersectionObserver' in window)) {
    revealTargets.forEach(target => target.classList.add('reveal', 'is-in-view'));
    document.querySelectorAll('.dam-bridge, .break-section').forEach(target => target.classList.add('is-in-view'));
  } else {
    const revealObserver = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-in-view');
        revealObserver.unobserve(entry.target);
      });
    }, { threshold: 0.13, rootMargin: '0px 0px -7% 0px' });

    revealTargets.forEach(target => {
      target.classList.add('reveal');
      revealObserver.observe(target);
    });

    document.querySelectorAll('.dam-bridge, .break-section').forEach(target => revealObserver.observe(target));
  }

  const form = document.querySelector('#waitlist-form');
  const formStatus = document.querySelector('#waitlist-status');
  const submitButton = form?.querySelector('button[type="submit"]');

  form?.addEventListener('submit', async event => {
    event.preventDefault();
    if (!form.reportValidity()) return;

    const originalLabel = submitButton?.querySelector('span')?.textContent || 'Request a pilot';
    const buttonLabel = submitButton?.querySelector('span');
    if (submitButton) submitButton.disabled = true;
    if (buttonLabel) buttonLabel.textContent = 'Sending request';
    form.setAttribute('aria-busy', 'true');
    if (formStatus) {
      formStatus.textContent = 'Saving your request…';
      formStatus.className = 'form-status';
    }

    try {
      const data = Object.fromEntries(new FormData(form).entries());
      const response = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'We could not save your request.');
      if (formStatus) {
        formStatus.textContent = payload.message || 'You’re on the list. We’ll follow up with plugin setup.';
        formStatus.className = 'form-status is-success';
      }
      form.reset();
    } catch (error) {
      if (formStatus) {
        formStatus.textContent = error.message || 'Something went wrong. Please try again.';
        formStatus.className = 'form-status is-error';
      }
    } finally {
      if (submitButton) submitButton.disabled = false;
      if (buttonLabel) buttonLabel.textContent = originalLabel;
      form.removeAttribute('aria-busy');
    }
  });
})();
