/***************************************************
 * Transline Cargo & Logistics - Backend (FINAL)
 * Supports: Book, Update, Search, Analytics, Print
 ***************************************************/

const SHEET_NAME = 'Bookings';
const STATUS_LOG = 'StatusLog';
const ADMIN_PASS = 'transline123';      // <-- change in production

/********************* HTTP HANDLERS *****************/
function doGet(e) {
  try {
    const p = e.parameter || {};
    const action = (p.action || '').toLowerCase();
    const auth = p.auth || '';

    if (action === 'selftest') {
      return _json({ ok: true, diag: { sheet: SHEET_NAME, log: STATUS_LOG } });
    }

    // Allow direct GET printing (your admin link/button opens a new tab)
    if (action === 'print') {
      if (auth !== ADMIN_PASS) return _json({ ok: false, error: 'Unauthorized' });
      const id = p.id || '';
      const url = _makeInvoiceAndGetUrl(id);
      if (!url) return _json({ ok: false, error: 'Order not found' });
      // Redirect page to the Drive PDF (simplest & reliable)
      const html = HtmlService
        .createHtmlOutput(`<meta http-equiv="refresh" content="0;url=${url}">`)
        .setTitle('Transline Invoice');
      return html;
    }

    return _json({ ok: false, error: 'Use POST (or ?action=print)' });
  } catch (err) {
    return _json({ ok: false, error: err.message });
  }
}

function doPost(e) {
  try {
    const body = e.postData && e.postData.contents
      ? JSON.parse(e.postData.contents)
      : {};

    const action = (body.action || '').toLowerCase();
    const auth = body.auth || '';
    if (auth !== ADMIN_PASS) return _json({ ok: false, error: 'Unauthorized' });

    if (action === 'book')      return handleBook(body);
    if (action === 'status')    return handleStatus(body);
    if (action === 'search')    return handleSearch(body);
    if (action === 'analytics') return handleAnalytics();
    if (action === 'print') {
      const id = body.id || '';
      const url = _makeInvoiceAndGetUrl(id);
      return url ? _json({ ok: true, data: { url } })
                 : _json({ ok: false, error: 'Order not found' });
    }

    return _json({ ok: false, error: 'No valid action' });
  } catch (err) {
    return _json({ ok: false, error: err.message });
  }
}

/********************* UTILITIES *********************/
function _json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function _sheet() {
  return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
}
function _logSheet() {
  return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(STATUS_LOG);
}

// OrderID = TD + ddMMyy + <sequence for that date>
// Example: TD1910251 (1st booking on 19-10-25), TD1910252 (2nd), etc.
function _genOrderId() {
  const now = new Date();
  const dd = Utilities.formatDate(now, 'Asia/Kolkata', 'dd');
  const mm = Utilities.formatDate(now, 'Asia/Kolkata', 'MM');
  const yy = Utilities.formatDate(now, 'Asia/Kolkata', 'yy');
  const dateCode = `${dd}${mm}${yy}`;
  const prefix = 'TD' + dateCode;

  const s = _sheet();
  const values = s.getDataRange().getValues(); // includes header
  let maxSeq = 0;
  for (let i = 1; i < values.length; i++) {
    const oid = String(values[i][1] || '');
    if (oid.startsWith(prefix)) {
      const rest = oid.slice(prefix.length);
      const n = parseInt(rest, 10);
      if (!isNaN(n) && n > maxSeq) maxSeq = n;
    }
  }
  return prefix + String(maxSeq + 1);
}

function _genInvoiceNo() {
  const s = _sheet();
  // Simple running invoice
  return 'INV-' + (s.getLastRow() + 1000);
}

function _amount(rate, weight) {
  const r = parseFloat(rate || 0);
  const w = parseFloat(weight || 0);
  return (isNaN(r) || isNaN(w)) ? 0 : (r * w);
}

/********************* ACTIONS ***********************/
// BOOK
function handleBook(b) {
  const s = _sheet();
  const now = new Date();
  const orderId   = _genOrderId();
  const invoiceNo = _genInvoiceNo();

  // Bookings headers (1-based reference):
  // 1 Timestamp | 2 OrderID | 3 InvoiceNo | 4 Customer | 5 SenderName | 6 SenderPhone | 7 SenderAddress
  // 8 Origin | 9 ReceiverName | 10 ReceiverPhone | 11 ReceiverAddress | 12 Destination
  // 13 BookingType | 14 Service | 15 Qty | 16 Weight | 17 Unit | 18 Rate | 19 ItemDesc
  // 20 Co-loader | 21 ETA | 22 Status | 23 AWB | 24 Notes | 25 UpdatedBy
  const row = [
    now, orderId, invoiceNo,
    b.customer || '',
    b.senderName || '', b.senderPhone || '', b.senderAddress || '',
    b.origin || '',
    b.receiverName || '', b.receiverPhone || '', b.receiverAddress || '',
    b.destination || '',
    b.bookingType || '', b.service || '',
    b.qty || '', b.weight || '', b.unit || '', b.rate || '',
    b.itemDesc || '',
    b.coloader || '', b.eta || '',
    'Booked',
    b.awb || '',
    b.notes || '',
    'Admin'
  ];
  s.appendRow(row);

  return _json({
    ok: true,
    data: {
      orderId,
      invoiceNo,
      amount: _amount(b.rate, b.weight).toFixed(2)
    }
  });
}

