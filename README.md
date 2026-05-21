# WI-Fi Voucher

Single-page Wi-Fi voucher request form for ARTSTUDIO Nevsky.

The page sends guest details to a Google Apps Script web app. Apps Script reserves one or more voucher codes from the `Пароли` sheet and appends the request to `запрошено через QR-код`.

## Production Wiring

- Spreadsheet: `127zHlLiojIdj60UJ42vgIU1SlCftqyB-15C9Ur26YL0`
- Voucher source sheet: `Пароли`
- Request archive sheet: `запрошено через QR-код`
- Frontend endpoint: `CONFIG.scriptUrl` in `index.html`
- Apps Script source: `Code.gs`

If the Apps Script deployment URL changes, update only `CONFIG.scriptUrl` in `index.html`.

## Data Contract

Frontend request:

```json
{
  "fio": "Guest name",
  "apartment": "214",
  "num_devices": 6,
  "language": "ru"
}
```

Apps Script response:

```json
{
  "vouchers": ["N99C-UGNC", "NC7J-8YA3"],
  "language": "ru"
}
```

Errors are returned as `{ "error": "..." }`. The frontend intentionally shows guests a generic availability message for backend and network failures.

## Spreadsheet Shape

`Пароли`:

| A |
| --- |
| Пароль |
| N99C-UGNC |

`запрошено через QR-код`:

| A | B | C | D |
| --- | --- | --- | --- |
| Дата и время | ФИО | № апартамента | Пароль |

Apps Script stores the next voucher row in Script Properties as `NEXT_ROW`. If the request archive contains only the header row, the script treats the voucher list as fresh and resets a stale `NEXT_ROW` value back to row 2.

## Operations

- Run `resetNextRow()` in the Apps Script editor to reset voucher issuance to row 2.
- Open the web app URL with `GET` to confirm the deployed script version. The response should include `status: "ok"` and `version`.
- Run `getDebugState()` in the Apps Script editor to inspect `NEXT_ROW`, source sheet last row, and request archive last row.

After changing Apps Script code, update the existing web app deployment with a new version. Saving the file alone does not update the public `/exec` endpoint.

## Safety Notes

- Guest-entered values and voucher codes are rendered as text nodes, not trusted HTML.
- The form validates name, apartment, and device count on the client and the Apps Script backend.
- Apps Script uses `LockService` to prevent concurrent requests from receiving the same voucher.
- The backend does not return internal exception details to guests.
