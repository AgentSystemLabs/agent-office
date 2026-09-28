// The browser's "Leave site?" prompt, so Cmd+W or a stray reload doesn't drop you out of the
// office. The office's own navigations (the login redirect, signing out, loading an upgrade) go
// through leaveTo / reloadPage, which skip the prompt.

let leaving = false;

/** Asks before the page closes or reloads. Browsers only ask once you've clicked or typed in the page. */
export function guardLeaving() {
  window.addEventListener('beforeunload', (e) => {
    if (leaving) return;
    e.preventDefault();
    // Safari and older Chrome ask only when returnValue is set.
    e.returnValue = '';
  });
}

export function leaveTo(url: string) {
  leaving = true;
  location.href = url;
}

export function reloadPage() {
  leaving = true;
  location.reload();
}
