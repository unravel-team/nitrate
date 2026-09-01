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
        title: 'Both agents log in once.',
        description: 'The plugin identifies Maya as the agency lead and Nia as a creator, while letting both stay inside the AI agent they already use.',
        direction: 'both',
        route: 'Roles connected',
        routeDetail: 'Each agent gets its own view.',
        status: 'Both agents are ready.',
        statusDetail: 'The campaign can now move between Maya and Nia without either person leaving their own AI agent.',
        active: ['leader', 'creator'],
        leader: [
          { kind: 'command', text: 'nitrate login --api https://nitrate.example.workers.dev --role leader --name "Maya Chen" --email maya@northwind.agency --clanker maya-lead --surface "Claude Code"' },
          { kind: 'success', text: 'Logged in as Maya Chen (team_lead) on maya-lead' }
        ],
        creator: [
          { kind: 'command', text: 'nitrate login --api https://nitrate.example.workers.dev --role member --name "Nia Patel" --email nia@studio.co --clanker nia-codex --surface "Codex"' },
          { kind: 'success', text: 'Logged in as Nia Patel (ai_creator) on nia-codex' }
        ]
      },
      {
        title: 'The lead sets the brief and assigns the team.',
        description: 'Maya gives every creator the same brief, approved inputs, and return folders, then adds a different creative route for each person.',
        direction: 'out',
        route: '3 assignments delivered',
        routeDetail: 'Shared rules, individual creative routes.',
        status: 'The lead defines the work once.',
        statusDetail: 'Nitrate turns one campaign setup into three focused creator assignments.',
        active: ['leader'],
        leader: [
          { kind: 'command', text: 'nitrate init-agency --name "Northwind · Move Closer" --client "Northwind" \\\n  --brief "Create three 15s launch ads." \\\n  --input brand-guide.pdf --input product-refs.zip \\\n  --folder /renders --folder /prompts --folder /notes --folder /handoff \\\n  --creator "Nia Patel|nia@studio.co|nia-codex|Tell the commuter story." \\\n  --creator "Jonas Reyes|jonas@studio.co|jonas-claude|Lead with the product reveal." \\\n  --creator "Asha Kapoor|asha@studio.co|asha-codex|Build the brand-world montage."' },
          { kind: 'success', text: 'Created packet: Northwind · Move Closer (pkt_move_closer)' },
          { kind: 'success', text: 'Pushed to 3 creator agents.' }
        ],
        creator: [
          { kind: 'comment', text: 'Nitrate is waiting for Maya to send Nia an assignment.' },
          { kind: 'output', text: 'No campaign work has been pulled into this agent yet.' }
        ]
      },
      {
        title: 'The creator pulls a ready-made workspace.',
        description: 'Nia asks what is next. Nitrate downloads her assignment and creates the brief, inputs, and required return folders inside her Codex workspace.',
        direction: 'out',
        route: 'Assignment + inputs',
        routeDetail: 'Delivered into Nia’s AI agent.',
        status: 'Nia receives exactly her part of the campaign.',
        statusDetail: 'The brand rules stay shared; her commuter-story direction stays specific.',
        active: ['creator'],
        leader: [
          { kind: 'command', text: 'nitrate packets' },
          { kind: 'output', text: '{ "campaign": "Northwind · Move Closer", "creators": 3, "Nia": "delivered" }' }
        ],
        creator: [
          { kind: 'command', text: 'nitrate next' },
          { kind: 'output', text: 'Pull "Northwind · Move Closer": nitrate pull --packet pkt_move_closer --assignment asn_nia_01' },
          { kind: 'command', text: 'nitrate pull --packet pkt_move_closer --assignment asn_nia_01 --dir ./move-closer' },
          { kind: 'success', text: 'Pulled Northwind · Move Closer into /work/move-closer' },
          { kind: 'tree', text: 'AGENT_BRIEF.md\ninputs/\nrenders/\nprompts/\nnotes/\nhandoff/' }
        ]
      },
      {
        title: 'The creator works in the tools they already use.',
        description: 'Nia marks the assignment as active, reads the generated brief, and makes the ad in Higgsfield. Maya can see that the work is underway.',
        direction: 'in',
        route: 'Working status',
        routeDetail: 'Visible to the agency lead.',
        status: 'Creation stays with the creator.',
        statusDetail: 'Nitrate coordinates the work around Higgsfield, Runway, or whichever media tool Nia chooses.',
        active: ['creator'],
        leader: [
          { kind: 'command', text: 'nitrate next' },
          { kind: 'output', text: 'Nia Patel is working on "Northwind · Move Closer". Ask for a return or adjust the packet.' }
        ],
        creator: [
          { kind: 'command', text: 'cd ./move-closer && nitrate status --status working' },
          { kind: 'output', text: '{ "assignment": "asn_nia_01", "status": "working" }' },
          { kind: 'comment', text: 'Read AGENT_BRIEF.md and create in Higgsfield Supercomputer.' },
          { kind: 'success', text: 'Final saved to /renders/nia-commuter-v1.mp4' }
        ]
      },
      {
        title: 'The creator returns the ad with its context.',
        description: 'One sync sends the video back with its creator, assignment, generation tool, prompt, notes, and source files still attached.',
        direction: 'in',
        route: 'Ad + prompt + notes',
        routeDetail: 'Returned to the same campaign.',
        status: 'The file arrives ready to review.',
        statusDetail: 'Maya does not have to reconstruct which brief, prompt, or creator produced it.',
        active: ['creator'],
        leader: [
          { kind: 'command', text: 'nitrate next' },
          { kind: 'output', text: 'Nia Patel is working on "Northwind · Move Closer". Ask for a return or adjust the packet.' }
        ],
        creator: [
          { kind: 'command', text: 'nitrate sync --dir ./move-closer \\\n  --file ./move-closer/renders/nia-commuter-v1.mp4 \\\n  --name "Nia commuter v1" --made-with "Higgsfield Supercomputer" \\\n  --prompt "Quiet morning commute; exact approved craft; warm graphite grade." \\\n  --notes "Kept the approved tagline and logo end card."' },
          { kind: 'output', text: '{ "filename": "nia-commuter-v1.mp4", "status": "review", "assignmentId": "asn_nia_01" }' },
          { kind: 'success', text: 'Return uploaded. Assignment status: returned.' }
        ]
      },
      {
        title: 'The lead reviews it and sends the next pass.',
        description: 'Nitrate points Maya to the exact return in the command center. If it needs changes, she pushes a new task to Nia and the same loop starts again.',
        direction: 'loop',
        route: 'Review decision → next pass',
        routeDetail: 'The feedback stays with Nia’s return.',
        status: 'Round one closes without losing the thread.',
        statusDetail: 'Nia’s next assignment arrives with the campaign context and Maya’s change request attached.',
        active: ['leader', 'creator'],
        leader: [
          { kind: 'command', text: 'nitrate next' },
          { kind: 'output', text: 'Review returned work for "Northwind · Move Closer" in the command center.' },
          { kind: 'comment', text: 'Command center: Nia · Higgsfield · prompt attached · notes attached · needs review' },
          { kind: 'comment', text: 'Maya requests: "Warm the grade. Keep the approved end card."' },
          { kind: 'command', text: 'nitrate push --packet pkt_move_closer --email nia@studio.co --name "Nia Patel" --clanker nia-codex --task "Round 2: warm the grade; keep the approved end card."' },
          { kind: 'success', text: 'New assignment delivered to nia-codex.' }
        ],
        creator: [
          { kind: 'command', text: 'nitrate next' },
          { kind: 'output', text: 'Pull "Northwind · Move Closer": nitrate pull --packet pkt_move_closer --assignment asn_nia_02' },
          { kind: 'success', text: 'Round 2 is ready—with Maya’s feedback attached.' }
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

    const linePrefix = kind => {
      if (kind === 'command') return '$';
      if (kind === 'comment') return '#';
      if (kind === 'success') return 'OK';
      if (kind === 'tree') return '+';
      return '>';
    };

    const renderTerminal = (terminal, lines, animate) => {
      if (!terminal) return;
      const fragment = document.createDocumentFragment();
      lines.forEach((line, index) => {
        const row = document.createElement('div');
        const prefix = document.createElement('span');
        const code = document.createElement('code');
        row.className = `cli-line cli-line-${line.kind}${animate ? ' is-new' : ''}`;
        row.style.setProperty('--line-index', String(index));
        prefix.setAttribute('aria-hidden', 'true');
        prefix.textContent = linePrefix(line.kind);
        code.textContent = line.text;
        row.append(prefix, code);
        fragment.append(row);
      });
      terminal.replaceChildren(fragment);
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
      cliIndex = index;
      cliJourney.dataset.step = String(index);
      if (bridge) {
        bridge.dataset.direction = step.direction;
        bridge.classList.remove('is-moving');
        void bridge.offsetWidth;
        bridge.classList.add('is-moving');
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
      renderTerminal(leaderTerminal, step.leader, options.animate && !reducedMotion.matches);
      renderTerminal(creatorTerminal, step.creator, options.animate && !reducedMotion.matches);
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
      }, 4300);
    };

    const setCliPlaying = playing => {
      cliPlaying = playing && !reducedMotion.matches;
      updateCliControls();
      if (cliPlaying) scheduleCliStep();
      else clearCliTimer();
    };

    stepButtons.forEach((button, index) => {
      button.addEventListener('click', () => {
        setCliPlaying(false);
        renderCliStep(index, { animate: true });
      });
    });

    previousButton?.addEventListener('click', () => {
      setCliPlaying(false);
      renderCliStep(Math.max(0, cliIndex - 1), { animate: true });
    });

    nextButton?.addEventListener('click', () => {
      setCliPlaying(false);
      renderCliStep(Math.min(cliSteps.length - 1, cliIndex + 1), { animate: true });
    });

    playButton?.addEventListener('click', () => {
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
          setCliPlaying(true);
        } else if (cliVisible && cliPlaying) scheduleCliStep();
        else if (!cliVisible) clearCliTimer();
      }, { threshold: 0.3 });
      cliObserver.observe(cliJourney);
    } else if (!reducedMotion.matches) {
      cliVisible = true;
    }

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) clearCliTimer();
      else if (cliPlaying && cliVisible) scheduleCliStep();
    });

    reducedMotion.addEventListener?.('change', event => {
      if (event.matches) setCliPlaying(false);
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
