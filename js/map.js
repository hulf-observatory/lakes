// The map: OpenFreeMap Positron as the base, our layers from lakes.pmtiles slotted under its labels, hillshade,
// the outside-HMDA mask, and the highlight layers a lake click drives (all filters on the same tiles, no fetching).
import { DATA_URL, BASEMAP_STYLE, LABEL_FONT, BASES, TERRAIN, EXAGGERATION, MIN_ZOOM, MAX_ZOOM, MAX_BOUNDS } from '../config.js';

const ml = window.maplibregl;
const protocol = new window.pmtiles.Protocol();
ml.addProtocol('pmtiles', protocol.tile);

const C = { w2: '#B7CDE4', w3: '#7FA6CE', w4: '#3F76B0', w5: '#123F70', ink: '#111827', outlet: '#D9772B', grey: '#6B7280' };
const NONE = ['==', ['get', 'lake_id'], '__none__'];
const NONE_L = ['==', ['get', 'lake'], '__none__'];

let vectorIds = [], rasterIds = [], labelAnchor, font = LABEL_FONT, base = 'light';
let is3D = false;

const tryLS = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch { return null; } };

async function fetchStyle() {
  try {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 6000);
    const r = await fetch(BASEMAP_STYLE, { signal: ctl.signal }); clearTimeout(t);
    return r.ok ? await r.json() : null;
  } catch { return null; }
}

function buildStyle(vec) {
  const sources = {}, under = [], labels = [], rasters = [];
  if (vec) {
    Object.assign(sources, vec.sources);
    const cut = vec.layers.findIndex((l) => l.type === 'symbol');
    under.push(...(cut < 0 ? vec.layers : vec.layers.slice(0, cut)));
    labels.push(...(cut < 0 ? [] : vec.layers.slice(cut)));
    vectorIds = vec.layers.map((l) => l.id);
    labelAnchor = cut < 0 ? undefined : vec.layers[cut].id;
  } else {
    font = null;
  }
  for (const [id, d] of Object.entries(BASES)) {
    if (d.style) continue;
    rasterIds.push(id);
    sources[id] = { type: 'raster', tiles: d.tiles, tileSize: 256, maxzoom: d.maxzoom, attribution: d.attribution };
    rasters.push({ id, type: 'raster', source: id, layout: { visibility: 'none' } });
  }
  const saved = tryLS('lakes-base');
  base = saved && BASES[saved] && (!BASES[saved].style || vec) ? saved : vec ? 'light' : 'streets';
  for (const l of [...under, ...labels]) l.layout = { ...(l.layout || {}), visibility: base === 'light' ? 'visible' : 'none' };
  for (const l of rasters) l.layout = { visibility: l.id === base ? 'visible' : 'none' };
  sources.dem = { type: 'raster-dem', tiles: TERRAIN.tiles, encoding: TERRAIN.encoding, tileSize: 256, maxzoom: TERRAIN.maxzoom,
                  attribution: 'Terrain: Mapzen, AWS Open Data' };
  sources.lk = { type: 'vector', url: `pmtiles://${DATA_URL}/lakes.pmtiles`,
                 attribution: 'Lakes: FABDEM derivation, TGRAC · Hyderabad Urban Observatory' };
  const hillshade = { id: 'hillshade', type: 'hillshade', source: 'dem',
    paint: { 'hillshade-shadow-color': '#4B5563', 'hillshade-highlight-color': '#FFFFFF', 'hillshade-accent-color': '#6B7280', 'hillshade-exaggeration': 0.3 } };
  return {
    version: 8,
    glyphs: vec?.glyphs || 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
    ...(vec?.sprite ? { sprite: vec.sprite } : {}),
    sources, layers: [...under, ...rasters, hillshade, ...labels],
  };
}

