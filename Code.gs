/**
 * HSE QR Emergency Alert System — Apps Script backend.
 *
 * Deploy this INSIDE the Google Sheet (Extensions > Apps Script), so it is
 * container-bound and SpreadsheetApp.getActiveSpreadsheet() just works —
 * no separate Sheet ID or auth needed here.
 *
 * Required sheet tabs and header rows (row 1):
 *
 *   Locations  | id | name | building | floor | created_at
 *
 *   Incidents  | id | timestamp | location_id | location_name | type | note
 *              | lat | lng | status | escalation_level | last_alert_at
 *              | acknowledged_by | acknowledged_at | resolved_by | resolved_at
 *
 *   Responders | tier | type | name | email
 *              (type is one of: Fire, Medical, Security, Other, or "All"
 *               to receive every incident type. tier is 1, 2, or 3 —
 *               tier 1 is alerted first, tier 2/3 only on escalation.)
 *
 * After pasting this file plus Form.html and Sent.html into the Apps
 * Script editor, deploy: Deploy > New deployment > Web app >
 * Execute as: Me, Who has access: Anyone. Copy the /exec URL — that is
 * the SCRIPT_URL used everywhere else (QR codes, admin dashboard).
 *
 * Then set up escalation: Triggers (clock icon) > Add trigger >
 * checkEscalations > Time-driven > Minutes timer > Every 5 minutes.
 */

// ===== CONFIG — edit these =====
const ESCALATION_MINUTES = 10;        // unacknowledged incident escalates after this many minutes
const MAX_TIER = 3;                   // highest responder tier
const DUPLICATE_WINDOW_MINUTES = 2;   // repeat reports for same location+type within this window are merged, not re-alerted
const EMERGENCY_CALL_NUMBER = '+92-XXX-XXXXXXX'; // shown as a direct-call fallback on the form

const INCIDENTS_SHEET = 'Incidents';
const RESPONDERS_SHEET = 'Responders';

// Incidents column numbers (1-indexed, matches header row above)
const COL = {
  ID: 1, TIMESTAMP: 2, LOC_ID: 3, LOC_NAME: 4, TYPE: 5, NOTE: 6,
  LAT: 7, LNG: 8, STATUS: 9, ESCALATION: 10, LAST_ALERT: 11,
  ACK_BY: 12, ACK_AT: 13, RESOLVED_BY: 14, RESOLVED_AT: 15
};

// ===== Entry points =====

function doGet(e) {
  const action = e.parameter.action;
  if (action === 'ack') return handleAck(e);
  if (action === 'resolve') return handleResolve(e);

  const locId = e.parameter.loc || '';
  const locName = e.parameter.name || 'Unregistered location';

  const t = HtmlService.createTemplateFromFile('Form');
  t.locId = locId;
  t.locName = locName;
  t.callNumber = EMERGENCY_CALL_NUMBER;
  return t.evaluate()
    .setTitle('HSE emergency alert')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function doPost(e) {
  const p = e.parameter;
  const locId = p.loc || '';
  const locName = p.name || 'Unregistered location';
  const type = p.type || 'Other';
  const note = p.note || '';
  const lat = p.lat || '';
  const lng = p.lng || '';

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(INCIDENTS_SHEET);
  const now = new Date();

  const dup = findRecentDuplicate(sheet, locId, type, now);
  if (dup) {
    return renderSent(locName, type, dup, true);
  }

  const id = Utilities.getUuid().slice(0, 8);
  sheet.appendRow([id, now, locId, locName, type, note, lat, lng, 'Open', 1, now, '', '', '', '']);

  notifyResponders(id, locId, locName, type, note, lat, lng, 1);

  return renderSent(locName, type, id, false);
}

// ===== Core logic =====

function findRecentDuplicate(sheet, locId, type, now) {
  const data = sheet.getDataRange().getValues();
  for (let i = data.length - 1; i >= 1; i--) {
    const row = data[i];
    if (row[COL.LOC_ID - 1] === locId && row[COL.TYPE - 1] === type && row[COL.STATUS - 1] !== 'Resolved') {
      const rowTime = new Date(row[COL.TIMESTAMP - 1]);
      if ((now - rowTime) / 60000 < DUPLICATE_WINDOW_MINUTES) {
        return row[COL.ID - 1];
      }
      break; // only the most recent matching row counts as a possible duplicate
    }
  }
  return null;
}

function notifyResponders(id, locId, locName, type, note, lat, lng, tier) {
  const respSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(RESPONDERS_SHEET);
  const rows = respSheet.getDataRange().getValues();
  const scriptUrl = ScriptApp.getService().getUrl();
  const mapsLink = (lat && lng) ? ('https://maps.google.com/?q=' + lat + ',' + lng) : '';
  const ackLink = scriptUrl + '?action=ack&id=' + id;
  const resolveLink = scriptUrl + '?action=resolve&id=' + id;

  const subject = (tier > 1 ? '[ESCALATED] ' : '') + 'EMERGENCY (' + type + ') - ' + locName;
  let body = 'Type: ' + type + '\nLocation: ' + locName + '\nNote: ' + (note || '(none)') + '\nTime: ' + new Date() + '\n';
  if (mapsLink) body += 'Map: ' + mapsLink + '\n';
  body += '\nAcknowledge: ' + ackLink + '\nMark resolved: ' + resolveLink;

  let sent = 0;
  for (let i = 1; i < rows.length; i++) {
    const [rTier, rType, rName, rEmail] = rows[i];
    if (Number(rTier) === Number(tier) && (rType === type || rType === 'All') && rEmail) {
      MailApp.sendEmail(rEmail, subject, body);
      sent++;
    }
  }
  return sent;
}

function checkEscalations() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(INCIDENTS_SHEET);
  const data = sheet.getDataRange().getValues();
  const now = new Date();

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const status = row[COL.STATUS - 1];
    const escLevel = Number(row[COL.ESCALATION - 1]);
    const lastAlert = new Date(row[COL.LAST_ALERT - 1]);

    if (status === 'Open' && escLevel < MAX_TIER) {
      const minsSince = (now - lastAlert) / 60000;
      if (minsSince >= ESCALATION_MINUTES) {
        const newTier = escLevel + 1;
        sheet.getRange(i + 1, COL.ESCALATION).setValue(newTier);
        sheet.getRange(i + 1, COL.LAST_ALERT).setValue(now);
        notifyResponders(row[COL.ID - 1], row[COL.LOC_ID - 1], row[COL.LOC_NAME - 1],
          row[COL.TYPE - 1], row[COL.NOTE - 1], row[COL.LAT - 1], row[COL.LNG - 1], newTier);
      }
    }
  }
}

