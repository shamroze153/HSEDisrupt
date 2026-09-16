# HSE QR Emergency Alert System

QR-based incident reporting for the campuses. Someone scans a location's QR
code, taps an emergency type, and responders are emailed automatically with
the location and (if the phone allows it) GPS coordinates. Unacknowledged
incidents auto-escalate to the next responder tier. No app to install, no
server to host, no ongoing cost — Google Sheets is the entire backend.

## How it fits together

- **Google Sheet** — the database. Three tabs: `Locations`, `Incidents`, `Responders`.
- **Apps Script** (`apps_script/`) — lives *inside* the Sheet. Serves the emergency
  form when a QR is scanned, writes incidents, emails responders, and runs the
  auto-escalation check. This is also what makes the whole thing zero-cost: it's
  free Google infrastructure, and because the form is served from the same
  script that receives the submission, there's no separate hosting and no
  cross-origin issues to work around.
- **admin_dashboard.py** — a Streamlit app (same pattern as the HFM energy
  dashboard) that reads/writes the same Sheet via a service account. Two tabs:
  generate QR codes for new locations, and a live incident dashboard with
  acknowledge/resolve buttons and charts.

The camera-based fall/injury detection layer discussed separately is **not**
part of this — that's a HFM-project extension, not this QR system.

> Sheet: **HSE Disrupt** (`SHEET_KEY = 1SgG5bFTMo3uRGDDV7O1dE6bYelxdvMwMgWS4wzddKKU`).
> Apps Script is **already deployed** —
> `SCRIPT_URL = https://script.google.com/macros/s/AKfycbxa1vsvgsCYee-WhnElePIjeA8fjmNoXQBnZL7hlIqyTNsaDOTcjWsmnsuAQtp8RfBxTg/exec`
> (confirmed live — `doGet` responds correctly). Both are already filled
> into `.env.example`.
>
> **Still to do by hand in the Sheet** before real alerts are useful:
> 1. Open the `Responders` tab and replace the example `@example.com`
>    rows with real names/emails — as deployed, nobody will actually get
>    emailed yet.
> 2. In the Apps Script editor, change `EMERGENCY_CALL_NUMBER` at the top
>    of `Code.gs` to the real fallback number, then redeploy (Deploy >
>    Manage deployments > edit > New version).
> 3. Confirm the `Locations`, `Incidents`, `Responders` tabs exist with
>    headers — if `setupHeadersIfMissing` hasn't been run yet, run it once
>    from the Apps Script editor's function dropdown.

## Setup — Part 1: the Sheet + Apps Script

1. Create a new Google Sheet. Name it e.g. "HSE Emergency System".
2. In the Sheet: `Extensions > Apps Script`. This opens a script bound to
   this specific Sheet — that's why `Code.gs` never needs a Sheet ID.
3. Delete the default `Code.gs` content. Create three files in the script
   editor with these exact names (the `.html` files need the HTML file type,
   not script):
   - `Code.gs` — paste `apps_script/Code.gs`
   - `Form` (HTML) — paste `apps_script/Form.html`
   - `Sent` (HTML) — paste `apps_script/Sent.html`
4. In `Code.gs`, edit `EMERGENCY_CALL_NUMBER` at the top to the real
   direct-call fallback number for the campus.
5. Run `setupHeadersIfMissing` once from the Apps Script editor (select it
   from the function dropdown, click Run). This creates the three tabs with
   correct headers and a few example rows in `Responders` — replace those
   example rows with real names/emails, one row per tier per emergency type
   (or `type = "All"` to get every incident type).
   - `tier` 1 responders are alerted first (e.g. floor fire warden, on-site
     paramedic). `tier` 2/3 are only alerted if nobody acknowledges within
     `ESCALATION_MINUTES` (10, by default — change at the top of `Code.gs`).
6. `Deploy > New deployment > Web app`. Execute as **Me**, who has access
   **Anyone**. Deploy, then copy the `/exec` URL — this is your `SCRIPT_URL`,
   used everywhere below.
7. Set up escalation: in the Apps Script editor, click the clock icon
   (Triggers) `> Add trigger > checkEscalations > Time-driven > Minutes
   timer > Every 5 minutes > Save`.

At this point, visiting `SCRIPT_URL?loc=test&name=Test%20Location` in a
browser should show the emergency form. Submitting it should append a row to
`Incidents` and email whoever is in `Responders` tier 1 for that type.

## Setup — Part 2: the admin dashboard

1. Create a Google Cloud service account (any free Google Cloud project),
   enable the Google Sheets API, and download its JSON key.
2. Share the Sheet (the "Share" button, top right) with the service
   account's email address (looks like
   `something@project-id.iam.gserviceaccount.com`), giving it **Editor**
   access — the dashboard needs to write acknowledge/resolve updates back.
3. `pip install -r requirements.txt`
4. Copy `.env.example` to `.env` and fill in:
   - `SHEET_KEY` — the long ID in the Sheet's URL
   - `SCRIPT_URL` — the `/exec` URL from step 6 above
   - `GOOGLE_SERVICE_ACCOUNT_JSON` — the entire JSON key file content as one
     line (if deploying to Streamlit Community Cloud, put these same three
     values in the app's Secrets instead of `.env`)
5. Run: `streamlit run admin_dashboard.py`

## Generating and placing QR codes

Use the **Manage locations** tab in the dashboard — enter a location name,
it saves to the `Locations` sheet and generates a QR PNG to download and
print. Print each one with the fallback text "Can't scan? Call
`<EMERGENCY_CALL_NUMBER>`" underneath, and laminate/mount at the physical
spot it represents (corridors, lift lobbies, workshops, stairwells).

## What's intentionally NOT built yet (be upfront about this when pitching)

- **No SMS/WhatsApp push** — reliable automatic WhatsApp delivery needs a
  paid Business API (Twilio etc.). Email is the zero-cost channel for phase
  1. This can be added later without changing anything else.
- **No offline/service-worker caching** — the form needs a live connection
  to load and submit. The "Call now" button is the fallback if network or
  the Sheet is briefly unavailable.
- **No login/identity on the reporting side, by design** — anyone can report
  without an account, so a genuine emergency is never blocked by a login
  screen. This does mean it's report-then-verify, not pre-authenticated;
  the duplicate-report window (2 minutes, same location + type) keeps a
  crowd of people scanning the same code from flooding responders.
- **Response-time analytics are only as good as acknowledgment discipline**
  — the "avg response time" metric depends on responders actually clicking
  Acknowledge (via email link or the dashboard button), not just reacting
  informally.
