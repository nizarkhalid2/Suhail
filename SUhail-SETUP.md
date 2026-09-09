# Suhail live travel setup

## What is included
- `suhail-beta-app 0.15.html`: stable frontend with a secure API-client layer.
- `suhail-api-worker.js`: Cloudflare Worker backend for live flight/hotel search through Duffel.

## Important
GitHub Pages is static hosting. Supplier secrets must NOT be placed in the HTML. Deploy the Worker separately and keep `DUFFEL_TOKEN` as a server secret.

## Backend
1. Create a Duffel account and test access token.
2. Deploy `suhail-api-worker.js` to Cloudflare Workers.
3. Add Worker secret: `DUFFEL_TOKEN`.
4. Put the Worker URL into the frontend before `</head>`:
   `window.SUHAIL_API_BASE='https://YOUR-WORKER.workers.dev';`
5. Test: `POST /api/flights/search` with `{origin:'MCT',destination:'DXB',departureDate:'2026-10-01',adults:1,cabin:'economy'}`.
6. Test hotels with latitude/longitude plus check-in/out.

## Current limitation
This phase implements secure live SEARCH plumbing. Booking/payment must be wired after search results are confirmed. Do not collect card numbers in the HTML. For Oman, Thawani provides a merchant API/sandbox and webhooks; connect that in the payment phase.
