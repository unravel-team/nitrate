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

  const pullButton = document.querySelector('[data-demo-pull]');
  const workspaceTree = document.querySelector('[data-workspace-tree]');

  pullButton?.setAttribute('aria-expanded', 'false');
  pullButton?.addEventListener('click', () => {
    const open = pullButton.getAttribute('aria-expanded') !== 'true';
    pullButton.setAttribute('aria-expanded', String(open));
    pullButton.textContent = open ? 'Assignment ready' : 'Pull assignment';
    workspaceTree?.classList.toggle('is-visible', open);
  });

  const revealTargets = [
    '.dam-heading',
    '.dam-explanation',
    '.break-copy',
    '.problem-evidence',
    '.workflow-heading',
    '.scene-copy',
    '.brief-sheet',
    '.creator-inbox',
    '.review-stack',
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
