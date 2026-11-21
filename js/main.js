// Lake Atlas: loads the data, builds the map, and wires clicks, the panel, the controls and the address.
import { DATA_URL, HMDA_EXTENT } from '../config.js';
import { createMap, highlight, clearHighlight, setPoint, setHover, baseChoices, setBase, setVisible, set3D, get3D, setExaggeration } from './map.js';
import { initNetwork, walk, lake, isHmdaLake, lakeCount, lakeName } from './network.js';
import { initRain, lakeRain, hmdaRain, rainAsOf } from './rain.js';
import { initGrid, lookup } from './grid.js';
import { renderOverview, renderLake, renderSpot } from './panel.js';
import { createPlaceSearch } from './place-search.js';

const $ = (id) => document.getElementById(id);
const phone = () => matchMedia('(max-width: 767px)').matches;
const loader = (t, pct) => { $('loader-text').textContent = t; $('loader-bar').firstElementChild.style.width = `${pct}%`; };
const json = (p, fallback) => fetch(`${DATA_URL}/${p}`).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${p}: ${r.status}`))))
  .catch((e) => { if (fallback !== undefined) { console.warn(e.message); return fallback; } throw e; });

let map, ctx;

async function main() {
  loader('Loading the network', 15);
  const [graph, boundary, weights, rain, roof, netStats, ovList] = await Promise.all([
    json('graph.json'), json('boundary.json'), json('station_weights.json'),
    json('rain.json', { dates: [], st: {}, open: 0 }), json('roof_area_by_catchment.json', { lake_catchment: {} }),
    json('network_stats_by_lake.json', {}), json('overlays/manifest.json', []),
  ]);
  initNetwork(graph);
  initRain(rain, weights);
  const overlays = (await Promise.all(ovList.map((o) => json(`overlays/${o.filename}`, null).then((data) => data && { ...o, data })))).filter(Boolean);

  // rivers the HMDA lakes end in, by number of lakes
  const rc = {};
  for (const rec of Object.values(graph.lakes)) if (rec.h && rec.tr) rc[rec.tr] = (rc[rec.tr] || 0) + 1;
  ctx = { roof, netStats, lakeCount: lakeCount(), rivers: Object.entries(rc).sort((a, b) => b[1] - a[1]), asOf: rainAsOf(), open: (id) => openLake(id) };

  loader('Drawing the map', 45);
  const sharedView = location.hash.includes('map=');      // a shared link with its own map position: keep it
  map = await createMap('map', boundary, overlays);
  loader('Almost there', 85);
  await initGrid().catch((e) => console.warn('grid:', e.message));

  wireMap();
  wireControls(overlays);
  wireBar();
  wireSearch();

  const q = new URLSearchParams(location.search);
  const id = q.get('lake'), pt = (q.get('pt') || '').split(',').map(Number);
  if (id && lake(id)) openLake(id, { fly: !sharedView });
  else if (pt.length === 2 && pt.every(Number.isFinite)) openSpot({ lng: pt[0], lat: pt[1] });
  else overview();

  $('loader').classList.add('done');
}

// ---------------- states ----------------
function overview(fit) {
  clearHighlight(map); setPoint(map, null);
  $('legend').classList.remove('has-sel');
  renderOverview({ ...ctx, series: hmdaRain() });
  setAddress({});
  if (fit) map.fitBounds([[HMDA_EXTENT[0], HMDA_EXTENT[1]], [HMDA_EXTENT[2], HMDA_EXTENT[3]]], { padding: 30, duration: 1600 });
}

function openLake(id, { spot, fly = true } = {}) {
  const n = walk(id);
  if (!n) return;
  highlight(map, n);
  $('legend').classList.add('has-sel');
  if (!spot) setPoint(map, null);
  renderLake(n, { ...ctx, series: lakeRain(id) }, spot);
  setAddress(spot ? { pt: spot } : { lake: id });
  if (fly && n.bbox) {
    const pad = phone() ? { top: 60, bottom: 30, left: 30, right: 30 } : { top: 70, bottom: 50, left: 120, right: 70 };
    map.fitBounds([[n.bbox[0], n.bbox[1]], [n.bbox[2], n.bbox[3]]], { padding: pad, maxZoom: 15, duration: 1600 });
  }
  openSheet();
}

async function openSpot(spot) {
  setPoint(map, [spot.lng, spot.lat]);
  const cell = await lookup(spot.lng, spot.lat);
  if (cell?.lake && lake(cell.lake)) { openLake(cell.lake, { spot: { ...spot, elev: cell.elev } }); return; }
  clearHighlight(map);
  $('legend').classList.remove('has-sel');
  renderSpot(spot, cell);
  setAddress({ pt: spot });
  openSheet();
}

function setAddress({ lake: id, pt }) {
  const u = new URL(location.href);
  u.searchParams.delete('lake'); u.searchParams.delete('pt');
  if (id) u.searchParams.set('lake', id);
  if (pt) u.searchParams.set('pt', `${pt.lng.toFixed(5)},${pt.lat.toFixed(5)}`);
  history.replaceState(null, '', u);
}

// ---------------- map ----------------
function wireMap() {
  const tip = $('map-tip'), wrap = $('map-wrap');
  const hitLake = (e) => {
    const t = get3D() ? 8 : 3;
    const f = map.queryRenderedFeatures([[e.point.x - t, e.point.y - t], [e.point.x + t, e.point.y + t]], { layers: ['lakes'] });
    return f.find((x) => isHmdaLake(x.properties.lake_id)) || null;
  };
  map.on('click', (e) => {
    closeMenus();
    const f = hitLake(e);
    if (f) openLake(f.properties.lake_id);
    else openSpot({ lng: e.lngLat.lng, lat: e.lngLat.lat });
  });
  map.on('mousemove', (e) => {
    const f = hitLake(e);
    wrap.classList.toggle('hover', !!f);
    setHover(map, f ? f.properties.lake_id : null);
    if (f) { tip.textContent = lakeName(f.properties.lake_id); tip.style.left = `${e.point.x}px`; tip.style.top = `${e.point.y}px`; tip.hidden = false; }
    else tip.hidden = true;
  });
  map.getCanvas().addEventListener('mouseleave', () => { tip.hidden = true; setHover(map, null); });
}

// ---------------- controls ----------------
function wireControls(overlays) {
  const btn = $('btn-layers'), card = $('layers');
  btn.addEventListener('click', (e) => { e.stopPropagation(); const open = card.hidden; closeMenus(); card.hidden = !open; btn.setAttribute('aria-expanded', String(open)); });
  card.addEventListener('click', (e) => e.stopPropagation());

  const seg = $('base-seg');
  const drawSeg = () => { seg.innerHTML = baseChoices().map((b) => `<button type="button" role="radio" data-b="${b.id}" aria-checked="${b.on}">${b.label}</button>`).join(''); };
  drawSeg();
  seg.addEventListener('click', (e) => { const b = e.target.dataset?.b; if (b) { setBase(map, b); drawSeg(); } });

  $('chk-streams').addEventListener('change', (e) => setVisible(map, ['streams-all'], e.target.checked));
  $('chk-catchments').addEventListener('change', (e) => setVisible(map, ['catch-all'], e.target.checked));

  $('overlay-list').innerHTML = overlays.map((o) => `<label class="chk"><input type="checkbox" data-ov="${o.kind}"> ${o.name}</label>`).join('');
  $('overlay-list').addEventListener('change', (e) => {
    const k = e.target.dataset?.ov; if (!k) return;
    // one outline set at a time
    $('overlay-list').querySelectorAll('input').forEach((i) => { if (i !== e.target) i.checked = false; });
    for (const o of overlays) setVisible(map, [`ov-${o.kind}`, `ov-${o.kind}-label`], o.kind === k && e.target.checked);
  });

  const c3 = $('chk-3d'), tc = $('terrain-ctl');
  c3.checked = get3D(); tc.hidden = !get3D();
  c3.addEventListener('change', () => { set3D(map, c3.checked, +$('r-exag').value); tc.hidden = !c3.checked; });
  $('r-exag').addEventListener('input', (e) => { $('v-exag').textContent = e.target.value; setExaggeration(map, +e.target.value); });
  $('r-pitch').addEventListener('input', (e) => { $('v-pitch').textContent = `${e.target.value}°`; map.setPitch(+e.target.value); });
  map.on('pitch', () => { const p = Math.round(map.getPitch()); $('r-pitch').value = p; $('v-pitch').textContent = `${p}°`; });
}

function wireBar() {
  const about = $('about'), ab = $('btn-about');
  const setAbout = (open) => { about.hidden = !open; ab.setAttribute('aria-expanded', String(open)); };
  ab.addEventListener('click', (e) => { e.stopPropagation(); closeMenus(); setAbout(about.hidden); });
  $('about-close').addEventListener('click', () => setAbout(false));
  about.addEventListener('click', (e) => { if (e.target === about) setAbout(false); });
  const reset = () => { closeMenus(); overview(true); };
  $('btn-reset').addEventListener('click', reset);
  $('brand-home').addEventListener('click', reset);

  const mb = $('btn-sitemenu'), menu = $('sitemenu');
  mb.addEventListener('click', (e) => { e.stopPropagation(); const open = menu.hidden; closeMenus(); menu.hidden = !open; mb.setAttribute('aria-expanded', String(open)); });
  document.addEventListener('click', closeMenus);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeMenus(); setAbout(false); } });

  const panel = $('panel'), h = $('sheet-handle');
  h.addEventListener('click', () => { const min = !panel.classList.contains('min'); panel.classList.toggle('min', min); h.setAttribute('aria-expanded', String(!min)); setTimeout(() => map.resize(), 260); });
}

function openSheet() {
  const panel = $('panel');
  if (panel.classList.contains('min')) { panel.classList.remove('min'); $('sheet-handle').setAttribute('aria-expanded', 'true'); setTimeout(() => map.resize(), 260); }
}

function closeMenus() {
  for (const [b, c] of [['btn-sitemenu', 'sitemenu'], ['btn-layers', 'layers']]) { $(c).hidden = true; $(b).setAttribute('aria-expanded', 'false'); }
  $('ps-results').hidden = true;
}

function wireSearch() {
  const input = $('ps-input'), res = $('ps-results');
  // lakes are searchable by number ("Lake 928" or "928")
  const lakes = Object.entries(walkable()).map(([id, bb]) => ({ name: lakeName(id), kind: 'lake', bbox: bb, id }));
  createPlaceSearch({
    input, results: res, getMap: () => map,
    local: () => (/\d/.test(input.value) ? lakes : []),
    onSelect: (p) => {                       // the module passes its own copy; a lake comes back as "Lake 928"
      res.hidden = true;
      const m = p?.kind === 'lake' && /(\d+)$/.exec(p.name);
      if (m) openLake(`lake_${m[1].padStart(5, '0')}`);
    },
  });
  input.addEventListener('focus', () => { res.hidden = false; });
  input.addEventListener('input', () => { res.hidden = !input.value; });
  input.addEventListener('click', (e) => e.stopPropagation());
  res.addEventListener('click', (e) => e.stopPropagation());
}

function walkable() {
  const out = {};
  for (const id of Object.keys(ctx.netStats || {})) { const r = lake(id); if (r?.h && r.bb) out[id] = r.bb; }
  return out;
}

main().catch((e) => { console.error(e); $('loader-text').textContent = `Could not load the atlas: ${e.message}`; });
