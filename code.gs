/***************************************************
 * Transline Cargo & Logistics - Backend (FINAL)
 * Supports: Book, Update, Search, Analytics, Print
 ***************************************************/

const SHEET_NAME = 'Bookings';
const STATUS_LOG = 'StatusLog';
const ADMIN_PASS = 'transline123';  // change password

/********************* ROUTER ************************/
function doGet(e) {
  return ContentService.createTextOutput(
    JSON.stringify({ ok: false, error: 'Use POST method for actions' })
  ).setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents || '{}');
    const action = body.action;
    const auth = body.auth || '';

    if (auth !== ADMIN_PASS)
      return jsonOut({ ok: false, error: 'Unauthorized' });

    if (action === 'book') return handleBook(body);
    if (action === 'status') return handleStatus(body);
    if (action === 'search') return handleSearch(body);
    if (action === 'print') return handlePrint(body);
    if (action === 'analytics') return handleAnalytics(body);

    return jsonOut({ ok: false, error: 'No valid action' });
  } catch (err) {
    return jsonOut({ ok: false, error: err.message });
  }
}

/********************* UTILITIES ************************/
function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function sheet() {
  return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
}

function logSheet() {
  return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(STATUS_LOG);
}

function genOrderId() {
  const now = new Date();
  const prefix = 'TD';
  const dateCode = Utilities.formatDate(now, 'Asia/Kolkata', 'ddMMyy');
  const s = sheet();
  const nextNum = s.getLastRow();
  return `${prefix}${dateCode}${nextNum}`;
}

function genInvoiceNo() {
  const s = sheet();
  return 'INV-' + (s.getLastRow() + 1000);
}

/********************* BOOK ************************/
function handleBook(b) {
  const s = sheet();
  const orderId = genOrderId();
  const invoiceNo = genInvoiceNo();
  const now = new Date();

  const data = [
    now, orderId, invoiceNo, b.customer || '', b.senderName || '',
    b.senderPhone || '', b.senderAddress || '', b.origin || '',
    b.receiverName || '', b.receiverPhone || '', b.receiverAddress || '',
    b.destination || '', b.bookingType || '', b.service || '',
    b.qty || '', b.weight || '', b.unit || '', b.rate || '',
    b.itemDesc || '', b.coloader || '', b.eta || '', 'Booked',
    b.awb || '', b.notes || '', 'Admin'
  ];

  s.appendRow(data);

  const amount =
    parseFloat(b.rate || 0) * parseFloat(b.weight || 1);

  return jsonOut({
    ok: true,
    data: {
      orderId,
      invoiceNo,
      amount: amount.toFixed(2)
    }
  });
}

/********************* STATUS UPDATE ************************/
function handleStatus(b) {
  const s = sheet();
  const l = logSheet();
  const rows = s.getDataRange().getValues();
  const id = (b.id || '').trim();
  const awb = (b.awb || '').trim();
  let found = false;

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (row[1] === id || row[22] === awb) {
      // Update main sheet
      s.getRange(i + 1, 22).setValue(b.status);
      s.getRange(i + 1, 21).setValue(b.eta);
      s.getRange(i + 1, 19).setValue(b.coloader);
      s.getRange(i + 1, 23).setValue(b.awb || row[22]);
      s.getRange(i + 1, 24).setValue(b.note);
      found = true;

      // Log entry
      l.appendRow([
        new Date(),
        id || row[1],
        awb || row[22],
        b.status,
        b.eta,
        b.location || '',
        b.coloader || '',
        b.note || '',
        'Admin'
      ]);
      break;
    }
  }

  if (!found)
    return jsonOut({ ok: false, error: 'Order not found' });

  return jsonOut({ ok: true, message: 'Status updated successfully' });
}

/********************* SEARCH ************************/
function handleSearch(b) {
  const s = sheet();
  const vals = s.getDataRange().getValues();
  const headers = vals[0];
  const out = [];

  for (let i = 1; i < vals.length; i++) {
    const obj = {};
    headers.forEach((h, j) => (obj[h] = vals[i][j]));
    out.push(obj);
  }

  return jsonOut({ ok: true, data: { rows: out } });
}

/********************* ANALYTICS ************************/
function handleAnalytics() {
  const s = sheet();
  const vals = s.getDataRange().getValues();
  const headers = vals[0];
  const statusIdx = headers.indexOf('Status');
  const counts = {};

  for (let i = 1; i < vals.length; i++) {
    const st = vals[i][statusIdx] || 'Unknown';
    counts[st] = (counts[st] || 0) + 1;
  }

  return jsonOut({ ok: true, data: counts });
}

/********************* PRINT ************************/
function handlePrint(b) {
  const s = sheet();
  const id = b.id || '';
  const vals = s.getDataRange().getValues();
  let rowData = null;

  for (let i = 1; i < vals.length; i++) {
    if (vals[i][1] === id) {
      rowData = vals[i];
      break;
    }
  }

  if (!rowData)
    return jsonOut({ ok: false, error: 'Order not found' });

  const html = `
  <html><body style="font-family:Arial">
  <h2 style="color:#0B3B8C">Transline Cargo & Logistics</h2>
  <h4>Invoice No: ${rowData[2]}</h4>
  <p><b>Order ID:</b> ${rowData[1]}<br>
  <b>Date:</b> ${rowData[0]}<br>
  <b>Customer:</b> ${rowData[3]}</p>
  <hr>
  <h4>Shipment Details</h4>
  <p><b>Sender:</b> ${rowData[4]}, ${rowData[6]}, ${rowData[7]}<br>
  <b>Receiver:</b> ${rowData[8]}, ${rowData[10]}, ${rowData[11]}<br>
  <b>Type:</b> ${rowData[12]} | <b>Service:</b> ${rowData[13]}<br>
  <b>Qty:</b> ${rowData[14]} | <b>Weight:</b> ${rowData[15]} ${rowData[16]}<br>
  <b>Rate:</b> ₹${rowData[17]} | <b>Amount:</b> ₹${(rowData[15]*rowData[17]).toFixed(2)}</p>
  <p><b>Co-loader:</b> ${rowData[19]}<br><b>ETA:</b> ${rowData[20]}<br><b>Status:</b> ${rowData[21]}</p>
  <p><b>Notes:</b> ${rowData[23]||''}</p>
  <hr>
  <p style="font-size:0.85rem;color:#666">Generated automatically by Transline Admin System.</p>
  </body></html>`;

  const blob = Utilities.newBlob(html, 'text/html', 'invoice.html');
  const pdf = blob.getAs('application/pdf');
  const pdfFile = DriveApp.createFile(pdf).setName(`${rowData[2]}.pdf`);
  return jsonOut({ ok: true, data: { url: pdfFile.getUrl() } });
}
