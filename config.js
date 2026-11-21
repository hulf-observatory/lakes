// Lake Atlas configuration.
// DATA_URL: the folder holding lakes.pmtiles, graph.json, rain.json and the rest (observatory-work/lakes/README.md).
// Live: the observatory server (obs-mumbai /srv/obs/www/lakes/). Local (dev-server.py): the same layout at /_data.
const LOCAL = ["localhost", "127.0.0.1"].includes(location.hostname);
export const DATA_URL = LOCAL ? `${location.origin}/_data` : "https://api.urbanobservatory.in/lakes";

// Basemap: OpenFreeMap Positron (free, no key). Our layers go under its labels. If the style cannot be fetched the
// OpenStreetMap raster is the base instead.
export const BASEMAP_STYLE = "https://tiles.openfreemap.org/styles/positron";
export const LABEL_FONT = ["Noto Sans Regular"];
export const BASES = {
  light: { label: "Light", style: true },
  streets: { label: "Streets", tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"], maxzoom: 19,
             attribution: "© OpenStreetMap contributors" },
  satellite: { label: "Satellite", tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
               maxzoom: 19, attribution: "Imagery © Esri" },
};

// Terrain for the hillshade and the 3D view (Mapzen terrain tiles on AWS Open Data, no key)
export const TERRAIN = { tiles: ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"],
                         encoding: "terrarium", maxzoom: 15 };
export const EXAGGERATION = 3;

// Zoom and pan limits: Telangana, as in the other observatory map apps
export const MIN_ZOOM = 9;
export const MAX_ZOOM = 18;
export const MAX_BOUNDS = [[77.1, 15.7], [81.5, 20.05]];
export const HMDA_EXTENT = [78.0045, 16.9652, 79.0502, 17.8967];

// Rooftop harvest: share of the rain on a roof that can be collected (losses to evaporation and splash)
export const RUNOFF = 0.8;
