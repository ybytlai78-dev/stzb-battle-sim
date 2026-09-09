/**
 * 率土风页内提示，替代 `window.alert`。
 * 同时只保留一条；新提示会替换旧提示。
 */
export function showNotice(message: string, ms = 3200): void {
  document.querySelectorAll('.app-notice').forEach((el) => el.remove());
  const el = document.createElement('div');
  el.className = 'app-notice';
  el.setAttribute('role', 'status');
  el.textContent = message;
  document.body.appendChild(el);
  window.setTimeout(() => {
    el.classList.add('out');
    window.setTimeout(() => el.remove(), 220);
  }, ms);
}
