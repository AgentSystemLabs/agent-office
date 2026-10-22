// Runs only inside the Office frame. Keep failures visible if the bundle cannot boot.
function showOfficeFailure(message) {
  const show = () => {
    let box = document.getElementById('pocket-frame-error');
    if (!box) {
      box = document.createElement('div');
      box.id = 'pocket-frame-error';
      box.setAttribute('role', 'alert');
      box.style.cssText = 'position:fixed;inset:12px 12px auto;z-index:99999;padding:16px;border:2px solid #e88;background:#241923;color:#fff;font:14px/1.5 system-ui;white-space:pre-wrap';
      document.body.append(box);
    }
    box.textContent = `Office v2 could not finish loading. ${message}\nUse Reconnect above. If the error continues, close the panel and check the extension package.`;
  };
  if (document.body) show(); else document.addEventListener('DOMContentLoaded', show, { once: true });
}
window.addEventListener('error', (event) => {
  if (event.message) showOfficeFailure(event.message);
  else if (event.target instanceof HTMLScriptElement) showOfficeFailure('A packaged script could not load.');
}, true);
window.addEventListener('unhandledrejection', (event) => showOfficeFailure(event.reason?.message ?? 'An unexpected loading error occurred.'));