export async function createMap(container, boundary, overlays) {
  const vec = await fetchStyle();
  const map = new ml.Map({
    container, style: buildStyle(vec), bounds: [[78.0045, 16.9652], [79.0502, 17.8967]], fitBoundsOptions: { padding: 30 },
    minZoom: MIN_ZOOM, maxZoom: MAX_ZOOM, maxBounds: MAX_BOUNDS, maxPitch: 85, hash: 'map',
    attributionControl: false, dragRotate: true, cooperativeGestures: false,
  });
  window.__lakesMap = map;   // for the headless check (check/check.mjs)
  map.addControl(new ml.AttributionControl({ compact: true }), 'bottom-right');
  map.addControl(new ml.NavigationControl({ visualizePitch: true }), 'top-right');
  map.addControl(new ml.GeolocateControl({ positionOptions: { enableHighAccuracy: true } }), 'top-right');
  map.addControl(new ml.ScaleControl({ maxWidth: 110, unit: 'metric' }), 'bottom-right');
  // the style is inline, so layers can go in once it is parsed; 'load' waits for a first frame, which a background tab never draws
  await new Promise((r) => (map.isStyleLoaded() ? r() : map.once('style.load', r)));
  addLayers(map, boundary, overlays);
  // the credits start folded (MapLibre opens them on load); the ⓘ button opens them
  const fold = () => map.getContainer().querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show');
  fold(); map.once('load', fold); map.once('idle', fold);
  if (tryLS('lakes-3d') === '1') set3D(map, true);
  return map;
}

function arrowImage() {
  const s = 24, c = document.createElement('canvas'); c.width = c.height = s;
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.strokeStyle = '#fff'; g.lineWidth = 4; g.lineJoin = 'round';
  const tri = () => { g.beginPath(); g.moveTo(5, 5); g.lineTo(19, 12); g.lineTo(5, 19); g.closePath(); };
  tri(); g.stroke(); g.fillStyle = '#111827'; tri(); g.fill();
  return g.getImageData(0, 0, s, s);
}

