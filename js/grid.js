// Point click: which lake (or river) the water from a spot runs to. A precomputed grid over HMDA, cut into tiles
// (grid_lookup/tile_CC_RR.json); each cell: [lon, lat, elevation m, lake index, river index, distance to river m].
import { DATA_URL } from '../config.js';

let M = null;
const cache = new Map();

export async function initGrid() {
  const r = await fetch(`${DATA_URL}/grid_lookup/manifest.json`);
  if (!r.ok) throw new Error(`grid manifest ${r.status}`);
  M = await r.json();
}

function tile(c, r) {
  const key = `${c}_${r}`;
  if (cache.has(key)) return cache.get(key);
  const p = M.tiles.some((t) => t.col === c && t.row === r)
    ? fetch(`${DATA_URL}/grid_lookup/tile_${String(c).padStart(2, '0')}_${String(r).padStart(2, '0')}.json`).then((x) => (x.ok ? x.json() : null)).catch(() => null)
    : Promise.resolve(null);
  cache.set(key, p);
  return p;
}

export async function lookup(lon, lat) {
  if (!M) return null;
  const [w, s, e, n] = M.bbox;
  if (lon < w || lon > e || lat < s || lat > n) return null;
  const col = Math.min(M.grid_dim - 1, Math.floor((lon - w) / M.lon_step));
  const row = Math.min(M.grid_dim - 1, Math.floor((lat - s) / M.lat_step));
  let best = null, bestD = Infinity;
  for (let dc = -1; dc <= 1; dc++) for (let dr = -1; dr <= 1; dr++) {
    const c = col + dc, r = row + dr;
    if (c < 0 || r < 0 || c >= M.grid_dim || r >= M.grid_dim) continue;
    const t = await tile(c, r);
    for (const cell of t?.cells || []) {
      const d = (cell[0] - lon) ** 2 + (cell[1] - lat) ** 2;
      if (d < bestD) { bestD = d; best = cell; }
    }
  }
  if (!best) return null;
  return { elev: best[2], lake: best[3] != null ? M.lake_ids[best[3]] : null,
           river: best[4] != null ? M.river_names[best[4]] : null, toRiver: best[5] ?? null };
}
