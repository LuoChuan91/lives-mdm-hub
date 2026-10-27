// Browser session, used when there is no account server
(function () {
  const KEY = 'mdm-hub-session-v1';
  const HOURS = 8;
  let memory = null; // used when the browser blocks storage

  function get(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
  function set(key, value) { try { localStorage.setItem(key, value); return true; } catch (e) { return false; } }
  function remove(key) { try { localStorage.removeItem(key); } catch (e) { /* ignore */ } }

  window.HubSession = {
    read() {
      let s = memory;
      const raw = get(KEY);
      if (raw) { try { s = JSON.parse(raw); } catch (e) { s = null; } }
      if (!s || !s.user || !s.expires || s.expires < Date.now()) return null;
      return s.user;
    },
    write(user) {
      memory = { user, expires: Date.now() + HOURS * 3600 * 1000 };
      set(KEY, JSON.stringify(memory));
    },
    clear() { memory = null; remove(KEY); },
  };
})();