// STATUS
function handleStatus(b) {
  const s = _sheet();
  const l = _logSheet();
  const id  = String(b.id || '').trim();
  const awb = String(b.awb || '').trim();

  const vals = s.getDataRange().getValues();
  let foundRow = -1;

  for (let i = 1; i < vals.length; i++) {
    const row = vals[i];
    const orderMatch = id && (row[1] === id);
    const awbMatch   = awb && (row[22] === awb);
    if (orderMatch || awbMatch) {
      foundRow = i + 1; // 1-based row index for setValue
      break;
    }
  }
  if (foundRow === -1) return _json({ ok: false, error: 'Order not found' });

  // Update Bookings sheet columns
  // ETA (21), Status (22), Co-loader (20), AWB (23), Notes (24)
  if (b.eta)       s.getRange(foundRow, 21).setValue(b.eta);
  if (b.status)    s.getRange(foundRow, 22).setValue(b.status);
  if (b.coloader)  s.getRange(foundRow, 20).setValue(b.coloader);
  if (b.awb)       s.getRange(foundRow, 23).setValue(b.awb);
  if (b.note)      s.getRange(foundRow, 24).setValue(b.note);

  // Always log to StatusLog
  l.appendRow([
    new Date(),
    id || s.getRange(foundRow, 2).getValue(),                    // Order ID
    awb || s.getRange(foundRow, 23).getValue(),                  // AWB
    b.status || s.getRange(foundRow, 22).getValue(),             // Status
    b.eta || s.getRange(foundRow, 21).getValue(),                // ETA
    b.location || '',                                            // Location
    b.coloader || s.getRange(foundRow, 20).getValue(),           // Co-loader
    b.note || s.getRange(foundRow, 24).getValue(),               // Note
    'Admin'                                                      // Updated By
  ]);

  return _json({ ok: true, message: 'Status updated' });
}

// SEARCH (simple dump for dashboard & reports)
function handleSearch(b) {
  const s = _sheet();
  const vals = s.getDataRange().getValues();
  if (vals.length < 2) return _json({ ok: true, data: { rows: [] } });

  const headers = vals[0];
  const rows = [];
  for (let i = 1; i < vals.length; i++) {
    const obj = {};
    headers.forEach((h, j) => obj[h] = vals[i][j]);
    rows.push(obj);
  }
  return _json({ ok: true, data: { rows } });
}

// ANALYTICS
function handleAnalytics() {
  const s = _sheet();
  const vals = s.getDataRange().getValues();
  if (vals.length < 2) return _json({ ok: true, data: {} });

  const headers = vals[0];
  const idxStatus = headers.indexOf('Status');
  const counts = {};
  for (let i = 1; i < vals.length; i++) {
    const st = vals[i][idxStatus] || 'Unknown';
    counts[st] = (counts[st] || 0) + 1;
  }
  return _json({ ok: true, data: counts });
}

// PRINT (helper used by GET and POST)
function _makeInvoiceAndGetUrl(orderId) {
  if (!orderId) return null;
  const s = _sheet();
  const vals = s.getDataRange().getValues();
  let row = null;
  for (let i = 1; i < vals.length; i++) {
    if (String(vals[i][1]) === String(orderId)) { row = vals[i]; break; }
  }
  if (!row) return null;

  const html =
`<html><body style="font-family:Arial">
  <h2 style="color:#0B3B8C;margin:0;">Transline Cargo & Logistics</h2>
  <div style="font-size:12px;color:#444;">Official Invoice</div>
  <hr>
  <table style="width:100%;font-size:13px">
    <tr><td><b>Invoice No:</b> ${row[2]}</td><td><b>Date:</b> ${row[0]}</td></tr>
    <tr><td><b>Order ID:</b> ${row[1]}</td><td><b>Status:</b> ${row[21]}</td></tr>
    <tr><td><b>ETA:</b> ${row[20]||'-'}</td><td><b>Co-loader:</b> ${row[19]||'-'}</td></tr>
  </table>
  <hr>
  <h4 style="margin:.2rem 0">Parties</h4>
  <table style="width:100%;font-size:13px">
    <tr>
      <td style="vertical-align:top;width:50%;">
        <b>Sender</b><br>
        ${row[4]||''}<br>
        ${row[6]||''}<br>
        ${row[7]||''}
      </td>
      <td style="vertical-align:top;width:50%;">
        <b>Receiver</b><br>
        ${row[8]||''}<br>
        ${row[10]||''}<br>
        ${row[11]||''}
      </td>
    </tr>
  </table>
  <h4 style="margin:.6rem 0 .2rem">Shipment</h4>
  <table style="width:100%;font-size:13px">
    <tr><td><b>Type:</b> ${row[12]}</td><td><b>Service:</b> ${row[13]}</td></tr>
    <tr><td><b>Qty:</b> ${row[14]}</td><td><b>Weight:</b> ${row[15]} ${row[16]}</td></tr>
    <tr><td><b>Rate:</b> ₹${row[17]}</td><td><b>Item:</b> ${row[18]||''}</td></tr>
    <tr><td><b>AWB:</b> ${row[22]||''}</td><td><b>Notes:</b> ${row[23]||''}</td></tr>
  </table>
  <hr>
  <h3 style="text-align:right;margin:.3rem 0;">Total: ₹${(_amount(row[17], row[15])).toFixed(2)}</h3>
  <div style="font-size:11px;color:#666;margin-top:12px">
    Generated by Transline Admin System
  </div>
</body></html>`;

  const blob = Utilities.newBlob(html, 'text/html', 'invoice.html');
  const pdf  = blob.getAs('application/pdf');
  const file = DriveApp.createFile(pdf).setName(`${row[2]}.pdf`);
  return file.getUrl();
}