function handleAck(e) {
  const id = e.parameter.id;
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(INCIDENTS_SHEET);
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][COL.ID - 1] === id) {
      sheet.getRange(i + 1, COL.STATUS).setValue('Acknowledged');
      sheet.getRange(i + 1, COL.ACK_BY).setValue(e.parameter.by || 'responder');
      sheet.getRange(i + 1, COL.ACK_AT).setValue(new Date());
      break;
    }
  }
  return HtmlService.createHtmlOutput(
    '<div style="font-family:sans-serif;padding:40px;text-align:center;max-width:400px;margin:0 auto">' +
    '<h2>Acknowledged</h2><p>Thanks — the reporter\'s location is on record. Please respond.</p></div>'
  );
}

function handleResolve(e) {
  const id = e.parameter.id;
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(INCIDENTS_SHEET);
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][COL.ID - 1] === id) {
      sheet.getRange(i + 1, COL.STATUS).setValue('Resolved');
      sheet.getRange(i + 1, COL.RESOLVED_BY).setValue(e.parameter.by || 'responder');
      sheet.getRange(i + 1, COL.RESOLVED_AT).setValue(new Date());
      break;
    }
  }
  return HtmlService.createHtmlOutput(
    '<div style="font-family:sans-serif;padding:40px;text-align:center;max-width:400px;margin:0 auto">' +
    '<h2>Marked resolved</h2><p>This incident is now closed.</p></div>'
  );
}

function renderSent(locName, type, id, isDuplicate) {
  const t = HtmlService.createTemplateFromFile('Sent');
  t.locName = locName;
  t.type = type;
  t.id = id;
  t.isDuplicate = isDuplicate;
  t.callNumber = EMERGENCY_CALL_NUMBER;
  return t.evaluate().setTitle('Alert sent');
}

/** One-time helper: run this manually once to write header rows if the sheet is empty. */
function setupHeadersIfMissing() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  const loc = ss.getSheetByName('Locations') || ss.insertSheet('Locations');
  if (loc.getLastRow() === 0) loc.appendRow(['id', 'name', 'building', 'floor', 'created_at']);

  const inc = ss.getSheetByName(INCIDENTS_SHEET) || ss.insertSheet(INCIDENTS_SHEET);
  if (inc.getLastRow() === 0) {
    inc.appendRow(['id', 'timestamp', 'location_id', 'location_name', 'type', 'note',
      'lat', 'lng', 'status', 'escalation_level', 'last_alert_at',
      'acknowledged_by', 'acknowledged_at', 'resolved_by', 'resolved_at']);
  }

  const resp = ss.getSheetByName(RESPONDERS_SHEET) || ss.insertSheet(RESPONDERS_SHEET);
  if (resp.getLastRow() === 0) {
    resp.appendRow(['tier', 'type', 'name', 'email']);
    resp.appendRow([1, 'Fire', 'Fire Warden', 'fire.warden@example.com']);
    resp.appendRow([1, 'Medical', 'Paramedic', 'paramedic@example.com']);
    resp.appendRow([1, 'Security', 'Security Desk', 'security@example.com']);
    resp.appendRow([1, 'All', 'OHS Officer', 'ohs.officer@example.com']);
    resp.appendRow([2, 'All', 'OHS Manager', 'ohs.manager@example.com']);
    resp.appendRow([3, 'All', 'CEO', 'ceo@example.com']);
  }
}
