// Rain per catchment, from rain.json (each weighted TGDPS station's rain per 08:30 rain day; written on the
// observatory server every 15 minutes by live-feed/lakes_rain.py) and station_weights.json (Thiessen weights).
// A lake's day = Σ weight × station rain, a station without a reading counting as 0 (as on the old server).
// A day on which none of a lake's stations reported is left out. The day still running is left out.

let R = null, W = null, idx = null;

export function initRain(rain, weights) {
  R = rain; W = weights.lake_weights;
  idx = R.dates.length - (R.open ? 1 : 0);          // days before this index are complete
}

export const rainAsOf = () => R?.as_of || null;

export function lakeRain(id) {
  const w = W?.[id];
  if (!w) return [];
  const st = Object.entries(w).map(([s, wt]) => [R.st[s], wt]).filter(([v]) => v);
  const out = [];
  for (let i = 0; i < idx; i++) {
    let mm = 0, any = false;
    for (const [v, wt] of st) if (v[i] != null) { mm += wt * v[i]; any = true; }
    if (any) out.push({ date: R.dates[i], mm: Math.round(mm * 10) / 10 });
  }
  return out;
}

// HMDA: the average of the stations that reported that day (days with at least 50 of them)
export function hmdaRain() {
  const cols = Object.values(R.st);
  const out = [];
  for (let i = 0; i < idx; i++) {
    let sum = 0, n = 0;
    for (const v of cols) if (v[i] != null) { sum += v[i]; n++; }
    if (n >= 50) out.push({ date: R.dates[i], mm: Math.round((sum / n) * 10) / 10 });
  }
  return out;
}

export function stats(series) {
  const total = series.reduce((s, r) => s + r.mm, 0);
  let peak = null, dry = { n: 0 }, wet = { n: 0 }, spells = 0, curDry = 0, curWet = 0, dryStart, wetStart, prev = null;
  const day = (s) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / 864e5;
  for (const r of series) {
    if (prev != null && day(r.date) - prev > 1) {   // a day with no readings ends any spell: we don't know if it rained
      if (curDry > dry.n) dry = { n: curDry, from: dryStart };
      if (curWet > wet.n) wet = { n: curWet, from: wetStart };
      curDry = 0; curWet = 0;
    }
    prev = day(r.date);
    if (!peak || r.mm > peak.mm) peak = r;
    if (r.mm >= 2.5) {                               // a rainy day, as IMD counts it
      if (!curWet) { wetStart = r.date; spells++; }
      curWet++;
      if (curDry > dry.n) dry = { n: curDry, from: dryStart };
      curDry = 0;
    } else {
      if (!curDry) dryStart = r.date;
      curDry++;
      if (curWet > wet.n) wet = { n: curWet, from: wetStart };
      curWet = 0;
    }
  }
  if (curDry > dry.n) dry = { n: curDry, from: dryStart };
  if (curWet > wet.n) wet = { n: curWet, from: wetStart };
  const rainy = series.filter((r) => r.mm >= 2.5).length;
  let last = null;
  for (let i = series.length - 1; i >= 0; i--) if (series[i].mm >= 2.5) { last = series[i]; break; }
  return { days: series.length, total, peak: peak && peak.mm > 0 ? peak : null, dry, wet, spells, rainy, last };
}
