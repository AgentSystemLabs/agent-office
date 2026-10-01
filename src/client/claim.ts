import { L, translatePage } from './i18n';

translatePage();
// One-time password reveal: /claim?t=<token>. The server forgets the plaintext as soon as it answers.
const $ = (id: string) => document.getElementById(id)!;
const token = new URLSearchParams(location.search).get('t') ?? '';
// Keep the single-use token out of the address bar and history.
history.replaceState(null, '', '/claim');

function fail(msg: string) {
  $('sub').textContent = '';
  $('error').textContent = msg;
  $('login').hidden = false;
}

async function claim() {
  if (!token) return fail(L.auth.noClaimToken);
  try {
    const res = await fetch('/api/claim', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token }) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return fail(body.error ?? L.auth.couldNotUnlock);
    $('sub').textContent = L.auth.oneLast;
    $('pw').textContent = body.password;
    $('reveal').hidden = false;
  } catch {
    fail(`${L.auth.unreachable}.`);
  }
}

$('copy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText($('pw').textContent ?? '');
    $('copy').textContent = L.auth.copied;
  } catch {
    getSelection()?.selectAllChildren($('pw'));
  }
});
($('saved') as HTMLInputElement).addEventListener('change', (e) => {
  ($('enter') as HTMLButtonElement).disabled = !(e.target as HTMLInputElement).checked;
});
$('enter').addEventListener('click', () => location.replace('/'));
window.addEventListener('beforeunload', (e) => {
  if (!$('reveal').hidden && !($('saved') as HTMLInputElement).checked) e.preventDefault();
});
void claim();
