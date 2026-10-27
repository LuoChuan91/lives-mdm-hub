// Sign-in and registration. Without server.py, passwords are checked in the browser (assets/accounts.js).
let mode = 'login';
const form = document.querySelector('#auth-form');
const error = document.querySelector('#auth-error');
const submit = document.querySelector('#auth-submit');
const help = document.querySelector('#role-help');
const LOCAL_ACCOUNTS = 'mdm-hub-local-accounts-v1';

function roleHelp() {
  const role = form.role.value;
  help.textContent = role.startsWith('requester') ? 'Create requests, track progress and explore reports.'
    : role === 'mdm' ? 'Review master data, prepare SAP imports and manage configuration.'
    : 'Review approvals assigned to your role, track requests and explore reports.';
}
form.role.addEventListener('change', roleHelp);
roleHelp();

document.querySelectorAll('[data-mode]').forEach((button) => button.addEventListener('click', () => {
  mode = button.dataset.mode;
  document.querySelectorAll('[data-mode]').forEach((b) => b.setAttribute('aria-pressed', String(b === button)));
  document.querySelector('#auth-title').textContent = mode === 'login' ? 'Sign in to your workspace' : 'Create your account';
  submit.textContent = mode === 'login' ? 'Sign in' : 'Create account';
  form.password.autocomplete = mode === 'login' ? 'current-password' : 'new-password';
  error.hidden = true;
}));

const DEMO = window.HUB_DEMO_ACCOUNTS;
function fillAccount(username) {
  const person = DEMO && DEMO.people.find((p) => p.username === username);
  if (!person) return;
  if (mode !== 'login') document.querySelector('[data-mode="login"]').click();
  form.username.value = person.username;
  form.password.value = DEMO.password;
  form.role.value = person.role;
  roleHelp();
  submit.focus();
}
const list = document.querySelector('#demo-accounts');
if (DEMO && list) {
  document.querySelector('#demo-password').textContent = DEMO.password;
  list.innerHTML = DEMO.people.map((p) => `<button type="button" class="auth-demo-person" data-user="${p.username}"><b>${p.name}</b><span>${p.title}</span><code>${p.username}</code></button>`).join('');
  list.addEventListener('click', (e) => { const b = e.target.closest('[data-user]'); if (b) fillAccount(b.dataset.user); });
}

function validate(data) {
  const username = String(data.username || '').trim().toLowerCase();
  const password = data.password;
  const ok = typeof password === 'string' && username.length >= 3 && username.length <= 40 && /^[a-z0-9._-]+$/.test(username)
    && password.length >= 8 && password.length <= 128;
  if (!ok) throw new Error('Use a 3–40 character username, an 8–128 character password and a valid role.');
  return { username, password, role: data.role };
}

async function serverAuth(data) {
  if (location.protocol === 'file:' || window.HUB_SINGLE) return null;
  let response;
  try {
    response = await fetch(`api/${mode}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  } catch (e) {
    return null; // nothing listening: no account server
  }
  if (!(response.headers.get('content-type') || '').includes('application/json')) return null; // a static host
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `Sign in failed (HTTP ${response.status}). Please try again.`);
  if (!result.username || !result.role) throw new Error('Invalid login response. Restart python3 server.py and try again.');
  return result;
}

const hex = (bytes) => Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('');
const unhex = (s) => new Uint8Array(s.match(/../g).map((h) => parseInt(h, 16)));
async function pbkdf2(password, salt, iterations) {
  if (!window.crypto || !crypto.subtle) throw new Error('This browser cannot check passwords on this address. Open the page through https or localhost.');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: unhex(salt), iterations }, key, 256));
}
function loadAccounts() {
  if (window.HUB_ACCOUNTS) return Promise.resolve(window.HUB_ACCOUNTS);
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'assets/accounts.js';
    script.onload = () => (window.HUB_ACCOUNTS ? resolve(window.HUB_ACCOUNTS) : reject(new Error('The account list did not load.')));
    script.onerror = () => reject(new Error('The account list (assets/accounts.js) could not be loaded.'));
    document.head.append(script);
  });
}
function localAccounts() {
  try { return JSON.parse(localStorage.getItem(LOCAL_ACCOUNTS) || '[]'); } catch (e) { return []; }
}
async function browserAuth({ username, password, role }) {
  const accounts = await loadAccounts();
  if (!accounts.roles[role]) throw new Error('Use a 3–40 character username, an 8–128 character password and a valid role.');
  const all = accounts.users.concat(localAccounts());
  let user = all.find((u) => u.username === username);
  if (mode === 'register') {
    if (user) throw new Error('Username already registered.');
    const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
    user = { username, role, salt, password_hash: await pbkdf2(password, salt, accounts.iterations) };
    try { localStorage.setItem(LOCAL_ACCOUNTS, JSON.stringify(localAccounts().concat(user))); } catch (e) { /* kept for this visit only */ }
  } else if (!user || user.role !== role || (await pbkdf2(password, user.salt, accounts.iterations)) !== user.password_hash) {
    throw new Error('Username, password or role is incorrect.');
  }
  const session = { username, role, persona: accounts.roles[role] };
  window.HubSession.write(session);
  return session;
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  submit.disabled = true;
  error.hidden = true;
  const label = submit.textContent;
  submit.textContent = mode === 'login' ? 'Signing in…' : 'Creating account…';
  try {
    const data = validate(Object.fromEntries(new FormData(form)));
    const user = (await serverAuth(data)) || (await browserAuth(data));
    if (window.HUB_ON_LOGIN) window.HUB_ON_LOGIN(user); // the offline file: start the app in place
    else location.href = 'index.html';
  } catch (e) {
    error.textContent = e.message || 'Unable to sign in. Please try again.';
    error.hidden = false;
  } finally {
    submit.disabled = false;
    submit.textContent = label;
  }
});
