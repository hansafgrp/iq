/** =========================
 *  Transline Admin Backend (Apps Script)
 *  Robustly parses both JSON and form POST data
 *  Supports username & password login
 *  Sheets: "Bookings", "StatusLog"
 *  Returns JSON for frontend
 * ========================= */

// Sheet names
const SHEET_BOOKINGS = 'Bookings';
const SHEET_STATUS   = 'StatusLog';

// ---- Admin login credentials ----
// Set these in Script Properties: ADMIN_USER, ADMIN_PASS
function getAdminUser_() {
  return PropertiesService.getScriptProperties().getProperty('admin') || 'admin';
}
function getAdminPass_() {
  return PropertiesService.getScriptProperties().getProperty('1234') || 'changeme';
}

// ---- Invoice counter ----
function nextInvoiceNo_() {
  const props = PropertiesService.getScriptProperties();
  const key = 'INVOICE_NO';
  const cur = Number(props.getProperty(key) || '10001');
  props.setProperty(key, String(cur + 1));
  return `INV${cur}`;
}

// ---- Order ID generator ----
function buildOrderId_(bookingType) {
  const isIntl = String(bookingType || '').toLowerCase().includes('international');
  const prefix = isIntl ? 'TRI' : 'TD';
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, '0');
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const yy = String(now.getFullYear()).slice(-2);
  const key = `SERIAL_${prefix}_${yy}${mm}${dd}`;
  const props = PropertiesService.getScriptProperties();
  const serial = Number(props.getProperty(key) || '0') + 1;
  props.setProperty(key, String(serial));
  return `${prefix}${dd}${mm}${'20'+yy}${serial}`;
}

// ---- Helpers ----
function getSheet_(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  return sh;
}
function rowsToObjects_(headers, rows) {
  return rows.map(r => {
    const o = {};
    headers.forEach((h, i) => o[h] = r[i]);
    return o;
  });
}
function ok_(data) { return ContentService.createTextOutput(JSON.stringify({ ok: true, data })).setMimeType(ContentService.MimeType.JSON); }
function err_(code, msg, detail) {
  const out = { ok: false, error: msg };
  if (detail) out.detail = detail;
  return ContentService
    .createTextOutput(JSON.stringify(out))
    .setMimeType(ContentService.MimeType.JSON);
}

// ---------- PUBLIC ENDPOINTS ----------
// get tracking by awb or id – used by sheets.php proxy and website
function doGet(e) {
  const p = e.parameter || {};
  const action = (p.action || '').toLowerCase();

  if (action === 'print' && p.id) {
    return printInvoice_(p.id);
  }

  // sheets.php expects awb or id
  const val = (p.awb && p.awb.trim()) || (p.id && p.id.trim());
  if (!val) return err_(400, 'Missing awb/order');

  const data = getTracking_(val);
  if (!data) return ContentService.createTextOutput(JSON.stringify({ ok:false, error:'Not found' })).setMimeType(ContentService.MimeType.JSON);
  return ok_(data);
}

// handle admin actions (login, book, update, search) via POST JSON or form
function doPost(e) {
  try {
    let body = {};
    if (e.postData && e.postData.contents) {
      // Accept JSON or form data
      if (e.postData.type && e.postData.type.indexOf('json') >= 0) {
        body = JSON.parse(e.postData.contents);
      } else {
        // Parse URL-encoded form data
        const params = e.postData.contents.split('&');
        params.forEach(p => {
          const eqIndex = p.indexOf('=');
          if (eqIndex < 0) return;
          const k = p.substring(0, eqIndex);
          const v = p.substring(eqIndex + 1);
          body[decodeURIComponent(k)] = decodeURIComponent(v || '');
        });
      }
    }

    const action = (body.action || '').toLowerCase();

    // Username/password login
    if (action === 'login') {
      const user = body.user;
      const pass = body.pass;
      if (user === getAdminUser_() && pass === getAdminPass_()) {
        return ok_({ok:true, token:'admin'});
      } else {
        return err_(403, 'Invalid username or password');
      }
    }

    // For all other actions, check token
    const token = body.auth;
    if (!token || token !== 'admin') return err_(403, 'Forbidden');

    if (action === 'book')   return ok_(bookShipment_(body));
    if (action === 'status') return ok_(updateStatus_(body));
    if (action === 'search') return ok_(searchBookings_(body));
    if (action === 'invoice') {
      const r = printInvoiceJson_(body.id);
      return r ? ok_(r) : err_(404, 'Not found');
    }

    return err_(400, 'Unknown action');
  } catch (ex) {
    return err_(500, 'Server error', String(ex));
  }
}

