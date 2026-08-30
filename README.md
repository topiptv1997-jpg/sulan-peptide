# Sulan Peptide — danye Worker + KV Admin V2

## What this version is for
This V2 upgrades the existing `danye` Worker rather than creating a new Worker.

- `/` — existing Sulan single-page landing page
- `/admin` — independent admin UI
- `SULAN_ADMIN` → `ADMIN_KV`
- `SULAN_CONFIG` → `CONFIG_KV`
- WhatsApp add/edit/enable/disable/delete/default + single/round-robin routing
- Global lead-form ON/OFF
- Meta/TikTok Pixel IDs and ON/OFF
- Pageview / WhatsApp click / form-submit event logging in KV for an initial 90-day event log
- UTM source/campaign/content captured for events
- `/go/whatsapp` is a Worker route, not a directory

## Important deployment note
This is a Worker project, not a static-upload-only project. Deploy with Wrangler.

Before production:
1. Change `ADMIN_PASSWORD`.
2. Change `SESSION_SECRET` to a long random value.
3. Keep the two KV IDs unchanged unless you intentionally create new namespaces.
4. Deploy the Worker.

Example:
`npx wrangler login`
`npx wrangler deploy`

## Important limitation
KV is being used here for configuration and an initial event log. For high-volume analytics, the next upgrade should move event records to D1 (or another analytics store). The current event log is intended as a functional V2 foundation, not a high-scale analytics warehouse.
