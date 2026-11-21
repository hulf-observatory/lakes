# Lake Atlas — Hyderabad

Where each lake's water comes from, where it goes, and how much rain fell on its catchment. Live at
**https://hyderabad.urbanobservatory.in/lakes/** (GitHub Pages, deploy = push to `main`). The old address
`lakeatlas.hyderabad.urbanobservatory.in` is held by the redirect repo `to-lakeatlas`.

Fully static, no build step, no database. Restyled to the observatory design system (`observatory-work/DESIGN-SYSTEM.md`).

## Where things live

| Piece | Where |
|---|---|
| App (this repo) | `index.html`, `config.js`, `css/`, `js/`, `vendor/` (MapLibre 5, PMTiles, Lato, Outfit) |
| Data, ~35 MB | obs-mumbai `/srv/obs/www/lakes/` → `https://api.urbanobservatory.in/lakes/` |
| Data build | `observatory-work/lakes/build.py` (README there) |
| Rain, every 15 min | `live-feed/lakes_rain.py` → `/srv/obs/www/lakes/rain.json` |
| nginx for the data | `observatory-work/server/api/nginx-obs-api.conf`, `location /lakes/` |

`config.js` → `DATA_URL` is the server on the live site and `/_data` on localhost.

## How a click works

- **Lake:** `js/network.js` walks `graph.json` (each lake's one step downstream) to find the lakes upstream and the
  chain down to the river; `js/map.js` highlights them by filtering the layers of `lakes.pmtiles` on those lake ids
  (catchments, streams, paths, lakes). `js/rain.js` adds up `rain.json` with the Thiessen weights.
- **Anywhere else:** `js/grid.js` finds the nearest cell of the precomputed grid, which names the lake (or river)
  downhill.
- `?lake=lake_00929` opens a lake, `?pt=lng,lat` a spot; `#map=zoom/lat/lng` keeps the view.

`js/place-search.js` is a fourth copy of the shared place search (maps viewer, City Timeline, Accessibility Atlas);
keep it identical to the others.

## Local

```bash
python3 dev-server.py            # http://127.0.0.1:8127/, launch entry `lakes`
node check/check.mjs --url http://127.0.0.1:8127/ --shots /tmp/lakes-shots
```

`dev-server.py` serves `observatory-data/lake/output/lakes/` at `/_data/`; rain falls back to
`observatory-data/lake/working/rain-dev.json` (Feb–Oct 2026).

## History

Built in 2026 and run by Amruth Kiran on his server until Nov 2026, from `amruthkiran94/hyderabad-urban-observatory`
(`lake atlas/`), with an Express API over PostGIS. This repo answers the same questions from files. Rain is now
counted per 08:30–08:30 rain day; the old API took each calendar day's highest running total, which counted most
rain on two days (Lake 929, Aug 2026: 271.9 mm there, 160.8 mm here). Analytics moved from Umami to the
observatory's visit counter (`visits.js`, no cookies, no IPs). Address search moved from Nominatim (whose policy
forbids search-as-you-type) to the shared Photon place search.
