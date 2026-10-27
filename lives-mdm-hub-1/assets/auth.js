// Check who is signed in (server cookie or browser session), then load the app or go to login.
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
