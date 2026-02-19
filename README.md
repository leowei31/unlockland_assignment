# UnlockLand Vancouver Parcel Analysis

This is my implementation of the UnlockLand assignment.

## What I Built

1. Parcel map centered on downtown Vancouver with polygon rendering.
2. Parcel selection from map click with highlight and fly-to.
3. Address search with autocomplete, debounce, keyboard nav, and Enter/Esc support.
4. Search history shown when input is focused and empty, with clear-history support.
5. Parcel info card with:
   - full address
   - area (`m^2`)
   - primary street
   - lot type
6. Edge visualization (`Frontage`, `Flankage`, `Rear Lane`, `Rear`, `Side`).
7. Debug mode panel with per-edge diagnostics and classification reasoning.

## Stack

1. React 19 + TypeScript (strict mode)
2. Vite
3. Mapbox GL JS
4. Turf.js
5. Tailwind CSS v4 via `@tailwindcss/vite`

## How To Run

### Local

1. Install dependencies:
   - `npm install`
2. Create `.env` and set:
   - `VITE_MAPBOX_ACCESS_TOKEN=...`
3. Fetch parcel data:
   - This will take a while to download
   - `npm run data:fetch`
4. Start dev server:
   - `npm run dev`
5. Open:
   - `http://localhost:5173`

### Quick Verification

1. Lint:
   - `npm run lint`
2. Production build:
   - `npm run build`

### Docker

1. Build:
   - `docker build -t unlockland-assignment .`
2. Run:
   - `docker run --rm -it -p 5173:5173 -e VITE_MAPBOX_ACCESS_TOKEN=your_token unlockland-assignment`

The container entrypoint runs `npm run data:fetch` before starting the app.

### Docker Compose

1. Build + run:
   - `docker compose up --build`
2. Stop:
   - `docker compose down`
3. During startup, `data:fetch` prints download and normalization progress in container logs.

## Data Flow

1. Dataset source: Vancouver Open Data parcel polygons (GeoJSON export endpoint).
2. `scripts/fetch-parcels.mjs` normalizes and writes:
   - `public/data/parcels.geojson`
   - `public/data/search-index.json`
3. These files are generated and ignored in Git/Docker context.

## Classification Approach

I classify lot edges using parcel geometry + nearby rendered Mapbox vector line features:

1. Build edge segments from each parcel polygon ring.
2. Query nearby line features and score candidates by:
   - distance from edge midpoint to centerline
   - orientation similarity (edge vs line segment)
3. Assign edge types:
   - `Frontage`: best street-facing edge (prefer matching primary street name)
   - `Flankage`: additional street-facing edge on a different street
   - `Rear Lane`: opposite side if lane-adjacent
   - `Rear`: opposite side when no lane is adjacent
   - `Side`: remaining edges
4. Lot type priority:
   - `Corner Lot` > `Double Fronting` > `Standard with Lane` > `Standard without Lane`
5. Known classification edge case:
   - In some parcels near intersections, a side edge can be close enough to a secondary street centerline to be treated as `Flankage`.
   - Because `Corner Lot` has higher priority than `Standard with Lane`, those parcels may be labeled `Corner Lot` even when a rear lane is present.
   - This is a known tradeoff of the current midpoint-distance + orientation heuristic.

## Performance Decisions

1. Keep full data in memory for search and selection.
2. Only render parcels in/near viewport using a spatial index.
3. Cap rendered parcel count by zoom level.
4. Always include selected parcel in the rendered set.

## Project Guide

1. `src/App.tsx`: top-level composition and interaction wiring.
2. `src/features/map/ParcelMap.tsx`: map lifecycle, layers, and parcel click interaction.
3. `src/features/search/SearchBar.tsx`: search/autocomplete UI behavior.
4. `src/features/parcels/InfoCard.tsx`: selected parcel summary.
5. `src/features/debug/DebugPanel.tsx`: debugging output for edge classification.
6. `src/hooks/`: data loading, rendering strategy, selection, history, debounce, theme.
7. `src/lib/geo/parcelAnalysis.ts`: lot edge and lot type heuristics.

## Known MVP Limitations

1. Classification is heuristic and can be wrong for complex/irregular parcels.
2. Road/lane detection quality depends on currently rendered Mapbox vector features.
3. No automated test suite yet.

## Useful Scripts

1. `npm run dev`
2. `npm run lint`
3. `npm run build`
4. `npm run data:fetch`
5. `npm run preview`
