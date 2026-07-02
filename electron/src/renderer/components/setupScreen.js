export function initSetupScreen({ onSubmit }) {
  const input = document.getElementById('setup-key-input');
  const button = document.getElementById('setup-submit');
  const error = document.getElementById('setup-error');

  async function submit() {
    const key = input.value.trim();
    if (!key) {
      error.textContent = 'Agent Key is required.';
      return;
    }
    button.disabled = true;
    error.textContent = '';
    const result = await onSubmit(key);
    button.disabled = false;
    if (!result.ok) {
      error.textContent = result.error || 'Could not validate Agent Key.';
    }
  }

  button.addEventListener('click', submit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submit();
  });
}

export function showSetupScreen(show) {
  document.getElementById('setup-screen').classList.toggle('hidden', !show);
}
