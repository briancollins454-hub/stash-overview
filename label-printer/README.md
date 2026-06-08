# Label Printer

Thermal label tool for Deco job lookup, box packing, and PDF export.

## How it works

Job lookup goes through the Stash Overview API proxy (`/api/label-printer`), which calls Deco server-side. Credentials never ship to the browser.

## Hosted URLs

- **Production:** https://www.stashoverview.co.uk/label-printer/
- **AI Studio:** point `VITE_LABEL_PRINTER_API` at `https://www.stashoverview.co.uk/api/label-printer`

## Local development

```bash
cd label-printer
npm install
npm run dev
```

Optional `.env.local`:

```
VITE_LABEL_PRINTER_API=/api/label-printer
```

Run the main Stash server (`npm run dev` from repo root) so the Vite proxy can reach the API.

## Build for production

```bash
cd label-printer
npm install
npm run build
```

Output lands in `public/label-printer/` and is served by Vercel at `/label-printer/`.
