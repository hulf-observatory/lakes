// The drainage network (graph.json), walked in the browser. Every lake has at most one step downstream:
//   d = [next lake id, metres]  or  ["river:<name>", metres, confluence lon, lat]
// plus a = lake area m², ca = catchment area m², bb = catchment bounding box, dr = distance to the river (m),
// tr = the river it ends in, h = 1 for lakes inside HMDA. Same answers as the old /api/graph on Amruth's server.

let G = null, UP = null;

export function initNetwork(graph) {
  G = graph.lakes;
  UP = new Map();
  for (const [id, rec] of Object.entries(G)) {
    const t = rec.d && rec.d[0];
    if (t && !t.startsWith('river:')) {
      if (!UP.has(t)) UP.set(t, []);
      UP.get(t).push(id);
    }
  }
}

export const lake = (id) => G?.[id] || null;
export const isHmdaLake = (id) => !!G?.[id]?.h;
export const lakeCount = () => Object.values(G).filter((r) => r.h).length;
// HMDA lakes with a bounding box, for the search: {id: bbox}
export const hmdaLakes = () => Object.fromEntries(Object.entries(G).filter(([, r]) => r.h && r.bb).map(([id, r]) => [id, r.bb]));

// "lake_00928" → "Lake 928" (the lakes have no names in the source data)
export const lakeName = (id) => { const m = /_(\d+)$/.exec(id || ''); return m ? `Lake ${parseInt(m[1], 10)}` : id; };

export function walk(id) {
  const rec = G[id];
  if (!rec) return null;
  // upstream: every lake whose water reaches this one
  const up = [], seen = new Set([id]), stack = [...(UP.get(id) || [])];
  while (stack.length) {
    const x = stack.pop();
    if (seen.has(x)) continue;
    seen.add(x); up.push(x);
    stack.push(...(UP.get(x) || []));
  }
  // downstream: the chain of lakes to the river
  const down = [], chain = [];
  let x = id, metres = 0, outlet = null, river = rec.tr || null;
  const guard = new Set([id]);
  while (G[x]?.d) {
    const [t, m, lon, lat] = G[x].d;
    metres += m || 0;
    if (t.startsWith('river:')) {
      river = t.slice(6);
      if (lon != null && lat != null) outlet = { lon, lat, river };
      chain.push({ river, metres });
      break;
    }
    if (guard.has(t)) break;                       // a loop in the data: stop rather than spin
    guard.add(t); down.push(t); chain.push({ id: t, metres });
    x = t;
  }
  return { id, up, down, chain, outlet, river, metres, toRiver: rec.dr ?? null, area: rec.a || 0, catchment: rec.ca || 0, bbox: rec.bb || null };
}
