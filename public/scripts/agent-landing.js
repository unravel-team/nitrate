(() => {
  'use strict';

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  document.querySelectorAll('[data-aha-demo]').forEach(demo => {
    const stepButtons = [...demo.querySelectorAll('[data-aha-step]')];
    const events = [...demo.querySelectorAll('[data-event-step]')];
    const replay = demo.querySelector('[data-replay-aha]');
    let activeStep = reducedMotion.matches ? stepButtons.length - 1 : 0;
    let timer = 0;
    let hasPlayed = reducedMotion.matches;
    let userControlled = false;

    const stop = () => {
      window.clearTimeout(timer);
      timer = 0;
    };

    const render = step => {
      activeStep = Math.max(0, Math.min(step, stepButtons.length - 1));
      const progress = stepButtons.length > 1 ? activeStep / (stepButtons.length - 1) * 100 : 100;
      demo.style.setProperty('--aha-progress', `${progress}%`);
      demo.style.setProperty('--aha-scale', String(progress / 100));
      demo.dataset.step = String(activeStep);

      stepButtons.forEach((button, index) => {
        if (index === activeStep) button.setAttribute('aria-current', 'step');
        else button.removeAttribute('aria-current');
      });

      events.forEach(event => {
        const eventStep = Number(event.dataset.eventStep || 0);
        event.classList.toggle('is-seen', eventStep <= activeStep);
        event.classList.toggle('is-current', eventStep === activeStep);
      });
    };

    const advance = () => {
      if (userControlled || document.hidden) return;
      if (activeStep >= stepButtons.length - 1) {
        hasPlayed = true;
        return;
      }
      render(activeStep + 1);
      timer = window.setTimeout(advance, 920);
    };

    const play = () => {
      if (reducedMotion.matches) return;
      stop();
      userControlled = false;
      hasPlayed = false;
      render(0);
      timer = window.setTimeout(advance, 760);
    };

    stepButtons.forEach((button, index) => {
      button.addEventListener('click', () => {
        stop();
        userControlled = true;
        render(index);
      });
    });

    replay?.addEventListener('click', play);
    render(activeStep);

    if (!reducedMotion.matches && 'IntersectionObserver' in window) {
      const observer = new IntersectionObserver(entries => {
        if (!entries.some(entry => entry.isIntersecting) || hasPlayed || userControlled) return;
        observer.disconnect();
        play();
      }, { threshold: 0.45 });
      observer.observe(demo);
    } else if (!reducedMotion.matches) {
      play();
    }

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) stop();
    });
  });

  document.querySelectorAll('[data-copy-command]').forEach(button => {
    button.addEventListener('click', async () => {
      const value = button.dataset.copyCommand || '';
      const original = button.textContent;
      try {
        await navigator.clipboard.writeText(value);
        button.textContent = 'Copied';
      } catch {
        const code = button.closest('.setup-command')?.querySelector('code');
        const selection = window.getSelection();
        if (code && selection) {
          const range = document.createRange();
          range.selectNodeContents(code);
          selection.removeAllRanges();
          selection.addRange(range);
          button.focus();
          button.textContent = 'Command selected';
        } else {
          button.textContent = 'Copy unavailable';
        }
      }
      window.setTimeout(() => {
        button.textContent = original;
      }, 1500);
    });
  });

  document.querySelectorAll('[data-pilot-form]').forEach(form => {
    const status = form.querySelector('[data-form-status]');
    const submit = form.querySelector('button[type="submit"]');
    const label = submit?.querySelector('span');

    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (!form.reportValidity()) return;

      const originalLabel = label?.textContent || 'Request pilot';
      form.setAttribute('aria-busy', 'true');
      if (submit) submit.disabled = true;
      if (label) label.textContent = 'Sending request';
      if (status) {
        status.textContent = 'Saving your request…';
        status.className = 'form-status';
      }

      try {
        const response = await fetch('/api/waitlist', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(Object.fromEntries(new FormData(form).entries()))
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || 'We could not save your request.');
        if (status) {
          status.textContent = payload.message || 'Request saved. We’ll follow up with the right setup.';
          status.className = 'form-status is-success';
        }
        form.reset();
      } catch (error) {
        if (status) {
          status.textContent = error.message || 'Something went wrong. Try again.';
          status.className = 'form-status is-error';
        }
      } finally {
        form.removeAttribute('aria-busy');
        if (submit) submit.disabled = false;
        if (label) label.textContent = originalLabel;
      }
    });
  });
})();
