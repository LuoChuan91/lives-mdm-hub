// SVG chart helpers
(function (root) {
  'use strict';
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const compact = (v) => {
    const a = Math.abs(v);
    if (a >= 1e6) return (v / 1e6).toFixed(a >= 1e7 ? 0 : 1).replace(/\.0$/, '') + 'M';
    if (a >= 1e3) return (v / 1e3).toFixed(a >= 1e4 ? 0 : 1).replace(/\.0$/, '') + 'K';
    return String(Math.round(v * 10) / 10);
  };
  function niceTicks(max, count) {
    if (!(max > 0)) return [0, 1];
    const raw = max / (count || 4);
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || 10 * mag;
    const ticks = [];
    for (let v = 0; v <= max + step * 0.001; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
    if (ticks[ticks.length - 1] < max) ticks.push(ticks[ticks.length - 1] + step);
    return ticks;
  }
  const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const monthLabel = (ym, withYear) => { const [y, m] = ym.split('-').map(Number); return MONTH[m - 1] + (withYear ? ` '${String(y).slice(2)}` : ''); };

  // Line chart: actual months, optional forecast continuation with a range band.
  function line(o) {
    const W = Math.round(o.width || 720), H = o.height || 270, L = 48, T = 18, B = 30;
    if (W < 560) o.endLabels = false;
    const R = o.endLabels === false ? 14 : 128;
    const n = o.labels.length, m = (o.forecastLabels || []).length, total = n + m;
    const all = [];
    o.series.forEach((s) => { s.values.forEach((v) => all.push(v)); (s.forecast || []).forEach((v) => all.push(v)); (s.hi || []).forEach((v) => all.push(v)); });
    const ticks = niceTicks(Math.max(...all, 0) * 1.05, 4);
    const ymax = ticks[ticks.length - 1];
    const x = (i) => L + (total === 1 ? 0 : (i * (W - L - R)) / (total - 1));
    const y = (v) => T + (H - T - B) * (1 - v / ymax);
    const fmt = o.format || compact;
    let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(o.title || 'Line chart')}">`;
    if (m) s += `<rect x="${x(n - 1)}" y="${T}" width="${x(total - 1) - x(n - 1)}" height="${H - T - B}" style="fill:var(--surface-2)" opacity="0.7"></rect><text x="${x(n - 1) + 6}" y="${T + 12}" class="lbl">Forecast</text>`;
    ticks.forEach((t) => { s += `<line class="gridline" x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}"></line><text x="${L - 8}" y="${y(t) + 4}" text-anchor="end" class="tnum">${fmt(t)}</text>`; });
    s += `<line class="axisline" x1="${L}" x2="${W - R}" y1="${y(0)}" y2="${y(0)}"></line>`;
    const labels = [...o.labels, ...(o.forecastLabels || [])];
    const every = Math.max(1, Math.ceil(36 / ((W - L - R) / Math.max(1, total - 1))));
    labels.forEach((lab, i) => {
      const show = i % every === 0 || i === total - 1;
      if (show) s += `<text x="${x(i)}" y="${H - 10}" text-anchor="middle">${esc(monthLabel(lab, i === 0 || lab.endsWith('-01')))}</text>`;
    });
    o.series.forEach((se) => {
      if (se.lo && se.hi) {
        const pts = se.hi.map((v, j) => `${x(n - 1 + j + 1)},${y(v)}`).concat([...se.lo].reverse().map((v, j) => `${x(n - 1 + se.lo.length - j)},${y(v)}`));
        pts.unshift(`${x(n - 1)},${y(se.values[n - 1])}`);
        s += `<polygon points="${pts.join(' ')}" style="fill:${se.color}" opacity="0.13"></polygon>`;
      }
    });
    o.series.forEach((se) => {
      const pts = se.values.map((v, i) => `${x(i)},${y(v)}`).join(' ');
      s += `<polyline points="${pts}" fill="none" style="stroke:${se.color}" stroke-width="${se.weight || 2}" stroke-linejoin="round" stroke-linecap="round" ${se.dashed ? 'stroke-dasharray="5 4"' : ''}></polyline>`;
      if (se.forecast && se.forecast.length) {
        const fp = [`${x(n - 1)},${y(se.values[n - 1])}`].concat(se.forecast.map((v, j) => `${x(n + j)},${y(v)}`)).join(' ');
        s += `<polyline points="${fp}" fill="none" style="stroke:${se.color}" stroke-width="2" stroke-dasharray="5 4" stroke-linecap="round"></polyline>`;
      }
      if (se.compare && se.compare.length) {
        const cp = [`${x(n - 1)},${y(se.values[n - 1])}`].concat(se.compare.map((v, j) => `${x(n + j)},${y(v)}`)).join(' ');
        s += `<polyline points="${cp}" fill="none" style="stroke:var(--ink-2)" stroke-width="1.5" stroke-dasharray="2 3"></polyline>`;
      }
      const lastI = se.forecast && se.forecast.length ? total - 1 : n - 1;
      const lastV = se.forecast && se.forecast.length ? se.forecast[se.forecast.length - 1] : se.values[n - 1];
      s += `<circle cx="${x(lastI)}" cy="${y(lastV)}" r="4" style="fill:${se.color};stroke:var(--surface)" stroke-width="2"></circle>`;
    });
    if (o.endLabels !== false) {
      const ends = o.series.map((se) => {
        const lastV = se.forecast && se.forecast.length ? se.forecast[se.forecast.length - 1] : se.values[n - 1];
        return { name: se.name, v: lastV, y: y(lastV) };
      }).sort((a, b) => a.y - b.y);
      const clash = ends.some((e, i) => i > 0 && e.y - ends[i - 1].y < 14);
      if (!clash) ends.forEach((e) => { s += `<text x="${W - R + 10}" y="${e.y + 4}" class="lbl">${esc(e.name)} <tspan class="lbl-strong">${fmt(e.v)}</tspan></text>`; });
    }
    for (let i = 0; i < total; i++) {
      const isF = i >= n;
      const rows = o.series.map((se) => {
        const v = isF ? (se.forecast || [])[i - n] : se.values[i];
        if (v === undefined) return '';
        const band = isF && se.lo ? ` <span style="opacity:.75">(${fmt(se.lo[i - n])}–${fmt(se.hi[i - n])})</span>` : '';
        return `<div><span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${se.color};margin-right:6px"></span>${esc(se.name)}: <b>${fmt(v)}</b>${band}</div>`;
      }).join('');
      const w = (W - L - R) / Math.max(1, total - 1);
      s += `<g class="hov"><line x1="${x(i)}" x2="${x(i)}" y1="${T}" y2="${y(0)}" style="stroke:var(--line-strong)" stroke-width="1" opacity="0" class="guide"></line><rect x="${x(i) - w / 2}" y="${T}" width="${w}" height="${H - T - B}" fill="transparent" data-tip="${esc(`<b>${monthLabel(labels[i], true)}${isF ? ' · forecast' : ''}</b>${rows}`)}"></rect></g>`;
    }
    return s + '</svg>';
  }

  // Horizontal bars, one per row (e.g. forecast error by method).
  function hbars(o) {
    const W = 720, rowH = 30, L = o.labelWidth || 230, R = 70, T = 6;
    const H = T + o.rows.length * rowH + 6;
    const max = o.max || Math.max(...o.rows.map((r) => r.value)) * 1.1;
    const x = (v) => L + ((W - L - R) * v) / max;
    let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(o.title || 'Bar chart')}">`;
    o.rows.forEach((r, i) => {
      const yy = T + i * rowH;
      const bw = Math.max(2, x(r.value) - L);
      s += `<text x="${L - 10}" y="${yy + 19}" text-anchor="end" class="${r.strong ? 'lbl-strong' : 'lbl'}">${esc(r.label)}</text>`;
      s += `<path d="M${L},${yy + 7} h${bw - 4} a4,4 0 0 1 4,4 v8 a4,4 0 0 1 -4,4 h-${bw - 4} z" style="fill:${r.color || 'var(--s1)'}" data-tip="${esc(r.tip || `${r.label}: ${o.format ? o.format(r.value) : r.value}`)}"></path>`;
      s += `<text x="${L + bw + 8}" y="${yy + 19}" class="${r.strong ? 'lbl-strong' : 'lbl'} tnum">${esc(o.format ? o.format(r.value) : r.value)}</text>`;
    });
    return s + '</svg>';
  }

  // Waterfall. The axis doesn't start at zero, so small steps stay visible.
  function waterfall(o) {
    const W = Math.round(o.width || 720), H = o.height || 260, L = 62, R = 12, T = 24, B = 58;
    let run = 0;
    const bars = o.steps.map((st) => {
      if (st.type === 'total') { const b = { ...st, from: 0, to: st.value }; run = st.value; return b; }
      const b = { ...st, from: run, to: run + st.value }; run += st.value; return b;
    });
    const vals = bars.flatMap((b) => (b.type === 'total' ? [b.to] : [b.from, b.to]));
    const lo = Math.min(...vals), hi = Math.max(...vals);
    const span = Math.max(hi - lo, Math.abs(hi) * 0.02, 1);
    const tk = niceTicks(span * 2.4, 4);
    const step = tk[1] - tk[0];
    const floor = Math.max(0, Math.floor((lo - span * 1.1) / step) * step);
    const ceil = Math.ceil((hi + span * 0.2) / step) * step;
    const y = (v) => T + (H - T - B) * (1 - (v - floor) / (ceil - floor));
    const band = (W - L - R) / bars.length;
    const bw = Math.min(64, band * 0.56);
    const fmt = o.format || compact;
    let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(o.title || 'Waterfall chart')}">`;
    for (let v = floor; v <= ceil + step * 0.001; v += step) s += `<line class="gridline" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"></line><text x="${L - 8}" y="${y(v) + 4}" text-anchor="end" class="tnum">${fmt(v)}</text>`;
    bars.forEach((b, i) => {
      const cx = L + band * i + band / 2;
      const isTotal = b.type === 'total';
      const top = y(Math.max(isTotal ? floor : b.from, b.to)), bot = y(Math.max(floor, Math.min(isTotal ? floor : b.from, b.to)));
      const color = isTotal ? 'var(--ink-2)' : b.value >= 0 ? 'var(--div-pos)' : 'var(--div-neg)';
      s += `<rect x="${cx - bw / 2}" y="${top}" width="${bw}" height="${Math.max(2, bot - top)}" rx="3" style="fill:${color}" data-tip="${esc(b.tip || `${b.label}: ${fmt(b.value)}`)}"></rect>`;
      if (isTotal && floor > 0) s += `<path d="M${cx - bw / 2 - 2},${bot - 9} l${bw + 4},-5 M${cx - bw / 2 - 2},${bot - 3} l${bw + 4},-5" style="stroke:var(--surface)" stroke-width="3"></path>`;
      const label = isTotal ? fmt(b.value) : (b.value >= 0 ? '+' : '−') + fmt(Math.abs(b.value));
      s += `<text x="${cx}" y="${top - 7}" text-anchor="middle" class="lbl-strong tnum">${label}</text>`;
      const words = b.label.split(' ');
      const cut = Math.ceil(words.length / 2);
      s += `<text x="${cx}" y="${H - 38}" text-anchor="middle" class="lbl">${esc(words.length > 2 ? words.slice(0, cut).join(' ') : b.label)}</text>`;
      if (words.length > 2) s += `<text x="${cx}" y="${H - 24}" text-anchor="middle" class="lbl">${esc(words.slice(cut).join(' '))}</text>`;
      if (i < bars.length - 1) s += `<line x1="${cx + bw / 2}" x2="${cx + band - bw / 2}" y1="${y(b.to)}" y2="${y(b.to)}" style="stroke:var(--line-strong)" stroke-dasharray="3 3"></line>`;
    });
    if (floor > 0) s += `<text x="${L}" y="${H - 4}" class="lbl">Axis starts at ${esc(fmt(floor))} so the changes are visible</text>`;
    return s + '</svg>';
  }

  // Horizontal bars as HTML, so labels stay readable at any width.
  function barsHtml(o) {
    const max = o.max || Math.max(...o.rows.map((r) => r.value)) || 1;
    return `<div class="hbar-list" role="list">${o.rows.map((r) => `<div class="hbar-row ${r.strong ? 'strong' : ''}" role="listitem" data-tip="${esc(r.tip || '')}"><span class="hbar-label">${esc(r.label)}</span><span class="hbar-track"><i style="width:${Math.max(1, (r.value / max) * 100)}%;background:${r.color || 'var(--s1)'}"></i></span><span class="hbar-val tnum">${esc(o.format ? o.format(r.value) : r.value)}</span></div>`).join('')}</div>`;
  }

  // Stacked columns: months x categories.
  function stacked(o) {
    const W = Math.round(o.width || 720), H = o.height || 240, L = 40, R = 8, T = 12, B = 28;
    const n = o.labels.length;
    const every = Math.max(1, Math.ceil(34 / ((W - L - R) / n)));
    const totals = o.labels.map((_, i) => o.series.reduce((a, se) => a + se.values[i], 0));
    const ticks = niceTicks(Math.max(...totals), 4);
    const ymax = ticks[ticks.length - 1];
    const band = (W - L - R) / n, bw = Math.min(24, band * 0.62);
    const y = (v) => T + (H - T - B) * (1 - v / ymax);
    let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(o.title || 'Stacked column chart')}">`;
    ticks.forEach((t) => { s += `<line class="gridline" x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}"></line><text x="${L - 8}" y="${y(t) + 4}" text-anchor="end" class="tnum">${compact(t)}</text>`; });
    o.labels.forEach((lab, i) => {
      const cx = L + band * i + band / 2;
      let acc = 0;
      const tip = `<b>${monthLabel(lab, true)}</b>` + o.series.map((se) => `<div>${esc(se.name)}: <b>${se.values[i]}</b></div>`).join('') + `<div style="opacity:.75">Total ${totals[i]}</div>`;
      o.series.forEach((se, k) => {
        const v = se.values[i];
        if (!v) return;
        const top = y(acc + v), bot = y(acc);
        const h = Math.max(0, bot - top - (k < o.series.length - 1 ? 2 : 0));
        s += `<rect x="${cx - bw / 2}" y="${top}" width="${bw}" height="${h}" rx="${k === o.series.length - 1 ? 3 : 0}" style="fill:${se.color}" data-tip="${esc(tip)}"></rect>`;
        acc += v;
      });
      if (i % every === 0) s += `<text x="${cx}" y="${H - 10}" text-anchor="middle">${esc(monthLabel(lab, i === 0 || lab.endsWith('-01')))}</text>`;
    });
    return s + '</svg>';
  }

  // Two distributions side by side per bin (turnaround histograms).
  function histPair(o) {
    const W = Math.round(o.width || 720), H = o.height || 230, L = 40, R = 8, T = 12, B = 34;
    const n = o.edges.length - 1;
    const every = Math.max(2, 2 * Math.ceil(26 / ((W - L - R) / n) / 2));
    const max = Math.max(...o.a.values, ...o.b.values);
    const ticks = niceTicks(max * 100, 4).map((t) => t / 100);
    const ymax = ticks[ticks.length - 1];
    const band = (W - L - R) / n, bw = Math.min(14, band * 0.38);
    const y = (v) => T + (H - T - B) * (1 - v / ymax);
    let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(o.title || 'Distribution chart')}">`;
    ticks.forEach((t) => { s += `<line class="gridline" x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}"></line><text x="${L - 8}" y="${y(t) + 4}" text-anchor="end" class="tnum">${Math.round(t * 100)}%</text>`; });
    for (let i = 0; i < n; i++) {
      const cx = L + band * i + band / 2;
      const lab = i === n - 1 ? `${o.edges[i]}+` : `${o.edges[i]}–${o.edges[i + 1]}`;
      const tip = `<b>${lab} days</b><div>${esc(o.a.name)}: <b>${Math.round(o.a.values[i] * 1000) / 10}%</b></div><div>${esc(o.b.name)}: <b>${Math.round(o.b.values[i] * 1000) / 10}%</b></div>`;
      [[o.a, -1], [o.b, 1]].forEach(([se, side]) => {
        const v = se.values[i];
        const top = y(v);
        s += `<rect x="${cx + (side < 0 ? -bw - 1 : 1)}" y="${top}" width="${bw}" height="${Math.max(0, y(0) - top)}" rx="2" style="fill:${se.color}" data-tip="${esc(tip)}"></rect>`;
      });
      if (i % every === 0) s += `<text x="${cx}" y="${H - 16}" text-anchor="middle" class="tnum">${o.edges[i]}</text>`;
    }
    s += `<text x="${(W + L) / 2}" y="${H - 2}" text-anchor="middle">Days from submission to record in SAP B1</text>`;
    return s + '</svg>';
  }

  function spark(values, color, w, h) {
    w = w || 96; h = h || 26;
    const max = Math.max(...values), min = Math.min(...values);
    const span = max - min || 1;
    const x = (i) => 2 + (i * (w - 6)) / (values.length - 1);
    const y = (v) => 3 + (h - 6) * (1 - (v - min) / span);
    const pts = values.map((v, i) => `${x(i)},${y(v)}`).join(' ');
    return `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true" style="overflow:visible"><polygon points="${x(0)},${h} ${pts} ${x(values.length - 1)},${h}" style="fill:${color}" opacity="0.1"></polygon><polyline points="${pts}" fill="none" style="stroke:${color}" stroke-width="1.6" stroke-linejoin="round"></polyline><circle cx="${x(values.length - 1)}" cy="${y(values[values.length - 1])}" r="2.6" style="fill:${color}"></circle></svg>`;
  }

  // One horizontal bar made of segments (e.g. days spent in each stage).
  function segments(o) {
    const total = o.parts.reduce((a, p) => a + p.value, 0) || 1;
    return `<div style="display:flex;height:30px;border-radius:8px;overflow:hidden;gap:2px">${o.parts.map((p) => `<div data-tip="${esc(p.tip || `${p.label}: ${p.value}`)}" style="flex:${p.value / total};background:${p.color};min-width:28px;display:flex;align-items:center;justify-content:center;color:${p.ink || '#fff'};font-size:12px;font-weight:600;white-space:nowrap;overflow:hidden">${esc(p.short || '')}</div>`).join('')}</div>`;
  }

  let tipEl = null;
  function bindTooltips(doc) {
    tipEl = doc.getElementById('tooltip');
    const show = (e) => {
      const t = e.target.closest('[data-tip]');
      if (!t || !tipEl) return;
      tipEl.innerHTML = t.getAttribute('data-tip');
      tipEl.hidden = false;
      const g = t.closest('.hov');
      if (g) { const guide = g.querySelector('.guide'); if (guide) guide.setAttribute('opacity', '1'); }
      move(e);
    };
    const move = (e) => {
      if (!tipEl || tipEl.hidden) return;
      const pad = 14, r = tipEl.getBoundingClientRect();
      let left = e.clientX + pad, top = e.clientY + pad;
      if (left + r.width > window.innerWidth - 8) left = e.clientX - r.width - pad;
      if (top + r.height > window.innerHeight - 8) top = e.clientY - r.height - pad;
      tipEl.style.left = Math.max(8, left) + 'px';
      tipEl.style.top = Math.max(8, top) + 'px';
    };
    const hide = (e) => {
      const t = e.target.closest('[data-tip]');
      if (!t || !tipEl) return;
      tipEl.hidden = true;
      const g = t.closest('.hov');
      if (g) { const guide = g.querySelector('.guide'); if (guide) guide.setAttribute('opacity', '0'); }
    };
    doc.addEventListener('pointerover', show);
    doc.addEventListener('pointermove', move);
    doc.addEventListener('pointerout', hide);
  }

  root.Charts = { line, hbars, barsHtml, waterfall, stacked, histPair, spark, segments, bindTooltips, compact, niceTicks, monthLabel, esc };
})(typeof window !== 'undefined' ? window : globalThis);
