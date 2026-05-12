# Index Pro

Index Pro is a browser-based PDF indexing tool. It lets you load PDF files,
detect pages, apply index stamps, preview results, and export a stamped PDF.

## Requirements

- Node.js 24
- pnpm 11

The repository declares the pnpm version in `package.json`, so Corepack-enabled
Node installs can use:

```sh
corepack enable
corepack prepare
```

## Run Locally

```sh
pnpm install
pnpm run dev
```

The app runs at:

```text
http://localhost:23735/
```

## Check And Build

```sh
pnpm run typecheck:pdf-indexer
pnpm run build:pdf-indexer
```

The production files are written to:

```text
artifacts/pdf-indexer/dist/public
```

## Publish On GitHub Pages

This repo includes `.github/workflows/deploy-pages.yml`.

1. Push the project to a GitHub repository.
2. In GitHub, open **Settings > Pages**.
3. Set **Build and deployment** to **GitHub Actions**.
4. Push to the `main` branch, or run the workflow manually.

The workflow installs dependencies, typechecks the PDF indexer, builds the app,
and publishes `artifacts/pdf-indexer/dist/public`.
# Index-Pro
# Index-Pro
