# HSE emergency alert — dashboard portal (Vercel / Next.js)

This replaces the Streamlit dashboard with a Next.js app that Vercel
understands natively (zero-config — this is exactly what was missing
before, which is what caused the "No python entrypoint found" error).
It talks to the **same Google Sheet** as before, through two small API
routes, and does **not** touch the Apps Script side (the QR emergency
form + email dispatch + escalation) — that stays exactly as already
deployed and working.

- `/` — live incidents: metrics, active-incident cards with Acknowledge /
  Mark resolved buttons (these write straight back to the Sheet), and
  charts by type and by location. Polls every 8 seconds.
- `/locations` — add a location (writes to the `Locations` tab) and get
  a real, scannable QR code back immediately, plus re-download QR codes
  for any existing location.

## 1. Reuse your existing service account — don't make a new one

You already created a Google service account and shared the "HSE Disrupt"
Sheet with it (for the Streamlit dashboard). Open that same downloaded
JSON key file in a text editor and copy out two fields:

- `client_email` → this is `GOOGLE_CLIENT_EMAIL`
- `private_key` → this is `GOOGLE_PRIVATE_KEY` — copy it exactly as
  written, including the literal `\n` characters. Do **not** convert
  them into real line breaks; the code converts them back at runtime.

## 2. Push this folder to GitHub

```
git init
git add .
git commit -m "HSE dashboard portal"
git branch -M main
git remote add origin <your-new-or-existing-repo-url>
git push -u origin main
```

## 3. Import into Vercel

`New Project > Import` this repo. Vercel will auto-detect Next.js — do
**not** add a custom build command or override anything, that's what
caused the earlier error.

Before the first deploy (or right after, then redeploy), go to
**Project Settings > Environment Variables** and add:

| Name | Value |
|---|---|
| `SHEET_KEY` | `1SgG5bFTMo3uRGDDV7O1dE6bYelxdvMwMgWS4wzddKKU` |
| `SCRIPT_URL` | your Apps Script `/exec` URL |
| `NEXT_PUBLIC_SCRIPT_URL` | same `/exec` URL again (client-side needs it to build QR links) |
| `GOOGLE_CLIENT_EMAIL` | from step 1 |
| `GOOGLE_PRIVATE_KEY` | from step 1 — paste as one line, `\n` kept literal |

Deploy. You'll get a `your-project.vercel.app` URL — that's the real,
live-connected dashboard.

## What still lives where

- **Apps Script** (in the Google Sheet) — still owns the QR scan → form
  → email-to-responders → escalation flow. Nothing here changes that.
- **This Vercel app** — only reads/writes the Sheet for the admin side
  (viewing incidents, acknowledging, resolving, adding locations,
  generating QR codes).
- **The old `admin_dashboard.py` (Streamlit)** — no longer needed once
  this is live. Safe to stop using; it was reading/writing the exact
  same Sheet, so there's no conflict if you ever ran both, but there's
  no reason to keep both running.

## Local dev (optional, before pushing)

```
npm install
cp .env.example .env.local   # fill in the real values
npm run dev
```
