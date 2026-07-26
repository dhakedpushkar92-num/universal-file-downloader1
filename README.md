# Fetchr — Universal File Downloader

A production-ready, mobile-first web app for downloading **publicly accessible** files from a direct URL. Paste a link, review the file's metadata, and stream it straight to your device with a live progress indicator.

![status](https://img.shields.io/badge/status-production--ready-8b5cf6) ![node](https://img.shields.io/badge/node-%3E%3D18-22d3ee)

---

## What this is (and isn't)

This tool fetches files exactly the way a browser would if you clicked a public download link: a plain, unauthenticated HTTP(S) request to the URL you provide.

**It does not, and will not:**
- Bypass logins, paywalls, tokens, or cookies
- Solve or circumvent CAPTCHAs
- Bypass Cloudflare or other bot-protection challenges
- Circumvent DRM or platform download restrictions
- Scrape pages that require authentication

If a URL requires any of the above, the app reports the failure rather than working around it.

---

## Folder structure

```
universal-file-downloader/
├── client/                      # Static frontend (deploy to Vercel)
│   ├── index.html
│   ├── vercel.json
│   └── assets/
│       ├── css/style.css
│       └── js/app.js
├── server/                      # Express API (deploy to Render/Railway)
│   ├── server.js
│   ├── package.json
│   ├── .env.example
│   ├── routes/
│   │   └── downloadRoutes.js
│   ├── controllers/
│   │   └── downloadController.js
│   ├── services/
│   │   └── downloadService.js
│   ├── middleware/
│   │   ├── security.js
│   │   └── rateLimiter.js
│   └── utils/
│       ├── urlValidator.js
│       ├── fileHelpers.js
│       ├── mediafireResolver.js
│       └── logger.js
├── API.md
├── DEPLOYMENT.md
└── README.md
```

---

## Features

**Frontend**
- Glassmorphism cards over an animated aurora gradient background
- Dark-mode-first, fully responsive (mobile → desktop)
- Paste / Copy / Clear controls, Enter-to-download
- Live file info card: name, extension, size, content type
- Circular + linear progress indicators while checking and downloading
- Toast notifications for success/error/info states
- Local download history (persisted in `localStorage`), clearable

**Backend**
- `POST /info` — HEAD-based metadata lookup (falls back to a ranged GET)
- `POST /download` — streamed proxy download with byte-accurate progress headers
- `GET /health` — health check for hosting platforms
- **MediaFire public file link support** — detects `mediafire.com/file/...` links, resolves the official static download link from the public page, and reports MediaFire's displayed filename/size; refuses folder links, password-protected files, and bot-protection challenges instead of working around them (see [API.md](./API.md#mediafire-support))
- SSRF-hardened URL validation (blocks localhost, private/reserved IP ranges, and DNS-rebinding via per-redirect re-validation) — applied to both direct URLs and resolved MediaFire CDN links
- Per-IP rate limiting, Helmet security headers, strict CORS allowlist
- Request timeouts, max file size enforcement, structured Winston logging

---

## Quick start

```bash
# Backend
cd server
cp .env.example .env
npm install
npm run dev

# Frontend (in a second terminal)
cd client
npx serve .
```

Open the served frontend URL in your browser, paste a direct file link (e.g. a sample PDF or image URL), and click **Get**.

Full deployment instructions: see [DEPLOYMENT.md](./DEPLOYMENT.md).
API reference: see [API.md](./API.md).

---

## Tech stack

| Layer | Tech |
|---|---|
| Frontend | HTML5, Tailwind CSS (CDN), Vanilla JS |
| Backend | Node.js, Express.js, Axios |
| Security | Helmet, CORS allowlist, express-rate-limit, ipaddr.js (SSRF checks) |
| Logging | Winston + Morgan |
| Hosting | Vercel (frontend) · Render/Railway (backend) |

---

## Configuration

All backend configuration is via environment variables — see [`server/.env.example`](./server/.env.example) for the full list (port, allowed CORS origins, max file size, timeouts, rate limits, log level).

The frontend reads the backend URL from a single inline variable in `client/index.html`:
```html
<script>window.__API_BASE_URL__ = 'https://your-backend.onrender.com';</script>
```

---

## License

MIT — build on it freely.
