// Tests for assets/engine.js. Run: node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

global.window = {};
require('../assets/data.js');
const E = require('../assets/engine.js');
const HUB = window.HUB_DATA;
E.init(HUB.textnorm);
const fixture = (name) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8'));

test('duplicate scores match the Python batch matcher', () => {
  const f = fixture('dedup_parity.json');
  const check = (rows, fn, label) => {
    let worst = 0;
    for (const r of rows) {
      const d = Math.abs(fn(r) - r.score);
      if (d > worst) worst = d;
      assert.ok(d <= 0.15, `${label}: JS ${fn(r)} vs Python ${r.score} for ${JSON.stringify(r.a || r.q)} / ${JSON.stringify(r.b.name || r.b.description)}`);
    }
    return worst;
  };
  check(f.customer_pairs, (r) => E.scoreParty(r.a, r.b, 'customer').score, 'customer pair');
  check(f.customer_queries, (r) => E.scoreParty(r.q, r.b, 'customer').score, 'customer query');
  check(f.vendor_pairs, (r) => E.scoreParty(r.a, r.b, 'vendor').score, 'vendor pair');
  check(f.item_pairs, (r) => E.scoreItem(r.a, r.b).score, 'item pair');
  check(f.item_queries, (r) => E.scoreItem(r.q, r.b).score, 'item query');
});

test('inbox classifier reproduces scikit-learn probabilities', () => {
  const f = fixture('triage_parity.json');
  E.loadModel(HUB.triage.model);
  let agree = 0;
  for (const c of f.cases) {
    const out = E.classify(c.text);
    const py = f.classes[c.proba.indexOf(Math.max(...c.proba))];
    if (out.label === py) agree++;
    f.classes.forEach((cls, i) => assert.ok(Math.abs(out.proba[cls] - c.proba[i]) < 2e-3, `probability drift on: ${c.text.slice(0, 60)}`));
  }
  assert.equal(agree, f.cases.length);
});

test('initials and abbreviations are caught as you type', () => {
  const st = E.seedState(HUB);
  const top = (q) => E.findMatches(st, 'customer', { legal_name: q }, 'SPD')[0];
  assert.equal(top('NUH').label, 'National University Hospital');
  assert.equal(top('NUH').band, 'likely');
  assert.equal(top('Natl Univ Hosp').score, 100);
  assert.notEqual(top('Saigon Riverside Eye Clinic').label, 'Saigon Riverside Hospital JSC');
});

test('a regulated item shows the licence field and routes to Quality/Regulatory', () => {
  const cfg = E.defaultConfig();
  const keys = (data) => E.visibleFields(cfg, 'item', data).map((f) => f.key);
  assert.ok(!keys({ category: 'Lab consumable' }).includes('licence_no'));
  assert.ok(keys({ category: 'IVD reagent' }).includes('licence_no'));
  const v = E.validate(cfg, 'item', { description: 'x', product_line: 'A', category: 'IVD reagent', manufacturer: 'm', mfr_part_no: 'p', uom: 'kit', list_price: '10', storage: '2-8 °C' });
  assert.equal(v.errors.licence_no, 'Required');
  const roles = E.route(cfg, 'item', { category: 'IVD reagent' }, 'SPD').map((s) => s.role).sort();
  assert.deepEqual(roles, ['BUSINESS_SUPPORT', 'BU_HEAD', 'QA_RA']);
  assert.ok(E.route(cfg, 'item', { category: 'IVD reagent' }, 'SPD').every((s) => s.stage === 1), 'approvals run in parallel');
});

test('full lifecycle: submit, parallel approvals, MDM check, import, then the duplicate check finds the new record', () => {
  const st = E.seedState(HUB);
  const data = { legal_name: 'Harapan Kita Diagnostics Centre', country: 'ID', city: 'Jakarta', reg_no: '99.111.222.3-444.555', segment: 'Independent lab', address: 'Jl. Sudirman No. 1, Jakarta', contact_email: 'buy@hkd.co.id', phone: '+62 21 5555 1234', products: ['A'], payment_terms: 'Net 30', credit_limit: '50000' };
  assert.ok(E.validate(st.config, 'customer', data).ok);
  const req = E.createRequest(st, { domain: 'customer', bu: 'SPD', requester: 'nurul', data }, st.now);
  assert.equal(req.status, 'In approval');
  assert.deepEqual(req.approvals.map((a) => a.status), ['Pending', 'Pending']);
  E.decide(st, req.id, 'daniel', 'approve', '', st.now);
  assert.equal(req.status, 'In approval');
  E.decide(st, req.id, 'weijie', 'approve', '', st.now);
  assert.equal(req.status, 'MDM check');
  E.mdmApprove(st, req.id, 'priya', st.now);
  assert.match(req.sapCode, /^C-ID-\d{4}$/);
  const csv = E.buildImportCsv([req], 'customer');
  assert.equal(csv.count, 1);
  assert.match(csv.csv.split('\n')[0], /^RecordKey,CardCode,CardName,CardType/);
  E.markImported(st, [req.id], 'priya', st.now);
  assert.equal(req.status, 'Completed');
  const again = E.findMatches(st, 'customer', { legal_name: 'Harapan Kita Diagnostic Center' }, 'SPD')[0];
  assert.equal(again.id, req.sapCode);
  assert.ok(st.audit.filter((a) => a.reqId === req.id).length >= 6, 'every step is in the audit log');
});

