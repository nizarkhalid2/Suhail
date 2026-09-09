# Suhail live setup

## 1) GitHub Pages
Keep `index.html` as the public frontend. Do NOT put supplier tokens in it.

## 2) Cloudflare Worker
Files required:
- `suhail-api-worker.js`
- `wrangler.toml`

Deploy from a folder containing both files:

```bash
npx wrangler login
npx wrangler deploy
npx wrangler secret put DUFFEL_TOKEN
```

Cloudflare Workers supports encrypted secrets; do not put the Duffel token in `vars` or HTML.

After deployment, copy the Worker URL, for example:
`https://suhail-travel-api.<your-subdomain>.workers.dev`

## 3) Connect the frontend
In `index.html`, before `</head>`, add:

```html
<script>window.SUHAIL_API_BASE='https://YOUR-WORKER.workers.dev';</script>
```

## 4) Test
Open:
`https://YOUR-WORKER.workers.dev/api/health`

It should return JSON with `ok: true`. Once `DUFFEL_TOKEN` is configured, `configured` should be true.

## 5) Live flights
Suhail v0.16 can call the live flight search endpoint and falls back to the existing demo inventory if the Worker is not configured or the live request fails.

## 6) Hotels
Hotel search uses Duffel Stays and requires latitude/longitude for location searches. The next UI step is city-to-coordinate lookup + live hotel results + room/rate retrieval.

## Important
Real booking/payment still requires the next phase: offer/rate revalidation, traveler details, booking creation, payment gateway, webhooks, cancellation/refund logic, and production security rules.