// ---------- CORE LOGIC ----------
function getHeaders_Bookings_() {
  return [
    'Timestamp','OrderID','AWB','InvoiceNo',
    'BookingType','Service','Customer',
    'SenderName','SenderPhone','SenderAddress','Origin',
    'ReceiverName','ReceiverPhone','ReceiverAddress','Destination',
    'Quantity','Weight','Unit','Rate','Amount',
    'ItemDescription','CoLoader','ETA','Status','Notes','UpdatedAt'
  ];
}
function getHeaders_Status_() {
  return ['Timestamp','OrderID','AWB','Status','Location','Note','ETA','CoLoader','UpdatedBy'];
}

function ensureHeaders_() {
  const shB = getSheet_(SHEET_BOOKINGS);
  const shS = getSheet_(SHEET_STATUS);
  if (shB.getLastRow() === 0) shB.appendRow(getHeaders_Bookings_());
  if (shS.getLastRow() === 0) shS.appendRow(getHeaders_Status_());
}

function bookShipment_(body) {
  ensureHeaders_();
  const {
    bookingType, service, customer,
    senderName, senderPhone, senderAddress, origin,
    receiverName, receiverPhone, receiverAddress, destination,
    qty, weight, unit, rate,
    itemDesc, coloader, eta, notes, awb
  } = body;

  const orderId  = buildOrderId_(bookingType);
  const invoiceNo= nextInvoiceNo_();
  const rateNum  = Number(rate||0);
  const qtyNum   = Number(qty||1);
  const weightNum= Number(weight||0);
  const amount   = rateNum * (weightNum || qtyNum || 1);
  const nowStr   = new Date();

  const row = [
    nowStr, orderId, (awb||''), invoiceNo,
    (bookingType||''), (service||''), (customer||''),
    (senderName||''), (senderPhone||''), (senderAddress||''), (origin||''),
    (receiverName||''), (receiverPhone||''), (receiverAddress||''), (destination||''),
    (qty||''), (weight||''), (unit||''), (rate||''), amount,
    (itemDesc||''), (coloader||''), (eta||''), 'Booked', (notes||''), nowStr
  ];

  getSheet_(SHEET_BOOKINGS).appendRow(row);

  // seed status log
  getSheet_(SHEET_STATUS).appendRow([
    nowStr, orderId, (awb||''), 'Booked', origin || '', 'Shipment created', (eta||''), (coloader||''), (body.updatedBy||'admin')
  ]);

  return {
    orderId, invoiceNo, amount
  };
}

function updateStatus_(body) {
  ensureHeaders_();
  const { id, awb, status, location, note, eta, coloader, updatedBy } = body;
  if (!id && !awb) throw new Error('Order ID or AWB required');

  // Add to status log
  const nowStr = new Date();
  getSheet_(SHEET_STATUS).appendRow([
    nowStr, (id||''), (awb||''), (status||''), (location||''), (note||''), (eta||''), (coloader||''), (updatedBy||'admin')
  ]);

  // Update latest in Bookings (Status, ETA, Notes, UpdatedAt, CoLoader)
  const sh = getSheet_(SHEET_BOOKINGS);
  const data = sh.getDataRange().getValues();
  const headers = data[0];
  const idxOrder = headers.indexOf('OrderID');
  const idxAwb   = headers.indexOf('AWB');
  const idxStatus= headers.indexOf('Status');
  const idxEta   = headers.indexOf('ETA');
  const idxNotes = headers.indexOf('Notes');
  const idxUpd   = headers.indexOf('UpdatedAt');
  const idxCol   = headers.indexOf('CoLoader');

  for (let r = 1; r < data.length; r++) {
    const row = data[r];
    if ((id && row[idxOrder] == id) || (awb && row[idxAwb] == awb)) {
      if (status) row[idxStatus] = status;
      if (eta)    row[idxEta]    = eta;
      if (note)   row[idxNotes]  = note;
      if (coloader) row[idxCol]  = coloader;
      row[idxUpd] = nowStr;
      sh.getRange(r+1, 1, 1, headers.length).setValues([row]);
      break;
    }
  }

  return { ok: true };
}

