const CONFIG = Object.freeze({
  VERSION: '2026-05-21-next-row-diagnostics',
  SPREADSHEET_ID: '127zHlLiojIdj60UJ42vgIU1SlCftqyB-15C9Ur26YL0',
  PASSWORDS_SHEET: 'Пароли',
  REQUESTS_SHEET: 'запрошено через QR-код',
  FIRST_DATA_ROW: 2,
  VOUCHER_COLUMN: 1,
  ARCHIVE_COLUMNS: 4,
  DEVICES_PER_VOUCHER: 5,
  MAX_DEVICES: 20,
  MAX_FIO_LENGTH: 120,
  MAX_APARTMENT: 999,
  NEXT_ROW_PROPERTY: 'NEXT_ROW'
});

function doPost(e) {
  const lock = LockService.getScriptLock();

  if (!lock.tryLock(30000)) {
    return jsonOut({ error: 'Busy' });
  }

  try {
    const data = parseRequest(e);
    const fio = normalizeText(data.fio);
    const apartment = normalizeText(data.apartment);
    const numDevices = Number.parseInt(data.num_devices, 10);
    const language = data.language === 'en' ? 'en' : 'ru';

    if (!isValidRequest(fio, apartment, numDevices)) {
      return jsonOut({ error: 'Bad request' });
    }

    const spreadsheet = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    const passwordsSheet = getRequiredSheet(spreadsheet, CONFIG.PASSWORDS_SHEET);
    const requestsSheet = getRequiredSheet(spreadsheet, CONFIG.REQUESTS_SHEET);
    const voucherCount = Math.ceil(numDevices / CONFIG.DEVICES_PER_VOUCHER);
    const reservation = reserveVouchers(passwordsSheet, requestsSheet, voucherCount);

    appendRequest(requestsSheet, fio, apartment, reservation.vouchers);
    reservation.commit();

    return jsonOut({ vouchers: reservation.vouchers, language });
  } catch (error) {
    console.error('Error in doPost:', error);
    return jsonOut({ error: error && error.publicMessage ? error.publicMessage : 'Internal error' });
  } finally {
    try {
      lock.releaseLock();
    } catch (error) {
      console.warn('Could not release lock:', error);
    }
  }
}

function doGet() {
  return jsonOut({ status: 'ok', version: CONFIG.VERSION });
}

function doOptions() {
  return ContentService
    .createTextOutput('')
    .setMimeType(ContentService.MimeType.TEXT);
}

function resetNextRow() {
  PropertiesService
    .getScriptProperties()
    .setProperty(CONFIG.NEXT_ROW_PROPERTY, String(CONFIG.FIRST_DATA_ROW));

  return `NEXT_ROW reset to ${CONFIG.FIRST_DATA_ROW}`;
}

function getDebugState() {
  const spreadsheet = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const passwordsSheet = getRequiredSheet(spreadsheet, CONFIG.PASSWORDS_SHEET);
  const requestsSheet = getRequiredSheet(spreadsheet, CONFIG.REQUESTS_SHEET);
  const props = PropertiesService.getScriptProperties();

  return {
    version: CONFIG.VERSION,
    nextRow: props.getProperty(CONFIG.NEXT_ROW_PROPERTY) || null,
    passwordsLastRow: passwordsSheet.getLastRow(),
    requestsLastRow: requestsSheet.getLastRow()
  };
}

function parseRequest(e) {
  const contents = e && e.postData && e.postData.contents ? e.postData.contents : '{}';
  try {
    return JSON.parse(contents);
  } catch (error) {
    return {};
  }
}

function normalizeText(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function isValidRequest(fio, apartment, numDevices) {
  const apartmentNumber = Number.parseInt(apartment, 10);

  return Boolean(fio)
    && fio.length <= CONFIG.MAX_FIO_LENGTH
    && /^\d{1,3}$/.test(apartment)
    && Number.isInteger(apartmentNumber)
    && apartmentNumber >= 1
    && apartmentNumber <= CONFIG.MAX_APARTMENT
    && Number.isInteger(numDevices)
    && numDevices >= 1
    && numDevices <= CONFIG.MAX_DEVICES;
}

function getRequiredSheet(spreadsheet, sheetName) {
  const sheet = spreadsheet.getSheetByName(sheetName);
  if (!sheet) {
    throw new Error(`Missing sheet: ${sheetName}`);
  }
  return sheet;
}

function reserveVouchers(passwordsSheet, requestsSheet, voucherCount) {
  const props = PropertiesService.getScriptProperties();
  reconcileNextRow(props, requestsSheet);

  const lastRow = passwordsSheet.getLastRow();
  if (lastRow < CONFIG.FIRST_DATA_ROW) {
    throwPublicError('No vouchers available');
  }

  const nextRow = getNextRow(props, lastRow);
  const rowsToRead = lastRow - nextRow + 1;

  if (rowsToRead < voucherCount) {
    throwPublicError('Not enough vouchers');
  }

  const values = passwordsSheet
    .getRange(nextRow, CONFIG.VOUCHER_COLUMN, rowsToRead, 1)
    .getValues()
    .map((row) => normalizeText(row[0]));

  const vouchers = [];
  let consumedRows = 0;

  for (const value of values) {
    consumedRows += 1;
    if (value) {
      vouchers.push(value);
    }
    if (vouchers.length === voucherCount) {
      break;
    }
  }

  if (vouchers.length < voucherCount) {
    throwPublicError('Not enough vouchers');
  }

  const nextAvailableRow = nextRow + consumedRows;

  return {
    vouchers,
    commit() {
      props.setProperty(CONFIG.NEXT_ROW_PROPERTY, String(nextAvailableRow));
    }
  };
}

function reconcileNextRow(props, requestsSheet) {
  const stored = Number.parseInt(props.getProperty(CONFIG.NEXT_ROW_PROPERTY), 10);
  const archiveHasRequests = requestsSheet.getLastRow() > 1;

  if (!archiveHasRequests && Number.isInteger(stored) && stored > CONFIG.FIRST_DATA_ROW) {
    props.setProperty(CONFIG.NEXT_ROW_PROPERTY, String(CONFIG.FIRST_DATA_ROW));
  }
}

function getNextRow(props, lastRow) {
  const stored = Number.parseInt(props.getProperty(CONFIG.NEXT_ROW_PROPERTY), 10);
  if (Number.isInteger(stored) && stored >= CONFIG.FIRST_DATA_ROW && stored <= lastRow + 1) {
    return stored;
  }
  return CONFIG.FIRST_DATA_ROW;
}

function appendRequest(sheet, fio, apartment, vouchers) {
  const timestamp = Utilities.formatDate(
    new Date(),
    Session.getScriptTimeZone() || 'Europe/Moscow',
    'dd.MM.yyyy HH:mm:ss'
  );

  sheet.appendRow([
    timestamp,
    fio,
    apartment,
    vouchers.join(', ')
  ].slice(0, CONFIG.ARCHIVE_COLUMNS));
}

function throwPublicError(message) {
  const error = new Error(message);
  error.publicMessage = message;
  throw error;
}

function jsonOut(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
