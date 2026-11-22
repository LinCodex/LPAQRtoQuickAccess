# EZRefill 椰子通讯 — Storefront & eSIM Quick Access

Storefront website, interactive 3D phone catalog, prepaid plan explorer, and eSIM LPA activation tools for **EZRefill** (136-78 Roosevelt Ave, Flushing, NY).

## Routes & Features

- `/` — Storefront landing page with scroll-driven product sequences, prepaid plan explorer (`config/store.json`), AirPods 4 showcase, and store essentials.
- `/phones` — New iPhone collection with multi-angle hover previews and an interactive Three.js 3D viewer modal.
- `/accessories/` & `/accessories/airpods/` — Chargers, cables, $5 screen protectors, and AirPods 4 details.
- `/lpascan` — eSIM LPA QR scanner (camera, image upload, screen cutout, or manual/pasted LPA entry) generating both iOS Quick Links (`/redirect?url=...`) and raw `LPA:1$...` QR codes for Android and camera scanning.
- `/redirect` & `/activate` & `/s/:id` — Customer-facing one-tap eSIM activation pages with bilingual (`EN` / `中文`) support.
- `/admin` — Cookie-authenticated activation console backed by Vercel serverless functions (`api/`) and Redis.
- `/privacy/` & `/store-information/` — Plain-language privacy and store policies.
- `/viewer.html` *(dev-only)* — Local GLB model inspection tool served against `dev-assets/` during `npm run dev` (excluded from production builds).

## Local Development & Preview

```bash
npm install
npm run dev          # Starts Vite dev server (includes /models and /decoders from dev-assets/)
npx tsc --noEmit     # Type-check all TypeScript sources
npm run build        # Outputs production bundle to build/
npx vite preview --port 4173 --host 127.0.0.1
```

To run the local Express API server alongside the frontend:

```bash
cd server && npm install
JWT_SECRET=your-local-secret ADMIN_BOOTSTRAP_PASSWORD=your-local-pass npm start
```

## Production Environment Variables (Vercel)

Configure these environment variables before deploying:

| Variable | Purpose |
| --- | --- |
| `REDIS_URL` | Redis connection string for activations, users, rate limiting, and short links |
| `JWT_SECRET` | Random 32+ character secret used to sign admin session cookies (`__Host-ezrefill_session`) |
| `ADMIN_BOOTSTRAP_PASSWORD` | Initial password (8+ chars) used only when `user:admin` does not yet exist in Redis |
| `ADMIN_RESET_TOKEN` | Secret token required by `POST /api/auth/reset-password` |
| `PUBLIC_BASE_URL` | Canonical public site URL (e.g. `https://ezrefillny.net`) for short links and CORS |
| `ALLOWED_ORIGINS` | Optional comma-separated list of additional allowed CORS origins |