// for tracking/search
function getTracking_(val) {
  ensureHeaders_();

  const sh = getSheet_(SHEET_BOOKINGS);
  const data = sh.getDataRange().getValues();
  const headers = data[0];

  const iOrder = headers.indexOf('OrderID');
  const iAwb   = headers.indexOf('AWB');
  let found = null;
  for (let r = 1; r < data.length; r++) {
    const row = data[r];
    if (String(row[iOrder]) === val || String(row[iAwb]) === val) {
      found = rowsToObjects_(headers, [row])[0];
      break;
    }
  }
  if (!found) return null;

  // include status timeline
  const shS = getSheet_(SHEET_STATUS);
  const sData = shS.getDataRange().getValues();
  const sHeaders = sData[0];
  const sIdxOrder= sHeaders.indexOf('OrderID');
  const sIdxAwb  = sHeaders.indexOf('AWB');

  const scans = [];
  for (let r = 1; r < sData.length; r++) {
    const row = sData[r];
    if (String(row[sIdxOrder]) === found.OrderID || String(row[sIdxAwb]) === found.AWB) {
      scans.push({
        time: row[0], // Timestamp
        Status: row[sHeaders.indexOf('Status')],
        Instructions: row[sHeaders.indexOf('Note')],
        StatusLocation: row[sHeaders.indexOf('Location')]
      });
    }
  }
  scans.sort((a,b)=> new Date(b.time) - new Date(a.time));

  return {
    awb: String(found.AWB||''),
    id:  String(found.OrderID||''),
    customer: String(found.Customer||''),
    status: String(found.Status||''),
    expectedDate: String(found.ETA||''),
    notes: String(found.Notes||''),
    origin: String(found.Origin||''),
    destination: String(found.Destination||''),
    phone: String(found.SenderPhone||''),
    updatedAt: String(found.UpdatedAt||''),
    scans: scans
  };
}

