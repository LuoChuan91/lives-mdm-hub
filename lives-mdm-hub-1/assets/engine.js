/*
 * MDM Request Hub - engine.
 * Pure logic shared by the app (browser) and the tests (Node): duplicate matching,
 * form rules, approval routing, the request workflow with SLA reminders, the SAP B1
 * import file, the turnaround simulation and the inbox classifier.
 *
 * The duplicate matcher mirrors analysis/dedup.py and reads the same rules file
 * (analysis/textnorm.json, embedded in data.js), so browser and batch scores agree.
 */
(function (root) {
  'use strict';

  // ------------------------------------------------------------------ text rules
  let T = null;
  const S = {};

  function init(textnorm) {
    T = textnorm;
    S.phrases = [...T.phrases].sort((a, b) => b[0].length - a[0].length);
    S.strip = new Set(T.strip_tokens);
    S.generic = new Set(T.generic);
    S.stop = new Set(T.stopwords);
    S.itemGeneric = new Set(T.item_generic);
    S.itemVariants = new Set(T.item_variants);
    S.countryWords = new Set(['singapore', 'malaysia', 'indonesia', 'thailand', 'vietnam']);
    S.addrAbbr = { jln: 'jalan', jl: 'jalan', rd: 'road', st: 'street', ave: 'avenue', dr: 'drive', blvd: 'boulevard', cres: 'crescent', no: '' };
    S.freeMail = new Set(['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'live.com', 'icloud.com']);
    S.likely = T.thresholds.likely;
    S.possible = T.thresholds.possible;
  }

  const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const lookup = (o, k) => (has(o, k) ? o[k] : k);

  function fold(s) {
    return String(s || '').replace(/đ/g, 'd').replace(/Đ/g, 'D').normalize('NFKD').replace(/[̀-ͯ]/g, '');
  }

  function lcsLen(a, b) {
    if (!a || !b) return 0;
    let prev = new Int32Array(b.length + 1);
    let cur = new Int32Array(b.length + 1);
    for (let i = 0; i < a.length; i++) {
      cur[0] = 0;
      const ch = a.charCodeAt(i);
      for (let j = 1; j <= b.length; j++) {
        cur[j] = ch === b.charCodeAt(j - 1) ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
      }
      const t = prev; prev = cur; cur = t;
    }
    return prev[b.length];
  }

  function ratio(a, b) {
    if (!a && !b) return 100;
    if (!a || !b) return 0;
    return (200 * lcsLen(a, b)) / (a.length + b.length);
  }

  function withinOneEdit(a, b) {
    if (a === b || Math.abs(a.length - b.length) > 1) return false;
    if (a.length === b.length) {
      let d = 0;
      for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++;
      return d === 1;
    }
    if (a.length > b.length) [a, b] = [b, a];
    let i = 0, j = 0, skipped = false;
    while (i < a.length && j < b.length) {
      if (a[i] !== b[j]) {
        if (skipped) return false;
        skipped = true; j++;
      } else { i++; j++; }
    }
    return true;
  }

  function initials(tokens) {
    return tokens.filter((t) => t && !S.stop.has(t) && !/^\d+$/.test(t)).map((t) => t[0]).join('');
  }

  function splitWords(s) { return s.split(' ').filter(Boolean); }

  function nameTokens(name) {
    let s = fold(name).toLowerCase().replace(/&/g, ' and ');
    s = s.replace(/[^a-z0-9]+/g, ' ');
    s = ' ' + splitWords(s).join(' ') + ' ';
    for (const [a, b] of S.phrases) s = s.split(' ' + a + ' ').join(' ' + b + ' ');
    let toks = splitWords(s).map((t) => lookup(T.abbrev, t)).filter((t) => t && !S.strip.has(t));
    if (toks.length > 2) {
      for (const t of [...toks]) {
        const rest = toks.filter((x) => x !== t);
        if (t.length >= 3 && t === initials(rest)) { toks = rest; break; }
      }
    }
    return toks;
  }

  const distinctive = (tokens) => tokens.filter((t) => !S.generic.has(t));
  const sortedJoin = (tokens, sep) => [...tokens].sort().join(sep === undefined ? ' ' : sep);

  function nameScore(ta, tb) {
    if (!ta.length || !tb.length) return 0;
    const full = ratio(sortedJoin(ta), sortedJoin(tb));
    const compact = ratio(ta.join(''), tb.join(''));
    const da = distinctive(ta), db = distinctive(tb);
    if (da.length && db.length) {
      const dist = Math.max(ratio(sortedJoin(da), sortedJoin(db)), ratio(da.join(''), db.join('')));
      return 0.4 * Math.max(full, compact) + 0.6 * dist;
    }
    return 0.85 * Math.max(full, compact);
  }

  function addressKey(addr) {
    const s = fold(addr).toLowerCase().replace(/[^a-z0-9]+/g, ' ');
    return splitWords(s).map((t) => lookup(S.addrAbbr, t)).filter((t) => t && !S.countryWords.has(t)).sort().join(' ');
  }
  const normReg = (r) => String(r || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const digits = (p) => String(p || '').replace(/\D/g, '');
  function emailDomain(e) {
    e = String(e || '').toLowerCase().trim();
    const d = e.includes('@') ? e.split('@').pop() : '';
    return S.freeMail.has(d) ? '' : d;
  }
  const fmt = (x) => Math.round(x);
  const band = (score) => (score >= S.likely ? 'likely' : score >= S.possible ? 'possible' : 'none');
  const round1 = (x) => Math.round(x * 10) / 10;

  function scoreParty(q, c, kind) {
    kind = kind || 'customer';
    const ta = nameTokens(q.name || ''), tb = nameTokens(c.name || '');
    const reasons = [];
    const ns = nameScore(ta, tb);
    let init = 0;
    if (ta.length === 1 && ta[0].length >= 2 && ta[0].length <= 6 && ta[0] === initials(tb)) init = 92;
    if (tb.length === 1 && tb[0].length >= 2 && tb[0].length <= 6 && tb[0] === initials(ta)) init = 92;
    let base = Math.max(ns, init);
    if (init && init >= ns) reasons.push('Typed name matches the initials of this record');
    else if (ns >= 50) reasons.push(`Name ${fmt(ns)}% similar`);
    const ka = new Set(ta.filter((t) => has(T.kinds, t)).map((t) => T.kinds[t]));
    const kb = new Set(tb.filter((t) => has(T.kinds, t)).map((t) => T.kinds[t]));
    if (ka.size && kb.size && ![...ka].some((k) => kb.has(k))) { base -= 15; reasons.push('Different type of facility'); }
    const ga = new Set(ta.filter((t) => S.generic.has(t) && !S.countryWords.has(t) && !S.stop.has(t)));
    const gb = new Set(tb.filter((t) => S.generic.has(t) && !S.countryWords.has(t) && !S.stop.has(t)));
    if (ga.size && gb.size && ![...ga].some((g) => gb.has(g))) base -= 10;
    const rq = normReg(q.reg_no), rc = normReg(c.reg_no);
    const idMatch = rq.length >= 6 && rq === rc;
    const regNear = !idMatch && rq.length >= 6 && rc.length >= 6 && withinOneEdit(rq, rc);
    const dq = digits(q.phone), dc = digits(c.phone);
    const phoneMatch = dq.length >= 8 && dc.length >= 8 && dq.slice(-8) === dc.slice(-8);
    const aq = addressKey(q.address || ''), ac = addressKey(c.address || '');
    const asim = aq && ac ? ratio(aq, ac) : 0;
    let bankMatch = false;
    if (kind === 'vendor') {
      const bq = digits(q.bank_account), bc = digits(c.bank_account);
      bankMatch = bq.length >= 6 && bq === bc;
    }
    const corroborated = idMatch || regNear || phoneMatch || asim >= 85 || bankMatch;
    const cq = String(q.country || '').toUpperCase(), cc = String(c.country || '').toUpperCase();
    if (cq && cc && cq !== cc) {
      if (corroborated) reasons.push(`Same organisation recorded under a different country (${cc})`);
      else { base -= 10; reasons.push(`Different country (${cc})`); }
    }
    const tq = nameTokens(q.city || '').join(' '), tc = nameTokens(c.city || '').join(' ');
    if (tq && tc && tq !== tc && !corroborated) base -= 8;
    if (phoneMatch) { base += 5; reasons.push('Same phone number'); }
    if (asim >= 85) { base += 5; reasons.push(`Address ${fmt(asim)}% similar`); }
    if (regNear) { base += 6; reasons.push('Registration no. differs by one character'); }
    if (bankMatch) { base += 10; reasons.push(`Same bank account (ending ${digits(c.bank_account).slice(-4)})`); }
    const eq = emailDomain(q.email), ec = emailDomain(c.email);
    if (eq && eq === ec) { base += 3; reasons.push('Same email domain'); }
    if (idMatch) { base = Math.max(base, ns >= 80 ? 100 : 98); reasons.unshift('Same registration no.'); }
    const score = Math.max(0, Math.min(100, base));
    return { score: round1(score), band: band(score), reasons, name_score: round1(ns) };
  }

  function itemTokens(desc) {
    let s = fold(desc).toLowerCase().replace(/[^a-z0-9]+/g, ' ');
    s = s.replace(/(\d)([a-z])/g, '$1 $2').replace(/([a-z])(\d)/g, '$1 $2');
    const out = [];
    for (let t of splitWords(s)) {
      t = lookup(T.item_abbrev, t);
      if (!t) continue;
      if (t.length > 3 && t.endsWith('s') && !t.endsWith('ss')) t = t.slice(0, -1);
      out.push(t);
    }
    return out;
  }

  function scoreItem(q, c) {
    const ta = itemTokens(q.description || ''), tb = itemTokens(c.description || '');
    const reasons = [];
    if (!ta.length || !tb.length) return { score: 0, band: 'none', reasons };
    const full = Math.max(ratio(sortedJoin(ta), sortedJoin(tb)), ratio(ta.join(' '), tb.join(' ')));
    const keep = (t) => !S.itemGeneric.has(t) && !/^\d+$/.test(t) && t.length > 1;
    const da = ta.filter(keep), db = tb.filter(keep);
    let s;
    if (da.length && db.length) {
      const dist = Math.max(ratio(sortedJoin(da), sortedJoin(db)), ratio(da.join(''), db.join('')));
      s = 0.4 * full + 0.6 * dist;
    } else s = 0.85 * full;
    if (s >= 50) reasons.push(`Description ${fmt(s)}% similar`);
    const va = new Set(ta.filter((t) => S.itemVariants.has(t))), vb = new Set(tb.filter((t) => S.itemVariants.has(t)));
    const setEq = (x, y) => x.size === y.size && [...x].every((v) => y.has(v));
    if (va.size && vb.size && !setEq(va, vb)) { s -= 20; reasons.push(`Different variant (${[...va].sort().join(', ')} vs ${[...vb].sort().join(', ')})`); }
    const na = new Set(ta.filter((t) => /^\d+$/.test(t) && t.length > 1)), nb = new Set(tb.filter((t) => /^\d+$/.test(t) && t.length > 1));
    if (na.size && nb.size && !setEq(na, nb)) { s -= 15; reasons.push(`Different pack size or strength (${[...na].sort().join(', ')} vs ${[...nb].sort().join(', ')})`); }
    if (q.product_line && c.product_line && q.product_line !== c.product_line) { s -= 20; reasons.push('Different product line'); }
    const pq = normReg(q.mfr_part_no), pc = normReg(c.mfr_part_no);
    if (pq.length >= 4 && pq === pc) { s = 100; reasons.unshift('Same manufacturer part no.'); }
    s = Math.max(0, Math.min(100, s));
    return { score: round1(s), band: band(s), reasons };
  }

  function scoreCostCentre(q, c) {
    if (normReg(q.code) && normReg(q.code) === normReg(c.code)) return { score: 100, band: 'likely', reasons: ['Same cost centre code'] };
    let s = ratio(sortedJoin(nameTokens(q.name || '')), sortedJoin(nameTokens(c.name || '')));
    const reasons = s >= 50 ? [`Name ${fmt(s)}% similar`] : [];
    if (q.entity && c.entity && q.entity !== c.entity) s -= 10;
    s = Math.max(0, Math.min(100, s));
    return { score: round1(s), band: band(s), reasons };
  }

  // Map a form's data to the record shape each scorer expects.
  function queryFromForm(domain, data, bu) {
    if (domain === 'customer') return { name: data.legal_name, reg_no: data.reg_no, phone: data.phone, address: data.address, country: data.country, city: data.city, email: data.contact_email };
    if (domain === 'vendor') return { name: data.legal_name, reg_no: data.reg_no, country: data.country, bank_account: data.bank_account };
    if (domain === 'item') return { description: data.description, product_line: data.product_line, mfr_part_no: data.mfr_part_no };
    return { code: data.code, name: data.name, entity: bu };
  }

  function queryText(domain, q) {
    return domain === 'item' ? q.description : domain === 'cost_centre' ? (q.code || '') + (q.name || '') : q.name;
  }

  // Candidates from master data plus requests already in flight (so two people can't request the same record).
  function findMatches(state, domain, data, bu, limit) {
    const q = queryFromForm(domain, data, bu);
    const text = String(queryText(domain, q) || '').trim();
    const idText = domain === 'customer' || domain === 'vendor' ? normReg(q.reg_no) : domain === 'item' ? normReg(q.mfr_part_no) : '';
    if (text.length < 3 && idText.length < 6) return [];
    const out = [];
    const push = (rec, s, source) => { if (s.score >= 60) out.push({ ...rec, ...s, source }); };
    const m = state.master;
    if (domain === 'customer') {
      for (const r of m.customers) push({ id: r.customer_id, label: r.name, sub: `${r.entity} · ${r.country} · ${r.city}`, entity: r.entity, country: r.country }, scoreParty(q, r, 'customer'), 'master');
    } else if (domain === 'vendor') {
      for (const r of m.vendors) push({ id: r.vendor_code, label: r.name, sub: `${r.vendor_type} · ${r.country}`, country: r.country }, scoreParty(q, { ...r, name: r.name }, 'vendor'), 'master');
    } else if (domain === 'item') {
      for (const r of m.items) push({ id: r.item_code, label: r.description, sub: `Product ${r.product_line} · ${r.category} · ${r.manufacturer}`, entity: r.entity }, scoreItem(q, r), 'master');
    } else {
      for (const r of m.cost_centres) push({ id: r.code, label: r.name, sub: `${r.entity} · ${r.country} · owner ${r.owner}`, entity: r.entity }, scoreCostCentre(q, r), 'master');
    }
    for (const req of state.requests) {
      if (req.domain !== domain || ['Rejected', 'Completed'].includes(req.status)) continue;
      const rq = queryFromForm(domain, req.data, req.bu);
      const s = domain === 'item' ? scoreItem(q, rq) : domain === 'cost_centre' ? scoreCostCentre(q, rq) : scoreParty(q, rq, domain);
      push({ id: req.id, label: req.title, sub: `Request in progress · ${req.status}`, entity: req.bu }, s, 'request');
    }
    out.sort((a, b) => b.score - a.score);
    return out.slice(0, limit || 4);
  }

  // ------------------------------------------------------------------ dates (simulated clock, minutes precision, no time zone)
  const toDate = (iso) => new Date(iso + ':00Z');
  const toIso = (d) => d.toISOString().slice(0, 16);
  function addWorkingDays(iso, n) {
    const d = toDate(iso);
    let left = n;
    while (left > 0) {
      d.setUTCDate(d.getUTCDate() + 1);
      const wd = d.getUTCDay();
      if (wd !== 0 && wd !== 6) left--;
    }
    return toIso(d);
  }
  function nextWorkingMorning(iso) {
    const d = toDate(iso);
    do { d.setUTCDate(d.getUTCDate() + 1); } while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
    d.setUTCHours(9, 0, 0, 0);
    return toIso(d);
  }
  function workingDaysBetween(aIso, bIso) {
    const a = toDate(aIso), b = toDate(bIso);
    if (b <= a) return 0;
    let days = 0;
    const d = new Date(a);
    while (true) {
      d.setUTCDate(d.getUTCDate() + 1);
      if (d > b) break;
      if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) days++;
    }
    const rem = (b - new Date(d.getTime() - 86400000)) / 86400000;
    return days + Math.max(0, Math.min(1, rem));
  }
  const daysBetween = (aIso, bIso) => (toDate(bIso) - toDate(aIso)) / 86400000;

  // ------------------------------------------------------------------ configuration (what the Settings page edits)
  const COUNTRY_OPTIONS = ['SG', 'MY', 'ID', 'TH', 'VN'];

  function defaultConfig() {
    let n = 0;
    const f = (domain, key, label, type, extra) => ({ id: `F${++n}`, domain, key, label, type, required: false, sensitive: false, active: true, order: n, ...extra });
    const fields = [
      f('customer', 'legal_name', 'Legal name', 'text', { required: true, placeholder: 'As on the business registration' }),
      f('customer', 'country', 'Country', 'select', { required: true, options: COUNTRY_OPTIONS }),
      f('customer', 'city', 'City', 'text', { required: true }),
      f('customer', 'reg_no', 'Business registration / tax no.', 'text', { required: true, help: 'UEN (SG), SSM (MY), NPWP (ID), tax ID (TH), MST (VN)' }),
      f('customer', 'segment', 'Customer segment', 'select', { required: true, options: ['Public hospital', 'Private hospital', 'Independent lab', 'Clinic group', 'Research institute', 'Distributor'] }),
      f('customer', 'address', 'Billing address', 'textarea', { required: true }),
      f('customer', 'contact_email', 'Purchasing contact email', 'email', { required: true }),
      f('customer', 'phone', 'Phone', 'text', { required: true }),
      f('customer', 'products', 'Product lines they will buy', 'multi', { required: true, options: ['A', 'B', 'C'] }),
      f('customer', 'payment_terms', 'Payment terms', 'select', { required: true, options: ['Cash in advance', 'Net 30', 'Net 60', 'Net 90'] }),
      f('customer', 'credit_limit', 'Credit limit (SGD)', 'number', { required: true, sensitive: true, showIf: { field: 'payment_terms', op: 'not_equals', value: 'Cash in advance' }, help: 'Visible to Finance and the MDM team only' }),
      f('customer', 'tender_ref', 'Tender or contract reference', 'text', { required: true, showIf: { field: 'segment', op: 'equals', value: 'Public hospital' }, help: 'Public hospitals buy under a tender; Business Support checks it' }),
      f('item', 'description', 'Item description', 'text', { required: true, placeholder: 'e.g. HbA1c Reagent Kit, 200 tests' }),
      f('item', 'product_line', 'Product line', 'select', { required: true, options: ['A', 'B', 'C'] }),
      f('item', 'category', 'Category', 'select', { required: true, options: ['IVD reagent', 'Medical device', 'Lab consumable', 'Instrument', 'Service'] }),
      f('item', 'licence_no', 'Product registration / licence no.', 'text', { required: true, showIf: { field: 'category', op: 'in', value: ['IVD reagent', 'Medical device'] }, help: 'Regulated diagnostics and devices need a licence; Quality/Regulatory checks it' }),
      f('item', 'storage', 'Storage condition', 'select', { required: true, options: ['Ambient', '2-8 °C', '-20 °C'], showIf: { field: 'category', op: 'equals', value: 'IVD reagent' } }),
      f('item', 'shelf_life_months', 'Shelf life (months)', 'number', { required: false, showIf: { field: 'category', op: 'equals', value: 'IVD reagent' } }),
      f('item', 'manufacturer', 'Manufacturer', 'text', { required: true }),
      f('item', 'mfr_part_no', 'Manufacturer part no.', 'text', { required: true }),
      f('item', 'uom', 'Unit of measure', 'select', { required: true, options: ['kit', 'box', 'case', 'unit', 'visit', 'month'] }),
      f('item', 'list_price', 'List price (SGD)', 'number', { required: true }),
      f('vendor', 'legal_name', 'Legal name', 'text', { required: true }),
      f('vendor', 'country', 'Country', 'select', { required: true, options: ['SG', 'MY', 'ID', 'TH', 'VN', 'US', 'DE', 'JP', 'GB', 'SE', 'AU', 'CN', 'Other'] }),
      f('vendor', 'reg_no', 'Company registration no.', 'text', { required: true }),
      f('vendor', 'vendor_type', 'Vendor type', 'select', { required: true, options: ['Product principal / manufacturer', 'Logistics', 'Service provider', 'Other'] }),
      f('vendor', 'quality_agreement', 'Quality agreement attached', 'checkbox', { required: true, showIf: { field: 'vendor_type', op: 'equals', value: 'Product principal / manufacturer' }, help: 'Principals must sign a quality agreement before we import their products' }),
      f('vendor', 'address', 'Address', 'textarea', { required: true }),
      f('vendor', 'contact_email', 'Accounts contact email', 'email', { required: true }),
      f('vendor', 'bank_name', 'Bank name', 'text', { required: true, sensitive: true }),
      f('vendor', 'bank_account', 'Bank account no.', 'text', { required: true, sensitive: true }),
      f('vendor', 'swift', 'SWIFT / BIC', 'text', { required: true, sensitive: true }),
      f('vendor', 'payment_terms', 'Payment terms', 'select', { required: true, options: ['Net 30', 'Net 45', 'Net 60'] }),
      f('cost_centre', 'code', 'Cost centre code', 'text', { required: true, placeholder: 'CC-<BU>-<country>-<function>' }),
      f('cost_centre', 'name', 'Name', 'text', { required: true }),
      f('cost_centre', 'country', 'Country', 'select', { required: true, options: COUNTRY_OPTIONS }),
      f('cost_centre', 'owner', 'Budget owner', 'text', { required: true }),
      f('cost_centre', 'valid_from', 'Valid from', 'date', { required: true }),
      f('cost_centre', 'purpose', 'Purpose', 'textarea', { required: false }),
    ];
    let r = 0;
    const rule = (domain, name, approver, when, extra) => ({ id: `R${++r}`, domain, name, approver, when: when || null, stage: 1, active: true, ...extra });
    const rules = [
      rule('customer', 'Every new customer needs the business unit head', 'BU_HEAD'),
      rule('customer', 'Credit terms requested', 'FINANCE', { field: 'payment_terms', op: 'not_equals', value: 'Cash in advance' }),
      rule('customer', 'Public hospital: tender and contract check', 'BUSINESS_SUPPORT', { field: 'segment', op: 'equals', value: 'Public hospital' }),
      rule('item', 'Every new item needs the business unit head', 'BU_HEAD'),
      rule('item', 'Regulated product: licence check', 'QA_RA', { field: 'category', op: 'in', value: ['IVD reagent', 'Medical device'] }),
      rule('item', 'Pricing and item setup', 'BUSINESS_SUPPORT'),
      rule('vendor', 'Vendor evaluation', 'PROCUREMENT'),
      rule('vendor', 'Bank details verification', 'FINANCE'),
      rule('vendor', 'Principal: quality agreement check', 'QA_RA', { field: 'vendor_type', op: 'equals', value: 'Product principal / manufacturer' }),
      rule('cost_centre', 'Financial reporting structure', 'FINANCE'),
      rule('cost_centre', 'Business unit head owns the budget', 'BU_HEAD'),
    ];
    return {
      domains: [
        { key: 'customer', label: 'Customer', sap: 'Business Partner (customer)', nameField: 'legal_name', active: true },
        { key: 'item', label: 'Item', sap: 'Item master data', nameField: 'description', active: true },
        { key: 'vendor', label: 'Vendor', sap: 'Business Partner (vendor)', nameField: 'legal_name', active: true },
        { key: 'cost_centre', label: 'Cost centre', sap: 'Profit / cost centre', nameField: 'name', active: true },
      ],
      fields,
      rules,
      roles: {
        BU_HEAD: { label: 'Business unit head' },
        FINANCE: { label: 'Finance', person: 'weijie' },
        QA_RA: { label: 'Quality & Regulatory', person: 'siti' },
        BUSINESS_SUPPORT: { label: 'Business Support', person: 'grace' },
        PROCUREMENT: { label: 'Procurement', person: 'hafiz' },
        MDM: { label: 'MDM team', person: 'priya' },
      },
      businessUnits: [
        { code: 'SPD', name: 'SPD · Diagnostics (Product A)', head: 'daniel', active: true },
        { code: 'QTS', name: 'QTS · Lab supplies (Product B)', head: 'meiling', active: true },
        { code: 'QTG', name: 'QTG · Instruments & service (Product C)', head: 'arjun', active: true },
      ],
      people: [
        { id: 'amy', name: 'Amy', title: 'Product Manager', bu: 'SPD', kind: 'requester' },
        { id: 'nurul', name: 'Nurul', title: 'Sales Executive', bu: 'SPD', kind: 'requester' },
        { id: 'joel', name: 'Joel', title: 'Procurement Officer', bu: 'QTS', kind: 'requester' },
        { id: 'marcus', name: 'Marcus', title: 'Regional Sales, new business unit', bu: null, kind: 'requester' },
        { id: 'weijie', name: 'Wei Jie', title: 'Finance Manager', role: 'FINANCE', kind: 'approver' },
        { id: 'siti', name: 'Dr Siti', title: 'Quality & Regulatory', role: 'QA_RA', kind: 'approver' },
        { id: 'daniel', name: 'Daniel', title: 'BU Head, SPD', role: 'BU_HEAD', bu: 'SPD', kind: 'approver' },
        { id: 'meiling', name: 'Mei Ling', title: 'BU Head, QTS', role: 'BU_HEAD', bu: 'QTS', kind: 'approver' },
        { id: 'arjun', name: 'Arjun', title: 'BU Head, QTG', role: 'BU_HEAD', bu: 'QTG', kind: 'approver' },
        { id: 'grace', name: 'Grace', title: 'Business Support', role: 'BUSINESS_SUPPORT', kind: 'approver' },
        { id: 'hafiz', name: 'Hafiz', title: 'Procurement Lead', role: 'PROCUREMENT', kind: 'approver' },
        { id: 'priya', name: 'Priya', title: 'MDM Analyst', role: 'MDM', kind: 'mdm' },
      ],
      settings: { slaDays: 2, escalateAfterDays: 1, mdmCheckDays: 1, cutoverDate: '2027-01-04' },
    };
  }

  // ------------------------------------------------------------------ form rules
  function evalCond(cond, data) {
    if (!cond) return true;
    const v = data[cond.field];
    switch (cond.op) {
      case 'equals': return v === cond.value;
      case 'not_equals': return v !== undefined && v !== '' && v !== cond.value;
      case 'in': return Array.isArray(cond.value) && cond.value.includes(v);
      case 'not_in': return Array.isArray(cond.value) && v !== undefined && v !== '' && !cond.value.includes(v);
      case 'not_empty': return v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && !v.length);
      case 'is_true': return v === true;
      case 'gt': return Number(v) > Number(cond.value);
      case 'lt': return Number(v) < Number(cond.value);
      default: return false;
    }
  }

  function describeCond(cond, config, domain) {
    if (!cond) return 'Always';
    const field = config.fields.find((x) => x.domain === domain && x.key === cond.field);
    const label = field ? field.label : cond.field;
    const val = Array.isArray(cond.value) ? cond.value.join(' or ') : cond.value;
    switch (cond.op) {
      case 'equals': return `${label} is ${val}`;
      case 'not_equals': return `${label} is not ${val}`;
      case 'in': return `${label} is ${val}`;
      case 'not_in': return `${label} is not ${val}`;
      case 'not_empty': return `${label} is filled in`;
      case 'is_true': return `${label} is ticked`;
      case 'gt': return `${label} is over ${val}`;
      case 'lt': return `${label} is under ${val}`;
      default: return '';
    }
  }

  function visibleFields(config, domain, data) {
    return config.fields.filter((x) => x.domain === domain && x.active && evalCond(x.showIf, data || {})).sort((a, b) => a.order - b.order);
  }

  function isBlank(v) { return v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length) || v === false; }

  function validate(config, domain, data) {
    const errors = {};
    for (const fd of visibleFields(config, domain, data)) {
      const v = data[fd.key];
      if (fd.required && isBlank(v)) { errors[fd.key] = fd.type === 'checkbox' ? 'Tick to confirm' : 'Required'; continue; }
      if (isBlank(v)) continue;
      if (fd.type === 'email' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) errors[fd.key] = 'Enter an email address like name@company.com';
      if (fd.type === 'number' && (isNaN(Number(v)) || Number(v) < 0)) errors[fd.key] = 'Enter a number of 0 or more';
    }
    return { ok: Object.keys(errors).length === 0, errors };
  }

  function personById(config, id) { return config.people.find((p) => p.id === id); }
  function buByCode(config, code) { return config.businessUnits.find((b) => b.code === code); }

  function assigneeFor(config, role, bu) {
    if (role === 'BU_HEAD') { const b = buByCode(config, bu); return b ? b.head : null; }
    return config.roles[role] ? config.roles[role].person : null;
  }

  function roleLabel(config, role, bu) {
    if (role === 'BU_HEAD') return `BU head, ${bu}`;
    return config.roles[role] ? config.roles[role].label : role;
  }

  function route(config, domain, data, bu) {
    const steps = [];
    for (const r of config.rules) {
      if (r.domain !== domain || !r.active || !evalCond(r.when, data)) continue;
      const key = r.approver + (r.approver === 'BU_HEAD' ? ':' + bu : '');
      let step = steps.find((s) => s.key === key);
      if (!step) {
        step = { key, role: r.approver, bu: r.approver === 'BU_HEAD' ? bu : null, stage: r.stage || 1, assignee: assigneeFor(config, r.approver, bu), reasons: [] };
        steps.push(step);
      }
      step.stage = Math.min(step.stage, r.stage || 1);
      step.reasons.push(r.name);
    }
    return steps.sort((a, b) => a.stage - b.stage);
  }

  // ------------------------------------------------------------------ state, audit and notifications
  function log(state, at, actor, action, reqId, detail) {
    state.audit.push({ id: `A${++state.seq.audit}`, at, actor, action, reqId: reqId || null, detail: detail || '' });
  }
  function notify(state, at, to, reqId, kind, text) {
    if (!to) return;
    state.notifications.push({ id: `N${++state.seq.note}`, at, to, reqId, kind, text, read: false });
  }

  function titleFor(config, domain, data) {
    const d = config.domains.find((x) => x.key === domain);
    const name = data[d ? d.nameField : 'name'] || '(untitled)';
    return domain === 'cost_centre' && data.code ? `${data.code} · ${name}` : name;
  }

  function activateStage(state, req, at) {
    const pending = req.approvals.filter((a) => a.status === 'Waiting');
    if (!pending.length) return false;
    const stage = Math.min(...pending.map((a) => a.stage));
    const s = state.config.settings;
    for (const a of pending.filter((x) => x.stage === stage)) {
      a.status = 'Pending';
      a.assignedAt = at;
      a.dueAt = addWorkingDays(at, s.slaDays);
      notify(state, at, a.assignee, req.id, 'approval', `Approval needed: ${req.title}`);
    }
    return true;
  }

  function createRequest(state, input, at) {
    const cfg = state.config;
    const req = {
      id: `REQ-${++state.seq.req}`,
      domain: input.domain,
      bu: input.bu,
      requester: input.requester,
      type: input.type || 'new',
      data: { ...input.data },
      title: titleFor(cfg, input.domain, input.data),
      status: 'In approval',
      createdAt: at,
      updatedAt: at,
      dup: input.dup || { decision: 'none' },
      approvals: [],
      sapCode: null,
      completedAt: null,
      importedAt: null,
    };
    const steps = route(cfg, req.domain, req.data, req.bu);
    req.approvals = steps.map((s, i) => ({ id: `${req.id}-T${i + 1}`, role: s.role, bu: s.bu, assignee: s.assignee, stage: s.stage, reasons: s.reasons, status: 'Waiting', assignedAt: null, dueAt: null, decidedAt: null, comment: '', reminders: 0, escalated: false }));
    state.requests.push(req);
    const who = personById(cfg, req.requester);
    log(state, at, req.requester, 'Submitted', req.id, `${who ? who.name : req.requester} submitted a ${req.type === 'extend' ? 'request to extend an existing record' : 'new ' + domainLabel(cfg, req.domain).toLowerCase() + ' request'} for ${req.bu}`);
    if (req.dup.decision === 'override') log(state, at, req.requester, 'Possible duplicate reviewed', req.id, `Requestor confirmed this is not ${req.dup.matchName} (${req.dup.matchId}, score ${req.dup.score}): "${req.dup.reason}"`);
    if (req.dup.decision === 'extend') log(state, at, req.requester, 'Existing record reused', req.id, `Extending ${req.dup.matchName} (${req.dup.matchId}) to ${req.bu} instead of creating a new record`);
    if (!req.approvals.length) {
      req.status = 'MDM check';
      log(state, at, 'system', 'Routed', req.id, 'No approval rules matched; sent straight to the MDM team');
      notify(state, at, cfg.roles.MDM.person, req.id, 'approval', `Ready for MDM check: ${req.title}`);
      return req;
    }
    log(state, at, 'system', 'Routed', req.id, req.approvals.map((a) => `${roleLabel(cfg, a.role, a.bu)} (${a.reasons.join('; ')})`).join(', ') + (new Set(req.approvals.map((a) => a.stage)).size === 1 && req.approvals.length > 1 ? '. All approvals run in parallel.' : '.'));
    activateStage(state, req, at);
    return req;
  }

  function domainLabel(cfg, key) { const d = cfg.domains.find((x) => x.key === key); return d ? d.label : key; }

  function findTask(req, personId, cfg) {
    return req.approvals.find((a) => a.assignee === personId && (a.status === 'Pending' || a.status === 'Info requested'));
  }

  function decide(state, reqId, personId, decision, comment, at) {
    const cfg = state.config;
    const req = state.requests.find((r) => r.id === reqId);
    if (!req) throw new Error('Request not found');
    const task = findTask(req, personId, cfg);
    if (!task) throw new Error('No open approval for this person');
    const who = personById(cfg, personId);
    task.comment = comment || '';
    req.updatedAt = at;
    if (decision === 'approve') {
      task.status = 'Approved';
      task.decidedAt = at;
      log(state, at, personId, 'Approved', req.id, `${who.name} (${roleLabel(cfg, task.role, task.bu)}) approved${comment ? ': "' + comment + '"' : ''}`);
      notify(state, at, req.requester, req.id, 'decision', `${who.name} approved ${req.title}`);
      const open = req.approvals.filter((a) => ['Pending', 'Info requested'].includes(a.status));
      if (!open.length && !activateStage(state, req, at)) {
        req.status = 'MDM check';
        log(state, at, 'system', 'All approvals received', req.id, 'Sent to the MDM team for the final check');
        notify(state, at, cfg.roles.MDM.person, req.id, 'approval', `Ready for MDM check: ${req.title}`);
      } else if (!req.approvals.some((a) => a.status === 'Info requested')) {
        req.status = 'In approval';
      }
    } else if (decision === 'reject') {
      task.status = 'Rejected';
      task.decidedAt = at;
      req.status = 'Rejected';
      for (const a of req.approvals) if (['Pending', 'Waiting', 'Info requested'].includes(a.status)) a.status = 'Cancelled';
      log(state, at, personId, 'Rejected', req.id, `${who.name} rejected: "${comment || 'no reason given'}"`);
      notify(state, at, req.requester, req.id, 'decision', `${who.name} rejected ${req.title}`);
    } else if (decision === 'info') {
      task.status = 'Info requested';
      req.status = 'Needs info';
      log(state, at, personId, 'Asked for information', req.id, `${who.name} asked: "${comment}"`);
      notify(state, at, req.requester, req.id, 'info', `${who.name} needs more information on ${req.title}`);
    }
    return req;
  }

  function provideInfo(state, reqId, personId, note, updates, at) {
    const cfg = state.config;
    const req = state.requests.find((r) => r.id === reqId);
    if (!req || req.status !== 'Needs info') throw new Error('Request is not waiting for information');
    if (updates) {
      for (const [k, v] of Object.entries(updates)) {
        const fd = cfg.fields.find((x) => x.domain === req.domain && x.key === k);
        const old = req.data[k];
        req.data[k] = v;
        log(state, at, personId, 'Field updated', req.id, `${fd ? fd.label : k} changed${fd && fd.sensitive ? ' (sensitive, value hidden)' : `: ${old || '(blank)'} -> ${v}`}`);
      }
    }
    for (const a of req.approvals.filter((x) => x.status === 'Info requested')) {
      a.status = 'Pending';
      a.assignedAt = at;
      a.dueAt = addWorkingDays(at, cfg.settings.slaDays);
      a.reminders = 0;
      a.escalated = false;
      notify(state, at, a.assignee, req.id, 'approval', `Information added to ${req.title}; it is back with you`);
    }
    req.status = 'In approval';
    req.updatedAt = at;
    log(state, at, personId, 'Information provided', req.id, note ? `"${note}"` : 'Requestor responded');
    return req;
  }

  function nextSapCode(state, req) {
    const d = req.data;
    if (req.type === 'extend' && req.dup && req.dup.matchId) return req.dup.matchId;
    if (req.domain === 'customer') {
      const c = d.country || 'SG';
      const n = state.master.customers.filter((x) => x.customer_id.startsWith(`C-${c}-`)).length + state.requests.filter((r) => r.sapCode && r.sapCode.startsWith(`C-${c}-`)).length + 1;
      return `C-${c}-${String(n).padStart(4, '0')}`;
    }
    if (req.domain === 'vendor') {
      const n = 2200 + state.requests.filter((r) => r.sapCode && r.sapCode.startsWith('V-')).length + 1;
      return `V-${n}`;
    }
    if (req.domain === 'item') {
      const line = d.product_line || 'A';
      const used = state.master.items.filter((x) => x.item_code.startsWith(line + '-')).map((x) => Number(x.item_code.split('-')[1]));
      const reqd = state.requests.filter((r) => r.sapCode && r.sapCode.startsWith(line + '-')).map((r) => Number(r.sapCode.split('-')[1]));
      return `${line}-${Math.max(1000, ...used, ...reqd) + 1}`;
    }
    return d.code;
  }

  function mdmApprove(state, reqId, personId, at, note) {
    const req = state.requests.find((r) => r.id === reqId);
    if (!req || req.status !== 'MDM check') throw new Error('Request is not waiting for the MDM check');
    req.sapCode = nextSapCode(state, req);
    req.status = 'Ready for SAP import';
    req.updatedAt = at;
    log(state, at, personId, 'MDM check passed', req.id, `${req.type === 'extend' ? 'Existing record ' + req.sapCode + ' extended to ' + req.bu : 'SAP code ' + req.sapCode + ' assigned'}; added to the SAP B1 import file${note ? ' (' + note + ')' : ''}`);
    notify(state, at, req.requester, req.id, 'decision', `${req.title} passed the MDM check (${req.sapCode})`);
    return req;
  }

  function mdmReturn(state, reqId, personId, comment, at) {
    const req = state.requests.find((r) => r.id === reqId);
    if (!req || req.status !== 'MDM check') throw new Error('Request is not waiting for the MDM check');
    req.status = 'Needs info';
    req.approvals.push({ id: `${req.id}-T${req.approvals.length + 1}`, role: 'MDM', bu: null, assignee: personId, stage: 99, reasons: ['MDM final check'], status: 'Info requested', assignedAt: at, dueAt: null, decidedAt: null, comment, reminders: 0, escalated: false });
    log(state, at, personId, 'Asked for information', req.id, `MDM check: "${comment}"`);
    notify(state, at, req.requester, req.id, 'info', `The MDM team needs more information on ${req.title}`);
    return req;
  }

  function markImported(state, reqIds, personId, at) {
    const done = [];
    for (const id of reqIds) {
      const req = state.requests.find((r) => r.id === id);
      if (!req || req.status !== 'Ready for SAP import') continue;
      req.status = 'Completed';
      req.importedAt = at;
      req.completedAt = at;
      req.updatedAt = at;
      addToMaster(state, req);
      log(state, at, personId, 'Imported to SAP B1', req.id, `${req.sapCode} loaded through the import file; requestor notified`);
      notify(state, at, req.requester, req.id, 'completed', `${req.title} is live in SAP B1 as ${req.sapCode}. You can transact now.`);
      done.push(req);
    }
    return done;
  }

  function addToMaster(state, req) {
    const d = req.data;
    if (req.type === 'extend') return;
    if (req.domain === 'customer') state.master.customers.push({ customer_id: req.sapCode, name: d.legal_name, entity: req.bu, country: d.country, city: d.city || '', segment: d.segment, size: '', reg_no: d.reg_no, address: d.address, phone: d.phone, email: d.contact_email, payment_terms: d.payment_terms, credit_limit: Number(d.credit_limit || 0), created: req.importedAt.slice(0, 10) });
    if (req.domain === 'vendor') state.master.vendors.push({ vendor_code: req.sapCode, name: d.legal_name, country: d.country, vendor_type: d.vendor_type, reg_no: d.reg_no, bank_name: d.bank_name, bank_account: d.bank_account, swift: d.swift, payment_terms: d.payment_terms, created: req.importedAt.slice(0, 10) });
    if (req.domain === 'item') state.master.items.push({ item_code: req.sapCode, description: d.description, product_line: d.product_line, category: d.category, uom: d.uom, manufacturer: d.manufacturer, mfr_part_no: d.mfr_part_no, licence_no: d.licence_no || '', storage: d.storage || '', list_price: d.list_price, entity: req.bu, created: req.importedAt.slice(0, 10) });
    if (req.domain === 'cost_centre') state.master.cost_centres.push({ code: d.code, name: d.name, entity: req.bu, country: d.country, owner: d.owner, valid_from: d.valid_from });
  }

  // SLA engine: reminder when an approval passes its due time, escalation one working day later.
  function tick(state, at) {
    const cfg = state.config;
    const events = [];
    for (const req of state.requests) {
      if (!['In approval', 'Needs info'].includes(req.status)) continue;
      for (const a of req.approvals) {
        if (a.status !== 'Pending' || !a.dueAt) continue;
        if (a.reminders === 0 && at >= a.dueAt) {
          a.reminders = 1;
          const p = personById(cfg, a.assignee);
          notify(state, a.dueAt, a.assignee, req.id, 'reminder', `Reminder: ${req.title} is past its ${cfg.settings.slaDays}-working-day target`);
          log(state, a.dueAt, 'system', 'Reminder sent', req.id, `${p ? p.name : a.assignee} (${roleLabel(cfg, a.role, a.bu)}) reminded in Teams and Outlook`);
          events.push({ type: 'reminder', req: req.id, to: a.assignee });
        }
        const escalateAt = addWorkingDays(a.dueAt, cfg.settings.escalateAfterDays);
        if (a.reminders >= 1 && !a.escalated && at >= escalateAt) {
          a.escalated = true;
          const bu = buByCode(cfg, req.bu);
          const to = a.role === 'BU_HEAD' ? cfg.roles.MDM.person : bu ? bu.head : cfg.roles.MDM.person;
          const p = personById(cfg, a.assignee);
          notify(state, escalateAt, to, req.id, 'escalation', `Escalation: ${req.title} has waited ${cfg.settings.slaDays + cfg.settings.escalateAfterDays} working days for ${p ? p.name : a.assignee}`);
          notify(state, escalateAt, cfg.roles.MDM.person, req.id, 'escalation', `Escalated: ${req.title} (waiting on ${p ? p.name : a.assignee})`);
          log(state, escalateAt, 'system', 'Escalated', req.id, `Waiting on ${p ? p.name : a.assignee}; ${personById(cfg, to) ? personById(cfg, to).name : to} and the MDM team notified`);
          events.push({ type: 'escalation', req: req.id, to });
        }
      }
    }
    return events;
  }

  function advanceClock(state, workingDays) {
    const events = [];
    for (let i = 0; i < workingDays; i++) {
      state.now = nextWorkingMorning(state.now);
      events.push(...tick(state, state.now));
    }
    log(state, state.now, 'system', 'Clock moved', null, `Simulated date moved to ${state.now.replace('T', ' ')}`);
    return events;
  }

  function canSeeSensitive(config, personId) {
    const p = personById(config, personId);
    return !!p && (p.role === 'FINANCE' || p.role === 'MDM');
  }

  function maskValue(value) {
    const s = String(value || '');
    if (!s) return '';
    const compact = s.replace(/\s/g, '');
    // Account-style numbers keep their last four digits so the approver can match a bank letter;
    // amounts (credit limits) and names are hidden completely.
    if (/^[\d-]{6,}$/.test(compact)) return '•••• ' + compact.replace(/\D/g, '').slice(-4);
    return '••••';
  }

  function revealField(state, reqId, fieldKey, personId, at) {
    const fd = state.config.fields.find((x) => x.key === fieldKey);
    log(state, at, personId, 'Viewed sensitive field', reqId, `${personById(state.config, personId).name} viewed ${fd ? fd.label : fieldKey}`);
  }

  // ------------------------------------------------------------------ settings changes (logged like any other change)
  function changeSettings(state, personId, at, kind, payload) {
    const cfg = state.config;
    if (kind === 'addField') {
      const order = Math.max(0, ...cfg.fields.filter((f) => f.domain === payload.domain).map((f) => f.order)) + 1;
      const key = (payload.key || payload.label).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'field';
      const field = { id: `F${cfg.fields.length + 1}`, domain: payload.domain, key, label: payload.label, type: payload.type || 'text', options: payload.options, required: !!payload.required, sensitive: !!payload.sensitive, active: true, order, help: payload.help || '' };
      cfg.fields.push(field);
      log(state, at, personId, 'Settings changed', null, `Added field "${field.label}" to ${domainLabel(cfg, field.domain)} requests${field.required ? ' (required)' : ''}`);
      return field;
    }
    if (kind === 'toggleField') {
      const f = cfg.fields.find((x) => x.id === payload.id);
      f[payload.prop] = !f[payload.prop];
      log(state, at, personId, 'Settings changed', null, `${domainLabel(cfg, f.domain)} field "${f.label}": ${payload.prop} ${f[payload.prop] ? 'on' : 'off'}`);
      return f;
    }
    if (kind === 'addRule') {
      const rule = { id: `R${cfg.rules.length + 1}`, domain: payload.domain, name: payload.name, approver: payload.approver, when: payload.when || null, stage: payload.stage || 1, active: true };
      cfg.rules.push(rule);
      log(state, at, personId, 'Settings changed', null, `Added approval step: ${roleLabel(cfg, rule.approver, '')} for ${domainLabel(cfg, rule.domain)} requests when ${describeCond(rule.when, cfg, rule.domain).toLowerCase()}`);
      return rule;
    }
    if (kind === 'toggleRule') {
      const r = cfg.rules.find((x) => x.id === payload.id);
      r.active = !r.active;
      log(state, at, personId, 'Settings changed', null, `Approval rule "${r.name}" ${r.active ? 'switched on' : 'switched off'}`);
      return r;
    }
    if (kind === 'addBusinessUnit') {
      const code = payload.code.toUpperCase().trim();
      if (buByCode(cfg, code)) throw new Error(`${code} already exists`);
      const headId = payload.headName.toLowerCase().replace(/[^a-z0-9]+/g, '') + '_' + code.toLowerCase();
      cfg.people.push({ id: headId, name: payload.headName.trim(), title: `BU Head, ${code}`, role: 'BU_HEAD', bu: code, kind: 'approver' });
      cfg.businessUnits.push({ code, name: `${code} · ${payload.name.trim()}`, head: headId, active: true });
      const moved = [];
      for (const p of cfg.people) if (payload.members && payload.members.includes(p.id)) { p.bu = code; moved.push(p.name); }
      log(state, at, personId, 'Settings changed', null, `Added business unit ${code} (${payload.name.trim()}); ${payload.headName.trim()} approves as its head${moved.length ? ` and ${moved.join(', ')} now ${moved.length > 1 ? 'request' : 'requests'} under it` : ''}. No IT change needed.`);
      return code;
    }
    if (kind === 'setting') {
      const old = cfg.settings[payload.key];
      cfg.settings[payload.key] = payload.value;
      log(state, at, personId, 'Settings changed', null, `${payload.label || payload.key}: ${old} -> ${payload.value}`);
      return payload.value;
    }
    throw new Error('Unknown settings change');
  }

  // ------------------------------------------------------------------ SAP B1 import file
  function csvCell(v) {
    const s = v === undefined || v === null ? '' : String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  // Business partner currency follows the country; '##' is SAP B1's code for "all currencies".
  const CURRENCY = { SG: 'SGD', MY: 'MYR', ID: 'IDR', TH: 'THB', VN: 'VND', DE: 'EUR', FR: 'EUR', IT: 'EUR', NL: 'EUR', IE: 'EUR', ES: 'EUR', US: 'USD', GB: 'GBP', CH: 'CHF', JP: 'JPY', KR: 'KRW', CN: 'CNY', AU: 'AUD' };
  function currencyFor(country) { return CURRENCY[String(country || '').toUpperCase()] || '##'; }
  const IMPORT_LAYOUT = {
    customer: { object: 'oBusinessPartners', cols: ['RecordKey', 'CardCode', 'CardName', 'CardType', 'Currency', 'FederalTaxID', 'Phone1', 'EmailAddress', 'PayTermsGrpCode', 'CreditLimit', 'Address', 'City', 'Country', 'U_BusinessUnit', 'U_Segment', 'U_SourceRequest'] },
    vendor: { object: 'oBusinessPartners', cols: ['RecordKey', 'CardCode', 'CardName', 'CardType', 'Currency', 'FederalTaxID', 'EmailAddress', 'PayTermsGrpCode', 'Address', 'Country', 'BankName', 'AccountNo', 'SWIFT', 'U_VendorType', 'U_BusinessUnit', 'U_SourceRequest'] },
    item: { object: 'oItems', cols: ['RecordKey', 'ItemCode', 'ItemName', 'ItemsGroupCode', 'InventoryItem', 'SalesItem', 'PurchaseItem', 'Manufacturer', 'SalesUnit', 'U_MfrPartNo', 'U_LicenceNo', 'U_Storage', 'U_ShelfLifeMonths', 'U_ListPriceSGD', 'U_BusinessUnit', 'U_SourceRequest'] },
    cost_centre: { object: 'oProfitCenters', cols: ['RecordKey', 'CenterCode', 'CenterName', 'InWhichDimension', 'EffectiveFrom', 'Active', 'U_Owner', 'U_Country', 'U_BusinessUnit', 'U_SourceRequest'] },
  };

  function importRow(req, i) {
    const d = req.data;
    const base = { RecordKey: i + 1, U_BusinessUnit: req.bu, U_SourceRequest: req.id };
    if (req.domain === 'customer') return { ...base, CardCode: req.sapCode, CardName: d.legal_name, CardType: 'cCustomer', Currency: currencyFor(d.country), FederalTaxID: d.reg_no, Phone1: d.phone, EmailAddress: d.contact_email, PayTermsGrpCode: d.payment_terms, CreditLimit: d.credit_limit || 0, Address: d.address, City: d.city, Country: d.country, U_Segment: d.segment };
    if (req.domain === 'vendor') return { ...base, CardCode: req.sapCode, CardName: d.legal_name, CardType: 'cSupplier', Currency: currencyFor(d.country), FederalTaxID: d.reg_no, EmailAddress: d.contact_email, PayTermsGrpCode: d.payment_terms, Address: d.address, Country: d.country, BankName: d.bank_name, AccountNo: d.bank_account, SWIFT: d.swift, U_VendorType: d.vendor_type };
    if (req.domain === 'item') return { ...base, ItemCode: req.sapCode, ItemName: d.description, ItemsGroupCode: `Product ${d.product_line}`, InventoryItem: d.category === 'Service' ? 'tNO' : 'tYES', SalesItem: 'tYES', PurchaseItem: 'tYES', Manufacturer: d.manufacturer, SalesUnit: d.uom, U_MfrPartNo: d.mfr_part_no, U_LicenceNo: d.licence_no || '', U_Storage: d.storage || '', U_ShelfLifeMonths: d.shelf_life_months || '', U_ListPriceSGD: d.list_price };
    return { ...base, CenterCode: d.code, CenterName: d.name, InWhichDimension: 1, EffectiveFrom: d.valid_from, Active: 'tYES', U_Owner: d.owner, U_Country: d.country };
  }

  function buildImportCsv(requests, domain) {
    const layout = IMPORT_LAYOUT[domain];
    const rows = requests.filter((r) => r.domain === domain);
    const lines = [layout.cols.join(',')];
    rows.forEach((r, i) => { const row = importRow(r, i); lines.push(layout.cols.map((c) => csvCell(row[c])).join(',')); });
    return { object: layout.object, csv: lines.join('\n'), count: rows.length };
  }

  // ------------------------------------------------------------------ turnaround simulation (mirrors analysis/process_sim.py)
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function makeLognormal(rand) {
    let spare = null;
    const normal = () => {
      if (spare !== null) { const s = spare; spare = null; return s; }
      let u = 0, v = 0;
      while (u === 0) u = rand();
      while (v === 0) v = rand();
      const r = Math.sqrt(-2 * Math.log(u));
      spare = r * Math.sin(2 * Math.PI * v);
      return r * Math.cos(2 * Math.PI * v);
    };
    return (mean, sd) => {
      const s2 = Math.log(1 + (sd * sd) / (mean * mean));
      return Math.exp(Math.log(mean) - s2 / 2 + Math.sqrt(s2) * normal());
    };
  }

  function simulateTurnaround(opts) {
    const { counts, probs, cur, prop } = opts;
    const n = opts.n || 8000;
    const rand = mulberry32(opts.seed || 7);
    const ln = makeLognormal(rand);
    const cum = [];
    probs.reduce((acc, p, i) => (cum[i] = acc + p), 0);
    const pickK = () => { const u = rand() * cum[cum.length - 1]; for (let i = 0; i < cum.length; i++) if (u <= cum[i]) return counts[i]; return counts[counts.length - 1]; };
    const current = new Float64Array(n), proposed = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const k = pickK();
      let t = ln(cur.triage_mean, cur.triage_sd);
      if (rand() < cur.bounce_p) t += ln(cur.bounce_mean, cur.bounce_sd) + 0.5;
      for (let j = 0; j < k; j++) {
        t += ln(cur.approver_mean, cur.approver_sd);
        if (rand() < cur.clar_p) t += ln(cur.clar_mean, cur.clar_sd);
      }
      t += ln(cur.keying_mean, cur.keying_sd);
      current[i] = t;
      let u = prop.routing_mean;
      if (rand() < prop.bounce_p) u += ln(prop.bounce_mean, prop.bounce_sd);
      let longest = 0;
      for (let j = 0; j < k; j++) {
        let r = ln(prop.approver_mean, prop.approver_sd);
        if (r > prop.sla_days) r = prop.sla_days + ln(prop.after_reminder_mean, prop.after_reminder_sd);
        if (r > prop.escalate_days) r = prop.escalate_days + ln(prop.after_escalation_mean, prop.after_escalation_sd);
        if (rand() < prop.clar_p) r += ln(prop.clar_mean, prop.clar_sd);
        if (r > longest) longest = r;
      }
      u += longest + ln(prop.check_mean, prop.check_sd);
      proposed[i] = u;
    }
    return { current: summarise(current), proposed: summarise(proposed), currentRaw: current, proposedRaw: proposed };
  }

  function summarise(arr) {
    const a = Array.from(arr).sort((x, y) => x - y);
    const q = (p) => a[Math.min(a.length - 1, Math.floor(p * (a.length - 1)))];
    const mean = a.reduce((s, x) => s + x, 0) / a.length;
    return { mean: round1(mean), median: round1(q(0.5)), p90: round1(q(0.9)), share_within_5: Math.round((a.filter((x) => x <= 5).length / a.length) * 1000) / 1000 };
  }

  function histogram(arr, edges) {
    const counts = new Array(edges.length - 1).fill(0);
    for (const x of arr) {
      const v = Math.min(Math.max(x, edges[0]), edges[edges.length - 1] - 1e-9);
      for (let i = 0; i < edges.length - 1; i++) if (v >= edges[i] && v < edges[i + 1]) { counts[i]++; break; }
    }
    return counts.map((c) => Math.round((c / arr.length) * 10000) / 10000);
  }

  // ------------------------------------------------------------------ inbox classifier (reproduces scikit-learn TF-IDF + logistic regression)
  let MODEL = null;
  function loadModel(model) {
    MODEL = { ...model, index: new Map(model.terms.map((t, i) => [t, i])), stop: new Set(model.stop_words || []) };
  }
  function tokenize(text) {
    return String(text || '').toLowerCase().match(/[\p{L}\p{N}_]{2,}/gu) || [];
  }
  function classify(text) {
    if (!MODEL) throw new Error('Model not loaded');
    const toks = tokenize(text).filter((t) => !MODEL.stop.has(t)); // same order as scikit-learn: drop stop words, then form bigrams
    const grams = [...toks];
    for (let i = 0; i + 1 < toks.length; i++) grams.push(toks[i] + ' ' + toks[i + 1]);
    const tf = new Map();
    for (const g of grams) { const j = MODEL.index.get(g); if (j !== undefined) tf.set(j, (tf.get(j) || 0) + 1); }
    let norm = 0;
    const x = new Map();
    for (const [j, c] of tf) { const v = (1 + Math.log(c)) * MODEL.idf[j]; x.set(j, v); norm += v * v; }
    norm = Math.sqrt(norm) || 1;
    const logits = MODEL.coef.map((row, k) => { let s = MODEL.intercept[k]; for (const [j, v] of x) s += row[j] * (v / norm); return s; });
    const mx = Math.max(...logits);
    const ex = logits.map((l) => Math.exp(l - mx));
    const sum = ex.reduce((a, b) => a + b, 0);
    const proba = ex.map((e) => e / sum);
    let best = 0;
    proba.forEach((p, i) => { if (p > proba[best]) best = i; });
    const contributions = [];
    for (const [j, v] of x) contributions.push({ term: MODEL.terms[j], weight: MODEL.coef[best][j] * (v / norm) });
    contributions.sort((a, b) => b.weight - a.weight);
    return { label: MODEL.classes[best], confidence: proba[best], proba: Object.fromEntries(MODEL.classes.map((c, i) => [c, proba[i]])), keyTerms: contributions.filter((c) => c.weight > 0).slice(0, 5).map((c) => c.term) };
  }

  function extractFields(text, master) {
    const out = {};
    const po = String(text).match(/\bPO\s*(?:no\.?|number|#|:)?\s*([A-Z]{0,3}\d{5,})/i) || String(text).match(/\b(4[57]\d{6})\b/);
    if (po) out.po = po[1];
    const qty = String(text).match(/\b(\d{1,5})\s*(kits?|boxes|box|cases?|units?|visits?|months?)\b/i);
    if (qty) out.quantity = `${qty[1]} ${qty[2]}`;
    if (master) {
      let bestItem = null;
      for (const it of master.items) {
        const words = itemTokens(it.description).filter((t) => !S.itemGeneric.has(t) && !/^\d+$/.test(t) && t.length > 2);
        const textToks = new Set(itemTokens(text));
        const hit = words.filter((w) => textToks.has(w)).length;
        if (words.length && hit / words.length >= 0.6 && (!bestItem || hit > bestItem.hit)) bestItem = { it, hit };
      }
      if (bestItem) out.item = { code: bestItem.it.item_code, name: bestItem.it.description, line: bestItem.it.product_line };
      let bestCust = null;
      const toks = new Set(nameTokens(text));
      for (const c of master.customers) {
        const d = distinctive(nameTokens(c.name));
        if (!d.length) continue;
        const hit = d.filter((w) => toks.has(w)).length;
        if (hit === d.length && (!bestCust || d.length > bestCust.n)) bestCust = { c, n: d.length };
      }
      if (bestCust) out.customer = { id: bestCust.c.customer_id, name: bestCust.c.name };
    }
    return out;
  }

  // ------------------------------------------------------------------ demo state
  function seedState(HUB) {
    init(HUB.textnorm);
    const config = defaultConfig();
    const master = {
      customers: HUB.master.customers.map((x) => ({ ...x })),
      items: HUB.master.items.map((x) => ({ ...x })),
      vendors: HUB.master.vendors.map((x) => ({ ...x })),
      cost_centres: HUB.master.cost_centres.map((x) => ({ ...x })),
    };
    const state = { version: 4, now: '2026-09-21T09:00', seq: { req: 1000, audit: 0, note: 0 }, config, master, requests: [], audit: [], notifications: [], stats: { duplicatesStopped: 0 } };
    const prospect = (name) => HUB.master.prospects.find((p) => p.name === name) || {};
    const at = (iso) => { state.now = iso; tick(state, iso); return iso; };

    // REQ-1001: completed last week (shows the full trail)
    let r = createRequest(state, { domain: 'item', bu: 'QTG', requester: 'amy', data: { description: 'Hematology Analyzer Service Contract, annual', product_line: 'C', category: 'Service', manufacturer: 'Arden Instruments', mfr_part_no: 'ARD-77120', uom: 'unit', list_price: '9800' } }, at('2026-09-21T10:05'));
    decide(state, r.id, 'arjun', 'approve', '', at('2026-09-21T15:40'));
    decide(state, r.id, 'grace', 'approve', 'Price list updated', at('2026-09-22T09:20'));
    mdmApprove(state, r.id, 'priya', at('2026-09-22T14:10'));
    markImported(state, [r.id], 'priya', at('2026-09-23T10:00'));

    // REQ-1002: cost centre, approved, waiting in the import file
    r = createRequest(state, { domain: 'cost_centre', bu: 'QTS', requester: 'joel', data: { code: 'CC-QTS-SG-MKT', name: 'QTS Marketing - Singapore', country: 'SG', owner: 'Mei Ling', valid_from: '2026-10-01', purpose: 'Marketing spend for lab supplies in Singapore' } }, at('2026-09-22T11:30'));
    decide(state, r.id, 'weijie', 'approve', '', at('2026-09-23T16:05'));
    decide(state, r.id, 'meiling', 'approve', '', at('2026-09-24T09:45'));
    mdmApprove(state, r.id, 'priya', at('2026-09-29T10:30'));

    // duplicate stopped at intake (logged, no request created)
    at('2026-09-25T10:12');
    const nuh = master.customers.find((c) => c.name === 'National University Hospital');
    log(state, '2026-09-25T10:12', 'nurul', 'Duplicate stopped at intake', null, `Nurul started a new customer "Natl University Hosp"; the form matched National University Hospital (${nuh ? nuh.customer_id : 'existing record'}) and she used the existing record`);
    state.stats.duplicatesStopped += 1;

    // REQ-1003: customer, all approvals in, at the MDM check
    const dn = prospect('Da Nang Coastal Hospital');
    r = createRequest(state, { domain: 'customer', bu: 'QTG', requester: 'nurul', data: { legal_name: dn.name || 'Da Nang Coastal Hospital', country: 'VN', city: 'Da Nang', reg_no: dn.reg_no, segment: 'Private hospital', address: dn.address, contact_email: 'purchasing@danangcoastal.com.vn', phone: dn.phone, products: ['A', 'B', 'C'], payment_terms: 'Net 30', credit_limit: '150000' } }, at('2026-09-24T10:00'));
    decide(state, r.id, 'arjun', 'approve', '', at('2026-09-25T09:15'));
    decide(state, r.id, 'weijie', 'approve', 'Credit check done', at('2026-09-28T15:00'));

    // REQ-1004: vendor, Finance asked for the bank letter
    r = createRequest(state, { domain: 'vendor', bu: 'QTS', requester: 'joel', data: { legal_name: 'Kestrel Biosciences GmbH', country: 'DE', reg_no: 'HRB 214877', vendor_type: 'Product principal / manufacturer', quality_agreement: true, address: 'Lindenstrasse 18, 69117 Heidelberg, Germany', contact_email: 'accounts@kestrel-bio.de', bank_name: 'Rhein Handelsbank', bank_account: '440219887105', swift: 'RHBKDEFF', payment_terms: 'Net 45' } }, at('2026-09-28T11:00'));
    decide(state, r.id, 'hafiz', 'approve', 'Evaluation form on file', at('2026-09-29T10:00'));
    decide(state, r.id, 'weijie', 'info', 'Please attach the bank confirmation letter on the bank\'s letterhead.', at('2026-09-29T16:20'));

    // REQ-1005: customer, Finance overdue (reminder already sent)
    const kk = prospect('Kota Kinabalu Specialist Centre Sdn Bhd');
    r = createRequest(state, { domain: 'customer', bu: 'SPD', requester: 'nurul', data: { legal_name: kk.name || 'Kota Kinabalu Specialist Centre Sdn Bhd', country: 'MY', city: 'Kota Kinabalu', reg_no: kk.reg_no, segment: 'Private hospital', address: kk.address, contact_email: 'purchasing@kkspecialist.com.my', phone: kk.phone, products: ['A', 'B', 'C'], payment_terms: 'Net 30', credit_limit: '120000' } }, at('2026-09-28T09:30'));
    decide(state, r.id, 'daniel', 'approve', '', at('2026-09-29T10:15'));

    // REQ-1006: Amy's regulated item, QA/RA and Business Support pending
    r = createRequest(state, { domain: 'item', bu: 'SPD', requester: 'amy', data: { description: 'Procalcitonin Rapid Test, 25 tests', product_line: 'A', category: 'IVD reagent', licence_no: 'DE4471820', storage: '2-8 °C', shelf_life_months: '18', manufacturer: 'Meridian Dx', mfr_part_no: 'MER-58213', uom: 'kit', list_price: '165' } }, at('2026-09-29T14:00'));
    decide(state, r.id, 'daniel', 'approve', '', at('2026-09-30T11:00'));

    // REQ-1007: new customer submitted yesterday
    const sm = prospect('PT Rumah Sakit Semarang Diagnostika');
    createRequest(state, { domain: 'customer', bu: 'SPD', requester: 'nurul', data: { legal_name: sm.name || 'PT Rumah Sakit Semarang Diagnostika', country: 'ID', city: 'Semarang', reg_no: sm.reg_no, segment: 'Private hospital', address: sm.address, contact_email: 'pengadaan@semarangdiagnostika.co.id', phone: sm.phone, products: ['A', 'B'], payment_terms: 'Net 30', credit_limit: '90000' } }, at('2026-09-30T15:30'));

    at('2026-10-01T09:00');
    for (const n of state.notifications) n.read = n.at < '2026-09-30T00:00';
    return state;
  }

  // ------------------------------------------------------------------ market scenarios
  // Price-driven demand model layered on the combined forecast. All inputs are percentages.
  //   fx[c]      local currency weakens against SGD by this much (negative = strengthens)
  //   tariff[p]  import duty on product line p rises by this many points, in tariffCountries
  //   demand[c]  demand in country c shifts by this much for reasons other than price
  // Customers pay more when Lives Group passes a share of the move into prices (fxPass, tariffPass);
  // the share it absorbs comes off Lives Group's SGD price instead. Orders respond through the product's
  // price elasticity times the buyer segment's sensitivity.
  function marketScenario(M, inputs) {
    const A = M.assumptions;
    const fxPass = inputs.fxPass !== undefined ? inputs.fxPass : A.fx_pass;
    const tariffPass = inputs.tariffPass !== undefined ? inputs.tariffPass : A.tariff_pass;
    const el = { ...A.elasticity, ...(inputs.elasticity || {}) };
    const sens = { ...A.sensitivity, ...(inputs.sensitivity || {}) };
    const fx = inputs.fx || {}, demand = inputs.demand || {}, tariff = inputs.tariff || {};
    const tc = new Set(inputs.tariffCountries || []);
    const shock = (c, p) => {
      const d = (fx[c] || 0) / 100;
      const t = tc.has(c) ? (tariff[p] || 0) / 100 : 0;
      return {
        customerPrice: fxPass * d + tariffPass * t,                 // change in what the customer pays, local terms
        netPrice: -(1 - fxPass) * d - (1 - tariffPass) * t,         // change in Lives Group's SGD price per unit
        demand: (demand[c] || 0) / 100,
      };
    };
    const unitChange = (c, p, segment) => {
      const s = shock(c, p);
      return el[p] * s.customerPrice * (sens[segment] !== undefined ? sens[segment] : 1) + s.demand;
    };
    const cells = M.cells.map((m) => {
      const s = shock(m.country, m.product);
      const shares = Object.entries(m.segment_share || {});
      const mix = shares.length ? shares.reduce((a, [seg, w]) => a + w * (sens[seg] !== undefined ? sens[seg] : 1), 0) : 1;
      const du = Math.max(-1, el[m.product] * s.customerPrice * mix + s.demand);
      const units = m.q4_units * (1 + du);
      const baseRev = m.q4_units * m.price;
      const rev = units * m.price * (1 + s.netPrice);
      return { country: m.country, product: m.product, baseUnits: m.q4_units, units, unitChange: du, customerPrice: s.customerPrice,
        netPrice: s.netPrice, baseRev, rev, revChange: rev - baseRev };
    });
    const sum = (arr, k) => arr.reduce((a, x) => a + x[k], 0);
    const byCountry = {}, byProduct = {};
    for (const x of cells) {
      byCountry[x.country] = byCountry[x.country] || { baseRev: 0, rev: 0 };
      byCountry[x.country].baseRev += x.baseRev; byCountry[x.country].rev += x.rev;
      byProduct[x.product] = byProduct[x.product] || { baseUnits: 0, units: 0, baseRev: 0, rev: 0 };
      for (const k of ['baseUnits', 'units', 'baseRev', 'rev']) byProduct[x.product][k] += x[k];
    }
    const customers = M.customers.map((cu) => {
      let base = 0, scen = 0;
      for (const [p, v] of Object.entries(cu.q4_value)) {
        if (!v) continue;
        const s = shock(cu.country, p);
        const du = Math.max(-1, unitChange(cu.country, p, cu.segment));
        base += v;
        scen += v * (1 + du) * (1 + s.netPrice);
      }
      return { id: cu.id, name: cu.name, country: cu.country, segment: cu.segment, base, scen, change: scen - base };
    });
    return { cells, byCountry, byProduct, customers, totals: { baseRev: sum(cells, 'baseRev'), rev: sum(cells, 'rev') } };
  }

  const Engine = {
    init, fold, ratio, lcsLen, nameTokens, nameScore, scoreParty, itemTokens, scoreItem, scoreCostCentre, band, findMatches, queryFromForm,
    toDate, toIso, addWorkingDays, nextWorkingMorning, workingDaysBetween, daysBetween,
    defaultConfig, evalCond, describeCond, visibleFields, validate, route, personById, buByCode, roleLabel, assigneeFor, domainLabel,
    createRequest, decide, provideInfo, mdmApprove, mdmReturn, markImported, tick, advanceClock, canSeeSensitive, maskValue, revealField,
    changeSettings, buildImportCsv, IMPORT_LAYOUT, simulateTurnaround, histogram, loadModel, classify, tokenize, extractFields, seedState, log,
    marketScenario,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = Engine;
  else root.Engine = Engine;
})(typeof window !== 'undefined' ? window : globalThis);
