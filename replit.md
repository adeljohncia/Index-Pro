# Index Pro

A PDF document indexing system that stamps index codes (e.g. `<A1>`, `<A1-1>`, `<A1-1-1>`) onto scanned PDF pages. Fully responsive across desktop, tablet, and mobile.

## Run & Operate

- `pnpm --filter @workspace/pdf-indexer run dev` — run the web app (port 23735, preview path `/`)
- `pnpm --filter @workspace/pdf-indexer run typecheck` — typecheck the app
- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080, preview path `/api`)

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- React + Vite + Tailwind CSS v4 + shadcn/ui
- pdfjs-dist (PDF parsing + thumbnails), pdf-lib (PDF stamping + page edits)
- tesseract.js (OCR for scanned pages)
- wouter (routing)

## Where things live

```
artifacts/pdf-indexer/src/
  pages/
    indexer-home.tsx      — main shell: responsive sidebar/bottom-nav, tab routing, shared state
    tab-dashboard.tsx     — Dashboard tab (stats, quick actions, workflow guide)
    tab-pdf-editor.tsx    — PDF Editor tab (page thumbnails, rotate, delete, OCR, text extract)
    tab-index-editor.tsx  — Index Editor tab (stamp settings, format levels, page analysis table)
    tab-export.tsx        — Export Hub tab (apply stamps, download, print template)
  lib/
    pdf-utils.ts          — all PDF logic: analyze, thumbnail, stamp, OCR, text extract
```

## Architecture decisions

- All 4 tabs share a single state tree in `IndexerHome` (entries, settings, overrides) — avoids complex context/stores.
- Responsive layout: fixed sidebar (lg+, collapsible), bottom navigation bar (< lg).
- OCR uses tesseract.js dynamically imported — not in initial bundle, loaded on first OCR call.
- Format levels (level1/level2/level3) are independent booleans, not an enum — supports all 7 non-empty combinations.
- Page analysis (blank detection) uses pixel stddev on a low-res canvas render; threshold = 5.

## Product

- **Dashboard** — overview stats and quick navigation
- **PDF Editor** — view page thumbnails, rotate pages visually, mark pages for deletion, extract embedded text (pdfjs), run OCR (tesseract.js) on scanned pages
- **Index Editor** — configure stamp prefix, start number, three independent format levels (`<A1>`, `<A1-1>`, `<A1-1-1>`), margins, typography; live preview of codes; per-page override editing
- **Export Hub** — review full configuration, download stamped PDF, generate print overlay template

## User preferences

- App name: Index Pro (not "Index Stamper")
- Tab names: Dashboard / PDF Editor / Index Editor / Export Hub
- Fully responsive — mobile-first, works on all iPhone and Android screen sizes

## Gotchas

- Tesseract.js downloads language data (~7 MB) on first OCR call — show a progress indicator.
- `pdfjs-dist` worker must be resolved via `new URL(..., import.meta.url)` for Vite compatibility.
- Always run `pnpm --filter @workspace/pdf-indexer run typecheck` before publishing.