// ---------- PRINT (PDF) ----------
function invoiceHtml_(b) {
  return `
  <html>
  <head>
    <meta charset="utf-8">
    <style>
      @page { size: A4; margin: 20mm; }
      body { font-family: Arial, Helvetica, sans-serif; color:#111; }
      .h { display:flex; justify-content:space-between; align-items:center; margin-bottom:16px; }
      .brand { font-size:20px; font-weight:700; color:#0B3B8C; }
      .muted { color:#6b7280; font-size:12px; }
      .box { border:1px solid #e5e7eb; border-radius:8px; padding:10px; margin-bottom:10px; }
      h2 { margin: 0 0 8px; }
      table { width:100%; border-collapse: collapse; margin-top:8px; }
      th,td { text-align:left; border-bottom:1px solid #eee; padding:8px; }
      .right { text-align:right; }
      .tot { font-weight:700; }
    </style>
  </head>
  <body>
    <div class="h">
      <div>
        <div class="brand">Transline Cargo & Logistics</div>
        <div class="muted">Malappuram • Delhi • Qatar</div>
      </div>
      <div class="muted">Invoice #: ${b.InvoiceNo}<br/>Order ID: ${b.OrderID}</div>
    </div>
    <div class="box">
      <h2>Shipment Details</h2>
      <div class="muted">Booking Type: ${b.BookingType || ''} | Service: ${b.Service || ''}</div>
      <div class="muted">AWB: ${b.AWB || '-'} | ETA: ${b.ETA || '-'}</div>
    </div>
    <div class="box">
      <h2>Sender</h2>
      <div>${b.SenderName || ''}</div>
      <div class="muted">${b.SenderPhone || ''}</div>
      <div class="muted">${b.SenderAddress || ''}</div>
      <div class="muted">Origin: ${b.Origin || ''}</div>
    </div>
    <div class="box">
      <h2>Receiver</h2>
      <div>${b.ReceiverName || ''}</div>
      <div class="muted">${b.ReceiverPhone || ''}</div>
      <div class="muted">${b.ReceiverAddress || ''}</div>
      <div class="muted">Destination: ${b.Destination || ''}</div>
    </div>
    <table>
      <thead><tr>
        <th>Description</th><th>Qty</th><th>Weight (${b.Unit||''})</th><th>Rate</th><th class="right">Amount</th>
      </tr></thead>
      <tbody>
        <tr>
          <td>${b.ItemDescription || 'Consignment'}</td>
          <td>${b.Quantity || 1}</td>
          <td>${b.Weight || 0}</td>
          <td>${b.Rate || 0}</td>
          <td class="right tot">${b.Amount || 0}</td>
        </tr>
      </tbody>
    </table>
    <div class="muted" style="margin-top:12px;">
      Co-loader: ${b.CoLoader || '-'} • Notes: ${b.Notes || '-'}
    </div>
    <div class="muted" style="margin-top:12px;">
      Tracking: https://www.translinelogistics.in/track.php?id=${encodeURIComponent(b.OrderID||'')}
    </div>
  </body>
  </html>`;
}

function printInvoiceJson_(orderId) {
  if (!orderId) return null;

  const sh = getSheet_(SHEET_BOOKINGS);
  const data = sh.getDataRange().getValues();
  const headers = data[0];

  const all = rowsToObjects_(headers, data.slice(1));
  const b = all.find(r => String(r.OrderID) === orderId);
  if (!b) return null;

  const html = invoiceHtml_(b);
  const fileName = `Invoice_${b.InvoiceNo || b.OrderID}.pdf`;
  const blob = Utilities.newBlob(html, 'text/html', 'invoice.html');

  // Convert to PDF using Drive Advanced Service (or HTML->PDF rendering)
  const pdf = blob.getAs('application/pdf').setName(fileName);
  const file = DriveApp.createFile(pdf);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

  return { pdfUrl: file.getUrl(), name: fileName };
}

function printInvoice_(orderId) {
  const r = printInvoiceJson_(orderId);
  if (!r) return err_(404, 'Not found');
  return ok_(r);
}

// ---------- SEARCH ----------
function searchBookings_(body) {
  ensureHeaders_();
  const { q, from, to, service, bookingType, status } = body;

  const sh = getSheet_(SHEET_BOOKINGS);
  const data = sh.getDataRange().getValues();
  const headers = data[0];

  const all = rowsToObjects_(headers, data.slice(1));
  const qlc = (q||'').toString().toLowerCase();

  const f = new Date(from||0).getTime() || null;
  const t = new Date(to||0).getTime()   || null;

  const out = all.filter(r=>{
    const ts = new Date(r.Timestamp).getTime();
    if (f && ts < f) return false;
    if (t && ts > t) return false;
    if (service && String(r.Service).toLowerCase() !== String(service).toLowerCase()) return false;
    if (bookingType && String(r.BookingType).toLowerCase() !== String(bookingType).toLowerCase()) return false;
    if (status && String(r.Status).toLowerCase() !== String(status).toLowerCase()) return false;
    if (qlc) {
      const str = JSON.stringify(r).toLowerCase();
      if (str.indexOf(qlc) === -1) return false;
    }
    return true;
  });

  return { rows: out.slice(0, 500) }; // cap for UI
}