test('asking for information pauses the request and resumes it', () => {
  const st = E.seedState(HUB);
  const req = st.requests.find((r) => r.status === 'Needs info');
  assert.ok(req, 'seed has a request waiting for information');
  E.provideInfo(st, req.id, req.requester, 'Bank letter attached', null, st.now);
  assert.equal(req.status, 'In approval');
  assert.ok(req.approvals.some((a) => a.assignee === 'weijie' && a.status === 'Pending'));
});

test('SLA: reminder after 2 working days, escalation one day later', () => {
  const st = E.seedState(HUB);
  const req = E.createRequest(st, { domain: 'cost_centre', bu: 'QTG', requester: 'joel', data: { code: 'CC-QTG-ID-SVC', name: 'QTG Field service - Indonesia', country: 'ID', owner: 'Arjun', valid_from: '2026-11-01' } }, '2026-10-01T09:00');
  st.now = '2026-10-01T09:00';
  E.advanceClock(st, 1);
  assert.equal(req.approvals[0].reminders, 0);
  E.advanceClock(st, 1);
  assert.equal(req.approvals[0].reminders, 1, 'reminded on the second working day');
  assert.equal(req.approvals[0].escalated, false);
  E.advanceClock(st, 1);
  assert.equal(req.approvals[0].escalated, true, 'escalated a working day later');
  assert.ok(st.notifications.some((n) => n.reqId === req.id && n.kind === 'escalation'));
});

test('adding a business unit in Settings routes its requests to the new head, no code change', () => {
  const st = E.seedState(HUB);
  E.changeSettings(st, 'priya', st.now, 'addBusinessUnit', { code: 'QTV', name: 'Vietnam clinical solutions', headName: 'Linh', members: ['marcus'] });
  assert.equal(E.personById(st.config, 'marcus').bu, 'QTV');
  const steps = E.route(st.config, 'customer', { payment_terms: 'Cash in advance' }, 'QTV');
  assert.equal(steps[0].assignee, 'linh_qtv');
  E.changeSettings(st, 'priya', st.now, 'addField', { domain: 'customer', label: 'Hospital accreditation no.', type: 'text', required: true });
  assert.ok(E.visibleFields(st.config, 'customer', {}).some((f) => f.key === 'hospital_accreditation_no'));
  assert.ok(st.audit.filter((a) => a.action === 'Settings changed').length >= 2);
});

test('sensitive fields are visible to Finance and MDM only', () => {
  const cfg = E.defaultConfig();
  assert.ok(E.canSeeSensitive(cfg, 'weijie'));
  assert.ok(E.canSeeSensitive(cfg, 'priya'));
  assert.ok(!E.canSeeSensitive(cfg, 'amy'));
  assert.equal(E.maskValue('440219887105'), '•••• 7105');
  assert.equal(E.maskValue('250,000'), '••••');
  assert.equal(E.maskValue('Deutsche Bank AG'), '••••');
});

test('turnaround simulation agrees with the Python model', () => {
  const bc = HUB.business_case;
  const out = E.simulateTurnaround({ counts: bc.history.approval_counts, probs: bc.history.approval_probs, cur: bc.sim.params_current, prop: bc.sim.params_proposed, n: 20000, seed: 3 });
  assert.ok(Math.abs(out.current.mean - bc.sim.current.mean) < 0.6, `current ${out.current.mean} vs ${bc.sim.current.mean}`);
  assert.ok(Math.abs(out.proposed.mean - bc.sim.proposed.mean) < 0.3, `proposed ${out.proposed.mean} vs ${bc.sim.proposed.mean}`);
});

test('working-day arithmetic skips weekends', () => {
  assert.equal(E.addWorkingDays('2026-10-02T09:00', 1), '2026-10-05T09:00');
  assert.equal(E.nextWorkingMorning('2026-10-02T15:00'), '2026-10-05T09:00');
});
