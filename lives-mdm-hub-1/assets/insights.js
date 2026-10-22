/* MDM Request Hub - insight pages: regional business view, inbox sorting, business case.
   Numbers come from analysis/build_data.py (window.HUB_DATA); the simulation and the impact
   calculator recompute in the browser when sliders or assumptions change. */
(function () {
  'use strict';
  const App = window.App;
  const { H, E, C, esc, num, num1, money, pct, tile, productName, countryName } = App;
  const ui = () => App.getUI();
  const COLORS = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)', 'var(--s5)'];
  const TYPE_LABEL = { purchase_order: 'Purchase orders', enquiry: 'Enquiries', setup_request: 'Setup requests', follow_up: 'Follow-ups' };
  const TYPE_ONE = { purchase_order: 'Purchase order', enquiry: 'Enquiry', setup_request: 'Setup request', follow_up: 'Follow-up' };
  const countries = H.meta.countries;
  const products = H.meta.products;
  const seg = (items, cur, action, attr) => `<div class="seg" role="group">${items.map(([k, l]) => `<button aria-pressed="${cur === k}" data-action="${action}" data-${attr}="${k}">${esc(l)}</button>`).join('')}</div>`;
  const growthChip = (g) => {
    if (g === null || g === undefined) return '<span class="muted">–</span>';
    const cls = g > 0.02 ? 'delta up' : g < -0.02 ? 'delta down' : 'delta';
    return `<span class="${cls}">${g > 0 ? '▲' : g < 0 ? '▼' : ''} ${pct(g, true)}</span>`;
  };
  const heat = (g) => {
    if (g === null || g === undefined) return '';
    const w = Math.round(Math.min(1, Math.abs(g) / 0.4) * 26);
    return `background:color-mix(in srgb, ${g >= 0 ? 'var(--div-pos)' : 'var(--div-neg)'} ${w}%, var(--surface))`;
  };
  const unit = (p) => (products.find((x) => x.code === p) || {}).unit || 'units';

  // ================================================================ regional view
  App.views.regional = function () {
    const u = ui();
    const v = u.regionalView;
    const R = H.regional[v];
    const F = H.forecast[v];
    const imp = H.dedup.impact;
    const fg = H.forecast_gain;
    const pipe = H.requests.pipeline;
    const pipeMonthly = pipe.reduce((s, r) => s + r.expected_monthly, 0);
    return `
      <div class="page-head"><div><span class="label">Regional business view</span><h1>Customer purchase orders across five countries</h1>
        <p>Products A, B and C from October 2025 to September 2026. Only customer purchase orders count as volume; enquiries and account setup requests are tracked separately further down. All figures are synthetic.</p></div>
        <div class="stack tight"><span class="label">Customer records</span>${seg([['dedup', 'Duplicates merged'], ['raw', 'As in SAP B1 today']], v, 'regional-view', 'view')}</div></div>
      ${v === 'raw' ? `<div class="notice warn"><span class="icon">!</span><div>You are looking at customer records as they sit in SAP B1 today: ${imp.records} records for ${imp.customers} customers. Some customers are split across two records and one Malaysian hospital is filed under Singapore. <a href="#merge-effect" data-action="scroll" data-target="merge-effect">See what merging changes</a>.</div></div>` : ''}
      <div class="grid four">
        ${tile('Order value, Jul to Sep 2026', money(R.region.q3_value), `${pct(R.region.growth, true)} on Apr to Jun`)}
        ${tile(v === 'raw' ? 'Customer records ordering, Jul to Sep' : 'Customers ordering, Jul to Sep', num(R.region.active_q3), v === 'raw' ? 'Includes customers counted twice' : `${num(imp.records)} SAP records merged to ${num(imp.customers)} customers`)}
        ${tile('Forecast error', `${(fg.ours_wape * 100).toFixed(1)}%`, `Today's 6-month average: ${(fg.baseline_wape * 100).toFixed(1)}%, so ${Math.round(fg.relative_reduction * 100)}% lower`)}
        ${tile('Accounts waiting on setup', num(pipe.length), `About ${money(pipeMonthly)} a month of expected orders`)}
      </div>
      ${countryProductTable(R, v)}
      ${forecastPanel(F, u)}
      ${accuracyPanel(F)}
      ${decompositionPanel(v, u)}
      ${requestsPanel()}
      ${signalsPanel(v, u)}
      ${implicationsPanel()}
      ${mergePanel()}`;
  };

  function countryProductTable(R, v) {
    const byKey = Object.fromEntries(R.table.map((r) => [r.country + r.product, r]));
    const cell = (r) => `<div class="cell-heat" style="${heat(r.growth)}" data-tip="${esc(`<b>${countryName(r.country)} · Product ${r.product}</b><div>Apr–Jun: ${num(r.q2)} ${unit(r.product)}</div><div>Jul–Sep: ${num(r.q3)} ${unit(r.product)}</div><div>Growth: ${pct(r.growth, true)}</div><div>Buyers in Jul–Sep: ${r.buyers_q3}</div>`)}">
      <div class="row between" style="gap:6px"><strong class="tnum">${num(r.q3)}</strong>${growthChip(r.growth)}</div>${C.spark(r.trend, 'var(--ink-2)', 108, 24)}</div>`;
    return `<section class="panel"><div class="panel-head"><div><h2>Volume and growth by country and product</h2><p>Units ordered July to September 2026, the change on April to June, and the 12-month trend.</p></div></div>
      <div class="table-wrap"><table><thead><tr><th>Country</th>${products.map((p) => `<th style="white-space:normal">Product ${p.code}<div style="text-transform:none;letter-spacing:0;font-weight:500">${esc(p.name)}, ${esc(p.unit)}</div></th>`).join('')}<th class="num" style="white-space:normal">Order value<div style="text-transform:none;letter-spacing:0;font-weight:500">Jul to Sep</div></th></tr></thead><tbody>
        ${countries.map((c) => `<tr><td><strong>${esc(c.name)}</strong><div class="tiny muted">${R.countries[c.code].active_q3} ordering</div></td>${products.map((p) => `<td>${cell(byKey[c.code + p.code])}</td>`).join('')}<td class="num"><strong>${esc(money(R.countries[c.code].q3_value))}</strong><div>${growthChip(R.countries[c.code].growth)}</div></td></tr>`).join('')}
        <tr><td><strong>All five countries</strong></td>${products.map((p) => { const t = R.products[p.code]; return `<td><div class="row between"><strong class="tnum">${num(t.q3)}</strong>${growthChip(t.growth)}</div></td>`; }).join('')}<td class="num"><strong>${esc(money(R.region.q3_value))}</strong><div>${growthChip(R.region.growth)}</div></td></tr>
      </tbody></table></div>
      <p class="footnote" style="margin-top:10px"><b>Growth measure.</b> Units ordered in July to September 2026 divided by units ordered in April to June 2026, minus one (quarter on quarter). Year-on-year growth would need more than 12 months of history. Shading: blue for growth, red for decline, stronger for bigger changes.</p></section>`;
  }

  function forecastPanel(F, u) {
    const p = u.product;
    const months = H.meta.months;
    const fwd = F.months_forward;
    let chart, legend;
    if (u.chartMode === 'region') {
      const r = F.region[p];
      chart = C.line({ width: App.chartWidth(), title: `Product ${p} units, region total`, labels: months, forecastLabels: fwd, series: [{ name: 'Region', color: 'var(--s1)', values: r.actual, forecast: r.forecast, lo: r.lo, hi: r.hi, compare: r.ma6 }], format: C.compact });
      legend = `<span><i style="background:var(--s1)"></i>Actual</span><span><i class="dash" style="background:var(--s1)"></i>Forecast, combined method</span><span><i class="box" style="background:var(--s1);opacity:.25"></i>Likely range (80%)</span><span><i class="dash"></i>Today's 6-month average</span>`;
    } else {
      chart = C.line({ width: App.chartWidth(), title: `Product ${p} units by country`, labels: months, forecastLabels: fwd, series: countries.map((c, i) => ({ name: c.name, color: COLORS[i], values: F.series[c.code][p].actual, forecast: F.series[c.code][p].forecast })), format: C.compact });
      legend = countries.map((c, i) => `<span><i style="background:${COLORS[i]}"></i>${esc(c.name)}</span>`).join('') + '<span><i class="dash"></i>Dashed: forecast</span>';
    }
    const r = F.region[p];
    const q3 = r.actual.slice(9).reduce((a, b) => a + b, 0);
    const next = r.forecast.reduce((a, b) => a + b, 0);
    const ma = r.ma6.reduce((a, b) => a + b, 0);
    const rows = u.chartMode === 'region'
      ? `<tr><th>Month</th><th class="num">Actual</th><th class="num">Forecast</th><th class="num">Range</th><th class="num">6-month average</th></tr>${months.map((m, i) => `<tr><td>${C.monthLabel(m, true)}</td><td class="num">${num(r.actual[i])}</td><td></td><td></td><td></td></tr>`).join('')}${fwd.map((m, i) => `<tr><td>${C.monthLabel(m, true)}</td><td></td><td class="num">${num(r.forecast[i])}</td><td class="num">${num(r.lo[i])}–${num(r.hi[i])}</td><td class="num">${num(r.ma6[i])}</td></tr>`).join('')}`
      : `<tr><th>Month</th>${countries.map((c) => `<th class="num">${esc(c.name)}</th>`).join('')}</tr>${[...months, ...fwd].map((m, i) => `<tr><td>${C.monthLabel(m, true)}${i >= 12 ? ' (forecast)' : ''}</td>${countries.map((c) => { const s = F.series[c.code][p]; return `<td class="num">${num(i < 12 ? s.actual[i] : s.forecast[i - 12])}</td>`; }).join('')}</tr>`).join('')}`;
    return `<section class="panel"><div class="panel-head"><div><h2>Trend and next-quarter forecast</h2><p>Product ${p}, ${esc(productName(p).toLowerCase())}. October to December 2026 is forecast with the combined method; the shaded band is the range the backtest says is likely.</p></div>
        <div class="row">${seg(products.map((x) => [x.code, `Product ${x.code}`]), p, 'product', 'product')}${seg([['region', 'Region total'], ['country', 'By country']], u.chartMode, 'chart-mode', 'mode')}</div></div>
      <div class="chart">${chart}</div><div class="legend" style="margin-top:8px">${legend}</div>
      <div class="inset small" style="margin-top:12px">Next quarter: about <b>${num(next)} ${esc(unit(p))}</b> across the region, ${pct(next / q3 - 1, true)} on July to September. Today's 6-month average would plan for ${num(ma)}, ${ma < next ? 'under-ordering' : 'over-ordering'} by about ${num(Math.abs(next - ma))} ${esc(unit(p))}.</div>
      <details class="data" style="margin-top:10px"><summary>Show the numbers</summary><div class="table-wrap"><table>${rows}</table></div></details></section>`;
  }

  function accuracyPanel(F) {
    const order = ['ma6', 'ma_all', 'naive', 'pooled', 'damped', 'combined'];
    const ms = order.map((k) => F.methods.find((m) => m.code === k));
    const fg = H.forecast_gain;
    const rows = ms.map((m) => ({ label: m.label, value: m.wape * 100, strong: m.code === 'combined' || m.code === 'ma6', color: m.code === 'combined' ? 'var(--s1)' : m.code === 'ma6' ? 'var(--s2)' : 'var(--axis)', tip: `<b>${esc(m.label)}</b><div>Error (WAPE): ${(m.wape * 100).toFixed(1)}%</div><div>Bias: ${pct(m.bias, true)}</div><div>Month-to-month swing: ${(m.swing * 100).toFixed(1)}%</div>` }));
    return `<section class="panel"><div class="panel-head"><div><h2>How much better is the forecast?</h2><p>We hid each month from March to June 2026, forecast the next three months from the months before it, as a planner would have, and compared with what customers actually ordered.</p></div></div>
      <div class="grid two" style="align-items:start">
        <div><div class="label" style="margin-bottom:10px">Average error, value-weighted (WAPE)</div>${C.barsHtml({ rows, max: Math.max(...rows.map((r) => r.value)) * 1.05, format: (x) => x.toFixed(1) + '%' })}<p class="footnote" style="margin-top:10px">Orange: today's method. Blue: the combined method we recommend.</p></div>
        <div class="stack">
          <div class="table-wrap"><table><thead><tr><th>Method</th><th class="num">Error</th><th class="num">Bias</th><th class="num">Swing</th></tr></thead><tbody>${ms.map((m) => `<tr ${m.code === 'combined' ? 'class="highlight"' : ''}><td class="small">${esc(m.label)}</td><td class="num">${(m.wape * 100).toFixed(1)}%</td><td class="num">${pct(m.bias, true)}</td><td class="num">${(m.swing * 100).toFixed(1)}%</td></tr>`).join('')}</tbody></table></div>
          <ul class="small ink2" style="margin:0;padding-left:18px;display:flex;flex-direction:column;gap:6px">
            <li><b>Today's 6-month average lags behind growth.</b> It under-forecast by ${Math.abs(Math.round(fg.baseline_bias * 100))}% because demand in Indonesia and Vietnam kept rising.</li>
            <li><b>The combined method</b> averages a damped-trend model per country with a pooled regional model split by recent share. Error falls from ${(fg.baseline_wape * 100).toFixed(1)}% to ${(fg.ours_wape * 100).toFixed(1)}%.</li>
            <li><b>Why not just repeat last month?</b> It scores about the same (${(fg.naive_wape * 100).toFixed(1)}%) but its forecast swings ${(fg.naive_swing * 100).toFixed(0)}% from month to month, against ${(fg.ours_swing * 100).toFixed(0)}% for the combined method. Stock plans built on it would lurch with every unusual month.</li>
            <li><b>No seasonal model.</b> One year of data shows each calendar month once, which cannot separate a seasonal pattern from noise. Revisit with 24 months.</li>
          </ul></div></div></section>`;
  }

  function decompositionPanel(v, u) {
    const key = u.decompKey || 'all';
    const d = H.decomposition[v][key];
    const isValue = key === 'all';
    const fmt = isValue ? (x) => 'S$' + C.compact(x) : C.compact;
    const steps = [
      { label: 'Apr to Jun total', value: d.q2, type: 'total' },
      { label: `New accounts (${d.new_count})`, value: d.new, tip: `<b>New accounts</b><div>${d.new_names.map((n) => esc(n.name)).join('<br>') || 'None'}</div>` },
      { label: `Existing accounts (${d.existing_count})`, value: d.existing, tip: '<b>Existing accounts</b><div>Change in what continuing customers ordered</div>' },
      { label: `Stopped ordering (${d.stopped_count})`, value: -d.stopped, tip: `<b>Stopped ordering</b><div>${d.stopped_names.map((n) => esc(n.name)).join('<br>') || 'None'}</div>` },
      { label: 'Jul to Sep total', value: d.q3, type: 'total' },
    ];
    const other = H.decomposition[v === 'raw' ? 'dedup' : 'raw'][key];
    return `<section class="panel"><div class="panel-head"><div><h2>Where the growth came from</h2><p>The change from April to June to July to September, split into new accounts, existing accounts and accounts that stopped ordering. It tells sales whether to win new accounts or grow the ones they have.</p></div>
        ${seg([['all', 'All products (SGD)'], ...products.map((x) => [x.code, `Product ${x.code} (${x.unit})`])], key, 'decomp', 'key')}</div>
      <div class="chart">${C.waterfall({ width: App.chartWidth(), title: 'Growth decomposition', steps, format: fmt })}</div>
      <div class="grid two small" style="margin-top:8px">
        <div><b>New accounts:</b> ${d.new_names.map((n) => esc(n.name)).join(', ') || 'none'}</div>
        <div><b>Stopped ordering:</b> ${d.stopped_names.map((n) => esc(n.name)).join(', ') || 'none'}</div></div>
      ${v === 'raw' ? `<div class="notice warn small" style="margin-top:10px"><span class="icon">!</span><div>With the records as they are in SAP B1, ${d.new_count} "new accounts" appear where the merged view finds ${other.new_count}. Duplicate records created this year look like new customers, and the records they replaced look like customers that stopped.</div></div>` : ''}</section>`;
  }

  function requestsPanel() {
    const R = H.requests;
    const types = R.types;
    const tc = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)'];
    const med = R.new_account_medians;
    const totalQ3 = types.reduce((s, t) => s + R.actual_q3[t], 0);
    return `<section class="panel"><div class="panel-head"><div><h2>Orders, enquiries and setup requests, kept apart</h2><p>Every message to the shared mailbox is sorted into one of four types (see <a href="#inbox" data-action="go" data-route="inbox">Inbox sorting</a>). Only purchase orders count as demand; setup requests go to the MDM team; enquiries and follow-ups go to sales.</p></div></div>
      <div class="grid two" style="align-items:start">
        <div><div class="label" style="margin-bottom:6px">Messages a month, by type</div><div class="chart">${C.stacked({ width: App.chartWidth('half'), title: 'Messages by type per month', labels: H.meta.months, series: types.map((t, i) => ({ name: TYPE_LABEL[t], color: tc[i], values: R.by_type_month[t] })) })}</div>
          <div class="legend" style="margin-top:6px">${types.map((t, i) => `<span><i class="box" style="background:${tc[i]}"></i>${TYPE_LABEL[t]}</span>`).join('')}</div></div>
        <div class="stack"><div class="table-wrap"><table><thead><tr><th>Jul to Sep</th>${types.map((t) => `<th class="num">${{ purchase_order: 'Orders', enquiry: 'Enquiries', setup_request: 'Setup', follow_up: 'Follow-ups' }[t]}</th>`).join('')}</tr></thead><tbody>
          ${R.by_country_q3.map((r) => `<tr><td>${esc(countryName(r.country))}</td>${types.map((t) => `<td class="num">${num(r[t])}</td>`).join('')}</tr>`).join('')}
          <tr><td><b>All</b></td>${types.map((t) => `<td class="num"><b>${num(R.actual_q3[t])}</b></td>`).join('')}</tr></tbody></table></div>
          <p class="small ink2">Only ${pct(R.actual_q3.purchase_order / totalQ3)} of the mailbox is orders. Counting the rest as demand would overstate volume; leaving setup requests in a sales inbox delays new accounts.</p></div></div>
      <hr class="divider" style="margin:16px 0">
      <div class="stack">
        <h3>From first enquiry to first order, new accounts this year</h3>
        ${C.segments({ parts: [
          { label: 'First enquiry to setup request', value: Math.max(1, med.enquiry_to_request), color: 'var(--surface-3)', ink: 'var(--ink)', short: `${Math.round(med.enquiry_to_request)} days`, tip: `<b>Customer deciding</b><div>Median ${med.enquiry_to_request} days from first enquiry to asking for an account</div>` },
          { label: 'Setup request to account in SAP B1', value: Math.max(1, med.setup_days), color: 'var(--div-neg)', short: `${Math.round(med.setup_days)} days`, tip: `<b>Account setup (email process)</b><div>Median ${med.setup_days} days</div>` },
          { label: 'Account to first order', value: Math.max(1, med.created_to_first_order), color: 'var(--s1)', short: `${Math.round(med.created_to_first_order)} days`, tip: `<b>Account to first order</b><div>Median ${med.created_to_first_order} days</div>` },
        ] })}
        <div class="legend"><span><i class="box" style="background:var(--surface-3)"></i>Customer deciding</span><span><i class="box" style="background:var(--div-neg)"></i>Waiting for account setup</span><span><i class="box" style="background:var(--s1)"></i>Account to first order</span></div>
        <p class="small ink2" style="max-width:80ch">Once a customer asks for an account, setup is the longest wait before their first order. This year about <b>${money(R.value_waited_on_setup)}</b> of first orders waited on account setups. With setups in about ${num1(H.business_case.sim.proposed.mean)} days, around ${money(H.business_case.impacts.revenue_pulled_forward_sgd)} a year of orders would arrive sooner.</p></div>
      <div class="stack" style="margin-top:20px"><h3>Accounts waiting on setup now (${R.pipeline.length})</h3>
        <div class="table-wrap"><table><thead><tr><th>Prospect</th><th>Country</th><th>Segment</th><th>Waiting on</th><th class="num">Days waiting</th><th class="num">Expected a month</th></tr></thead><tbody>
          ${R.pipeline.slice(0, 6).map(pipeRow).join('')}
        </tbody></table></div>${R.pipeline.length > 6 ? `<details class="data"><summary>${R.pipeline.length - 6} more waiting</summary><div class="table-wrap"><table><thead><tr><th>Prospect</th><th>Country</th><th>Segment</th><th>Waiting on</th><th class="num">Days waiting</th><th class="num">Expected a month</th></tr></thead><tbody>${R.pipeline.slice(6).map(pipeRow).join('')}</tbody></table></div></details>` : ''}<p class="footnote">Expected a month: the median first-quarter order value of accounts of the same segment and size opened this year.</p></div></section>`;
  }

  function pipeRow(p) {
    return `<tr><td>${esc(p.name)}</td><td>${esc(countryName(p.country))}</td><td class="small">${esc(p.segment)}</td><td class="small">${esc(p.waiting_on || '–')}</td><td class="num">${p.days_waiting}</td><td class="num">${esc(money(p.expected_monthly))}</td></tr>`;
  }

  function signalsPanel(v, u) {
    const S = H.signals;
    const gq = S.going_quiet[v], xs = S.cross_sell[v], conc = S.concentration[v];
    const tab = u.signalsTab;
    const tabs = [['quiet', `Going quiet (${gq.length})`], ['xsell', `Cross-sell targets (${xs.length})`], ['conc', `Growth concentration (${conc.filter((r) => r.flag).length})`]];
    let body = '';
    if (tab === 'quiet') body = `<p class="small ink2" style="margin-bottom:10px">Customers whose last order is more than twice their usual gap for their main product, and at least 60 days ago. Action: account manager call this week.</p>
      <div class="table-wrap"><table><thead><tr><th>Customer</th><th>Last order</th><th class="num">Usual gap</th><th class="num">Days since</th><th class="num">Value a month</th><th>Note</th></tr></thead><tbody>
      ${gq.map((r) => `<tr><td><div class="stack tight"><span>${esc(r.name)}</span><span class="tiny muted">${esc(countryName(r.country))} · ${esc(r.segment)} · mainly Product ${esc(r.main_product)}</span></div></td><td class="small">${esc(App.fmtShort(r.last_order))}</td><td class="num">${r.usual_gap} d</td><td class="num">${r.days_since}</td><td class="num">${esc(money(r.monthly_value))}</td>
        <td class="small">${r.duplicate_artifact ? `<span class="pill warn">False alarm</span><div class="tiny">Orders continue under ${esc(r.duplicate_artifact.name)}</div>` : '<span class="pill serious">Call this week</span>'}</td></tr>`).join('')}</tbody></table></div>`;
    if (tab === 'xsell') body = `<p class="small ink2" style="margin-bottom:10px">Hospitals and labs buying Products A and B in the last six months, never Product C, where at least 40% of similar customers (same segment and size) do buy C. Potential is scaled to the customer's size. Action: instruments team (QTG) visit in Q4.</p>
      <div class="table-wrap"><table><thead><tr><th>Customer</th><th>Peers</th><th class="num">Peers buying C</th><th class="num">Potential a month</th><th>Note</th></tr></thead><tbody>
      ${xs.map((r) => `<tr><td><div class="stack tight"><span>${esc(r.name)}</span><span class="tiny muted">${esc(countryName(r.country))} · ${esc(r.segment)}, size ${esc(r.size)}</span></div></td><td class="num">${r.peers}</td><td class="num">${pct(r.peer_adoption)}</td><td class="num">${esc(money(r.potential_monthly))}</td>
        <td class="small">${r.already_buys_c_elsewhere ? `<span class="pill warn">False target</span><div class="tiny">Already buys C under ${esc(r.already_buys_c_elsewhere.name)}</div>` : ''}</td></tr>`).join('')}</tbody></table></div>
      ${v === 'raw' && H.dedup.impact.cross_sell.missed ? `<p class="small" style="margin-top:8px;color:var(--warn-ink)">Missing from this list because its orders are split across two records: ${esc(H.dedup.impact.cross_sell.missed_names.join(', '))}.</p>` : ''}`;
    if (tab === 'conc') body = `<p class="small ink2" style="margin-bottom:10px">Share of each market's July to September volume taken by its three biggest buyers. Flagged when growth of 15% or more rests on three buyers taking 60% or more.</p>
      <div class="table-wrap"><table><thead><tr><th>Market</th><th class="num">Buyers</th><th style="min-width:160px">Top three's share</th><th class="num">Growth</th><th>Top buyers</th></tr></thead><tbody>
      ${conc.slice(0, 15).map((r) => `<tr ${r.flag ? 'class="highlight"' : ''}><td>${esc(countryName(r.country))} · Product ${esc(r.product)}${r.flag ? ' <span class="pill serious">Flag</span>' : ''}</td><td class="num">${r.buyers}</td><td><div class="bar-inline"><span class="track-bg"><i style="width:${Math.round(r.top3_share * 100)}%"></i></span><span class="small tnum">${pct(r.top3_share)}</span></div></td><td class="num">${growthChip(r.growth)}</td><td class="tiny">${r.top3.map((t) => esc(t.name)).join('<br>')}</td></tr>`).join('')}</tbody></table></div>`;
    return `<section class="panel"><div class="panel-head"><div><h2>Signals for sales</h2><p>Lists the country teams can act on this month.</p></div>${seg(tabs, tab, 'signals-tab', 'tab')}</div>${body}</section>`;
  }

  function implicationsPanel() {
    return `<section class="panel"><div class="panel-head"><div><h2>What it means and what to do</h2><p>Written from the numbers above; they update with the data.</p></div></div>
      <div class="grid two">${H.implications.map((i) => `<div class="inset stack tight"><h3>${esc(i.title)}</h3><p class="small ink2">${esc(i.text)}</p><p class="small"><b>Action:</b> ${esc(i.action)}</p></div>`).join('')}</div></section>`;
  }

  function mergePanel() {
    const m = H.dedup.impact;
    const rows = [
      ['Customer records', `${m.records}`, `${m.customers} customers`, ''],
      ['Customers ordering, Jul to Sep', num(m.active_q3.raw), num(m.active_q3.dedup), 'Split customers counted twice'],
      ['"Going quiet" alerts', `${m.going_quiet.raw}`, `${m.going_quiet.dedup}`, `${m.going_quiet.false} false alarms: orders moved to a duplicate record`],
      ['New accounts, Jul to Sep', `${m.new_accounts_q3.raw}`, `${m.new_accounts_q3.dedup}`, 'Duplicates created this year look like new customers'],
      ['Cross-sell targets', `${m.cross_sell.raw}`, `${m.cross_sell.dedup}`, `${m.cross_sell.false} false target, ${m.cross_sell.missed} missed (${m.cross_sell.missed_names.join(', ')})`],
      ['Malaysia, Product B units, Jul to Sep', num(m.my_b_q3.raw), num(m.my_b_q3.dedup), 'A Johor hospital was filed under Singapore'],
      ['Singapore, Product B units, Jul to Sep', num(m.sg_b_q3.raw), num(m.sg_b_q3.dedup), 'The same orders, now in the right country'],
    ];
    return `<section class="panel" id="merge-effect"><div class="panel-head"><div><h2>What merging duplicate customers changes</h2><p>Country totals barely move when a customer is split within one country, so the regional forecast holds up. Customer-level views do not: alerts, new-account counts and target lists are wrong until the records are merged.</p></div>
        <button class="btn small" data-action="go-health">See the ${H.dedup.clusters.length} duplicate pairs</button></div>
      <div class="table-wrap"><table><thead><tr><th>Measure</th><th class="num">As in SAP B1 today</th><th class="num">Duplicates merged</th><th>Why it differs</th></tr></thead><tbody>
        ${rows.map((r) => `<tr><td>${esc(r[0])}</td><td class="num">${esc(r[1])}</td><td class="num"><b>${esc(r[2])}</b></td><td class="small ink2">${esc(r[3])}</td></tr>`).join('')}</tbody></table></div></section>`;
  }

  Object.assign(App.actions, {
    'regional-view'(el) { ui().regionalView = el.dataset.view; App.save(); App.render(); },
    product(el) { ui().product = el.dataset.product; App.save(); App.render(); },
    'chart-mode'(el) { ui().chartMode = el.dataset.mode; App.save(); App.render(); },
    decomp(el) { ui().decompKey = el.dataset.key; App.save(); App.render(); },
    'signals-tab'(el) { ui().signalsTab = el.dataset.tab; App.save(); App.render(); },
    scroll(el) { const t = document.getElementById(el.dataset.target); if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' }); },
    'go-health'() { ui().deskTab = 'health'; App.go('desk'); },
  });

  // ================================================================ inbox sorting
  App.views.inbox = function () {
    const m = H.triage.metrics;
    const u = ui();
    const text = u.inboxText !== undefined ? u.inboxText : `${H.triage.examples[0].subject}\n${H.triage.examples[0].body}`;
    const ex = H.triage.examples;
    const classes = m.confusion.labels;
    return `
      <div class="page-head"><div><span class="label">Inbox sorting</span><h1>Sort the shared mailbox automatically</h1><p>A small text model reads each email and labels it as a purchase order, an enquiry, a setup request or a follow-up. Orders go to the order desk, setup requests to the MDM team, and only real orders count as demand.</p></div></div>
      <div class="grid four">
        ${tile('Accuracy on unseen emails', `${(m.accuracy * 100).toFixed(1)}%`, `${num(m.test_size)} held-out messages`)}
        ${tile('Sorted without a person', `${Math.round(m.auto_share * 100)}%`, `Confidence of 80% or more; ${(m.auto_accuracy * 100).toFixed(1)}% of those correct`)}
        ${tile('Hours saved a year', num(H.business_case.impacts.triage_hours), `At ${H.business_case.assumptions.triage_minutes_saved_per_message} minutes per message sorted`)}
        ${tile('Messages a year', num(H.business_case.impacts.messages_per_year), 'In the synthetic mailbox')}
      </div>
      <div class="grid sidebar">
        <section class="panel stack"><div class="panel-head" style="margin:0"><div><h2>Try it</h2><p>Paste an email or pick an example. The model runs in your browser.</p></div></div>
          <div class="chips">${ex.map((x, i) => `<button class="btn small" data-action="inbox-example" data-i="${i}">${esc(x.ambiguous ? 'Mixed message' : TYPE_ONE[x.type])}</button>`).join('')}</div>
          <div class="field"><label for="inbox-text">Email</label><textarea id="inbox-text" rows="7" data-inbox>${esc(text)}</textarea></div>
          <div id="inbox-result">${inboxResult(text)}</div></section>
        <section class="panel"><h3>Where the model goes wrong</h3><p class="small muted" style="margin:4px 0 10px">Rows are the true type, columns what the model said, on ${num(m.test_size)} held-out messages.</p>
          <div class="table-wrap"><table><thead><tr><th>True type</th>${classes.map((c) => `<th class="num" title="${esc(TYPE_ONE[c])}">${{ purchase_order: 'Order', enquiry: 'Enq.', setup_request: 'Setup', follow_up: 'F-up' }[c]}</th>`).join('')}</tr></thead><tbody>
            ${classes.map((c, i) => `<tr><td class="small"><b>${esc(TYPE_ONE[c])}</b></td>${m.confusion.matrix[i].map((v, j) => `<td class="num" style="${i === j ? 'font-weight:600' : v ? 'color:var(--critical-ink)' : 'color:var(--muted)'}">${v}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
          <div class="table-wrap" style="margin-top:12px"><table><thead><tr><th>Type</th><th class="num">Precision</th><th class="num">Recall</th></tr></thead><tbody>${m.per_class.map((r) => `<tr><td class="small">${esc(r.label)}</td><td class="num">${pct(r.precision)}</td><td class="num">${pct(r.recall)}</td></tr>`).join('')}</tbody></table></div>
          <p class="footnote" style="margin-top:10px">Mistakes cluster on mixed messages, such as an order with a question attached. Below 80% confidence the email goes to a person. In production the same step can run as an AI action in Power Automate.</p></section>
      </div>`;
  };

  function inboxResult(text) {
    if (!String(text || '').trim()) return '<p class="muted small">Paste an email to see how it is sorted.</p>';
    const r = E.classify(text);
    const f = E.extractFields(text, App.getState().master);
    const route = { purchase_order: 'Order desk: raise the sales order in SAP B1.', enquiry: 'Sales queue: reply with a quote or product information.', setup_request: 'MDM team: start a setup request.', follow_up: 'Reply with the live status link; no new work.' }[r.label];
    const bars = Object.entries(r.proba).sort((a, b) => b[1] - a[1]).map(([k, p]) => `<div class="bar-inline small"><span style="width:110px">${esc(TYPE_ONE[k])}</span><span class="track-bg"><i style="width:${Math.round(p * 100)}%;background:${k === r.label ? 'var(--accent)' : 'var(--axis)'}"></i></span><span class="tnum" style="width:44px;text-align:right">${Math.round(p * 100)}%</span></div>`).join('');
    const facts = [f.po ? `<dt>PO number</dt><dd class="mono">${esc(f.po)}</dd>` : '', f.quantity ? `<dt>Quantity</dt><dd>${esc(f.quantity)}</dd>` : '', f.item ? `<dt>Item</dt><dd>${esc(f.item.name)} <span class="tag mono">${esc(f.item.code)}</span></dd>` : '', f.customer ? `<dt>Customer</dt><dd>${esc(f.customer.name)} <span class="tag mono">${esc(f.customer.id)}</span></dd>` : ''].join('');
    return `<div class="stack"><div class="row"><span class="pill ${r.confidence >= 0.8 ? 'accent' : 'warn'}">${esc(TYPE_ONE[r.label])}</span><span class="small ink2">${Math.round(r.confidence * 100)}% confident · ${r.confidence >= 0.8 ? 'sorted automatically' : 'sent to a person to check'}</span></div>
      <div class="stack tight">${bars}</div>
      ${r.keyTerms.length ? `<div class="small ink2">Words that pointed to this: ${r.keyTerms.map((t) => `<span class="tag">${esc(t)}</span>`).join(' ')}</div>` : ''}
      ${facts ? `<dl class="facts">${facts}</dl>` : ''}
      <div class="inset small"><b>Next:</b> ${esc(route)}</div>
      ${r.label === 'setup_request' ? `<button class="btn small primary" data-action="inbox-to-request" style="align-self:flex-start">Start a setup request from this email</button>` : ''}</div>`;
  }

  App.onInputExtra = function (el) {
    if (el.hasAttribute('data-inbox')) {
      ui().inboxText = el.value;
      App.save();
      const out = document.getElementById('inbox-result');
      if (out) { const html = inboxResult(el.value); if (out._html !== html) { out.innerHTML = html; out._html = html; } }
      return true;
    }
    if (el.hasAttribute('data-sim')) { simChanged(el); return true; }
    if (el.hasAttribute('data-assume')) { assumeChanged(el); return true; }
    return false;
  };

  Object.assign(App.actions, {
    'inbox-example'(el) { const x = H.triage.examples[Number(el.dataset.i)]; ui().inboxText = `${x.subject}\n${x.body}`; App.save(); App.render(); },
    'inbox-to-request'() {
      const text = ui().inboxText || '';
      const f = E.extractFields(text, App.getState().master);
      const isItem = /item code|product code|create item|new item/i.test(text);
      const d = App.freshDraft(isItem ? 'item' : 'customer');
      const org = (text.match(/We are ([^,.\n]+?)(?: and| in|,|\.)/i) || text.match(/set up ([^,.\n]+?) as a new customer/i) || text.match(/register ([^,.\n]+?) in your system/i) || [])[1];
      if (!isItem && org) d.data.legal_name = org.trim();
      if (isItem) { const it = (text.match(/order ([^.\n]+?) which we don't carry/i) || text.match(/register ([^.\n]+?) as a new product code/i) || [])[1]; if (it) d.data.description = it.trim(); }
      if (!isItem && f.customer) d.data.legal_name = d.data.legal_name || f.customer.name;
      App.getUI().draft = d;
      App.go('request');
      App.toast('Draft started from the email. Check the details, then submit.');
    },
  });

  // ================================================================ business case
  const simParams = () => {
    const u = ui();
    return { ...H.business_case.sim.params_proposed, ...(u.simOverrides || {}) };
  };
  function runSim() {
    const bc = H.business_case;
    const out = E.simulateTurnaround({ counts: bc.history.approval_counts, probs: bc.history.approval_probs, cur: bc.sim.params_current, prop: simParams(), n: 6000, seed: 5 });
    out.currentHist = E.histogram(out.currentRaw, bc.sim.edges);
    out.proposedHist = E.histogram(out.proposedRaw, bc.sim.edges);
    return out;
  }
  function simResult(out) {
    const bc = H.business_case;
    return `<div class="grid two" style="align-items:start"><div class="chart">${C.histPair({ width: App.chartWidth('half'), title: 'Turnaround distribution', edges: bc.sim.edges, a: { name: 'Email today', color: 'var(--s2)', values: out.currentHist }, b: { name: 'Request hub', color: 'var(--s1)', values: out.proposedHist } })}</div>
      <div class="stack"><div class="legend"><span><i class="box" style="background:var(--s2)"></i>Email today (model)</span><span><i class="box" style="background:var(--s1)"></i>Request hub (model)</span></div>
        <div class="table-wrap"><table><thead><tr><th></th><th class="num">Email today</th><th class="num">Request hub</th></tr></thead><tbody>
          <tr><td>Average days</td><td class="num">${num1(out.current.mean)}</td><td class="num"><b>${num1(out.proposed.mean)}</b></td></tr>
          <tr><td>Median days</td><td class="num">${num1(out.current.median)}</td><td class="num"><b>${num1(out.proposed.median)}</b></td></tr>
          <tr><td>9 in 10 done within</td><td class="num">${num1(out.current.p90)}</td><td class="num"><b>${num1(out.proposed.p90)}</b></td></tr>
          <tr><td>Done within 5 days</td><td class="num">${pct(out.current.share_within_5)}</td><td class="num"><b>${pct(out.proposed.share_within_5)}</b></td></tr></tbody></table></div>
        <p class="small ink2">Most of the gain comes from running approvals in parallel and reminding people, not from software speed. The email model is calibrated to the last 12 months (actual average ${num1(bc.history.mean)} days).</p></div></div>`;
  }
  function simChanged(el) {
    const u = ui();
    u.simOverrides = { ...(u.simOverrides || {}) };
    const k = el.dataset.sim;
    let val = Number(el.value);
    if (k === 'sla_wd') { u.simOverrides.sla_days = val * 1.4; u.simOverrides.escalate_days = (val + 1) * 1.4; u.simSla = val; }
    else u.simOverrides[k] = val;
    const lab = document.getElementById(`${el.id}-v`);
    if (lab) lab.textContent = el.dataset.fmt === 'pct' ? `${Math.round(val * 100)}%` : k === 'sla_wd' ? `${val} working day${val === 1 ? '' : 's'}` : `${val.toFixed(1)} days`;
    App.save();
    clearTimeout(simChanged.t);
    simChanged.t = setTimeout(() => { const out = document.getElementById('sim-result'); if (out) out.innerHTML = simResult(runSim()); impactRefresh(); }, 60);
  }

  const ASSUME_FIELDS = [
    ['mdm_minutes_today', 'MDM team minutes per request today', 'Forwarding, chasing approvers, re-keying incomplete forms'],
    ['mdm_minutes_hub', 'MDM team minutes per request with the hub', 'Final check and import file'],
    ['requester_minutes_today', 'Requestor minutes per request today', 'Status emails and re-submitting'],
    ['requester_minutes_hub', 'Requestor minutes per request with the hub', ''],
    ['approver_minutes_today', 'Approver minutes per approval today', 'Finding the thread, asking questions'],
    ['approver_minutes_hub', 'Approver minutes per approval with the hub', 'One card in Teams'],
    ['duplicate_rate_today', 'Share of new customers created as duplicates today', ''],
    ['duplicate_fix_hours', 'Hours to find and fix one duplicate', 'Reconciliation, wrong invoices, merges'],
    ['forecast_hours_today_per_month', 'Analyst hours a month on the forecast today', 'Pulling SAP exports into spreadsheets'],
    ['forecast_hours_hub_per_month', 'Analyst hours a month with the automated forecast', 'Review only'],
    ['hourly_cost_sgd', 'Loaded cost of an hour of staff time (SGD)', ''],
    ['outside_help_days', 'Days of outside help to build', 'Duplicate-check service, Power BI connection'],
    ['outside_day_rate_sgd', 'Outside help day rate (SGD)', ''],
    ['build_internal_hours', 'Internal build hours', 'MDM team and one power user'],
  ];
  function impacts() {
    const bc = H.business_case;
    const A = { ...bc.assumptions, ...(ui().assume || {}) };
    const im = bc.impacts;
    const hist = bc.history;
    const per = im.requests_per_year;
    const mdm = per * (A.mdm_minutes_today - A.mdm_minutes_hub) / 60;
    const req = per * (A.requester_minutes_today - A.requester_minutes_hub) / 60;
    const appr = per * hist.approvals_mean * (A.approver_minutes_today - A.approver_minutes_hub) / 60;
    const dups = im.customer_setups_per_year * A.duplicate_rate_today * A.duplicate_catch_rate;
    const dupH = dups * A.duplicate_fix_hours;
    const fc = 12 * (A.forecast_hours_today_per_month - A.forecast_hours_hub_per_month);
    const tri = im.triage_hours;
    const total = mdm + req + appr + dupH + fc + tri;
    const benefit = total * A.hourly_cost_sgd;
    const cost = A.build_internal_hours * A.hourly_cost_sgd + A.outside_help_days * A.outside_day_rate_sgd + A.licence_cost_sgd;
    const simMean = ui().simOverrides ? runSimMean() : bc.sim.proposed.mean;
    const daily = im.revenue_pulled_forward_sgd / (im.new_accounts_per_year * im.days_saved_per_setup);
    const saved = im.customer_setup_days_today - simMean;
    return { A, rows: [['MDM team', mdm], ['Requestors', req], ['Approvers', appr], [`Duplicates avoided (${num1(dups)} a year)`, dupH], ['Forecast preparation', fc], ['Inbox sorting', tri]], total, benefit, cost, payback: cost / (benefit / 12), pulled: im.new_accounts_per_year * saved * daily, saved };
  }
  let simMeanCache = null;
  function runSimMean() { const key = JSON.stringify(ui().simOverrides); if (!simMeanCache || simMeanCache.key !== key) simMeanCache = { key, v: runSim().proposed.mean }; return simMeanCache.v; }
  function impactTable() {
    const x = impacts();
    return `<div class="table-wrap"><table><thead><tr><th>Where time is saved</th><th class="num">Hours a year</th><th class="num">Value (SGD)</th></tr></thead><tbody>
      ${x.rows.map(([l, h]) => `<tr><td>${esc(l)}</td><td class="num">${num(h)}</td><td class="num">${num(h * x.A.hourly_cost_sgd)}</td></tr>`).join('')}
      <tr><td><b>Total</b> (about ${num1(x.total / 1650)} full-time staff)</td><td class="num"><b>${num(x.total)}</b></td><td class="num"><b>${num(x.benefit)}</b></td></tr></tbody></table></div>
      <div class="grid three" style="margin-top:12px">
        <div class="inset"><div class="label">Build cost</div><div class="callout-num">${esc(money(x.cost))}</div><div class="tiny muted">Internal time plus outside help; licences assumed covered by Microsoft 365</div></div>
        <div class="inset"><div class="label">Pays back in</div><div class="callout-num">${num1(x.payback)} months</div><div class="tiny muted">From staff time alone</div></div>
        <div class="inset"><div class="label">First orders arrive sooner</div><div class="callout-num">${esc(money(x.pulled))} a year</div><div class="tiny muted">Customer setups take ${num1(H.business_case.impacts.customer_setup_days_today)} days today. ${num1(x.saved)} days sooner × ${num(H.business_case.impacts.new_accounts_per_year)} new accounts a year × their daily order value. Timing, not new revenue.</div></div></div>`;
  }
  function impactRefresh() { const el = document.getElementById('impact-table'); if (el) el.innerHTML = impactTable(); }
  function assumeChanged(el) {
    const u = ui();
    u.assume = { ...(u.assume || {}), [el.dataset.assume]: Number(el.value) };
    App.save();
    impactRefresh();
  }

  App.views.case = function () {
    const bc = H.business_case;
    const hist = bc.history;
    const u = ui();
    const P = simParams();
    const slaWd = u.simSla || 2;
    const A = { ...bc.assumptions, ...(u.assume || {}) };
    const slider = (id, key, label, min, max, step, val, fmt) => `<div class="field"><label for="${id}">${esc(label)}: <b id="${id}-v">${fmt === 'pct' ? Math.round(val * 100) + '%' : key === 'sla_wd' ? `${val} working day${val === 1 ? '' : 's'}` : Number(val).toFixed(1) + ' days'}</b></label><input id="${id}" type="range" min="${min}" max="${max}" step="${step}" value="${val}" data-sim="${key}" data-fmt="${fmt || ''}"></div>`;
    return `
      <div class="page-head"><div><span class="label">Business case</span><h1>Faster setups, cleaner records, fewer hours</h1><p>A model of request turnaround, the time saved, what it costs to build on Microsoft 365, and how we get people to stop emailing. Every figure is an assumption you can change; the defaults are explained next to each one.</p></div></div>
      <section class="panel"><div class="hero-compare">
        <div><div class="label">Average setup today (12 months of email requests)</div><div class="hero-num tnum">${num1(hist.mean)}<small>days</small></div><div class="small muted">Median ${num1(hist.median)} · 1 in 10 over ${num1(hist.p90)} · ${pct(hist.bounce_rate)} bounced back for missing fields</div></div>
        <div class="hero-arrow" aria-hidden="true">→</div>
        <div><div class="label">With the request hub (simulated)</div><div class="hero-num tnum" style="color:var(--accent)">${num1(bc.sim.proposed.mean)}<small>days</small></div><div class="small muted">9 in 10 within ${num1(bc.sim.proposed.p90)} days</div></div></div></section>
      <section class="panel"><div class="panel-head"><div><h2>Turnaround model</h2><p>Monte Carlo model of ${num(6000)} requests. Today: approvals run one after another and each approver has to notice the email. With the hub: approvals run in parallel, with a reminder and an escalation. Move the sliders to test the assumptions.</p></div></div>
        <div class="grid four">
          ${slider('sim-appr', 'approver_mean', 'Approver reply time', 0.5, 4, 0.1, P.approver_mean)}
          ${slider('sim-bounce', 'bounce_p', 'Still bounced back', 0, 0.3, 0.01, P.bounce_p, 'pct')}
          ${slider('sim-sla', 'sla_wd', 'Reminder after', 1, 4, 1, slaWd)}
          ${slider('sim-clar', 'clar_p', 'Need a question', 0, 0.3, 0.01, P.clar_p, 'pct')}
        </div>
        <div id="sim-result" style="margin-top:16px">${simResult(runSim())}</div></section>
      <section class="panel"><div class="panel-head"><div><h2>Time saved and cost</h2><p>${num(bc.impacts.requests_per_year)} requests a year (${num1(hist.per_month)} a month), ${num1(hist.approvals_mean)} approvals each, ${num(bc.impacts.messages_per_year)} mailbox messages. Change any assumption.</p></div></div>
        <div id="impact-table">${impactTable()}</div>
        <details class="data" style="margin-top:14px"><summary>Change the assumptions</summary><div class="assume-grid">${ASSUME_FIELDS.map(([k, l, h]) => `<div class="field"><label for="as-${k}" class="small">${esc(l)}</label><input id="as-${k}" type="number" step="any" value="${A[k]}" data-assume="${k}">${h ? `<span class="help">${esc(h)}</span>` : ''}</div>`).join('')}</div></details></section>
      <div class="grid two">
        <section class="panel"><h2>Why this, not the alternatives</h2><div class="table-wrap" style="margin-top:12px"><table><thead><tr><th>Option</th><th>For</th><th>Against</th></tr></thead><tbody>
          <tr class="highlight"><td><b>Request hub on Microsoft 365</b> (ours)</td><td class="small">Uses licences Lives Group already has; the MDM team changes fields, rules and units itself; approvals live in Teams</td><td class="small">Needs one power user; the duplicate check needs a short piece of outside help</td></tr>
          <tr><td>Process fix only: one template and a shared tracker</td><td class="small">Cheapest and fastest to start</td><td class="small">No duplicate check, nothing enforced, still email; does not fix forecasting data</td></tr>
          <tr><td>Commercial MDM software</td><td class="small">Complete feature set</td><td class="small">Costly, needs IT, oversized for one shared SAP B1 database</td></tr></tbody></table></div></section>
        <section class="panel"><h2>Getting people off email</h2><ul class="small" style="margin:12px 0 0;padding-left:18px;display:flex;flex-direction:column;gap:6px">
          <li><b>Meet approvers where they work.</b> Cards in Teams and Outlook; no new app to learn.</li>
          <li><b>Make the form faster than email.</b> Copy settings from a similar record; most requests take under five minutes.</li>
          <li><b>Auto-reply.</b> The shared mailbox answers every email with the form link and the request status page.</li>
          <li><b>Hard cut-over.</b> Once a business unit is live, email requests are no longer processed: for SPD from ${esc(App.fmtD(App.getState().config.settings.cutoverDate))}, the end of the 8-week pilot (set in Settings).</li>
          <li><b>Champions.</b> One person per business unit, and a starter pack for every new unit, so Marcus's story does not repeat.</li>
          <li><b>Show the numbers.</b> A weekly view for leadership: share of requests through the form, turnaround, overdue approvals.</li></ul></section></div>
      <div class="grid two">
        <section class="panel"><h2>Deliberately not in version 1</h2><div class="table-wrap" style="margin-top:12px"><table><thead><tr><th>Left out</th><th>Why</th><th>When</th></tr></thead><tbody>
          <tr><td>Writing straight into SAP B1</td><td class="small">Risky without an IT team; the import file keeps a person checking every record</td><td class="small">Phase 3, through the Service Layer</td></tr>
          <tr><td>Bulk merge of existing duplicates</td><td class="small">Needs data owners to agree; version 1 flags them</td><td class="small">Phase 2 clean-up sprint</td></tr>
          <tr><td>Full security model</td><td class="small">Outside the brief; version 1 masks sensitive fields by role and logs every view</td><td class="small">With an IT security review</td></tr>
          <tr><td>Forecasts per item or per customer</td><td class="small">Too sparse with 12 months of history</td><td class="small">After 24 months of clean data</td></tr>
          <tr><td>Machine-learning forecasts</td><td class="small">Too little history; simple methods are easier to trust and explain</td><td class="small">When more data exists</td></tr>
          <tr><td>A mobile app</td><td class="small">Teams and Outlook already work on phones</td><td class="small">Not planned</td></tr></tbody></table></div></section>
        <section class="panel"><h2>How it would be built at Lives Group</h2><div class="table-wrap" style="margin-top:12px"><table><thead><tr><th>In this prototype</th><th>In production</th><th>Built by</th></tr></thead><tbody>
          <tr><td>Request form</td><td class="small">Power Apps form (Microsoft Forms for simple types)</td><td class="small">MDM team and one power user</td></tr>
          <tr><td>Requests, settings, audit log</td><td class="small">SharePoint lists; Dataverse later if needed</td><td class="small">MDM team</td></tr>
          <tr><td>Routing, reminders, escalation</td><td class="small">Power Automate flows with Teams and Outlook approvals</td><td class="small">MDM team and one power user</td></tr>
          <tr><td>Duplicate check</td><td class="small">The same matching logic as a small Azure Function called by the flow</td><td class="small">Outside help, short engagement</td></tr>
          <tr><td>SAP B1 import file</td><td class="small">Data Transfer Workbench import; Service Layer in phase 3</td><td class="small">MDM team; SAP partner for phase 3</td></tr>
          <tr><td>Regional view and forecast</td><td class="small">Power BI on SAP B1 purchase-order data</td><td class="small">Analyst, with help for the data connection</td></tr>
          <tr><td>Inbox sorting</td><td class="small">AI step in Power Automate on the shared mailbox</td><td class="small">Phase 3 pilot</td></tr></tbody></table></div>
          <p class="footnote" style="margin-top:8px">Version 1 uses standard connectors (SharePoint, Outlook, Teams) that many Microsoft 365 plans include; premium connectors cost extra, so licences need checking with Lives Group.</p></section></div>
      <section class="panel"><h2>Rollout</h2><ol class="small" style="margin:12px 0 0;padding-left:18px;display:flex;flex-direction:column;gap:6px">
        <li><b>Phase 1, about 8 weeks:</b> customer and item requests, parallel approvals, tracker, audit log and import file, piloted with SPD.</li>
        <li><b>Phase 2:</b> all request types and business units, the duplicate-check service, the Power BI regional view, merging existing duplicates.</li>
        <li><b>Phase 3:</b> SAP B1 write-back through the Service Layer, inbox sorting pilot, automated monthly forecast refresh.</li></ol></section>`;
  };
})();