function addLayers(map, boundary, overlays) {
  const add = (l) => map.addLayer(l, labelAnchor);
  const fc = (f) => ({ type: 'FeatureCollection', features: f });
  // outside HMDA greyed: the world with HMDA as a hole
  const holes = boundary.geometry.type === 'Polygon' ? [boundary.geometry.coordinates] : boundary.geometry.coordinates;
  map.addSource('mask', { type: 'geojson', data: fc([{ type: 'Feature', properties: {},
    geometry: { type: 'Polygon', coordinates: [[[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]], ...holes.map((p) => p[0])] } }]) });
  map.addSource('boundary', { type: 'geojson', data: boundary });
  map.addSource('outlet', { type: 'geojson', data: fc([]) });
  map.addSource('point', { type: 'geojson', data: fc([]) });
  map.addImage('lk-arrow', arrowImage(), { pixelRatio: 2 });

  add({ id: 'mask', type: 'fill', source: 'mask', paint: { 'fill-color': '#FFFFFF', 'fill-opacity': 0.78 } });

  // catchments: all outlines (off by default), upstream catchments, the selected one
  add({ id: 'catch-all', type: 'line', source: 'lk', 'source-layer': 'catchments', layout: { visibility: 'none' },
    paint: { 'line-color': C.grey, 'line-width': 0.6, 'line-opacity': 0.5 } });
  add({ id: 'catch-up-fill', type: 'fill', source: 'lk', 'source-layer': 'catchments', filter: NONE,
    paint: { 'fill-color': C.w3, 'fill-opacity': 0.12 } });
  add({ id: 'catch-up-line', type: 'line', source: 'lk', 'source-layer': 'catchments', filter: NONE,
    paint: { 'line-color': C.w3, 'line-width': 0.8, 'line-dasharray': [3, 2] } });
  add({ id: 'catch-sel-fill', type: 'fill', source: 'lk', 'source-layer': 'catchments', filter: NONE,
    paint: { 'fill-color': '#185FA5', 'fill-opacity': 0.10 } });
  add({ id: 'catch-sel-line', type: 'line', source: 'lk', 'source-layer': 'catchments', filter: NONE,
    paint: { 'line-color': C.ink, 'line-width': 1.4, 'line-dasharray': [3, 2] } });

  // streams: all (off by default) and those of the selected network
  const sw = ['interpolate', ['linear'], ['get', 'order'], 1, 0.4, 3, 1, 5, 1.8, 7, 2.6];
  add({ id: 'streams-all', type: 'line', source: 'lk', 'source-layer': 'streams', layout: { visibility: 'none', 'line-cap': 'round' },
    paint: { 'line-color': C.w4, 'line-width': sw, 'line-opacity': 0.6 } });
  add({ id: 'streams-sel', type: 'line', source: 'lk', 'source-layer': 'streams', filter: NONE_L, layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': C.w4, 'line-width': sw, 'line-opacity': 0.75 } });

  // rivers and lakes
  add({ id: 'rivers', type: 'fill', source: 'lk', 'source-layer': 'rivers', paint: { 'fill-color': C.w5, 'fill-opacity': 0.75 } });
  add({ id: 'lakes', type: 'fill', source: 'lk', 'source-layer': 'lakes', paint: { 'fill-color': C.w4, 'fill-opacity': 0.7 } });
  add({ id: 'lakes-line', type: 'line', source: 'lk', 'source-layer': 'lakes', paint: { 'line-color': C.w5, 'line-width': 0.5, 'line-opacity': 0.6 } });
  add({ id: 'lakes-hover', type: 'line', source: 'lk', 'source-layer': 'lakes', filter: NONE, paint: { 'line-color': C.ink, 'line-width': 1.5 } });

  // the network: paths leaving each upstream lake, and the chain down to the river
  const lw = ['interpolate', ['linear'], ['zoom'], 9, 1.6, 13, 3, 16, 4.5];
  add({ id: 'path-up', type: 'line', source: 'lk', 'source-layer': 'paths', filter: NONE_L, layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': C.w3, 'line-width': lw } });
  add({ id: 'path-down', type: 'line', source: 'lk', 'source-layer': 'paths', filter: NONE_L, layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': C.w5, 'line-width': lw } });
  add({ id: 'path-arrows', type: 'symbol', source: 'lk', 'source-layer': 'paths', filter: NONE_L,
    layout: { 'symbol-placement': 'line', 'symbol-spacing': 90, 'icon-image': 'lk-arrow', 'icon-size': ['interpolate', ['linear'], ['zoom'], 10, 0.7, 15, 1],
              'icon-allow-overlap': true, 'icon-rotation-alignment': 'map' } });
  add({ id: 'lakes-up', type: 'line', source: 'lk', 'source-layer': 'lakes', filter: NONE, paint: { 'line-color': C.w3, 'line-width': 2.5 } });
  add({ id: 'lakes-down', type: 'line', source: 'lk', 'source-layer': 'lakes', filter: NONE, paint: { 'line-color': C.w5, 'line-width': 2.5 } });
  add({ id: 'lake-sel', type: 'line', source: 'lk', 'source-layer': 'lakes', filter: NONE, paint: { 'line-color': C.ink, 'line-width': 2.5 } });

  add({ id: 'boundary', type: 'line', source: 'boundary', paint: { 'line-color': C.ink, 'line-width': 1.2, 'line-dasharray': [4, 2], 'line-opacity': 0.7 } });

  // ward / circle / corporation outlines (one at a time)
  for (const o of overlays) {
    map.addSource(`ov-${o.kind}`, { type: 'geojson', data: o.data });
    add({ id: `ov-${o.kind}`, type: 'line', source: `ov-${o.kind}`, layout: { visibility: 'none' },
      paint: { 'line-color': C.grey, 'line-width': 1, 'line-dasharray': [4, 2], 'line-opacity': 0.8 } });
    const field = { ward: ['concat', 'Ward ', ['to-string', ['get', 'Ward_No']]], circle: ['get', 'Circle'], corporation: ['get', 'Corporation'] }[o.kind];
    if (field && font) add({ id: `ov-${o.kind}-label`, type: 'symbol', source: `ov-${o.kind}`, layout: { visibility: 'none',
      'text-field': field, 'text-font': font, 'text-size': 11, 'text-allow-overlap': false },
      paint: { 'text-color': C.grey, 'text-halo-color': '#fff', 'text-halo-width': 1.5 } });
  }

  // markers on top
  add({ id: 'outlet', type: 'circle', source: 'outlet', paint: { 'circle-color': C.outlet, 'circle-radius': 6, 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 } });
  add({ id: 'point', type: 'circle', source: 'point', paint: { 'circle-color': C.ink, 'circle-radius': 6, 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 } });
  if (font) map.addLayer({ id: 'river-names', type: 'symbol', source: 'lk', 'source-layer': 'rivers', minzoom: 10,
    layout: { 'text-field': ['get', 'name'], 'text-font': font, 'text-size': ['interpolate', ['linear'], ['zoom'], 10, 10, 14, 13] },
    paint: { 'text-color': C.w5, 'text-halo-color': '#fff', 'text-halo-width': 1.6 } });
}

// ---- highlight a lake's network (ids from network.js) ----
const inList = (key, ids) => (ids.length ? ['in', ['get', key], ['literal', ids]] : NONE);
export function highlight(map, n) {
  map.setFilter('lake-sel', ['==', ['get', 'lake_id'], n.id]);
  map.setFilter('catch-sel-fill', ['==', ['get', 'lake_id'], n.id]);
  map.setFilter('catch-sel-line', ['==', ['get', 'lake_id'], n.id]);
  map.setFilter('catch-up-fill', inList('lake_id', n.up));
  map.setFilter('catch-up-line', inList('lake_id', n.up));
  map.setFilter('streams-sel', inList('lake', [n.id, ...n.up]));
  map.setFilter('lakes-up', inList('lake_id', n.up));
  map.setFilter('lakes-down', inList('lake_id', n.down));
  map.setFilter('path-up', n.up.length ? ['in', ['get', 'lake'], ['literal', n.up]] : NONE_L);
  map.setFilter('path-down', ['in', ['get', 'lake'], ['literal', [n.id, ...n.down]]]);
  map.setFilter('path-arrows', ['in', ['get', 'lake'], ['literal', [n.id, ...n.down, ...n.up]]]);
  map.getSource('outlet').setData({ type: 'FeatureCollection', features: n.outlet ? [{ type: 'Feature', properties: {},
    geometry: { type: 'Point', coordinates: [n.outlet.lon, n.outlet.lat] } }] : [] });
}

export function clearHighlight(map) {
  for (const id of ['lake-sel', 'catch-sel-fill', 'catch-sel-line', 'catch-up-fill', 'catch-up-line', 'lakes-up', 'lakes-down']) map.setFilter(id, NONE);
  for (const id of ['streams-sel', 'path-up', 'path-down', 'path-arrows']) map.setFilter(id, NONE_L);
  map.getSource('outlet').setData({ type: 'FeatureCollection', features: [] });
}

export function setPoint(map, lngLat) {
  map.getSource('point').setData({ type: 'FeatureCollection', features: lngLat ? [{ type: 'Feature', properties: {},
    geometry: { type: 'Point', coordinates: lngLat } }] : [] });
}

export function setHover(map, id) { map.setFilter('lakes-hover', id ? ['==', ['get', 'lake_id'], id] : NONE); }

// ---- base map, layers, 3D ----
export function baseChoices() {
  return Object.entries(BASES).filter(([, d]) => !d.style || vectorIds.length).map(([id, d]) => ({ id, label: d.label, on: id === base }));
}
export function setBase(map, id) {
  const vis = (l, on) => map.getLayer(l) && map.setLayoutProperty(l, 'visibility', on ? 'visible' : 'none');
  for (const l of vectorIds) vis(l, id === 'light');
  for (const l of rasterIds) vis(l, l === id);
  base = id; tryLS('lakes-base', id);
}
export function setVisible(map, ids, on) {
  for (const id of ids) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
}
export function set3D(map, on, exag = EXAGGERATION) {
  is3D = on;
  map.setTerrain(on ? { source: 'dem', exaggeration: exag } : null);
  map.easeTo({ pitch: on ? 60 : 0, bearing: on ? map.getBearing() : 0, duration: 800 });
  tryLS('lakes-3d', on ? '1' : '0');
}
export const get3D = () => is3D;
export function setExaggeration(map, v) { if (is3D) map.setTerrain({ source: 'dem', exaggeration: v }); }
