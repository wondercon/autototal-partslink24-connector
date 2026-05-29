# autototal-partslink24-connector

Small HTTP service that logs into `partslink24`, runs a VIN + part-name lookup with Playwright, and returns JSON.

## What It Exposes

`POST /search`

Request:

```json
{
  "platformName": "partslink24",
  "vin": "YV1ZW72UDK2030600",
  "filters": {
    "brand": "VOLVO",
    "partName": "brake pads"
  },
  "allowAmbiguousResults": false
}
```

Typical response:

```json
{
  "success": true,
  "found": true,
  "matches": [
    {
      "resultLabel": "31423652",
      "rowText": "31423652 Brake pad kit ..."
    }
  ],
  "evidence": {
    "pageUrl": "https://www.partslink24.com/...",
    "pageTitle": "Volvo YV1ZW72UDK2030600 - partslink24",
    "uiVariant": "old",
    "timestamp": "2026-05-28T06:48:43.994Z"
  }
}
```

## Required Environment

```bash
PARTSLINK24_COMPANY_ID=ro-213915
PARTSLINK24_USERNAME=your-username
PARTSLINK24_PASSWORD=your-password
```

Optional:

```bash
CONNECTOR_BEARER_TOKEN=
PORT=8080
HEADLESS=true
NAV_TIMEOUT_MS=30000
STORAGE_STATE_PATH=./data/storageState.json
SCREENSHOT_DIR=./data/screenshots
LOG_LEVEL=info
```

## Run Locally

```bash
npm install
npx playwright install chromium
npm start
```

Health check:

```bash
curl http://localhost:8080/healthz
```

## Example Request

```bash
curl -X POST http://localhost:8080/search \
  -H 'Content-Type: application/json' \
  -d '{
    "platformName": "partslink24",
    "vin": "WVWZZZ6RZFY103906",
    "filters": {
      "brand": "VOLKSWAGEN",
      "partName": "brake pads"
    },
    "allowAmbiguousResults": false
  }'
```

If `CONNECTOR_BEARER_TOKEN` is set:

```bash
curl -X POST http://localhost:8080/search \
  -H 'Authorization: Bearer YOUR_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{ ... }'
```

## Expose It With ngrok

Start the service locally:

```bash
npm start
```

Expose port `8080`:

```bash
ngrok http 8080
```

Use the generated HTTPS URL:

```bash
https://<your-ngrok-id>.ngrok-free.app/search
```

If bearer auth is enabled, the remote caller must send the bearer token too.

## Notes

- The service supports both old and new partslink24 UI variants.
- Session state is persisted in `data/storageState.json`.
- Terminal-state screenshots are written to `data/screenshots`.
- Main service flow: `src/partslink24.js`
- UI-specific selectors: `src/ui/new.js`, `src/ui/old.js`

## Common Errors

- `LOGIN_FAILED`: login did not reach `brandMenu.do`
- `BRAND_NOT_FOUND`: brand label did not match the menu
- `PART_SEARCH_FAILED`: part search UI did not become usable
- `CONNECTOR_INTERNAL_ERROR`: unexpected runtime failure
