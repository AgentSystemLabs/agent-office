import { L, translatePage } from './i18n';

translatePage();

// An invite link, /join#<token>: make your own account, then walk in. The token rides in the
// fragment, so it never reaches a server log or a Referer header.
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const token = location.hash.slice(1);
const form = $<HTMLFormElement>('form');
const name = $<HTMLInputElement>('name');
const password = $<HTMLInputElement>('password');
const again = $<HTMLInputElement>('again');
const submit = $<HTMLButtonElement>('submit');
const error = $('error');

function fail(msg: string) {
  $('sub').textContent = '';
  form.hidden = true;
  error.textContent = msg;
  $('login').hidden = false;
}

async function post(body: Record<string, unknown>): Promise<{ ok: boolean; body: any }> {
  const res = await fetch('/api/join', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token, ...body }) });
  return { ok: res.ok, body: await res.json().catch(() => ({})) };
}

async function peek() {
  if (!token) return fail(L.auth.noInviteCode);
  try {
    const r = await post({ peek: true });
    if (!r.ok) return fail(r.body.error ?? L.auth.badInvite);
    const { name: invited, role, by, project } = r.body as { name?: string; role: string; by: string; project: string };
    $('title').textContent = L.auth.joinOffice(project);
    const sub = $('sub');
    sub.replaceChildren(role === 'admin' ? L.auth.invitedAs(by) : L.auth.invitedYou(by));
    if (role === 'admin') {
      const pill = document.createElement('span');
      pill.className = 'role';
      pill.textContent = 'admin';
      sub.append(pill, '.');
    }
    sub.append(L.auth.makeYourOwn);
    if (invited) {
      name.value = invited;
      name.readOnly = true;
      name.title = L.auth.invitedName;
    }
    form.hidden = false;
    (invited ? password : name).focus();
  } catch {
    fail(`${L.auth.unreachable}.`);
  }
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  error.textContent = '';
  if (password.value !== again.value) {
    error.textContent = L.auth.noMatch;
    again.select();
    return;
  }
  submit.disabled = true;
  try {
    const r = await post({ name: name.value.trim(), password: password.value });
    if (!r.ok) {
      error.textContent = r.body.error ?? L.auth.couldNotMake;
      return;
    }
    try {
      localStorage.setItem('agent-office.login-name', r.body.name);
    } catch {
      // storage blocked
    }
    location.replace('/');
  } catch {
    error.textContent = L.auth.unreachable;
  } finally {
    submit.disabled = false;
  }
});

void peek();
