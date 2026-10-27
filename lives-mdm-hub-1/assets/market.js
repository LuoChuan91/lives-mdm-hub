(function () {
  'use strict';
  const App = window.App;
  const { H, E, esc, num, money, countryName } = App;
  const M = H.market;
  const ui = () => App.getUI();
  const PRODUCTS = H.meta.products;
  const COUNTRIES = H.meta.countries;
  const LOCAL = COUNTRIES.filter((c) => c.code !== 'SG');

  function presetInputs(key) {
    const p = M.presets.find((x) => x.key === key) || M.presets[0];
    return { preset: p.key, fx: { ...p.fx }, demand: { ...p.demand }, tariff: { ...p.tariff }, tariffCountries: [...p.tariff_countries] };
  }
  function state() {
    const u = ui();
    if (!u.market) u.market = { ...presetInputs('fx'), fxPass: M.assumptions.fx_pass, tariffPass: M.assumptions.tariff_pass, elasticity: {}, sensitivity: {} };
    return u.market;
  }
  function setHTML(id, html) {
    const el = document.getElementById(id);
    if (!el || el._html === html) return;
    el.innerHTML = html;
    el._html = html;
  }
  const signedPct = (v, d = 1) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v * 100).toFixed(d)}%`;
  const signedMoney = (v) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${money(Math.abs(v))}`;
  const tone = (v) => (v > 0.0005 ? 'delta up' : v < -0.0005 ? 'delta down' : 'delta');
  const heat = (v) => {
    const w = Math.round(Math.min(1, Math.abs(v) / 0.08) * 30);
    return `background:color-mix(in srgb, ${v >= 0 ? 'var(--div-pos)' : 'var(--div-neg)'} ${w}%, var(--surface))`;
  };
  const fxWords = (c, v) => {
    const cur = M.currency[c];
    if (!v) return `${cur} unchanged`;
    return v > 0 ? `${cur} ${v}% weaker` : `${cur} ${-v}% stronger`;
  };
  const demandWords = (v) => (!v ? 'No change' : `${v > 0 ? '+' : '−'}${Math.abs(v)}%`);

  App.views.market = function () {
    const s = state();
    const presets = M.presets.map((p) => `<button aria-pressed="${s.preset === p.key}" data-action="mk-preset" data-key="${p.key}">${esc(p.label)}</button>`).join('');
    return `
      <div class="page-head"><div><span class="label">Insights</span><h1>Market scenarios</h1>
        <p>How exchange rates, import tariffs and changes in demand would affect next quarter's orders. The price sensitivities are assumptions you can change.</p></div></div>
      <div class="stack tight"><span class="label">Start from a scenario</span><div class="seg" role="group">${presets}${s.preset === 'custom' ? '<button aria-pressed="true" disabled>Your changes</button>' : ''}</div></div>
      <div id="mk-tiles"></div>
      <div class="grid two" style="align-items:start">
        <section class="panel stack">${inputsPanel(s)}</section>
        <section class="panel stack" id="mk-effect"></section>
      </div>
      <section class="panel stack" id="mk-customers"></section>
      <section class="panel stack">${assumptionsPanel(s)}</section>
      <section class="panel stack">${modelPanel()}</section>`;
  };

  function inputsPanel(s) {
    const rows = COUNTRIES.map((c) => {
      const fx = s.fx[c.code] || 0, dm = s.demand[c.code] || 0;
      const fxCell = c.code === 'SG' ? '<span class="small muted">Prices are in SGD</span>'
        : `<input id="mk-fx-${c.code}" type="range" min="-10" max="10" step="1" value="${fx}" data-mk="fx" data-key="${c.code}" aria-label="${esc(c.name)} exchange rate against SGD"><span class="small" id="mk-fx-${c.code}-v">${esc(fxWords(c.code, fx))}</span>`;
      return `<tr><td><b>${esc(c.name)}</b></td><td><div class="stack tight">${fxCell}</div></td>
        <td><div class="stack tight"><input id="mk-dm-${c.code}" type="range" min="-15" max="15" step="1" value="${dm}" data-mk="demand" data-key="${c.code}" aria-label="${esc(c.name)} demand shift"><span class="small" id="mk-dm-${c.code}-v">${esc(demandWords(dm))}</span></div></td></tr>`;
    }).join('');
    const tariffRows = PRODUCTS.map((p) => {
      const t = s.tariff[p.code] || 0;
      return `<div class="field"><label for="mk-tf-${p.code}">Product ${p.code}, ${esc(p.name.toLowerCase())}: <b id="mk-tf-${p.code}-v">${t ? `+${t} points` : 'no change'}</b></label>
        <input id="mk-tf-${p.code}" type="range" min="0" max="15" step="1" value="${t}" data-mk="tariff" data-key="${p.code}"></div>`;
    }).join('');
    const tc = new Set(s.tariffCountries);
    const boxes = COUNTRIES.map((c) => `<label class="chip-toggle"><input type="checkbox" data-action="mk-tc" data-key="${c.code}" ${tc.has(c.code) ? 'checked' : ''}> ${esc(c.name)}</label>`).join('');
    return `<div class="panel-head" style="margin:0"><div><h2>Market inputs</h2><p>Exchange rates are against the Singapore dollar. Demand shifts cover reasons other than price, such as hospital budgets or an outbreak.</p></div></div>
      <div class="table-wrap"><table class="mk-inputs"><thead><tr><th>Country</th><th>Exchange rate</th><th>Demand shift</th></tr></thead><tbody>${rows}</tbody></table></div>
      <h3 style="margin-top:6px">Import tariffs</h3>
      <div class="stack tight">${tariffRows}</div>
      <div class="stack tight"><span class="small ink2">The tariff change applies to imports into:</span><div class="chips">${boxes}</div></div>`;
  }

  function assumptionsPanel(s) {
    const A = M.assumptions;
    const el = { ...A.elasticity, ...s.elasticity };
    const se = { ...A.sensitivity, ...s.sensitivity };
    const elRows = PRODUCTS.map((p) => `<tr><td>Product ${p.code}, ${esc(p.name.toLowerCase())}</td><td class="num"><input id="mk-el-${p.code}" type="number" step="0.1" min="-3" max="0" value="${el[p.code]}" data-mk="elasticity" data-key="${p.code}" style="width:76px" aria-label="Price elasticity of product ${p.code}"></td><td class="small ink2">${esc(A.elasticity_note[p.code])}</td></tr>`).join('');
    const seRows = Object.keys(A.sensitivity).map((k) => `<tr><td>${esc(k)}</td><td class="num"><input id="mk-se-${k.replace(/\W+/g, '-')}" type="number" step="0.1" min="0" max="3" value="${se[k]}" data-mk="sensitivity" data-key="${esc(k)}" style="width:76px" aria-label="Sensitivity of ${esc(k)}"></td></tr>`).join('');
    const pass = (id, key, label, val, help) => `<div class="field"><label for="${id}">${esc(label)}: <b id="${id}-v">${Math.round(val * 100)}%</b></label><input id="${id}" type="range" min="0" max="1" step="0.05" value="${val}" data-mk="${key}"><span class="help">${esc(help)}</span></div>`;
    return `<div class="panel-head" style="margin:0"><div><h2>Assumptions behind the scenario</h2><p>These are our assumptions, because twelve months of orders is too little to estimate them. You can change any of them.</p></div></div>
      <div class="grid two" style="align-items:start">
        <div class="stack">
          ${pass('mk-fxpass', 'fxPass', 'Share of an exchange-rate move passed into customer prices', s.fxPass, 'The rest comes off Lives Group’s Singapore-dollar revenue.')}
          ${pass('mk-tfpass', 'tariffPass', 'Share of a tariff passed into customer prices', s.tariffPass, 'The rest is absorbed as a lower net price.')}
          <div class="table-wrap"><table><thead><tr><th>Product line</th><th class="num">Price elasticity</th><th>Why</th></tr></thead><tbody>${elRows}</tbody></table></div>
          <p class="small ink2">Elasticity of −0.6 means a 10% price rise cuts orders by 6%.</p>
        </div>
        <div class="stack">
          <div class="table-wrap"><table><thead><tr><th>Customer type</th><th class="num">Sensitivity</th></tr></thead><tbody>${seRows}</tbody></table></div>
          <p class="small ink2">${esc(A.sensitivity_note)} The sensitivity multiplies the product’s elasticity.</p>
        </div>
      </div>`;
  }

  function modelPanel() {
    const pm = M.propensity.metrics;
    return `<div class="panel-head" style="margin:0"><div><h2>Purchase likelihood model</h2><p>We tested it before building on it.</p></div></div>
      <div class="grid three">
        ${App.tile('Machine-learning model', pm.auc.toFixed(3), 'AUC on Jul to Sep 2026, a quarter it never saw')}
        ${App.tile('Simple rule', pm.auc_rule.toFixed(3), '“Ordered this product in the last 3 months”')}
        ${App.tile('Customer and product pairs tested', num(pm.test_rows), `${Math.round(pm.base_rate * 100)}% of them ordered`)}
      </div>
      <p class="small ink2">A logistic regression learned from each customer’s recent orders, trend, months since the last order and what similar customers buy (trained on snapshots from January to March 2026). It ranks customers almost perfectly, but so does the simple rule: in twelve months of data, customers either keep buying a product line or stop, and the going-quiet alerts on the regional view already catch the ones who stop. So the scenarios start from the forecast and each customer’s recent orders rather than from a model that adds little.</p>
      <div class="inset small"><b>In production.</b> Join SAP B1 orders with daily exchange rates from the Monetary Authority of Singapore and the customs tariff schedules of the five countries. Once 24 to 36 months of history exist, estimate each product’s price sensitivity with a regression that includes exchange rates and tariffs, check it with the same backtest as the forecast, and replace the assumptions above with the estimates. The sliders become what-if parameters in Power BI.</div>`;
  }

  function results() {
    const s = state();
    const r = E.marketScenario(M, s);
    const t = r.totals;
    const ch = t.rev - t.baseRev;
    const worst = Object.entries(r.byCountry).map(([c, v]) => [c, v.rev - v.baseRev]).sort((a, b) => a[1] - b[1])[0];
    const pc = (p) => { const v = r.byProduct[p]; return v.units / v.baseUnits - 1; };
    setHTML('mk-tiles', `<div class="grid four">
      ${App.tile('Order value, Oct to Dec 2026, this scenario', money(t.rev), `Forecast with no market change: ${money(t.baseRev)}`)}
      ${App.tile('Change against the forecast', `<span class="${tone(ch)}" style="font-size:inherit">${signedMoney(ch)}</span>`, signedPct(ch / t.baseRev))}
      ${(() => {
        const ranked = PRODUCTS.map((p) => [p, pc(p.code)]).sort((a, b) => a[1] - b[1]);
        const [hp, hv] = ranked[0];
        if (Math.abs(hv) < 0.0005) return App.tile('Units ordered, by product line', 'No change', 'Kits, boxes and instrument units');
        const rest = ranked.slice(1).sort((a, b) => a[0].code.localeCompare(b[0].code)).map(([p, v]) => `${p.code} ${signedPct(v)}`).join(' · ');
        return App.tile('Product line hit hardest, units', `${hp.code} ${signedPct(hv)}`, `Product ${hp.code}, ${hp.name.toLowerCase()}. Others: ${rest}`);
      })()}
      ${App.tile('Country hit hardest', worst && worst[1] < -1 ? esc(countryName(worst[0])) : 'None', worst && worst[1] < -1 ? `${signedMoney(worst[1])} in the quarter` : 'No country loses value')}
    </div>`);
    // country x product effect
    const byKey = Object.fromEntries(r.cells.map((x) => [x.country + x.product, x]));
    const rowsHtml = COUNTRIES.map((c) => {
      const cells = PRODUCTS.map((p) => {
        const x = byKey[c.code + p.code];
        return `<td class="num" style="${heat(x.unitChange)}" data-tip="${esc(`<b>${c.name} · Product ${p.code}</b><div>Forecast: ${num(x.baseUnits)} ${p.unit}</div><div>Scenario: ${num(x.units)} ${p.unit}</div><div>Customer price: ${signedPct(x.customerPrice)}</div><div>Lives Group SGD price: ${signedPct(x.netPrice)}</div>`)}"><span class="${tone(x.unitChange)}">${signedPct(x.unitChange)}</span></td>`;
      }).join('');
      const v = r.byCountry[c.code];
      return `<tr><td>${esc(c.name)}</td>${cells}<td class="num"><span class="${tone(v.rev - v.baseRev)}">${signedMoney(v.rev - v.baseRev)}</span></td></tr>`;
    }).join('');
    const maxAbs = Math.max(1, ...Object.values(r.byCountry).map((v) => Math.abs(v.rev - v.baseRev)));
    const bars = COUNTRIES.map((c) => {
      const d = r.byCountry[c.code].rev - r.byCountry[c.code].baseRev;
      const w = (Math.abs(d) / maxAbs) * 50;
      return `<div class="mk-bar-row"><span class="small">${esc(c.name)}</span><div class="mk-bar-track"><span class="mk-bar ${d < 0 ? 'neg' : 'pos'}" style="${d < 0 ? `right:50%;width:${w}%` : `left:50%;width:${w}%`}"></span><span class="mk-bar-zero"></span></div><span class="small tnum mk-bar-val">${signedMoney(d)}</span></div>`;
    }).join('');
    setHTML('mk-effect', `<div class="panel-head" style="margin:0"><div><h2>Effect on October to December</h2><p>Change in units ordered against the forecast, by country and product line, and the change in order value in SGD.</p></div></div>
      <div class="table-wrap"><table><thead><tr><th>Country</th>${PRODUCTS.map((p) => `<th class="num">Product ${p.code}</th>`).join('')}<th class="num">Order value</th></tr></thead><tbody>${rowsHtml}
        <tr><td><b>All five</b></td>${PRODUCTS.map((p) => `<td class="num"><b>${signedPct(pc(p.code))}</b></td>`).join('')}<td class="num"><b>${signedMoney(ch)}</b></td></tr></tbody></table></div>
      <div class="stack tight"><span class="label">Change in order value by country</span>${bars}</div>`);
    // customers
    const hit = r.customers.filter((x) => x.change < -1).sort((a, b) => a.change - b.change).slice(0, 8);
    const gain = r.customers.filter((x) => x.change > 1).sort((a, b) => b.change - a.change).slice(0, 3);
    const list = hit.length ? hit : gain;
    const rows = list.map((x) => `<tr><td><div class="stack tight"><span>${esc(x.name)}</span><span class="tiny muted">${esc(countryName(x.country))} · ${esc(x.segment)}</span></div></td><td class="num">${money(x.base)}</td><td class="num">${money(x.scen)}</td><td class="num"><span class="${tone(x.change)}">${signedMoney(x.change)}</span></td><td class="num">${signedPct(x.change / x.base)}</td></tr>`).join('');
    setHTML('mk-customers', `<div class="panel-head" style="margin:0"><div><h2>${hit.length ? 'Customers most exposed' : gain.length ? 'Customers who gain most' : 'Customers'}</h2><p>Each customer’s expected orders for October to December (their July to September orders, grown in line with the forecast) under this scenario. Account managers can call these first.</p></div></div>
      ${list.length ? `<div class="table-wrap"><table><thead><tr><th>Customer</th><th class="num">Expected, no change</th><th class="num">This scenario</th><th class="num">Change</th><th class="num">%</th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p class="small ink2">No customer is affected by this scenario. Pick a scenario above or move a slider.</p>'}`);
  }

  // redraw on every input
  App.afterRender.market = results;

  function labelFor(el) {
    const k = el.dataset.mk, key = el.dataset.key, v = Number(el.value);
    if (k === 'fx') return fxWords(key, v);
    if (k === 'demand') return demandWords(v);
    if (k === 'tariff') return v ? `+${v} points` : 'no change';
    if (k === 'fxPass' || k === 'tariffPass') return `${Math.round(v * 100)}%`;
    return null;
  }
  const prevInput = App.onInputExtra;
  App.onInputExtra = function (el) {
    if (el.hasAttribute('data-mk')) {
      const s = state();
      const k = el.dataset.mk, key = el.dataset.key;
      const v = Number(el.value);
      if (Number.isNaN(v)) return true;
      if (k === 'fxPass' || k === 'tariffPass') s[k] = v;
      else { s[k] = { ...(s[k] || {}) }; s[k][key] = v; }
      if ((k === 'fx' || k === 'demand' || k === 'tariff') && s.preset !== 'custom') {
        s.preset = 'custom';
        document.querySelectorAll('[data-action="mk-preset"]').forEach((b) => b.setAttribute('aria-pressed', 'false'));
      }
      const lab = document.getElementById(`${el.id}-v`);
      const text = labelFor(el);
      if (lab && text !== null) lab.textContent = text;
      App.save();
      clearTimeout(App.onInputExtra.t);
      App.onInputExtra.t = setTimeout(results, 40);
      return true;
    }
    return prevInput ? prevInput(el) : false;
  };

  Object.assign(App.actions, {
    'mk-preset'(el) {
      const s = state();
      Object.assign(s, presetInputs(el.dataset.key));
      App.save(); App.render();
    },
    'mk-tc'(el) {
      const s = state();
      const set = new Set(s.tariffCountries);
      if (el.checked) set.add(el.dataset.key); else set.delete(el.dataset.key);
      s.tariffCountries = [...set];
      s.preset = 'custom';
      App.save(); App.render();
    },
  });
})();
