// Checks who is signed in, then loads the app.
// - With `python3 server.py`, the account server answers api/me from its session cookie.
// - Anywhere else (GitHub Pages, `python3 -m http.server`, a file opened from disk) there is no account
//   server, so the session saved by the login page in this browser is used (assets/session.js).
// No session either way: go to the login page. Paths are relative so the app also works from a
// sub-folder such as https://<user>.github.io/<repo>/.
(async () => {
  window.HUB_DEFER_START = true;
  let user = null;
  let auth = 'browser';
  if (location.protocol !== 'file:') {
    try {
      const response = await fetch('api/me', { cache: 'no-store', credentials: 'same-origin' });
      if ((response.headers.get('content-type') || '').includes('application/json')) {
        auth = 'server';
        if (response.ok) user = await response.json();
      }
    } catch (e) {
      // network error: no account server
    }
  }
  if (auth === 'browser') user = window.HubSession.read();
  if (!user || !user.username || !user.persona) { location.replace('login.html'); return; }
  window.HUB_USER = user;
  window.HUB_AUTH = auth;
  try {
    for (const file of ['demo-accounts', 'data', 'engine', 'charts', 'app', 'insights', 'market']) {
      await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = `assets/${file}.js`;
        script.onload = resolve;
        script.onerror = reject;
        document.body.append(script);
      });
    }
    window.App.start();
  } catch (e) {
    // a server session that expired makes the server refuse the app's scripts
    if (auth === 'server') { location.replace('login.html'); return; }
    const view = document.getElementById('view');
    if (view) view.innerHTML = '<p style="padding:24px">The app could not load. Check that the assets folder sits next to index.html, then reload.</p>';
  }
})();
