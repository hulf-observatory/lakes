// The side panel: HMDA overview, a lake, or a spot. Rain as a calendar (IMD's categories in the blue ramp),
// a date range shared by the rain figures and the rooftop harvest.
import { RUNOFF } from '../config.js';
import { lakeName } from './network.js';
import { stats } from './rain.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const n0 = (v) => (v == null ? '—' : Math.round(v).toLocaleString('en-IN'));
const d1 = (v) => (v == null ? '—' : v.toFixed(1));
const area = (m2) => (!m2 ? '—' : m2 >= 1e6 ? `${(m2 / 1e6).toFixed(2)} km²` : m2 >= 1e4 ? `${(m2 / 1e4).toFixed(1)} ha` : `${n0(m2)} m²`);
const dist = (m) => (m == null ? '—' : m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${n0(m)} m`);
const litres = (L) => (!L ? null : L >= 1e9 ? [(L / 1e9).toFixed(2), 'billion litres'] : L >= 1e6 ? [(L / 1e6).toFixed(1), 'million litres']
  : L >= 1e3 ? [(L / 1e3).toFixed(0), 'thousand litres'] : [n0(L), 'litres']);
const fmt = (d, o = { day: 'numeric', month: 'short', year: 'numeric' }) => (d ? new Date(d + 'T00:00:00').toLocaleDateString('en-GB', o) : '—');
const short = (d) => fmt(d, { day: 'numeric', month: 'short' });
const row = (k, v) => `<li><span>${esc(k)}</span><b>${esc(v)}</b></li>`;

export function head(eyebrow, title, sub) {
  $('p-eyebrow').textContent = eyebrow;
  $('p-title').textContent = title;
  $('p-sub').textContent = sub || '';
  $('p-sub').hidden = !sub;
  $('sheet-label').textContent = title;
}

// ---- rain calendar: weeks across, days down; IMD categories (mm per day) ----
const CATS = [[0.1, '#E4EDF6', 'very light'], [2.5, '#B7CDE4', 'light'], [15.6, '#7FA6CE', 'moderate'],
              [64.5, '#3F76B0', 'heavy'], [115.6, '#123F70', 'very heavy']];
const colour = (mm) => { let c = '#F3F4F6'; for (const [lo, col] of CATS) if (mm >= lo) c = col; return c; };

function calendar(series) {
  if (!series.length) return '<p class="note">No rain readings for these dates.</p>';
  const S = 11, G = 2, MAXW = 26;
  const weeks = Math.ceil((series.length + new Date(series[0].date).getDay()) / 7);
  const data = weeks > MAXW ? series.slice(-(MAXW * 7 - 6)) : series;
  let col = 0, rowi = new Date(data[0].date + 'T00:00:00').getDay();
  const cells = [], months = [];
  let lastM = -1, lastCol = -9;
  for (const r of data) {
    const m = +r.date.slice(5, 7);
    if (m !== lastM && r.date.slice(8) <= '07') {           // label a month at the week it starts, if there is room
      if (col - lastCol >= 3) { months.push([col, fmt(r.date, { month: 'short' })]); lastCol = col; }
      lastM = m;
    }
    cells.push(`<rect x="${col * (S + G)}" y="${16 + rowi * (S + G)}" width="${S}" height="${S}" rx="2" fill="${colour(r.mm)}" data-t="${short(r.date)} · ${d1(r.mm)} mm"/>`);
    if (++rowi === 7) { rowi = 0; col++; }
  }
  const w = (col + 1) * (S + G), h = 16 + 7 * (S + G);
  const labels = months.map(([c, t]) => `<text x="${c * (S + G)}" y="10">${t}</text>`).join('');
  const cut = data.length < series.length ? `<p class="note">The last ${MAXW} weeks of the range.</p>` : '';
  const key = `<div class="key"><span><i style="background:#F3F4F6"></i>none</span>${CATS.map(([, c, t]) => `<span><i style="background:${c}"></i>${t}</span>`).join('')}</div>`;
  return `<div class="cal"><svg width="${w}" height="${h}" role="img" aria-label="Rain each day">${labels}${cells.join('')}</svg><div class="cal-tip" hidden></div></div>${key}${cut}`;
}

function wireTips(root) {
  const cal = root.querySelector('.cal'); if (!cal) return;
  const tip = cal.querySelector('.cal-tip');
  cal.addEventListener('pointermove', (e) => {
    const t = e.target.getAttribute && e.target.getAttribute('data-t');
    if (!t) { tip.hidden = true; return; }
    const b = cal.getBoundingClientRect();
    tip.textContent = t; tip.hidden = false;
    tip.style.left = `${e.clientX - b.left}px`; tip.style.top = `${e.clientY - b.top}px`;
  });
  cal.addEventListener('pointerleave', () => { tip.hidden = true; });
}

// ---- the rain section with its date range; onRange(series) lets the harvest follow ----
const RANGES = [['30', '30 days'], ['90', '90 days'], ['monsoon', 'Monsoon'], ['all', 'All']];
function rainSection(host, series, onRange, scope) {
  if (!series.length) { host.innerHTML = `<p class="eyebrow">Rain</p><p class="note">No rain readings for this ${scope}.</p>`; onRange([]); return; }
  const first = series[0].date, last = series[series.length - 1].date;
  host.innerHTML = `<p class="eyebrow">Rain</p>
    <div class="seg" role="radiogroup" aria-label="Dates">${RANGES.map(([k, t]) => `<button type="button" role="radio" data-r="${k}" aria-checked="${k === 'all'}">${t}</button>`).join('')}</div>
    <div class="dates"><label>From<input type="date" data-d="from" min="${first}" max="${last}" value="${first}"></label>
      <label>To<input type="date" data-d="to" min="${first}" max="${last}" value="${last}"></label></div>
    <div class="big" data-o="total"></div><p class="cap" data-o="cap"></p>
    <div data-o="cal"></div>
    <ul class="rows" data-o="rows"></ul>`;
  const from = host.querySelector('[data-d=from]'), to = host.querySelector('[data-d=to]');
  const draw = () => {
    let a = from.value, b = to.value;
    if (a > b) [a, b] = [b, a];
    const s = series.filter((r) => r.date >= a && r.date <= b);
    const st = stats(s);
    host.querySelector('[data-o=total]').innerHTML = `${d1(st.total)}<small>mm</small>`;
    host.querySelector('[data-o=cap]').textContent = `Rain ${scope === 'lake' ? 'on the catchment' : 'across HMDA, station average'}, ${short(a)} to ${fmt(b)} (${st.days} days)`;
    host.querySelector('[data-o=cal]').innerHTML = calendar(s);
    wireTips(host);
    host.querySelector('[data-o=rows]').innerHTML =
      (st.last ? row('Last rainy day', `${short(st.last.date)} · ${d1(st.last.mm)} mm`) : '') +
      (st.peak ? row('Wettest day', `${short(st.peak.date)} · ${d1(st.peak.mm)} mm`) : '') +
      row('Rainy days (2.5 mm or more)', st.rainy) +
      (st.dry.n ? row('Longest dry spell', `${st.dry.n} days from ${short(st.dry.from)}`) : '') +
      (st.wet.n > 1 ? row('Longest rainy spell', `${st.wet.n} days from ${short(st.wet.from)}`) : '');
    onRange(s, a, b);
  };
  host.querySelector('.seg').addEventListener('click', (e) => {
    const k = e.target.dataset?.r; if (!k) return;
    host.querySelectorAll('.seg button').forEach((x) => x.setAttribute('aria-checked', String(x === e.target)));
    const end = new Date(last + 'T00:00:00');
    let start = first;
    if (k === '30' || k === '90') { const d = new Date(end); d.setDate(d.getDate() - (+k - 1)); start = d.toISOString().slice(0, 10); }
    if (k === 'monsoon') {                    // IMD's southwest monsoon season, 1 June to 30 September, of the latest year
      const y = last.slice(0, 4); start = `${y}-06-01`; to.value = last < `${y}-09-30` ? last : `${y}-09-30`;
    } else to.value = last;
    from.value = start < first ? first : start;
    draw();
  });
  for (const el of [from, to]) el.addEventListener('change', () => {
    host.querySelectorAll('.seg button').forEach((x) => x.setAttribute('aria-checked', 'false'));
    draw();
  });
  draw();
}

function harvestSection(host, roofM2, buildings, scope) {
  return (series, a, b) => {
    const mm = series.reduce((s, r) => s + r.mm, 0);
    const L = litres(roofM2 * mm * RUNOFF);
    host.innerHTML = `<p class="eyebrow">Rooftop harvest</p>
      <div class="big">${L ? `${L[0]}<small>${L[1]}</small>` : '—'}</div>
      <p class="cap">${L ? `Could be collected from the roofs ${scope === 'lake' ? 'in the catchment' : 'across HMDA'} from ${d1(mm)} mm of rain, ${short(a)} to ${fmt(b)}` : 'No rain in these dates'}</p>
      <ul class="rows">${row('Rooftop area', area(roofM2))}${row('Buildings', n0(buildings))}${row('Share collected', RUNOFF)}</ul>
      <p class="note">Rooftop area × rain × ${RUNOFF}. Buildings from Overture Maps.</p>`;
  };
}

// ---- HMDA overview ----
export function renderOverview(ctx) {
  head('HMDA', 'Lakes and their catchments', 'Tap a lake to see where its water comes from and where it goes, or tap anywhere to see which lake that spot drains into.');
  const body = $('panel-body');
  let roof = 0, bldg = 0;
  for (const r of Object.values(ctx.roof.lake_catchment || {})) { roof += r.total_roof_m2 || 0; bldg += r.n_buildings || 0; }
  body.innerHTML = `<div class="sec" id="s-rain"></div><div class="sec" id="s-harvest"></div>
    <div class="sec"><p class="eyebrow">Lakes and the rivers they end in</p><ul class="rows">${row('Lakes in HMDA', n0(ctx.lakeCount))}
      ${ctx.rivers.slice(0, 5).map(([r, k]) => row(r, `${n0(k)} lakes`)).join('')}</ul>
    <p class="note">Rain from TGDPS automatic weather stations, counted per rain day from 08:30 to 08:30 IST${ctx.asOf ? `; newest reading ${fmtTime(ctx.asOf)}` : ''}.</p></div>`;
  rainSection($('s-rain'), ctx.series, harvestSection($('s-harvest'), roof, bldg, 'hmda'), 'area');
}

// ---- one lake ----
export function renderLake(n, ctx, spot) {
  const name = lakeName(n.id);
  if (spot) head('Water from this spot flows into', name, `${spot.lat.toFixed(5)}° N, ${spot.lng.toFixed(5)}° E${spot.elev != null ? ` · ${n0(spot.elev)} m above sea level` : ''}`);
  else head('Lake', name, `${area(n.area)} of water · catchment ${area(n.catchment)}`);
  const roof = ctx.roof.lake_catchment?.[n.id] || {};
  const net = ctx.netStats?.[n.id];
  const chain = [`<li class="here">${esc(name)}</li>`,
    ...n.chain.map((c) => c.river ? `<li class="river">${esc(c.river)}<span>${dist(c.metres)}</span></li>`
      : `<li><button type="button" data-lake="${c.id}">${esc(lakeName(c.id))}</button><span>${dist(c.metres)}</span></li>`)];
  const body = $('panel-body');
  body.innerHTML = `
    <div class="sec">
      <p class="eyebrow">Where the water goes</p>
      <p class="lead">${n.up.length ? `<b>${n.up.length}</b> ${n.up.length === 1 ? 'lake drains' : 'lakes drain'} into it. ` : 'No other lake drains into it. '}
        ${n.river ? `Its water reaches the <b>${esc(n.river)}</b>${n.down.length ? ` through ${n.down.length} ${n.down.length === 1 ? 'lake' : 'lakes'}` : ''}.` : 'Its water does not reach a river in the data.'}</p>
      <ul class="flow">${chain.join('')}</ul>
      ${n.metres && n.outlet ? `<p class="note">${dist(n.metres)} along the flow path to the river.</p>` : ''}
    </div>
    <div class="sec" id="s-rain"></div>
    <div class="sec" id="s-harvest"></div>
    ${net ? `<div class="sec"><p class="eyebrow">With everything upstream</p><ul class="rows">
      ${row('Land draining here', area(net.network_catchment_area_m2))}${row('Rooftop area', area(net.network_roof_area_m2))}${row('Buildings', n0(net.network_buildings))}</ul>
      <p class="note">This lake's catchment and the catchments of all the lakes that drain into it.</p></div>` : ''}`;
  body.querySelectorAll('[data-lake]').forEach((b) => b.addEventListener('click', () => ctx.open(b.dataset.lake)));
  rainSection($('s-rain'), ctx.series, harvestSection($('s-harvest'), roof.total_roof_m2 || 0, roof.n_buildings || 0, 'lake'), 'lake');
  body.scrollTop = 0;
}

// ---- a spot that reaches a river without passing a lake, or outside the area ----
export function renderSpot(spot, cell) {
  const where = `${spot.lat.toFixed(5)}° N, ${spot.lng.toFixed(5)}° E`;
  const body = $('panel-body');
  if (!cell) {
    head('Spot', 'Outside the mapped area', where);
    body.innerHTML = '<div class="sec"><p class="lead">The atlas covers HMDA only.</p></div>';
    return;
  }
  head('Water from this spot flows to', cell.river ? `the ${cell.river}` : 'no lake or river found', `${where}${cell.elev != null ? ` · ${n0(cell.elev)} m above sea level` : ''}`);
  body.innerHTML = `<div class="sec"><p class="lead">${cell.river
    ? `It reaches the <b>${esc(cell.river)}</b>${cell.toRiver ? ` after ${dist(cell.toRiver)}` : ''} without passing through a lake.`
    : 'No lake or river was found downhill of this spot.'}</p></div>`;
}

function fmtTime(s) {
  const d = new Date(s);
  return isNaN(d) ? s : d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}
