(async () => {
  try {
    const response = await fetch('/api/me');
    if (!response.ok) { location.replace('/login.html'); return; }
    window.HUB_USER = await response.json();
    for (const file of ['data', 'engine', 'charts', 'app', 'insights']) {
      await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = `assets/${file}.js`; script.onload = resolve; script.onerror = reject;
        document.body.append(script);
      });
    }
    window.App.start();
  } catch { location.replace('/login.html'); }
})();
