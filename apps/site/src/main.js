for (const button of document.querySelectorAll('[data-copy]')) {
  button.addEventListener('click', async () => {
    const command = button.getAttribute('data-copy');
    const status = document.querySelector('.copy-status');
    if (!command || !status) return;
    setTimeout(() => { status.textContent = ''; }, 5000);
    try {
      await navigator.clipboard.writeText(command);
      status.textContent = 'Copied. Paste npx chaching into your terminal.';
      button.setAttribute('aria-label', 'Copied npx chaching');
      button.classList.add('copied');
      setTimeout(() => { button.classList.remove('copied'); button.setAttribute('aria-label', 'Copy npx chaching'); }, 2400);
    } catch {
      const code = button.querySelector('code');
      const selection = window.getSelection();
      if (code && selection) { const range = document.createRange(); range.selectNodeContents(code); selection.removeAllRanges(); selection.addRange(range); }
      status.textContent = 'Copy unavailable here. The command is selected; use your usual copy shortcut.';
    }
  });
}
