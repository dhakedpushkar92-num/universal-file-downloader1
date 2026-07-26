# API Documentation

Base URL (local): `http://localhost:5000`
Base URL (production): your deployed Render/Railway URL, e.g. `https://fetchr-api.onrender.com`

All responses are JSON except `POST /download`, which streams a binary file body on success.

---

## `GET /health`

Liveness probe used by the hosting platform and for manual checks.

**Response `200`**
```json
{ "success": true, "status": "ok", "uptimeSeconds": 1234.5 }
```

---

## `POST /info`

Fetches metadata about a remote file (filename, extension, size, content type) **without** downloading the file body. Internally issues a `HEAD` request (falling back to a 1-byte ranged `GET` if the server rejects `HEAD`).

If the URL is a **public MediaFire file page** (`mediafire.com/file/...`), the server first loads that public page, extracts MediaFire's own static download link and displayed filename/size, then runs the same metadata check against that resolved link. See "MediaFire support" below for exact behavior and limits.

**Request body**
```json
{ "url": "https://example.com/files/report.pdf" }
```

**Response `200`**
```json
{
  "success": true,
  "data": {
    "filename": "report.pdf",
    "extension": "pdf",
    "contentType": "application/pdf",
    "sizeBytes": 2485760,
    "sizeHuman": "2.37 MB",
    "acceptsRanges": true,
    "status": "available",
    "finalUrl": "https://example.com/files/report.pdf"
  }
}
```

**Response `200` for a MediaFire link** — includes two extra fields:
```json
{
  "success": true,
  "data": {
    "filename": "presentation.pptx",
    "extension": "pptx",
    "contentType": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "sizeBytes": 5242880,
    "sizeHuman": "5.00 MB",
    "acceptsRanges": true,
    "status": "available",
    "finalUrl": "https://download2401.mediafire.com/.../presentation.pptx",
    "source": "mediafire",
    "originalUrl": "https://www.mediafire.com/file/abc123/presentation.pptx/file"
  }
}
```

**Error responses**

| Status | Meaning |
|---|---|
| `400` | Missing/invalid URL, disallowed protocol, private/localhost address, embedded credentials, or a MediaFire folder link |
| `403` | MediaFire file is password-protected, or a bot-protection challenge was presented |
| `404` | File not found / removed (including on MediaFire) |
| `422` | MediaFire page loaded but no public static download link could be found on it |
| `502` | Remote server returned an error, requires auth, or is unreachable |
| `504` | Request to the remote server timed out |

```json
{ "success": false, "error": "Requests to private or reserved IP addresses are not permitted." }
```

---

## `POST /download`

Streams the remote file back to the caller as `Content-Disposition: attachment`. Use this directly as the target of a `fetch()` call and read the body as a stream to show progress.

**Request body**
```json
{ "url": "https://example.com/files/report.pdf" }
```

**Success**: `200` with binary body, plus headers:
- `Content-Disposition: attachment; filename="report.pdf"`
- `Content-Type: application/pdf`
- `Content-Length: 2485760` (when known)

**Error responses** (JSON body, same shape as `/info`):

| Status | Meaning |
|---|---|
| `400` | Invalid/disallowed URL |
| `413` | File exceeds `MAX_FILE_SIZE_BYTES` |
| `502` | Remote server error / unreachable |
| `504` | Timed out |

---

## Rate limiting

`POST /info` and `POST /download` are both rate-limited per IP (defaults: 30 requests / 60 seconds, configurable via `RATE_LIMIT_MAX_REQUESTS` / `RATE_LIMIT_WINDOW_MS`). When exceeded:

**Response `429`**
```json
{ "success": false, "error": "Too many requests. Please slow down and try again shortly." }
```

## MediaFire support

Both `/info` and `/download` accept a public MediaFire file page URL (`https://www.mediafire.com/file/<id>/<name>/file`) in place of a direct link.

What happens under the hood:
1. The server issues one plain `GET` to the public MediaFire page — no login, no cookies, no session reuse.
2. It reads the **static** download link MediaFire already renders into that page's HTML for anonymous visitors (`#downloadButton`'s `href`). It never executes page JavaScript and never decodes any obfuscated/scrambled anti-scraping token.
3. That resolved CDN link is validated with the same SSRF checks as any other URL, then used for the normal HEAD/stream flow.

What it refuses to do, by design:
- **Folder links** (`mediafire.com/folder/...`) — not supported, returns `400`.
- **Password-protected files** — detected from the page's password form; returns `403` instead of prompting for or guessing a password.
- **Removed/invalid files** — returns `404`.
- **Bot-protection / CAPTCHA interstitials** — returns `403` rather than attempting to solve or bypass them.
- **Pages with no static download link present** (e.g. requiring extra verification) — returns `422` and asks the user to open the page manually.

## Security notes

- Only `http:` and `https:` URLs are accepted.
- URLs (and every redirect hop) are resolved and checked against private/loopback/link-local/reserved IP ranges before any request is made, to prevent SSRF. This includes the MediaFire page URL and its resolved CDN download URL.
- No cookies, saved credentials, or session tokens are ever sent with outbound requests — the server only forwards the URL you give it.
- The server does not attempt to solve CAPTCHAs or bypass bot-protection (e.g. Cloudflare challenge pages); such responses surface as a `403`/`502` error.
