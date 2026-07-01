// The site-themed MapLibre vector style (near-black land, lighter teal sea,
// faint borders, quiet dim labels). Shared by the interactive maps (PhotoMap)
// and the lightbox inset map so the palette lives in one place. Returns null
// without a key (callers then show a notice / hide the map).
export function buildStyle(key) {
  if (!key) return null;
  const name = ['coalesce', ['get', 'name:en'], ['get', 'name']];
  return {
    version: 8,
    glyphs: `https://api.maptiler.com/fonts/{fontstack}/{range}.pbf?key=${key}`,
    sources: { omt: { type: 'vector', url: `https://api.maptiler.com/tiles/v3/tiles.json?key=${key}` } },
    layers: [
      { id: 'land', type: 'background', paint: { 'background-color': '#06121a' } },
      {
        id: 'water',
        type: 'fill',
        source: 'omt',
        'source-layer': 'water',
        paint: { 'fill-color': '#0e2a37', 'fill-outline-color': '#173d44' },
      },
      {
        id: 'boundary',
        type: 'line',
        source: 'omt',
        'source-layer': 'boundary',
        filter: ['<=', ['to-number', ['get', 'admin_level']], 4],
        paint: { 'line-color': '#1c3a49', 'line-width': 0.6, 'line-dasharray': [2, 2], 'line-opacity': 0.8 },
      },
      {
        id: 'place-country',
        type: 'symbol',
        source: 'omt',
        'source-layer': 'place',
        filter: ['==', ['get', 'class'], 'country'],
        layout: {
          'text-field': name,
          'text-font': ['Noto Sans Regular'],
          'text-size': 11,
          'text-transform': 'uppercase',
          'text-letter-spacing': 0.18,
          'text-max-width': 6,
        },
        paint: { 'text-color': '#6f8a96', 'text-halo-color': '#06121a', 'text-halo-width': 1.2 },
      },
      {
        id: 'place-locality',
        type: 'symbol',
        source: 'omt',
        'source-layer': 'place',
        minzoom: 4,
        filter: ['match', ['get', 'class'], ['city', 'town', 'village'], true, false],
        layout: { 'text-field': name, 'text-font': ['Noto Sans Regular'], 'text-size': 11, 'text-max-width': 7 },
        paint: { 'text-color': '#93abb6', 'text-halo-color': '#06121a', 'text-halo-width': 1.2 },
      },
    ],
  };
}
