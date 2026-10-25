/* MDM Request Hub - app shell and the workflow pages.
   State lives in the viewer's browser (localStorage, with a reset button); every judge starts from the
   same seeded demo. Insight pages (regional view, inbox sorting, business case) are in insights.js. */
(function () {
  'use strict';
  const H = window.HUB_DATA;
  const E = window.Engine;
  const C = window.Charts;
  const esc = C.esc;
  E.init(H.textnorm);
  E.loadModel(H.triage.model);
  const ENV = window.HUB_ENV || 'pages';
  const STORE_KEY = 'mdm-hub-state-v4';
  const UI_KEY = 'mdm-hub-ui-v4-' + window.HUB_USER.username;
  const App = (window.App = { views: {}, actions: {}, H, E, C, esc });

  let state = null;
  let ui = null;

  // ---------------------------------------------------------------- persistence
  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) { const s = JSON.parse(raw); if (s && s.version === 4) state = s; }
    } catch (e) { /* storage unavailable: run from the seed */ }
    if (!state) state = E.seedState(H);
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(UI_KEY) || 'null'); } catch (e) { saved = null; }
    ui = Object.assign({
      route: 'home', persona: 'amy', regionalView: 'dedup', product: 'A', chartMode: 'region', trackerFilter: 'all', search: '',
      approvalsTab: 'mine', deskTab: 'check', adminTab: 'bu', adminDomain: 'customer', signalsTab: 'quiet', draft: null,
      showErrors: false, lastSubmitted: null, drawer: null, revealed: {}, confirmReset: false, menuOpen: false, auditFilter: '',
    }, saved || {});
    ui.drawer = null; ui.confirmReset = false; ui.revealed = {};
    ui.persona = window.HUB_USER.persona;
  }
  function save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(state));
      const { drawer, revealed, confirmReset, ...rest } = ui;
      localStorage.setItem(UI_KEY, JSON.stringify(rest));
    } catch (e) { /* ignore */ }
  }
  App.getState = () => state;
  App.getUI = () => ui;
  App.save = save;

  // ---------------------------------------------------------------- formatting helpers
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const fmtDT = (iso) => { if (!iso) return ''; const d = E.toDate(iso.length === 10 ? iso + 'T00:00' : iso); return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MON[d.getUTCMonth()]}, ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`; };
  const fmtD = (iso) => { if (!iso) return ''; const d = E.toDate(iso.length === 10 ? iso + 'T00:00' : iso); return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MON[d.getUTCMonth()]}`; };
  const fmtShort = (iso) => { if (!iso) return ''; const d = E.toDate(iso.length === 10 ? iso + 'T00:00' : iso); return `${d.getUTCDate()} ${MON[d.getUTCMonth()]}`; };
  const num = (v) => (v === null || v === undefined ? '–' : Number(v).toLocaleString('en-SG', { maximumFractionDigits: 0 }));
  const num1 = (v) => (v === null || v === undefined ? '–' : Number(v).toLocaleString('en-SG', { minimumFractionDigits: 1, maximumFractionDigits: 1 }));
  const money = (v) => {
    const a = Math.abs(v);
    if (a >= 1e6) return `SGD ${(v / 1e6).toFixed(a >= 1e7 ? 0 : 1)}M`;
    if (a >= 1e4) return `SGD ${Math.round(v / 1e3)}k`;
    if (a >= 1e3) return `SGD ${(v / 1e3).toFixed(1)}k`;
    return `SGD ${num(v)}`;
  };
  const pct = (v, signed) => (v === null || v === undefined ? '–' : `${signed && v > 0 ? '+' : ''}${(v * 100).toFixed(Math.abs(v) < 0.1 && v !== 0 ? 1 : 0)}%`);
  const person = (id) => E.personById(state.config, id);
  const pname = (id) => (id === 'system' ? 'System' : person(id) ? person(id).name : id);
  const initials = (name) => String(name || '?').replace(/^Dr\s+/, '').split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  const avatar = (id, cls) => `<span class="avatar ${cls || ''}" aria-hidden="true">${esc(initials(pname(id)))}</span>`;
  const domainLabel = (k) => E.domainLabel(state.config, k);
  const productName = (p) => (H.meta.products.find((x) => x.code === p) || {}).name || p;
  const countryName = (c) => (H.meta.countries.find((x) => x.code === c) || {}).name || c;
  const ICON = {
    lock: '<svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true" style="vertical-align:-1px"><path fill="currentColor" d="M4 7V5a4 4 0 1 1 8 0v2h1a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1h1zm2 0h4V5a2 2 0 1 0-4 0v2z"/></svg>',
    check: '<svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M6.2 11.6 2.6 8l1.4-1.4 2.2 2.2 5.8-5.8L13.4 4.4z"/></svg>',
  };
  Object.assign(App, { fmtDT, fmtD, fmtShort, num, num1, money, pct, person, pname, avatar, productName, countryName, ICON, initials });

  function statusPill(s) {
    const cls = { 'In approval': 'info', 'Needs info': 'warn', 'MDM check': 'accent', 'Ready for SAP import': 'accent', Completed: 'good', Rejected: 'critical' }[s] || '';
    return `<span class="pill ${cls}">${esc(s)}</span>`;
  }
  function taskChip(t) {
    if (t.status === 'Approved') return `<span class="pill good">Approved</span>`;
    if (t.status === 'Rejected') return `<span class="pill critical">Rejected</span>`;
    if (t.status === 'Info requested') return `<span class="pill warn">Asked for info</span>`;
    if (t.status === 'Waiting') return `<span class="pill plain">Waiting for earlier step</span>`;
    if (t.status === 'Cancelled') return `<span class="pill plain">Cancelled</span>`;
    if (t.escalated) return `<span class="pill critical">Escalated</span>`;
    if (t.reminders) return `<span class="pill serious">Overdue · reminded</span>`;
    if (t.dueAt && state.now >= t.dueAt) return `<span class="pill serious">Overdue</span>`;
    if (t.dueAt && t.dueAt.slice(0, 10) === state.now.slice(0, 10)) return `<span class="pill warn">Due today ${t.dueAt.slice(11)}</span>`;
    return `<span class="pill info">Due ${esc(fmtD(t.dueAt))}</span>`;
  }
  App.statusPill = statusPill;
  App.taskChip = taskChip;

  function progressIndex(req) {
    return { 'In approval': 1, 'Needs info': 1, 'MDM check': 2, 'Ready for SAP import': 3, Completed: 4, Rejected: 1 }[req.status];
  }
  function tracker(req, labels) {
    const idx = progressIndex(req);
    const stuck = req.status === 'Needs info' || req.status === 'Rejected' || req.approvals.some((a) => a.status === 'Pending' && a.reminders);
    const steps = ['Submitted', `Approvals ${req.approvals.filter((a) => a.status === 'Approved').length}/${req.approvals.filter((a) => a.role !== 'MDM').length}`, 'MDM check', 'SAP import', 'Live'];
    let s = '<div class="track" aria-hidden="true">';
    steps.forEach((_, i) => {
      const cls = i < idx || (i === 4 && idx === 4) ? 'done' : i === idx ? (stuck ? 'stuck' : 'now') : '';
      s += `<div class="track-step ${cls}"><span class="track-dot"></span>${i < steps.length - 1 ? '<span class="track-line"></span>' : ''}</div>`;
    });
    s += '</div>';
    if (labels) s += `<div class="track-labels">${steps.map((l) => `<span>${esc(l)}</span>`).join('')}</div>`;
    return s + `<span class="sr">Stage: ${esc(steps[Math.min(idx, 4)])}</span>`;
  }
  App.tracker = tracker;

  function waitingOn(req) {
    if (req.status === 'Needs info') return `${pname(req.requester)} (requestor)`;
    if (req.status === 'MDM check' || req.status === 'Ready for SAP import') return 'Priya (MDM team)';
    if (req.status === 'In approval') return req.approvals.filter((a) => a.status === 'Pending').map((a) => pname(a.assignee)).join(', ');
    return '';
  }
  App.waitingOn = waitingOn;

  const openTasksFor = (pid) => {
    const out = [];
    for (const r of state.requests) for (const a of r.approvals) if (a.assignee === pid && (a.status === 'Pending' || a.status === 'Info requested') && ['In approval', 'Needs info'].includes(r.status)) out.push({ req: r, task: a });
    return out;
  };
  App.openTasksFor = openTasksFor;

  let toastTimer = null;
  function toast(msg) {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 4200);
  }
  App.toast = toast;

  // ---------------------------------------------------------------- routing and rendering
  const ROUTES = ['home', 'request', 'approvals', 'tracker', 'desk', 'admin', 'regional', 'inbox', 'case'];
  function go(route) {
    ui.route = ROUTES.includes(route) ? route : 'home';
    ui.menuOpen = false;
    try { if (location.hash.replace('#', '') !== ui.route) history.replaceState(null, '', '#' + ui.route); } catch (e) { /* ignore */ }
    save();
    render();
    const main = document.getElementById('view');
    if (main) { main.focus({ preventScroll: true }); window.scrollTo(0, 0); }
  }
  App.go = go;

  function allowed(route) {
    const role = window.HUB_USER.role;
    if (['desk', 'admin'].includes(route)) return role === 'mdm';
    if (route === 'request') return role === 'requester';
    return true;
  }
  function render() {
    ui.persona = window.HUB_USER.persona;
    state.now = new Date().toISOString().slice(0, 16);
    E.tick(state, state.now);
    if (!allowed(ui.route)) ui.route = 'home';
    const active = document.activeElement;
    const activeId = active && active.id;
    let sel = null;
    if (active && 'selectionStart' in active) { try { sel = [active.selectionStart, active.selectionEnd]; } catch (e) { sel = null; } }
    const rail = document.getElementById('rail');
    document.getElementById('account-name').textContent = window.HUB_USER.username;
    rail.innerHTML = renderRail();
    rail.dataset.open = String(!!ui.menuOpen);
    const view = App.views[ui.route] || App.views.home;
    document.getElementById('view').innerHTML = view();
    document.getElementById('drawer-root').innerHTML = ui.drawer ? renderDrawer(ui.drawer) : '';
    if (activeId) {
      const el = document.getElementById(activeId);
      if (el) { el.focus({ preventScroll: true }); if (sel && el.setSelectionRange && el.type !== 'number' && el.type !== 'email') { try { el.setSelectionRange(sel[0], sel[1]); } catch (e) { /* ignore */ } } }
    }
    if (App.afterRender[ui.route]) App.afterRender[ui.route]();
  }
  App.render = render;
  App.afterRender = {};
  // Charts are drawn at the pixel width they will occupy, so their text stays at its real size on any screen.
  App.chartWidth = function (fraction) {
    const view = document.getElementById('view');
    const vw = view && view.clientWidth ? view.clientWidth : Math.max(320, window.innerWidth - (window.innerWidth > 1000 ? 300 : 32));
    const inner = vw - 38;
    const w = fraction === 'half' ? (vw > 900 ? (inner - 16) / 2 : inner) : inner;
    return Math.max(280, Math.round(w));
  };

  function renderRail() {
    const p = person(ui.persona);
    const myTasks = openTasksFor(ui.persona).length + state.requests.filter((r) => r.status === 'Needs info' && r.requester === ui.persona).length;
    const open = state.requests.filter((r) => !['Completed', 'Rejected'].includes(r.status)).length;
    const deskCount = state.requests.filter((r) => ['MDM check', 'Ready for SAP import'].includes(r.status)).length;
    const nav = [
      ['home', 'Home'], ['request', 'New request'], ['approvals', 'My approvals', myTasks, myTasks > 0], ['tracker', 'Request tracker', open],
      ['desk', 'MDM desk', deskCount, p.role === 'MDM' && deskCount > 0], ['admin', 'Settings'],
    ];
    const insights = [['regional', 'Regional view'], ['inbox', 'Inbox sorting'], ['case', 'Business case']];
    const link = ([r, label, count, hot]) => `<a href="#${r}" data-action="go" data-route="${r}" ${ui.route === r ? 'aria-current="page"' : ''}><span>${esc(label)}</span>${count ? `<span class="count ${hot ? 'hot' : ''}">${count}</span>` : ''}</a>`;
    return `
      <div class="rail-top">
        <div class="brand"><div class="brand-mark">MDM</div><div><div class="brand-name">MDM Request Hub</div><div class="brand-sub">Lives Group · prototype · synthetic data</div></div></div>
        <button class="btn small menu-toggle" data-action="menu" aria-expanded="${ui.menuOpen}">${ui.menuOpen ? 'Close' : 'Menu'}</button>
      </div>
      <nav class="nav" aria-label="Main">${nav.filter(([r]) => allowed(r)).map(link).join('')}<div class="nav-group label">Insights</div>${insights.map(link).join('')}</nav>
      `;
  }

  // ---------------------------------------------------------------- home
  App.views.home = function () {
    const open = state.requests.filter((r) => !['Completed', 'Rejected'].includes(r.status));
    const overdue = state.requests.flatMap((r) => r.approvals.filter((a) => a.status === 'Pending' && a.dueAt && state.now >= a.dueAt));
    const avgAge = open.length ? open.reduce((s, r) => s + E.workingDaysBetween(r.createdAt, state.now), 0) / open.length : 0;
    const hist = H.business_case.history, sim = H.business_case.sim;
    const steps = [
      ['amy-item', 'Amy requests a new reagent pack. The licence field appears and Quality/Regulatory joins the route automatically.', 'Start as Amy'],
      ['marcus-dup', 'Marcus starts a customer called "Natl Univ Hosp". The form shows it already exists, before any approver sees it.', 'Start as Marcus'],
      ['weijie', 'Wei Jie approves from a Teams-style card. Bank details stay masked until he chooses to see them, and that view is logged.', 'Open as Wei Jie'],
      ['priya-bu', 'Priya adds Marcus\'s new business unit in Settings. No IT ticket, and his requests route to his own head.', 'Open Settings as Priya'],
      ['priya-desk', 'Priya passes the final check and exports the SAP Business One import file.', 'Open MDM desk as Priya'],
      ['regional', 'Growth by country and product, the forecast, and what changes once duplicate customers are merged.', 'Open regional view'],
    ];
    const personas = [
      ['amy', 'Copied an old email, guessed at the regulatory field and waited 18 days for an item code.', 'The form asks for the licence only when the item needs one and routes to Quality/Regulatory by itself.'],
      ['weijie', 'Requests sat unseen in his inbox for four days.', 'A card in Teams with the facts he checks, and a reminder if it waits two working days.'],
      ['priya', 'Keyed every record by hand and relied on memory to spot near-duplicates.', 'Duplicates are caught at the form; approved records arrive as an import file.'],
      ['marcus', 'His new team\'s requests went to the wrong people and sat for two weeks.', 'His business unit is added in Settings in a minute and requests route to his head.'],
    ];
    return `
      <div class="page-head"><div><span class="label">Lives Group · master data</span><h1>Master Data Dashboard</h1>
        <p>One request form that stops incomplete and duplicate requests, parallel approvals in Teams and Outlook, a live status page and an import file for SAP Business One. The same clean records feed the regional sales view.</p></div>
        <div class="row"><button class="btn primary" data-action="go" data-route="request">Start a request</button><button class="btn" data-action="go" data-route="regional">Regional view</button></div></div>
      <section class="panel"><div class="hero-compare">
        <div><div class="label">Email process, last 12 months</div><div class="hero-num tnum">${num1(hist.mean)}<small>days</small></div><div class="small muted">${num(hist.requests)} requests · 1 in 10 took over ${num(hist.p90)} days</div></div>
        <div class="hero-arrow" aria-hidden="true">→</div>
        <div><div class="label">With the request hub, simulated</div><div class="hero-num tnum" style="color:var(--accent)">${num1(sim.proposed.mean)}<small>days</small></div><div class="small muted">${Math.round(sim.proposed.share_within_5 * 100)}% within 5 days · <a href="#case" data-action="go" data-route="case">see the model</a></div></div>
      </div></section>
      <div class="grid four">
        ${tile('Open requests', num(open.length), `${state.requests.filter((r) => r.status === 'Needs info').length} waiting on requestors`)}
        ${tile('Approvals past target', num(overdue.length), `Target: ${state.config.settings.slaDays} working days`, overdue.length ? 'critical' : '')}
        ${tile('Duplicates stopped at the form', num(state.stats.duplicatesStopped), 'Before any approver saw them')}
        ${tile('Average age of open requests', `${num1(avgAge)} days`, 'Working days')}
      </div>
      <section class="panel"><div class="panel-head"><div><h2>How a request flows</h2><p>Every step reads its fields, rules and approvers from Settings, so the MDM team changes the process without IT.</p></div></div>
        <div class="flow">
          <div class="flow-step key"><strong>Request form</strong><span class="small">Fields change by request type. Live duplicate check. Rules pick the approvers.</span><span class="who">Amy, Marcus, Nurul</span></div><span class="flow-arrow">→</span>
          <div class="flow-step"><strong>Parallel approvals</strong><span class="small">Finance, Quality/Regulatory and the BU head review at the same time, in Teams or Outlook.</span><span class="who">Wei Jie, Dr Siti, Daniel</span></div><span class="flow-arrow">→</span>
          <div class="flow-step"><strong>MDM final check</strong><span class="small">Re-check duplicates, assign the SAP code, add to the import file.</span><span class="who">Priya</span></div><span class="flow-arrow">→</span>
          <div class="flow-step"><strong>SAP Business One</strong><span class="small">Import file loaded through the Data Transfer Workbench. Requestor told it is live.</span><span class="who">One clean record per customer</span></div><span class="flow-arrow">→</span>
          <div class="flow-step"><strong>Regional view</strong><span class="small">Orders by country and product, growth, forecast and sales actions.</span><span class="who">Sales and management</span></div>
        </div></section>
      <div class="grid sidebar">
        <section class="panel"><div class="panel-head"><h2>Your workspace</h2></div><p>Track requests, review assigned approvals and explore regional performance from the navigation. Your account determines which workflow tools are available.</p></section>
        <section class="panel"><div class="panel-head"><div><h2>For the people in the brief</h2></div></div>
          <div class="stack">${personas.map(([id, before, after]) => `<div class="stack tight"><div class="row">${avatar(id)}<strong>${esc(pname(id))}</strong><span class="muted small">${esc(person(id).title)}</span></div><div class="ba"><div class="before"><b>Before.</b> ${esc(before)}</div><div class="after"><b>Now.</b> ${esc(after)}</div></div></div>`).join('')}</div></section>
      </div>
      <p class="footnote">Prototype with synthetic data generated for the SMU DSA case competition. Names, registration numbers, volumes and bank details are invented, apart from National University Hospital, which the case brief uses as its example. The production design runs on Microsoft 365 (Power Apps, Power Automate, SharePoint) and SAP Business One; see the business case for the mapping.</p>`;
  };
  function tile(label, value, note, tone) {
    return `<div class="tile"><span class="tile-label">${esc(label)}</span><span class="tile-value tnum" ${tone === 'critical' ? 'style="color:var(--critical-ink)"' : ''}>${value}</span><span class="tile-note">${esc(note)}</span></div>`;
  }
  App.tile = tile;

  // ---------------------------------------------------------------- new request
  function freshDraft(domain) {
    const p = person(ui.persona);
    return { domain: domain || 'customer', bu: p && p.bu ? p.bu : '', data: {}, type: 'new', dup: { decision: 'none' } };
  }
  function draft() {
    if (!ui.draft) ui.draft = freshDraft();
    return ui.draft;
  }

  const DOMAIN_INFO = {
    customer: 'A hospital, lab or clinic we will sell to',
    item: 'A product or service we will sell or buy',
    vendor: 'A supplier, principal or service provider',
    cost_centre: 'A reporting unit for spend',
  };

  App.views.request = function () {
    const d = draft();
    const p = person(ui.persona);
    const cfg = state.config;
    const bus = cfg.businessUnits.filter((b) => b.active);
    const fields = E.visibleFields(cfg, d.domain, d.data);
    const v = E.validate(cfg, d.domain, d.data);
    const last = ui.lastSubmitted ? state.requests.find((r) => r.id === ui.lastSubmitted) : null;
    const clones = cloneSources(d.domain);
    return `
      <div class="page-head"><div><span class="label">New request</span><h1>What do you need set up?</h1><p>Requested by ${esc(p.name)} · ${esc(p.title)}${p.bu ? ' · ' + esc(p.bu) : ''}. Required fields change with the request type, and the duplicate check runs as you type.</p></div></div>
      ${last ? `<div class="notice good" role="status"><span class="icon">${ICON.check}</span><div class="stack tight"><strong>${esc(last.id)} submitted: ${esc(last.title)}</strong><span class="small">${last.approvals.length ? `${last.approvals.map((a) => esc(pname(a.assignee))).join(', ')} ${last.approvals.length > 1 ? 'were' : 'was'} notified in Teams and Outlook and can approve at the same time.` : 'Sent straight to the MDM team.'} Expected in SAP B1 by ${esc(fmtD(expectedDone()))}.</span><div class="row"><button class="btn small" data-action="open-req" data-id="${last.id}">Track this request</button><button class="btn small ghost" data-action="dismiss-last">Dismiss</button></div></div></div>` : ''}
      <div class="domain-cards" role="group" aria-label="Request type">${cfg.domains.filter((x) => x.active).map((x) => `<button class="domain-card" data-action="domain" data-domain="${x.key}" aria-pressed="${x.key === d.domain}"><strong>${esc(x.label)}</strong><span>${esc(DOMAIN_INFO[x.key] || x.sap)}</span></button>`).join('')}</div>
      <div class="grid sidebar">
        <section class="panel"><form class="stack" id="request-form" novalidate>
          ${d.type === 'extend' ? `<div class="notice"><span class="icon">i</span><div class="stack tight"><strong>Extending an existing record</strong><span class="small">${esc(d.dup.matchName)} (${esc(d.dup.matchId)}) already exists in SAP B1. This request adds it to ${esc(d.bu || 'your business unit')} instead of creating a second record.</span><button class="btn small ghost" type="button" data-action="dup-undo">Create a new record instead</button></div></div>` : ''}
          <div class="form-grid">
            <div class="field ${ui.showErrors && !d.bu ? 'invalid' : ''}"><label for="f-bu">Business unit <span class="req">*</span></label>
              <select id="f-bu" data-action="bu"><option value="">Choose…</option>${bus.map((b) => `<option value="${b.code}" ${b.code === d.bu ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}</select>
              ${p.kind === 'requester' && !p.bu ? `<span class="help">Can't find your business unit? The MDM team adds new ones in Settings in about a minute.</span>` : ''}
              ${ui.showErrors && !d.bu ? '<span class="err">Required</span>' : ''}</div>
            <div class="field"><label for="f-clone">Copy settings from a similar record</label>
              <select id="f-clone" data-action="clone"><option value="">Start blank</option>${clones.map((c) => `<option value="${esc(c.id)}">${esc(c.label)}</option>`).join('')}</select>
              <span class="help">Copies payment terms, category and similar settings, never names or registration numbers.</span></div>
          </div>
          <hr class="divider">
          <div class="form-grid">${fields.map((f, i) => fieldHtml(f, d.data[f.key], v.errors[f.key]) + (i === 0 ? '<div class="wide" id="dup-panel">' + dupPanel() + '</div>' : '')).join('')}</div>
          <div id="form-errors">${formErrors(v)}</div>
          <div class="row"><button class="btn primary" type="button" data-action="submit-request">Submit request</button><button class="btn ghost" type="button" data-action="clear-request">Clear form</button></div>
        </form></section>
        <div class="stack"><section class="panel" id="route-panel">${routePanel()}</section>
          <section class="panel"><h3>What happens after you submit</h3><ol class="small ink2" style="margin:8px 0 0;padding-left:18px;display:flex;flex-direction:column;gap:4px">
            <li>Every approver gets a card in Teams and an email, at the same time.</li><li>You can see where the request stands on the tracker, any time.</li>
            <li>Anyone who needs more information asks inside the request, not by email.</li><li>Priya checks it, adds it to the SAP B1 import file and you are told when it is live.</li></ol></section></div>
      </div>`;
  };

  function cloneSources(domain) {
    const m = state.master;
    const list = domain === 'customer' ? m.customers.map((r) => ({ id: r.customer_id, label: `${r.name} (${r.customer_id})`, created: r.created }))
      : domain === 'item' ? m.items.map((r) => ({ id: r.item_code, label: `${r.description} (${r.item_code})`, created: r.created }))
      : domain === 'vendor' ? m.vendors.map((r) => ({ id: r.vendor_code, label: `${r.name} (${r.vendor_code})`, created: r.created }))
      : m.cost_centres.map((r) => ({ id: r.code, label: `${r.name} (${r.code})`, created: r.valid_from }));
    return list.sort((a, b) => String(b.created).localeCompare(String(a.created))).slice(0, 25);
  }

  function fieldHtml(f, value, error) {
    const id = `f-${f.key}`;
    const show = ui.showErrors && error;
    const lab = `${esc(f.label)}${f.required ? ' <span class="req">*</span>' : ''}${f.sensitive ? ` <span class="tag" title="Visible to Finance and the MDM team only">${ICON.lock} Finance &amp; MDM only</span>` : ''}`;
    const help = f.help ? `<span class="help">${esc(f.help)}</span>` : '';
    const err = show ? `<span class="err" id="${id}-err">${esc(error)}</span>` : '';
    const wide = f.type === 'textarea' || f.type === 'multi' || f.key === 'description' || f.key === 'legal_name' ? 'wide' : '';
    const val = value === undefined || value === null ? '' : value;
    let input;
    if (f.type === 'select') input = `<select id="${id}" data-field="${f.key}"><option value="">Choose…</option>${(f.options || []).map((o) => `<option ${o === val ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
    else if (f.type === 'textarea') input = `<textarea id="${id}" data-field="${f.key}" rows="2">${esc(val)}</textarea>`;
    else if (f.type === 'multi') input = `<div class="chips" role="group" aria-label="${esc(f.label)}">${(f.options || []).map((o) => `<label class="chip-toggle"><input type="checkbox" id="${id}-${o}" data-field="${f.key}" data-multi="${esc(o)}" ${Array.isArray(val) && val.includes(o) ? 'checked' : ''}> ${esc(f.key === 'products' ? `${o} · ${productName(o)}` : o)}</label>`).join('')}</div>`;
    else if (f.type === 'checkbox') input = `<label class="chip-toggle" style="align-self:flex-start"><input type="checkbox" id="${id}" data-field="${f.key}" ${val === true ? 'checked' : ''}> Yes</label>`;
    else input = `<input id="${id}" data-field="${f.key}" type="${f.type === 'number' ? 'number' : f.type === 'email' ? 'email' : f.type === 'date' ? 'date' : 'text'}" value="${esc(val)}" ${f.placeholder ? `placeholder="${esc(f.placeholder)}"` : ''} autocomplete="off" ${show ? `aria-invalid="true" aria-describedby="${id}-err"` : ''}>`;
    return `<div class="field ${wide} ${show ? 'invalid' : ''}">${f.type === 'multi' || f.type === 'checkbox' ? `<span class="flabel">${lab}</span>` : `<label for="${id}">${lab}</label>`}${input}${help}${err}</div>`;
  }

  function topMatches() {
    const d = draft();
    return E.findMatches(state, d.domain, d.data, d.bu, 3);
  }

  function dupPanel() {
    const d = draft();
    const matches = topMatches();
    const nameKey = state.config.domains.find((x) => x.key === d.domain).nameField;
    if (!String(d.data[nameKey] || '').trim()) return '';
    if (d.dup.decision === 'extend') return '';
    const top = matches[0];
    if (!top || top.band === 'none') return `<div class="dup clear"><div class="dup-head"><strong class="small">No matching records in SAP B1 or in open requests</strong><span class="pill good">Clear</span></div></div>`;
    const tone = top.band;
    const overriding = d.dup.decision === 'override' || d.dup.decision === 'pending';
    const head = tone === 'likely' ? 'This looks like a record that already exists' : 'Possible duplicate: check before you continue';
    const rows = matches.filter((m) => m.band !== 'none').map((m) => {
      const isReq = m.source === 'request';
      const actions = isReq
        ? `<button type="button" class="btn small" data-action="open-req" data-id="${esc(m.id)}">Open that request</button>`
        : `<button type="button" class="btn small" data-action="dup-use" data-id="${esc(m.id)}">Use this record</button>${d.domain === 'customer' || d.domain === 'vendor' || d.domain === 'item' ? `<button type="button" class="btn small ghost" data-action="dup-extend" data-id="${esc(m.id)}">Extend it to my business unit</button>` : ''}`;
      return `<div class="match"><div class="score"><span class="score-num">${Math.round(m.score)}</span><span class="score-bar"><i class="${m.band}" style="width:${m.score}%"></i></span><span class="tiny muted">match</span></div>
        <div class="stack tight"><div class="row"><strong>${esc(m.label)}</strong><span class="tag mono">${esc(m.id)}</span>${isReq ? '<span class="pill info">In progress</span>' : ''}</div><span class="small muted">${esc(m.sub)}</span>
        <ul class="reasons">${m.reasons.map((r) => `<li>${esc(r)}</li>`).join('')}</ul><div class="row" style="margin-top:6px">${actions}</div></div></div>`;
    }).join('');
    const override = overriding
      ? `<div class="match" style="grid-template-columns:1fr"><div class="field"><label for="f-dup-reason">Why is this not the same ${esc(domainLabel(d.domain).toLowerCase())}? <span class="req">*</span></label><input id="f-dup-reason" data-dup-reason type="text" value="${esc(d.dup.reason || '')}" placeholder="e.g. Different pack size: 200 tests, a new item"><span class="help">Saved with the request and shown to approvers and the MDM team.</span></div></div>`
      : `<div class="match" style="grid-template-columns:1fr"><button type="button" class="btn small ghost" data-action="dup-not" data-id="${esc(top.id)}">None of these: it is different</button></div>`;
    return `<div class="dup ${tone}" role="status"><div class="dup-head"><strong class="small">${head}</strong><span class="pill ${tone === 'likely' ? 'critical' : 'warn'}">${tone === 'likely' ? 'Likely duplicate' : 'Possible duplicate'}</span></div>${rows}${override}</div>`;
  }

  function expectedDone() {
    const s = state.config.settings;
    return E.addWorkingDays(E.addWorkingDays(state.now, s.slaDays), s.mdmCheckDays);
  }

  function routePanel() {
    const d = draft();
    const cfg = state.config;
    const steps = E.route(cfg, d.domain, d.data, d.bu);
    const needsBu = steps.some((s) => s.role === 'BU_HEAD' && !s.assignee);
    const stages = [...new Set(steps.map((s) => s.stage))];
    const stepHtml = (s) => `<div class="route-step">${s.assignee ? avatar(s.assignee, 'sm') : '<span class="avatar sm">?</span>'}<div class="stack tight"><strong class="small">${s.assignee ? esc(pname(s.assignee)) : 'Choose a business unit'}</strong><span class="tiny muted">${esc(E.roleLabel(cfg, s.role, s.bu || '…'))}</span><span class="tiny ink2">${esc(s.reasons.join('; '))}</span></div><span class="tiny muted">${s.stage === stages[0] && stages.length === 1 && steps.length > 1 ? 'in parallel' : ''}</span></div>`;
    return `<h3>Who approves</h3><p class="small muted" style="margin:4px 0 12px">Worked out from the rules in Settings as you fill in the form.</p>
      ${steps.length ? `<div class="${steps.length > 1 ? 'parallel-bracket' : ''}">${steps.map(stepHtml).join('')}</div>` : '<p class="small muted">No approvals needed: goes straight to the MDM team.</p>'}
      <div class="route-step">${avatar('priya', 'sm')}<div class="stack tight"><strong class="small">Priya</strong><span class="tiny muted">MDM final check and SAP import</span></div><span></span></div>
      <hr class="divider"><div class="row between small"><span class="ink2">Expected in SAP B1 by</span><strong>${esc(fmtD(expectedDone()))}</strong></div>
      <div class="row between small"><span class="ink2">Same request by email today</span><span class="muted">about ${num(H.business_case.history.by_domain.find((x) => x.domain === (d.domain === 'cost_centre' ? 'Cost centre' : domainLabel(d.domain)))?.mean || H.business_case.history.mean)} days</span></div>
      ${needsBu ? '<p class="small" style="color:var(--warn-ink);margin-top:8px">Choose a business unit to see its head.</p>' : ''}`;
  }

  function formErrors(v) {
    if (!ui.showErrors) return '';
    const d = draft();
    const msgs = [];
    const missing = Object.keys(v.errors).length;
    if (missing) msgs.push(`${missing} field${missing > 1 ? 's need' : ' needs'} attention.`);
    if (!d.bu) msgs.push('Choose a business unit.');
    const top = topMatches()[0];
    if (top && top.band === 'likely' && d.dup.decision !== 'extend' && !(d.dup.decision === 'override' && String(d.dup.reason || '').trim())) msgs.push('Resolve the likely duplicate: use the existing record, extend it, or say why this one is different.');
    if (d.dup.decision === 'pending' && !String(d.dup.reason || '').trim()) msgs.push('Add a reason why this is not a duplicate.');
    return msgs.length ? `<div class="notice critical"><span class="icon">!</span><div>${msgs.map((m) => `<div>${esc(m)}</div>`).join('')}</div></div>` : '';
  }

  // Only touch the DOM when the markup actually changed, so scroll position and clicks are never disturbed.
  function setHTML(id, html) {
    const el = document.getElementById(id);
    if (!el || el._html === html) return;
    el.innerHTML = html;
    el._html = html;
  }
  function refreshRequestSide() {
    setHTML('dup-panel', dupPanel());
    setHTML('route-panel', routePanel());
    setHTML('form-errors', formErrors(E.validate(state.config, draft().domain, draft().data)));
  }

  Object.assign(App.actions, {
    domain(el) { const k = el.dataset.domain; const d = draft(); ui.draft = { ...freshDraft(k), bu: d.bu }; ui.showErrors = false; save(); render(); },
    'dismiss-last'() { ui.lastSubmitted = null; save(); render(); },
    'clear-request'() { ui.draft = freshDraft(draft().domain); ui.showErrors = false; save(); render(); },
    'dup-undo'() { const d = draft(); d.type = 'new'; d.dup = { decision: 'none' }; save(); render(); },
    'dup-not'(el) { const d = draft(); const m = topMatches().find((x) => x.id === el.dataset.id) || topMatches()[0]; d.dup = { decision: 'pending', matchId: m.id, matchName: m.label, score: m.score, reason: '' }; save(); render(); const i = document.getElementById('f-dup-reason'); if (i) i.focus(); },
    'dup-use'(el) {
      const d = draft();
      const m = topMatches().find((x) => x.id === el.dataset.id);
      E.log(state, state.now, ui.persona, 'Duplicate stopped at intake', null, `${pname(ui.persona)} started a new ${domainLabel(d.domain).toLowerCase()} "${d.data[state.config.domains.find((x) => x.key === d.domain).nameField] || ''}" and used the existing record ${m ? m.label + ' (' + m.id + ')' : ''} instead`);
      state.stats.duplicatesStopped += 1;
      ui.draft = freshDraft(d.domain);
      ui.showErrors = false;
      save(); render();
      toast(`No request needed: ${m ? m.label + ' (' + m.id + ')' : 'the record'} already exists in SAP B1. Duplicate avoided.`);
    },
    'dup-extend'(el) {
      const d = draft();
      const m = topMatches().find((x) => x.id === el.dataset.id);
      d.type = 'extend';
      d.dup = { decision: 'extend', matchId: m.id, matchName: m.label, score: m.score };
      save(); render();
      toast(`This request will extend ${m.label} to ${d.bu || 'your business unit'} instead of creating a second record.`);
    },
    'submit-request'() {
      const d = draft();
      const v = E.validate(state.config, d.domain, d.data);
      const top = topMatches()[0];
      const dupOk = !top || top.band !== 'likely' || d.dup.decision === 'extend' || (['override', 'pending'].includes(d.dup.decision) && String(d.dup.reason || '').trim());
      const pendingOk = d.dup.decision !== 'pending' || String(d.dup.reason || '').trim();
      if (!v.ok || !d.bu || !dupOk || !pendingOk) {
        ui.showErrors = true; save(); render();
        const first = document.querySelector('.field.invalid input, .field.invalid select, .field.invalid textarea') || document.getElementById('form-errors');
        if (first && first.focus) first.focus();
        return;
      }
      const dup = d.dup.decision === 'pending' ? { ...d.dup, decision: 'override' } : d.dup;
      const req = E.createRequest(state, { domain: d.domain, bu: d.bu, requester: ui.persona, data: d.data, type: d.type, dup }, state.now);
      ui.lastSubmitted = req.id;
      ui.draft = freshDraft(d.domain);
      ui.showErrors = false;
      save(); render(); window.scrollTo(0, 0);
      toast(`${req.id} submitted. ${req.approvals.length ? req.approvals.length + ' approver' + (req.approvals.length > 1 ? 's' : '') + ' notified at the same time.' : 'Sent to the MDM team.'}`);
    },
  });

  App.onRequestInput = function (el) {
    const d = draft();
    if (el.hasAttribute('data-dup-reason')) { d.dup.reason = el.value; if (d.dup.decision === 'pending' && el.value.trim()) d.dup.decision = 'override'; save(); setHTML('form-errors', formErrors(E.validate(state.config, d.domain, d.data))); return; }
    const key = el.dataset.field;
    if (!key) return;
    if (el.dataset.multi) {
      const cur = Array.isArray(d.data[key]) ? d.data[key] : [];
      d.data[key] = el.checked ? [...new Set([...cur, el.dataset.multi])].sort() : cur.filter((x) => x !== el.dataset.multi);
    } else if (el.type === 'checkbox') d.data[key] = el.checked;
    else d.data[key] = el.value;
    if (d.dup.decision !== 'extend' && d.dup.decision !== 'none' && ['legal_name', 'description', 'name', 'code'].includes(key)) d.dup = { decision: 'none' };
    save();
  };
  App.requestNeedsRender = function (el) {
    const key = el.dataset.field;
    const d = draft();
    return el.tagName === 'SELECT' || el.type === 'checkbox' || state.config.fields.some((f) => f.domain === d.domain && f.showIf && f.showIf.field === key);
  };
  App.refreshRequestSide = refreshRequestSide;
  App.freshDraft = freshDraft;

  // ---------------------------------------------------------------- approvals
  const DEFAULT_KEYS = E.defaultConfig().fields.reduce((m, f) => { (m[f.domain] = m[f.domain] || new Set()).add(f.key); return m; }, {});
  const KEY_FACTS = {
    customer: ['country', 'city', 'reg_no', 'segment', 'products', 'payment_terms', 'credit_limit', 'tender_ref'],
    vendor: ['country', 'reg_no', 'vendor_type', 'quality_agreement', 'payment_terms', 'bank_name', 'bank_account', 'swift'],
    item: ['product_line', 'category', 'licence_no', 'storage', 'manufacturer', 'mfr_part_no', 'uom', 'list_price'],
    cost_centre: ['code', 'country', 'owner', 'valid_from', 'purpose'],
  };
  function factsFor(req, viewerId, keyOnly) {
    const cfg = state.config;
    let fields = E.visibleFields(cfg, req.domain, req.data).filter((f) => req.data[f.key] !== undefined && req.data[f.key] !== '' && f.key !== cfg.domains.find((x) => x.key === req.domain).nameField);
    if (keyOnly) {
      const keys = KEY_FACTS[req.domain] || [];
      const builtIn = DEFAULT_KEYS[req.domain] || new Set();
      fields = fields.filter((f) => keys.includes(f.key) || !builtIn.has(f.key)); // key facts plus any field added in Settings
    }
    const canSee = E.canSeeSensitive(cfg, viewerId);
    const revealed = ui.revealed[req.id] || {};
    return fields.map((f) => {
      let val = req.data[f.key];
      if (Array.isArray(val)) val = val.join(', ');
      if (val === true) val = 'Yes';
      if (f.key === 'credit_limit' || f.key === 'list_price') val = `SGD ${num(val)}`;
      let cell = esc(val);
      if (f.sensitive) {
        if (canSee && revealed[f.key]) cell = `${esc(val)} <span class="tag">${ICON.lock} viewed, logged</span>`;
        else if (canSee) cell = `<span class="mono">${esc(E.maskValue(val))}</span> <button class="btn small ghost" data-action="reveal" data-id="${req.id}" data-field="${f.key}">Show</button>`;
        else cell = `<span class="mono">${esc(E.maskValue(val))}</span> <span class="tag">${ICON.lock} Finance &amp; MDM only</span>`;
      }
      return `<dt>${esc(f.label)}</dt><dd>${cell}</dd>`;
    }).join('');
  }
  App.factsFor = factsFor;

  function teamsCard(req, task) {
    const cfg = state.config;
    const others = req.approvals.filter((a) => a !== task && a.role !== 'MDM');
    const dupNote = req.dup && req.dup.decision === 'override' ? `<div class="notice warn small"><span class="icon">!</span><div>Possible duplicate of <b>${esc(req.dup.matchName)}</b> (${esc(req.dup.matchId)}, score ${Math.round(req.dup.score)}). Requestor's reason: "${esc(req.dup.reason)}"</div></div>` : req.dup && req.dup.decision === 'extend' ? `<div class="notice small"><span class="icon">i</span><div>Extends existing record <b>${esc(req.dup.matchName)}</b> (${esc(req.dup.matchId)}) to ${esc(req.bu)}.</div></div>` : '';
    const infoAsked = task.status === 'Info requested';
    return `<article class="teams-card" aria-label="Approval request ${esc(req.id)}">
      <div class="teams-top"><span class="teams-logo" aria-hidden="true">T</span><span>Approvals · MDM Request Hub</span><span style="margin-left:auto">${taskChip(task)}</span></div>
      <div class="teams-body">
        <div class="row"><span class="tag mono">${esc(req.id)}</span><span class="tag">${esc(req.type === 'extend' ? 'Extend ' : 'New ')}${esc(domainLabel(req.domain).toLowerCase())}</span><span class="tag">${esc(req.bu)}</span></div>
        <h3>${esc(req.title)}</h3>
        <div class="small ink2">Requested by ${esc(pname(req.requester))} · ${esc(fmtDT(req.createdAt))}</div>
        <div class="inset small"><b>Why you:</b> ${esc(task.reasons.join('; '))}</div>
        ${dupNote}
        <dl class="facts">${factsFor(req, ui.persona, true)}</dl>
        ${others.length ? `<div class="small ink2">Also reviewing: ${others.map((a) => `${esc(pname(a.assignee))} ${a.status === 'Approved' ? '✓' : `(${esc(a.status.toLowerCase())})`}`).join(' · ')}</div>` : ''}
        ${infoAsked ? `<div class="notice warn small"><span class="icon">?</span><div>You asked: "${esc(task.comment)}". Waiting for ${esc(pname(req.requester))}.</div></div>` : `<div class="field"><label for="c-${task.id}" class="small">Comment <span class="muted">(needed to return or reject)</span></label><textarea id="c-${task.id}" rows="2" data-comment="${task.id}"></textarea><span class="err" id="c-${task.id}-err" hidden>Add a comment so ${esc(pname(req.requester))} knows what to change.</span></div>`}
      </div>
      ${infoAsked ? '' : `<div class="teams-actions"><button class="btn teams" data-action="decide" data-decision="approve" data-id="${req.id}">Approve</button><button class="btn" data-action="decide" data-decision="info" data-id="${req.id}">Ask for information</button><button class="btn danger" data-action="decide" data-decision="reject" data-id="${req.id}">Reject</button><button class="btn ghost" data-action="open-req" data-id="${req.id}">Details</button></div>`}
    </article>`;
  }
  App.teamsCard = teamsCard;

  App.views.approvals = function () {
    const p = person(ui.persona);
    const tasks = openTasksFor(ui.persona);
    const mineNeedInfo = state.requests.filter((r) => r.status === 'Needs info' && r.requester === ui.persona);
    const myOpen = state.requests.filter((r) => r.requester === ui.persona && !['Completed', 'Rejected'].includes(r.status) && r.status !== 'Needs info');
    const done = state.requests.flatMap((r) => r.approvals.filter((a) => a.assignee === ui.persona && ['Approved', 'Rejected'].includes(a.status)).map((a) => ({ req: r, task: a }))).sort((a, b) => String(b.task.decidedAt).localeCompare(String(a.task.decidedAt)));
    const notes = state.notifications.filter((n) => n.to === ui.persona).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 8);
    const isApprover = p.kind === 'approver' || p.kind === 'mdm';
    return `
      <div class="page-head"><div><span class="label">My approvals</span><h1>${esc(p.name)}'s approvals</h1><p>In production these cards arrive in Microsoft Teams and Outlook as Power Automate approvals. Here they work the same way: approve, ask for information or reject, with every decision logged.</p></div></div>
      ${p.kind === 'mdm' ? `<div class="notice"><span class="icon">i</span><div>Final checks and the SAP import file are on the <a href="#desk" data-action="go" data-route="desk">MDM desk</a>.</div></div>` : ''}
      <div class="grid sidebar">
        <div class="stack">
          ${isApprover ? `<div class="seg" role="group" aria-label="Filter">${[['mine', `Waiting on me (${tasks.length})`], ['done', `Decided by me (${done.length})`]].map(([k, l]) => `<button aria-pressed="${ui.approvalsTab === k}" data-action="approvals-tab" data-tab="${k}">${esc(l)}</button>`).join('')}</div>` : ''}
          ${isApprover && ui.approvalsTab === 'mine' ? (tasks.length ? `<div class="stack" style="gap:16px">${tasks.map(({ req, task }) => teamsCard(req, task)).join('')}</div>` : `<div class="panel empty"><strong>Nothing waiting on you</strong><span class="small">New requests that need ${esc(p.name)} will appear here and in Teams.</span></div>`) : ''}
          ${isApprover && ui.approvalsTab === 'done' ? `<div class="table-wrap"><table><thead><tr><th>Request</th><th>Decision</th><th>When</th></tr></thead><tbody>${done.map(({ req, task }) => `<tr class="clickable" data-action="open-req" data-id="${req.id}"><td><span class="mono small">${esc(req.id)}</span> ${esc(req.title)}</td><td>${taskChip(task)}</td><td class="small">${esc(fmtDT(task.decidedAt))}</td></tr>`).join('') || '<tr><td colspan="3" class="muted">No decisions yet.</td></tr>'}</tbody></table></div>` : ''}
          ${!isApprover || mineNeedInfo.length ? `<section class="panel"><div class="panel-head"><div><h2>Your requests that need you</h2><p>Approvers ask inside the request, so nobody hunts through email threads.</p></div></div>
            ${mineNeedInfo.length ? mineNeedInfo.map((r) => infoReply(r)).join('') : '<p class="muted small">Nothing needs your input right now.</p>'}</section>` : ''}
          ${!isApprover ? `<section class="panel"><div class="panel-head"><div><h2>Your open requests</h2></div><button class="btn small" data-action="go" data-route="request">New request</button></div>${myOpen.length ? `<div class="table-wrap"><table><thead><tr><th>Request</th><th>Status</th><th>Waiting on</th></tr></thead><tbody>${myOpen.map((r) => `<tr class="clickable" data-action="open-req" data-id="${r.id}"><td><span class="mono small">${esc(r.id)}</span> ${esc(r.title)}</td><td>${statusPill(r.status)}</td><td class="small">${esc(waitingOn(r))}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted small">No open requests.</p>'}</section>` : ''}
        </div>
        <section class="panel"><div class="panel-head"><div><h3>Activity</h3><p class="small">What ${esc(p.name)} would see in the Teams activity feed.</p></div>${notes.some((n) => !n.read) ? '<button class="btn small ghost" data-action="mark-read">Mark all read</button>' : ''}</div>
          <ul class="timeline">${notes.map((n) => `<li><span class="when">${esc(fmtDT(n.at))}</span><span class="dot ${n.kind === 'escalation' ? 'critical' : n.kind === 'reminder' ? 'warn' : n.kind === 'completed' ? 'good' : n.read ? '' : 'accent'}"></span><span class="small">${n.read ? '' : '<b>New · </b>'}<a href="#tracker" data-action="open-req" data-id="${esc(n.reqId)}">${esc(n.text)}</a></span></li>`).join('') || '<li><span></span><span></span><span class="muted small">No activity yet.</span></li>'}</ul></section>
      </div>`;
  };

  function infoReply(r) {
    const asked = r.approvals.filter((a) => a.status === 'Info requested');
    return `<div class="stack" style="padding:12px 0;border-top:1px solid var(--line)">
      <div class="row"><span class="tag mono">${esc(r.id)}</span><strong>${esc(r.title)}</strong></div>
      ${asked.map((a) => `<div class="notice warn small"><span class="icon">?</span><div><b>${esc(pname(a.assignee))}</b> asked: "${esc(a.comment)}"</div></div>`).join('')}
      <div class="field"><label for="info-${r.id}" class="small">Your reply</label><textarea id="info-${r.id}" rows="2" data-info="${r.id}" placeholder="e.g. Bank confirmation letter attached"></textarea></div>
      <label class="chip-toggle" style="align-self:flex-start"><input type="checkbox" id="att-${r.id}"> Attach a document</label>
      <div class="row"><button class="btn primary small" data-action="send-info" data-id="${r.id}">Send reply</button><button class="btn small ghost" data-action="open-req" data-id="${r.id}">Details</button></div></div>`;
  }

  Object.assign(App.actions, {
    'approvals-tab'(el) { ui.approvalsTab = el.dataset.tab; save(); render(); },
    'mark-read'() { state.notifications.forEach((n) => { if (n.to === ui.persona) n.read = true; }); save(); render(); },
    decide(el) {
      const req = state.requests.find((r) => r.id === el.dataset.id);
      const task = req.approvals.find((a) => a.assignee === ui.persona && a.status === 'Pending');
      if (!task) return;
      const ta = document.getElementById(`c-${task.id}`);
      const comment = ta ? ta.value.trim() : '';
      if ((el.dataset.decision === 'info' || el.dataset.decision === 'reject') && !comment) {
        const er = document.getElementById(`c-${task.id}-err`);
        if (er) er.hidden = false;
        if (ta) ta.focus();
        return;
      }
      E.decide(state, req.id, ui.persona, el.dataset.decision, comment, state.now);
      save(); render();
      const msg = { approve: `Approved ${req.id}.`, info: `Asked ${pname(req.requester)} for information on ${req.id}.`, reject: `Rejected ${req.id}; ${pname(req.requester)} has been told why.` }[el.dataset.decision];
      toast(msg + (req.status === 'MDM check' ? ' All approvals are in: it is now with the MDM team.' : ''));
    },
    'send-info'(el) {
      const id = el.dataset.id;
      const ta = document.getElementById(`info-${id}`);
      const att = document.getElementById(`att-${id}`);
      const note = ((ta && ta.value.trim()) || 'Information added') + (att && att.checked ? ' (document attached)' : '');
      E.provideInfo(state, id, ui.persona, note, null, state.now);
      save(); render();
      toast(`Reply sent. ${id} is back with the approvers, and their target time restarts.`);
    },
    reveal(el) {
      const { id, field } = el.dataset;
      ui.revealed[id] = { ...(ui.revealed[id] || {}), [field]: true };
      E.revealField(state, id, field, ui.persona, state.now);
      save(); render();
      toast('Shown. Viewing a sensitive field is recorded in the audit log.');
    },
  });

  // ---------------------------------------------------------------- tracker and request drawer
  const FILTERS = [
    ['all', 'All'], ['mine', 'Mine'], ['approvals', 'With approvers'], ['info', 'Needs info'], ['mdm', 'With MDM'], ['done', 'Completed'],
  ];
  function filterReqs() {
    const q = ui.search.trim().toLowerCase();
    return state.requests.filter((r) => {
      const f = ui.trackerFilter;
      if (f === 'mine' && r.requester !== ui.persona && !r.approvals.some((a) => a.assignee === ui.persona)) return false;
      if (f === 'approvals' && r.status !== 'In approval') return false;
      if (f === 'info' && r.status !== 'Needs info') return false;
      if (f === 'mdm' && !['MDM check', 'Ready for SAP import'].includes(r.status)) return false;
      if (f === 'done' && !['Completed', 'Rejected'].includes(r.status)) return false;
      if (q && !(`${r.id} ${r.title} ${r.bu} ${pname(r.requester)} ${domainLabel(r.domain)}`.toLowerCase().includes(q))) return false;
      return true;
    }).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  App.views.tracker = function () {
    const rows = filterReqs();
    return `
      <div class="page-head"><div><span class="label">Request tracker</span><h1>Where every request stands</h1><p>Requestors and approvers see the same status, so nobody has to ask. Click a request for its approvals, details and full history.</p></div></div>
      <div class="row between"><div class="seg" role="group" aria-label="Filter">${FILTERS.map(([k, l]) => `<button aria-pressed="${ui.trackerFilter === k}" data-action="tracker-filter" data-filter="${k}">${esc(l)}</button>`).join('')}</div>
        <div style="flex:1;min-width:200px;max-width:320px"><label class="sr" for="tracker-search">Search requests</label><input id="tracker-search" type="search" placeholder="Search by name, ID or person" value="${esc(ui.search)}" data-search></div></div>
      <div class="table-wrap"><table><thead><tr><th>Request</th><th>Status</th><th style="min-width:180px">Progress</th><th>Waiting on</th><th class="num">Age</th></tr></thead><tbody>
        ${rows.map((r) => `<tr class="clickable" data-action="open-req" data-id="${r.id}"><td style="min-width:240px"><div class="stack tight"><span><span class="mono small">${esc(r.id)}</span> · <span class="small muted">${esc(r.type === 'extend' ? 'Extend' : 'New')} ${esc(domainLabel(r.domain).toLowerCase())} · ${esc(r.bu)}</span></span><strong>${esc(r.title)}</strong><span class="small muted">by ${esc(pname(r.requester))}</span></div></td>
          <td>${statusPill(r.status)}</td><td>${tracker(r)}</td><td class="small">${esc(waitingOn(r)) || '<span class="muted">–</span>'}${r.approvals.some((a) => a.status === 'Pending' && a.reminders) ? ' <span class="pill serious">reminded</span>' : ''}</td>
          <td class="num small">${esc(num1(E.workingDaysBetween(r.createdAt, r.completedAt || state.now)))} d</td></tr>`).join('') || '<tr><td colspan="5"><div class="empty">No requests match.</div></td></tr>'}
      </tbody></table></div>
      <p class="footnote">Age is in working days from submission. Completed requests show their total time from submission to SAP B1.</p>`;
  };

  function renderDrawer(id) {
    const req = state.requests.find((r) => r.id === id);
    if (!req) return '';
    const cfg = state.config;
    const task = req.approvals.find((a) => a.assignee === ui.persona && a.status === 'Pending');
    const isReq = req.requester === ui.persona && req.status === 'Needs info';
    const isMdm = person(ui.persona).role === 'MDM';
    const audit = state.audit.filter((a) => a.reqId === id).sort((a, b) => b.at.localeCompare(a.at));
    const dotFor = (a) => ({ Approved: 'good', 'Imported to SAP B1': 'good', 'MDM check passed': 'accent', Submitted: 'accent', 'Reminder sent': 'warn', Escalated: 'critical', Rejected: 'critical', 'Asked for information': 'warn', 'Viewed sensitive field': '' }[a.action] || '');
    return `<div class="drawer-backdrop" data-action="close-drawer"></div>
      <aside class="drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title">
        <div class="row between"><div class="row"><span class="tag mono">${esc(req.id)}</span><span class="tag">${esc(req.type === 'extend' ? 'Extend' : 'New')} ${esc(domainLabel(req.domain).toLowerCase())}</span><span class="tag">${esc(req.bu)}</span>${statusPill(req.status)}</div><button class="btn small" data-action="close-drawer" id="drawer-close">Close</button></div>
        <h2 id="drawer-title">${esc(req.title)}</h2>
        <div class="small ink2">Requested by ${esc(pname(req.requester))} on ${esc(fmtDT(req.createdAt))}${req.sapCode ? ` · SAP code <span class="mono">${esc(req.sapCode)}</span>` : ''}</div>
        <section class="panel">${tracker(req, true)}${waitingOn(req) ? `<p class="small" style="margin-top:10px">Waiting on <b>${esc(waitingOn(req))}</b></p>` : ''}</section>
        ${task ? teamsCard(req, task) : ''}
        ${isReq ? `<section class="panel">${infoReply(req)}</section>` : ''}
        ${isMdm && req.status === 'MDM check' ? `<section class="panel"><div class="row"><button class="btn primary" data-action="mdm-pass" data-id="${req.id}">Pass check and assign SAP code</button><button class="btn" data-action="go-desk">Open MDM desk</button></div></section>` : ''}
        <section class="panel"><h3>Approvals</h3><div class="table-wrap" style="margin-top:10px"><table><thead><tr><th>Approver</th><th>Why</th><th>Status</th><th>Decided</th></tr></thead><tbody>
          ${req.approvals.map((a) => `<tr><td><div class="row">${avatar(a.assignee, 'sm')}<div class="stack tight"><span>${esc(pname(a.assignee))}</span><span class="tiny muted">${esc(a.role === 'MDM' ? 'MDM team' : E.roleLabel(cfg, a.role, a.bu))}</span></div></div></td><td class="small">${esc(a.reasons.join('; '))}${a.comment ? `<div class="tiny ink2">"${esc(a.comment)}"</div>` : ''}</td><td>${taskChip(a)}</td><td class="small">${a.decidedAt ? esc(fmtDT(a.decidedAt)) : '–'}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">No approvals needed.</td></tr>'}
        </tbody></table></div></section>
        <section class="panel"><h3>Details</h3><dl class="facts" style="margin-top:10px">${factsFor(req, ui.persona)}</dl>
          ${req.dup && req.dup.decision !== 'none' ? `<div class="notice ${req.dup.decision === 'override' ? 'warn' : ''} small" style="margin-top:10px"><span class="icon">i</span><div>${req.dup.decision === 'override' ? `Requestor confirmed this is not <b>${esc(req.dup.matchName)}</b> (${esc(req.dup.matchId)}, match ${Math.round(req.dup.score)}): "${esc(req.dup.reason)}"` : `Extends existing record <b>${esc(req.dup.matchName)}</b> (${esc(req.dup.matchId)}).`}</div></div>` : ''}</section>
        <section class="panel"><h3>History</h3><p class="small muted" style="margin:4px 0 10px">Every action, from the audit log. Nothing here can be edited.</p><ul class="timeline">${audit.map((a) => `<li><span class="when">${esc(fmtDT(a.at))}</span><span class="dot ${dotFor(a)}"></span><span class="small"><b>${esc(a.action)}</b> · ${esc(a.detail)}</span></li>`).join('')}</ul></section>
      </aside>`;
  }

  Object.assign(App.actions, {
    'tracker-filter'(el) { ui.trackerFilter = el.dataset.filter; save(); render(); },
    'open-req'(el) { if (!el.dataset.id || !state.requests.find((r) => r.id === el.dataset.id)) return; ui.drawer = el.dataset.id; render(); const c = document.getElementById('drawer-close'); if (c) c.focus(); },
    'close-drawer'() { ui.drawer = null; render(); },
    'go-desk'() { ui.drawer = null; go('desk'); },
  });

  // ---------------------------------------------------------------- MDM desk
  App.views.desk = function () {
    const isMdm = person(ui.persona).role === 'MDM';
    const checks = state.requests.filter((r) => r.status === 'MDM check');
    const ready = state.requests.filter((r) => r.status === 'Ready for SAP import');
    const tabs = [['check', `Final check (${checks.length})`], ['import', `SAP import file (${ready.length})`], ['health', `Master data health (${H.dedup.clusters.length})`], ['audit', 'Audit log']];
    let body = '';
    if (ui.deskTab === 'check') body = checks.length ? `<div class="grid ${checks.length > 1 ? 'two' : ''}">${checks.map((r) => mdmCheckCard(r, isMdm)).join('')}</div>` : '<div class="panel empty"><strong>No requests waiting for the final check</strong><span class="small">Requests arrive here once every approver has signed off.</span></div>';
    if (ui.deskTab === 'import') body = importTab(ready, isMdm);
    if (ui.deskTab === 'health') body = healthTab(isMdm);
    if (ui.deskTab === 'audit') body = auditTab();
    return `
      <div class="page-head"><div><span class="label">MDM desk</span><h1>Final check, import file, master data health</h1><p>The MDM team's view. Approved requests get a last duplicate check, then go into a file the team loads into SAP Business One. Nothing is written to SAP directly in version 1.</p></div></div>
      ${isMdm ? '' : `<div class="notice"><span class="icon">i</span><div class="row between" style="flex:1"><span>This is the MDM team's desk. You can look around; switch to Priya to act.</span><button class="btn small" data-action="switch-persona" data-id="priya">Switch to Priya</button></div></div>`}
      <div class="seg" role="group" aria-label="Desk sections">${tabs.map(([k, l]) => `<button aria-pressed="${ui.deskTab === k}" data-action="desk-tab" data-tab="${k}">${esc(l)}</button>`).join('')}</div>
      ${body}`;
  };

  function mdmCheckCard(r, isMdm) {
    const v = E.validate(state.config, r.domain, r.data);
    const matches = E.findMatches(state, r.domain, r.data, r.bu, 3).filter((m) => m.id !== r.id && m.band !== 'none' && !(r.dup && r.dup.matchId === m.id && r.dup.decision === 'extend'));
    return `<section class="panel stack">
      <div class="row"><span class="tag mono">${esc(r.id)}</span><span class="tag">${esc(r.type === 'extend' ? 'Extend' : 'New')} ${esc(domainLabel(r.domain).toLowerCase())}</span><span class="tag">${esc(r.bu)}</span></div>
      <h3>${esc(r.title)}</h3>
      <ul class="small" style="margin:0;padding-left:18px;display:flex;flex-direction:column;gap:4px">
        <li>${v.ok ? 'All required fields complete' : `<span style="color:var(--critical-ink)">${Object.keys(v.errors).length} required fields missing</span>`}</li>
        <li>Approved by ${r.approvals.filter((a) => a.status === 'Approved').map((a) => esc(pname(a.assignee))).join(', ') || 'no one (no rules matched)'}</li>
        <li>${matches.length ? `<span style="color:var(--warn-ink)">Possible match: <b>${esc(matches[0].label)}</b> (${esc(matches[0].id)}, ${Math.round(matches[0].score)})</span>` : 'No duplicates in SAP B1 master data or open requests'}</li>
        ${r.dup && r.dup.decision === 'override' ? `<li>Requestor overrode a possible duplicate: "${esc(r.dup.reason)}"</li>` : ''}
      </ul>
      <div class="row"><button class="btn primary small" data-action="mdm-pass" data-id="${r.id}" ${isMdm ? '' : 'disabled'}>Pass check and assign SAP code</button>
        <button class="btn small" data-action="mdm-return" data-id="${r.id}" ${isMdm ? '' : 'disabled'}>Ask the requestor</button><button class="btn small ghost" data-action="open-req" data-id="${r.id}">Details</button></div>
      <div class="field" id="ret-wrap-${r.id}" hidden><label for="ret-${r.id}" class="small">What should the requestor fix?</label><textarea id="ret-${r.id}" rows="2"></textarea><button class="btn small" data-action="mdm-return-send" data-id="${r.id}">Send back</button></div>
    </section>`;
  }

  function importTab(ready, isMdm) {
    const domains = ['customer', 'vendor', 'item', 'cost_centre'];
    const groups = domains.map((d) => ({ d, rows: ready.filter((r) => r.domain === d) })).filter((g) => g.rows.length);
    if (!groups.length) return '<div class="panel empty"><strong>The import file is empty</strong><span class="small">Requests appear here after they pass the final check.</span></div>';
    return groups.map(({ d, rows }) => {
      const out = E.buildImportCsv(rows, d);
      const cols = E.IMPORT_LAYOUT[d].cols.slice(1, 6);
      return `<section class="panel"><div class="panel-head"><div><h3>${esc(domainLabel(d))} records · ${rows.length}</h3><p class="small">Data Transfer Workbench object <span class="mono">${esc(out.object)}</span>. Field names follow the SAP B1 DI API; map them to the template version your SAP B1 installation uses before the first import.</p></div></div>
        <div class="table-wrap"><table><thead><tr>${cols.map((c) => `<th class="sapcol">${esc(c)}</th>`).join('')}<th>Request</th></tr></thead><tbody>${rows.map((r, i) => { const row = csvRow(out.csv, i + 1); return `<tr>${cols.map((c) => `<td class="${c.endsWith('Code') ? 'mono small' : 'small'}">${esc(maskIfSensitive(c, row[c]))}</td>`).join('')}<td class="mono small">${esc(r.id)}</td></tr>`; }).join('')}</tbody></table></div>
        <details class="data" style="margin-top:10px"><summary>Show the full file</summary><div class="csv-preview">${esc(isMdm ? out.csv : maskCsv(out.csv, d))}</div></details>
        <div class="row" style="margin-top:12px">${ENV === 'pages' ? `<button class="btn small" data-action="download-csv" data-domain="${d}" ${isMdm ? '' : 'disabled'}>Download CSV</button>` : ''}<button class="btn small" data-action="copy-csv" data-domain="${d}" ${isMdm ? '' : 'disabled'}>Copy CSV</button>
          <button class="btn primary small" data-action="mark-imported" data-domain="${d}" ${isMdm ? '' : 'disabled'}>Mark as imported into SAP B1</button></div>
        ${d === 'vendor' ? '<p class="footnote" style="margin-top:8px">This file holds bank details. In production it is generated into a restricted SharePoint library, not emailed.</p>' : ''}</section>`;
    }).join('');
  }
  function csvRow(csv, i) {
    const lines = csv.split('\n');
    const head = lines[0].split(',');
    const vals = [];
    let cur = '', q = false;
    for (const ch of lines[i]) { if (ch === '"') q = !q; else if (ch === ',' && !q) { vals.push(cur); cur = ''; } else cur += ch; }
    vals.push(cur);
    return Object.fromEntries(head.map((h, k) => [h, vals[k]]));
  }
  const maskIfSensitive = (col, v) => (['AccountNo', 'SWIFT', 'CreditLimit'].includes(col) && person(ui.persona).role !== 'MDM' ? E.maskValue(v) : v);
  function maskCsv(csv, d) {
    if (d !== 'vendor' && d !== 'customer') return csv;
    const lines = csv.split('\n');
    const head = lines[0].split(',');
    const idx = head.map((h, i) => (['AccountNo', 'SWIFT', 'CreditLimit'].includes(h) ? i : -1)).filter((i) => i >= 0);
    return [lines[0], ...lines.slice(1).map((l) => l.split(',').map((v, i) => (idx.includes(i) ? E.maskValue(v) : v)).join(','))].join('\n');
  }

  function healthTab(isMdm) {
    const planned = new Set(state.stats.mergePlanned || []);
    const q = H.dedup.quality;
    const cl = H.dedup.clusters.map((c) => {
      const master = c.members.find((m) => m.id === c.master_id);
      const dups = c.members.filter((m) => m.id !== c.master_id);
      return `<section class="panel stack">
        <div class="row between"><div class="row"><strong>${esc(master.name)}</strong><span class="pill critical">Match ${Math.round(c.score)}</span></div>
          ${planned.has(c.master_id) ? '<span class="pill good">Merge planned</span>' : `<button class="btn small" data-action="plan-merge" data-id="${esc(c.master_id)}" ${isMdm ? '' : 'disabled'}>Plan merge into ${esc(c.master_id)}</button>`}</div>
        <div class="table-wrap"><table><thead><tr><th>Record</th><th>Created by</th><th>Country</th><th>Products booked here</th><th>Orders</th><th class="num">Value, 12 months</th></tr></thead><tbody>
          ${c.members.map((m) => `<tr ${m.id === c.master_id ? 'class="highlight"' : ''}><td><div class="stack tight"><span class="mono small">${esc(m.id)}${m.id === c.master_id ? ' · keep' : ''}</span><span class="small">${esc(m.name)}</span></div></td><td class="small">${esc(m.entity)} · ${esc(m.created)}</td><td>${esc(m.country)}</td><td class="small">${esc(m.products.split('').map((p) => 'Product ' + p).join(', ') || '–')}${m.first_month ? `<div class="tiny muted">${esc(Charts.monthLabel(m.first_month, true))} to ${esc(Charts.monthLabel(m.last_month, true))}</div>` : ''}</td><td class="num">${num(m.orders)}</td><td class="num">${esc(money(m.value))}</td></tr>`).join('')}
        </tbody></table></div>
        <div class="small ink2">${c.reasons.map((r) => esc(r)).join(' · ')}</div>
        ${dups.some((x) => x.country !== master.country) ? `<div class="notice warn small"><span class="icon">!</span><div>The duplicate is recorded in <b>${esc(countryName(dups[0].country))}</b>; the customer is in <b>${esc(countryName(master.country))}</b>. Its orders are reported under the wrong country until merged.</div></div>` : ''}
      </section>`;
    }).join('');
    const review = H.dedup.review.map((r) => `<tr><td class="small">${esc(r.a)}</td><td class="small">${esc(r.b)}</td><td class="num">${Math.round(r.score)}</td><td class="small">${esc(r.reasons.join(' · '))}</td></tr>`).join('');
    const items = H.dedup.items.map((p) => `<tr><td class="small"><span class="mono">${esc(p.master)}</span> ${esc(p.master_name)}</td><td class="small"><span class="mono">${esc(p.duplicate)}</span> ${esc(p.duplicate_name)}</td><td class="small">${esc(p.reasons.join(' · '))}</td></tr>`).join('');
    const vend = H.dedup.vendors.map((v) => `<tr><td class="small">${esc(v.names.join(' / '))}</td><td class="mono small">${esc(v.member_ids.join(', '))}</td><td class="small">${esc(v.reasons.join(' · '))}</td></tr>`).join('');
    return `<div class="notice"><span class="icon">i</span><div>The same matcher that runs on the request form scanned all ${num(H.dedup.impact.records)} customer records in SAP B1. It found <b>${q.found} customers recorded twice</b> and sent ${q.review_pairs} look-alike pair${q.review_pairs === 1 ? '' : 's'} to a person to decide. On this synthetic data it found every planted duplicate with no false merges. Merging changes the regional view: see <a href="#regional" data-action="go" data-route="regional">what merging changes</a>.</div></div>
      ${cl}
      <section class="panel"><h3>Look-alikes for a person to decide</h3><p class="small muted" style="margin:4px 0 10px">Scores 75 to 89: similar enough to check, not similar enough to merge automatically.</p><div class="table-wrap"><table><thead><tr><th>Record</th><th>Looks like</th><th class="num">Match</th><th>Why</th></tr></thead><tbody>${review || '<tr><td colspan="4" class="muted">None.</td></tr>'}</tbody></table></div></section>
      <div class="grid two"><section class="panel"><h3>Items recorded twice</h3><div class="table-wrap" style="margin-top:10px"><table><thead><tr><th>Keep</th><th>Duplicate</th><th>Why</th></tr></thead><tbody>${items}</tbody></table></div></section>
        <section class="panel"><h3>Vendors recorded twice</h3><div class="table-wrap" style="margin-top:10px"><table><thead><tr><th>Names</th><th>Codes</th><th>Why</th></tr></thead><tbody>${vend}</tbody></table></div></section></div>`;
  }

  function auditTab() {
    const f = ui.auditFilter.trim().toLowerCase();
    const rows = [...state.audit].sort((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id)).filter((a) => !f || `${a.action} ${a.detail} ${a.reqId || ''} ${pname(a.actor)}`.toLowerCase().includes(f));
    return `<section class="panel"><div class="panel-head"><div><h3>Audit log</h3><p class="small">Append-only: the app adds entries and never edits or deletes them. In production this is SharePoint version history or Dataverse auditing.</p></div>
      <div class="row"><label class="sr" for="audit-filter">Filter the audit log</label><input id="audit-filter" type="search" placeholder="Filter, e.g. Viewed sensitive" value="${esc(ui.auditFilter)}" data-audit-filter style="width:240px">${ENV === 'pages' ? '<button class="btn small" data-action="download-audit">Download CSV</button>' : ''}<button class="btn small" data-action="copy-audit">Copy CSV</button></div></div>
      <div class="table-wrap"><table><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Request</th><th>Detail</th></tr></thead><tbody>
        ${rows.slice(0, 150).map((a) => `<tr><td class="small tnum" style="white-space:nowrap">${esc(fmtDT(a.at))}</td><td class="small">${esc(pname(a.actor))}</td><td class="small"><b>${esc(a.action)}</b></td><td>${a.reqId ? `<a href="#tracker" class="mono small" data-action="open-req" data-id="${esc(a.reqId)}">${esc(a.reqId)}</a>` : ''}</td><td class="small">${esc(a.detail)}</td></tr>`).join('')}
      </tbody></table></div><p class="footnote" style="margin-top:8px">${num(rows.length)} entries${rows.length > 150 ? ', newest 150 shown' : ''}.</p></section>`;
  }

  function auditCsv() {
    const lines = ['When,Who,Action,Request,Detail'];
    for (const a of [...state.audit].sort((x, y) => x.at.localeCompare(y.at))) lines.push([a.at.replace('T', ' '), pname(a.actor), a.action, a.reqId || '', a.detail].map((v) => (/[",\n]/.test(v) ? '"' + String(v).replace(/"/g, '""') + '"' : v)).join(','));
    return lines.join('\n');
  }

  function download(name, text) {
    const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  function copy(text, what) {
    const done = () => toast(`${what} copied. Paste it into a .csv file or Excel.`);
    try {
      navigator.clipboard.writeText(text).then(done, () => fallbackCopy(text, done));
    } catch (e) { fallbackCopy(text, done); }
  }
  function fallbackCopy(text, done) {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); done(); } catch (e) { toast('Copy did not work here; select the text in "Show the full file" instead.'); }
    ta.remove();
  }

  Object.assign(App.actions, {
    'desk-tab'(el) { ui.deskTab = el.dataset.tab; save(); render(); },
    'switch-persona'(el) { ui.persona = el.dataset.id; ui.draft = null; save(); render(); toast(`Viewing as ${pname(ui.persona)}, ${person(ui.persona).title}.`); },
    'mdm-pass'(el) {
      const r = E.mdmApprove(state, el.dataset.id, ui.persona, state.now);
      save(); render();
      toast(`${r.id} passed. ${r.type === 'extend' ? 'Existing record ' + r.sapCode + ' will be extended' : 'SAP code ' + r.sapCode + ' assigned'}; it is in the import file.`);
    },
    'mdm-return'(el) { const w = document.getElementById(`ret-wrap-${el.dataset.id}`); if (w) { w.hidden = false; const t = document.getElementById(`ret-${el.dataset.id}`); if (t) t.focus(); } },
    'mdm-return-send'(el) {
      const t = document.getElementById(`ret-${el.dataset.id}`);
      if (!t || !t.value.trim()) { if (t) t.focus(); return; }
      E.mdmReturn(state, el.dataset.id, ui.persona, t.value.trim(), state.now);
      save(); render(); toast(`Sent back to the requestor with your note.`);
    },
    'download-csv'(el) { const d = el.dataset.domain; const rows = state.requests.filter((r) => r.status === 'Ready for SAP import'); download(`sap-b1-import-${d}-${state.now.slice(0, 10)}.csv`, E.buildImportCsv(rows, d).csv); toast('Import file downloaded.'); },
    'copy-csv'(el) { const d = el.dataset.domain; const rows = state.requests.filter((r) => r.status === 'Ready for SAP import'); copy(E.buildImportCsv(rows, d).csv, 'Import file'); },
    'mark-imported'(el) {
      const ids = state.requests.filter((r) => r.status === 'Ready for SAP import' && r.domain === el.dataset.domain).map((r) => r.id);
      const done = E.markImported(state, ids, ui.persona, state.now);
      save(); render();
      toast(`${done.length} record${done.length === 1 ? '' : 's'} marked as live in SAP B1. Requestors have been told they can transact.`);
    },
    'plan-merge'(el) {
      state.stats.mergePlanned = [...new Set([...(state.stats.mergePlanned || []), el.dataset.id])];
      const c = H.dedup.clusters.find((x) => x.master_id === el.dataset.id);
      E.log(state, state.now, ui.persona, 'Merge planned', null, `Merge ${c.members.filter((m) => m.id !== c.master_id).map((m) => m.id).join(', ')} into ${c.master_id} (${c.members[0].name}); order history to be re-pointed in SAP B1`);
      save(); render(); toast('Merge planned and logged. In SAP B1 the duplicate is set inactive and its history re-pointed.');
    },
    'download-audit'() { download(`audit-log-${state.now.slice(0, 10)}.csv`, auditCsv()); },
    'copy-audit'() { copy(auditCsv(), 'Audit log'); },
  });

  // ---------------------------------------------------------------- settings
  App.views.admin = function () {
    const isMdm = person(ui.persona).role === 'MDM';
    const cfg = state.config;
    const tabs = [['bu', 'Business units'], ['fields', 'Fields'], ['rules', 'Approval rules'], ['sla', 'Service levels']];
    const dis = isMdm ? '' : 'disabled';
    let body = '';
    if (ui.adminTab === 'bu') {
      const unassigned = cfg.people.filter((p) => p.kind === 'requester' && !p.bu);
      body = `<div class="grid sidebar"><section class="panel flush"><div class="table-wrap" style="border:0;border-radius:0"><table><thead><tr><th>Code</th><th>Business unit</th><th>Head (approves)</th><th class="num">Requests</th></tr></thead><tbody>
          ${cfg.businessUnits.map((b) => `<tr><td class="mono">${esc(b.code)}</td><td>${esc(b.name.split(' · ').slice(1).join(' · ') || b.name)}</td><td><div class="row">${avatar(b.head, 'sm')}${esc(pname(b.head))}</div></td><td class="num">${state.requests.filter((r) => r.bu === b.code).length}</td></tr>`).join('')}
        </tbody></table></div></section>
        <section class="panel"><h3>Add a business unit</h3><p class="small muted" style="margin:4px 0 12px">It appears on the request form at once and its requests route to its head. No form, email list or code to change.</p>
          <div class="stack"><div class="field"><label for="bu-code">Code</label><input id="bu-code" type="text" maxlength="4" placeholder="e.g. QTV" ${dis}></div>
          <div class="field"><label for="bu-name">Name</label><input id="bu-name" type="text" placeholder="e.g. Vietnam clinical solutions" ${dis}></div>
          <div class="field"><label for="bu-head">Head's name</label><input id="bu-head" type="text" placeholder="e.g. Linh" ${dis}></div>
          ${unassigned.length ? `<div class="field"><span class="flabel">Move these people into it</span><div class="chips">${unassigned.map((p) => `<label class="chip-toggle"><input type="checkbox" data-member="${p.id}" checked ${dis}> ${esc(p.name)}</label>`).join('')}</div></div>` : ''}
          <div class="err" id="bu-err" hidden></div>
          <button class="btn primary" data-action="add-bu" ${dis}>Add business unit</button></div></section></div>`;
    }
    if (ui.adminTab === 'fields') {
      const d = ui.adminDomain;
      const fields = cfg.fields.filter((f) => f.domain === d).sort((a, b) => a.order - b.order);
      body = `<div class="seg" role="group" aria-label="Request type">${cfg.domains.map((x) => `<button aria-pressed="${d === x.key}" data-action="admin-domain" data-domain="${x.key}">${esc(x.label)}</button>`).join('')}</div>
        <div class="grid sidebar"><section class="panel flush"><div class="table-wrap" style="border:0;border-radius:0"><table><thead><tr><th>Field</th><th>Type</th><th>Shown when</th><th>Required</th><th>Sensitive</th><th>On</th></tr></thead><tbody>
          ${fields.map((f) => `<tr><td><div class="stack tight"><span>${esc(f.label)}</span><span class="mono tiny muted">${esc(f.key)}</span></div></td><td class="small">${esc(f.type)}</td><td class="small">${esc(E.describeCond(f.showIf, cfg, d))}</td>
            ${['required', 'sensitive', 'active'].map((prop) => `<td><label class="switch"><input type="checkbox" ${f[prop] ? 'checked' : ''} data-action="toggle-field" data-id="${f.id}" data-prop="${prop}" aria-label="${esc(f.label)} ${prop}" ${dis}><span></span></label></td>`).join('')}</tr>`).join('')}
        </tbody></table></div></section>
        <section class="panel"><h3>Add a field to ${esc(domainLabel(d).toLowerCase())} requests</h3>
          <div class="stack" style="margin-top:12px"><div class="field"><label for="nf-label">Label</label><input id="nf-label" type="text" placeholder="e.g. Hospital accreditation no." ${dis}></div>
          <div class="field"><label for="nf-type">Type</label><select id="nf-type" ${dis}>${['text', 'number', 'date', 'textarea', 'checkbox'].map((t) => `<option>${t}</option>`).join('')}</select></div>
          <div class="row"><label class="chip-toggle"><input type="checkbox" id="nf-req" ${dis}> Required</label><label class="chip-toggle"><input type="checkbox" id="nf-sens" ${dis}> Sensitive</label></div>
          <div class="err" id="nf-err" hidden></div><button class="btn primary" data-action="add-field" ${dis}>Add field</button></div></section></div>`;
    }
    if (ui.adminTab === 'rules') {
      const d = ui.adminDomain;
      const domFields = cfg.fields.filter((f) => f.domain === d && f.active);
      body = `<div class="seg" role="group" aria-label="Request type">${cfg.domains.map((x) => `<button aria-pressed="${d === x.key}" data-action="admin-domain" data-domain="${x.key}">${esc(x.label)}</button>`).join('')}</div>
        <div class="grid sidebar"><section class="panel flush"><div class="table-wrap" style="border:0;border-radius:0"><table><thead><tr><th>Rule</th><th>Approver</th><th>When</th><th>Step</th><th>On</th></tr></thead><tbody>
          ${cfg.rules.filter((r) => r.domain === d).map((r) => `<tr><td class="small">${esc(r.name)}</td><td class="small">${esc(r.approver === 'BU_HEAD' ? 'Head of the business unit' : cfg.roles[r.approver].label)}${r.approver !== 'BU_HEAD' ? `<div class="tiny muted">${esc(pname(cfg.roles[r.approver].person))}</div>` : ''}</td><td class="small">${esc(E.describeCond(r.when, cfg, d))}</td><td class="small">${r.stage === 1 ? 'Parallel' : 'Step ' + r.stage}</td><td><label class="switch"><input type="checkbox" ${r.active ? 'checked' : ''} data-action="toggle-rule" data-id="${r.id}" aria-label="${esc(r.name)} on" ${dis}><span></span></label></td></tr>`).join('')}
        </tbody></table></div></section>
        <section class="panel"><h3>Add an approval step</h3><p class="small muted" style="margin:4px 0 12px">For example a new regulatory check. It applies to new requests straight away.</p>
          <div class="stack"><div class="field"><label for="nr-approver">Approver</label><select id="nr-approver" ${dis}>${Object.entries(cfg.roles).filter(([k]) => k !== 'MDM').map(([k, v]) => `<option value="${k}">${esc(v.label)}${v.person ? ' (' + esc(pname(v.person)) + ')' : ''}</option>`).join('')}</select></div>
          <div class="field"><label for="nr-field">When</label><select id="nr-field" ${dis}><option value="">Always</option>${domFields.map((f) => `<option value="${f.key}">${esc(f.label)}</option>`).join('')}</select></div>
          <div class="form-grid"><div class="field"><label for="nr-op">Condition</label><select id="nr-op" ${dis}><option value="equals">is</option><option value="not_equals">is not</option><option value="not_empty">is filled in</option><option value="is_true">is ticked</option></select></div>
          <div class="field"><label for="nr-value">Value</label><input id="nr-value" type="text" placeholder="e.g. Medical device" ${dis}></div></div>
          <div class="field"><label for="nr-name">Rule name</label><input id="nr-name" type="text" placeholder="e.g. Device import permit check" ${dis}></div>
          <div class="err" id="nr-err" hidden></div><button class="btn primary" data-action="add-rule" ${dis}>Add approval step</button></div></section></div>`;
    }
    if (ui.adminTab === 'sla') {
      const s = cfg.settings;
      body = `<section class="panel" style="max-width:640px"><div class="stack">
        <div class="field"><label for="sla-days">Approval target (working days)</label><input id="sla-days" type="number" min="1" max="5" value="${s.slaDays}" ${dis}><span class="help">A reminder goes to the approver in Teams and Outlook when this passes.</span></div>
        <div class="field"><label for="esc-days">Escalate after a further (working days)</label><input id="esc-days" type="number" min="1" max="3" value="${s.escalateAfterDays}" ${dis}><span class="help">Then the business unit head and the MDM team are told.</span></div>
        <div class="field"><label for="cutover">Email cut-over date</label><input id="cutover" type="date" value="${s.cutoverDate}" ${dis}><span class="help">After this date the shared mailbox auto-replies with the form link and only form requests are processed.</span></div>
        <button class="btn primary" data-action="save-sla" ${dis} style="align-self:flex-start">Save service levels</button></div></section>`;
    }
    const recent = state.audit.filter((a) => a.action === 'Settings changed').sort((a, b) => b.at.localeCompare(a.at)).slice(0, 5);
    return `
      <div class="page-head"><div><span class="label">Settings</span><h1>Change the process without IT</h1><p>Business units, form fields, approval rules and service levels are data, not code. The MDM team edits them here; in production they are SharePoint lists that the Power Automate flows read.</p></div></div>
      ${isMdm ? '' : `<div class="notice"><span class="icon">i</span><div class="row between" style="flex:1"><span>Only the MDM team edits settings. You are seeing them read-only.</span><button class="btn small" data-action="switch-persona" data-id="priya">Switch to Priya</button></div></div>`}
      <div class="seg" role="group" aria-label="Settings sections">${tabs.map(([k, l]) => `<button aria-pressed="${ui.adminTab === k}" data-action="admin-tab" data-tab="${k}">${esc(l)}</button>`).join('')}</div>
      ${body}
      ${recent.length ? `<section class="panel"><h3>Recent changes</h3><ul class="timeline" style="margin-top:10px">${recent.map((a) => `<li><span class="when">${esc(fmtDT(a.at))}</span><span class="dot accent"></span><span class="small"><b>${esc(pname(a.actor))}</b> · ${esc(a.detail)}</span></li>`).join('')}</ul></section>` : ''}`;
  };

  function showErr(id, msg) { const e = document.getElementById(id); if (e) { e.textContent = msg; e.hidden = false; } }
  Object.assign(App.actions, {
    'admin-tab'(el) { ui.adminTab = el.dataset.tab; save(); render(); },
    'admin-domain'(el) { ui.adminDomain = el.dataset.domain; save(); render(); },
    'add-bu'() {
      const code = document.getElementById('bu-code').value.trim(), name = document.getElementById('bu-name').value.trim(), head = document.getElementById('bu-head').value.trim();
      if (!/^[A-Za-z]{2,4}$/.test(code)) return showErr('bu-err', 'Use a 2 to 4 letter code, e.g. QTV.');
      if (!name || !head) return showErr('bu-err', 'Add a name and the head\'s name.');
      const members = [...document.querySelectorAll('[data-member]')].filter((x) => x.checked).map((x) => x.dataset.member);
      try { E.changeSettings(state, ui.persona, state.now, 'addBusinessUnit', { code, name, headName: head, members }); } catch (e) { return showErr('bu-err', e.message); }
      if (ui.draft && members.includes(ui.persona)) ui.draft.bu = code.toUpperCase();
      save(); render();
      toast(`${code.toUpperCase()} added. Its requests now route to ${head}${members.length ? `, and ${members.map(pname).join(', ')} can choose it on the form` : ''}.`);
    },
    'toggle-field'(el) { E.changeSettings(state, ui.persona, state.now, 'toggleField', { id: el.dataset.id, prop: el.dataset.prop }); save(); render(); toast('Saved. The request form uses it from now on.'); },
    'add-field'() {
      const label = document.getElementById('nf-label').value.trim();
      if (!label) return showErr('nf-err', 'Give the field a label.');
      E.changeSettings(state, ui.persona, state.now, 'addField', { domain: ui.adminDomain, label, type: document.getElementById('nf-type').value, required: document.getElementById('nf-req').checked, sensitive: document.getElementById('nf-sens').checked });
      save(); render(); toast(`"${label}" added to ${domainLabel(ui.adminDomain).toLowerCase()} requests.`);
    },
    'toggle-rule'(el) { E.changeSettings(state, ui.persona, state.now, 'toggleRule', { id: el.dataset.id }); save(); render(); toast('Saved. New requests use the updated route.'); },
    'add-rule'() {
      const approver = document.getElementById('nr-approver').value, field = document.getElementById('nr-field').value, op = document.getElementById('nr-op').value;
      const value = document.getElementById('nr-value').value.trim();
      let name = document.getElementById('nr-name').value.trim();
      if (field && ['equals', 'not_equals'].includes(op) && !value) return showErr('nr-err', 'Add the value to compare with.');
      const when = field ? { field, op, value: ['equals', 'not_equals'].includes(op) ? value : undefined } : null;
      if (!name) name = `${state.config.roles[approver].label} check`;
      E.changeSettings(state, ui.persona, state.now, 'addRule', { domain: ui.adminDomain, name, approver, when });
      save(); render(); toast(`Approval step added: ${name}.`);
    },
    'save-sla'() {
      const s = state.config.settings;
      const sla = Math.max(1, Math.min(5, Number(document.getElementById('sla-days').value) || s.slaDays));
      const escd = Math.max(1, Math.min(3, Number(document.getElementById('esc-days').value) || s.escalateAfterDays));
      const cut = document.getElementById('cutover').value || s.cutoverDate;
      if (sla !== s.slaDays) E.changeSettings(state, ui.persona, state.now, 'setting', { key: 'slaDays', value: sla, label: 'Approval target (working days)' });
      if (escd !== s.escalateAfterDays) E.changeSettings(state, ui.persona, state.now, 'setting', { key: 'escalateAfterDays', value: escd, label: 'Escalate after (working days)' });
      if (cut !== s.cutoverDate) E.changeSettings(state, ui.persona, state.now, 'setting', { key: 'cutoverDate', value: cut, label: 'Email cut-over date' });
      save(); render(); toast('Service levels saved.');
    },
  });

  // ---------------------------------------------------------------- shell actions
  Object.assign(App.actions, {
    go(el, e) { if (e) e.preventDefault(); go(el.dataset.route); },
    menu() { ui.menuOpen = !ui.menuOpen; render(); },
    async logout() {
      if (App.loggingOut) return;
      App.loggingOut = true;
      const buttons = document.querySelectorAll('[data-action="logout"]');
      buttons.forEach(button => { button.disabled = true; button.textContent = 'Logging out…'; });
      try {
        const response = await fetch('/api/logout', {method: 'POST'});
        if (!response.ok) throw new Error('Logout failed');
        window.HUB_USER = null;
        location.replace('/login.html');
      } catch {
        toast('Unable to log out. Check your connection and try again.');
        App.loggingOut = false;
        buttons.forEach(button => { button.disabled = false; button.textContent = 'Log out'; });
      }
    },
    reset() { ui.confirmReset = true; render(); },
    'reset-no'() { ui.confirmReset = false; render(); },
    'reset-yes'() {
      state = E.seedState(H);
      ui.confirmReset = false; ui.draft = null; ui.lastSubmitted = null; ui.drawer = null; ui.revealed = {};
      save(); render(); toast('Demo data reset.');
    },

  });

  // ---------------------------------------------------------------- events
  function onClick(e) {
    const el = e.target.closest('[data-action]');
    if (!el || el.tagName === 'SELECT' || (el.tagName === 'INPUT' && el.type !== 'checkbox' && el.type !== 'button')) return;
    if (el.tagName === 'INPUT' && el.type === 'checkbox') return; // handled on change
    const fn = App.actions[el.dataset.action];
    if (!fn) return;
    if (el.tagName === 'A') e.preventDefault();
    if (el.disabled) return;
    fn(el, e);
  }
  function onChange(e) {
    const el = e.target;
    if (el.dataset.action && el.type === 'checkbox' && App.actions[el.dataset.action]) { App.actions[el.dataset.action](el, e); return; }
    if (el.id === 'f-bu') { draft().bu = el.value; save(); refreshRequestSide(); render(); return; }
    if (el.id === 'f-clone') {
      const d = draft();
      const id = el.value;
      if (!id) return;
      const m = state.master;
      const copyKeys = { customer: ['segment', 'payment_terms', 'country', 'city'], item: ['product_line', 'category', 'manufacturer', 'uom', 'storage', 'shelf_life_months'], vendor: ['vendor_type', 'payment_terms', 'country'], cost_centre: ['country', 'owner'] }[d.domain];
      const src = d.domain === 'customer' ? m.customers.find((x) => x.customer_id === id) : d.domain === 'item' ? m.items.find((x) => x.item_code === id) : d.domain === 'vendor' ? m.vendors.find((x) => x.vendor_code === id) : m.cost_centres.find((x) => x.code === id);
      if (src) copyKeys.forEach((k) => { if (src[k] !== undefined && src[k] !== '') d.data[k] = String(src[k]); });
      save(); render();
      toast('Settings copied. Names, registration numbers and contact details are left for you to fill in.');
      return;
    }
    if (el.dataset.field && ui.route === 'request') {
      if (el.tagName !== 'SELECT' && el.type !== 'checkbox') return; // text fields are handled as you type
      App.onRequestInput(el);
      if (App.requestNeedsRender(el)) render(); else refreshRequestSide();
      return;
    }
    if (App.onChangeExtra && App.onChangeExtra(el)) return;
  }
  function onInput(e) {
    const el = e.target;
    if (ui.route === 'request' && (el.dataset.field || el.hasAttribute('data-dup-reason'))) {
      if (el.tagName === 'SELECT' || el.type === 'checkbox') return;
      App.onRequestInput(el);
      if (!el.hasAttribute('data-dup-reason')) refreshRequestSide();
      return;
    }
    if (el.hasAttribute('data-search')) { ui.search = el.value; save(); render(); return; }
    if (el.hasAttribute('data-audit-filter')) { ui.auditFilter = el.value; render(); return; }
    if (App.onInputExtra) App.onInputExtra(el);
  }
  function onKey(e) {
    if (e.key === 'Escape' && ui.drawer) { ui.drawer = null; render(); }
  }

  function start() {
    load();
    const h = (location.hash || '').replace('#', '');
    if (ROUTES.includes(h)) ui.route = h;
    document.addEventListener('click', onClick);
    document.addEventListener('change', onChange);
    document.addEventListener('input', onInput);
    document.addEventListener('keydown', onKey);
    document.addEventListener('submit', (e) => e.preventDefault());
    window.addEventListener('hashchange', () => { const r = (location.hash || '').replace('#', ''); if (ROUTES.includes(r) && r !== ui.route) { ui.route = r; render(); } });
    C.bindTooltips(document);
    let lastW = window.innerWidth;
    window.addEventListener('resize', () => {
      clearTimeout(App._rz);
      App._rz = setTimeout(() => { if (Math.abs(window.innerWidth - lastW) > 40 && ['regional', 'case', 'inbox'].includes(ui.route)) { lastW = window.innerWidth; render(); } }, 250);
    });
    render();
    if (['regional', 'case'].includes(ui.route)) render();
  }
  App.start = start;
  // The authenticated loader starts the app after all view modules are ready.
})();
