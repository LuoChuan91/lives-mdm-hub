let mode = 'login';
const form = document.querySelector('#auth-form');
const error = document.querySelector('#auth-error');
const submit = document.querySelector('#auth-submit');
const help = document.querySelector('#role-help');
function roleHelp() {
  help.textContent = form.role.value === 'requester' ? 'Create requests, track progress and explore reports.' : form.role.value === 'mdm' ? 'Review master data, prepare SAP imports and manage configuration.' : 'Review approvals assigned to your role, track requests and explore reports.';
}
form.role.addEventListener('change', roleHelp); roleHelp();
document.querySelectorAll('[data-mode]').forEach(button => button.addEventListener('click', () => {
  mode = button.dataset.mode;
  document.querySelectorAll('[data-mode]').forEach(b => b.setAttribute('aria-pressed', String(b === button)));
  document.querySelector('#auth-title').textContent = mode === 'login' ? 'Sign in to your workspace' : 'Create your account';
  submit.textContent = mode === 'login' ? 'Sign in' : 'Create account';
  form.password.autocomplete = mode === 'login' ? 'current-password' : 'new-password';
  error.hidden = true;
}));
form.addEventListener('submit', async event => {
  event.preventDefault(); submit.disabled = true; error.hidden = true;
  try {
    if (location.protocol === 'file:') throw new Error('Open http://localhost:8000/login.html instead of opening the HTML file directly.');
    const response = await fetch(`/api/${mode}`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(Object.fromEntries(new FormData(form)))});
    const body = await response.text();
    let result;
    try { result = JSON.parse(body); }
    catch {
      throw new Error('The login server did not return account data. Run python3 server.py, then open http://localhost:8000/login.html. VS Code Live Server cannot process logins.');
    }
    if (!response.ok) throw new Error(result?.error || `Sign in failed (HTTP ${response.status}). Please try again.`);
    if (!result?.username || !result?.role) throw new Error('Invalid login response. Restart python3 server.py and open http://localhost:8000/login.html.');
    location.href = '/';
  } catch (e) {
    error.textContent = e instanceof TypeError
      ? 'Cannot reach the login server. Keep python3 server.py running and open http://localhost:8000/login.html, then try again.'
      : e.message || 'Unable to connect to the Python server.';
    error.hidden = false;
  }
  finally { submit.disabled = false; }
});
