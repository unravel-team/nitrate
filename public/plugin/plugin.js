'use strict';

document.querySelectorAll('[data-copy]').forEach(button => {
  button.addEventListener('click', async () => {
    const command = button.dataset.copy || '';
    try {
      await navigator.clipboard.writeText(command);
      const original = button.textContent;
      button.textContent = 'Copied';
      window.setTimeout(() => { button.textContent = original; }, 1400);
    } catch {
      button.textContent = 'Select text';
    }
  });
});
