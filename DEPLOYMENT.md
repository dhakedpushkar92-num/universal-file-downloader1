# Deployment Guide

The project has two independent deployables: a static **frontend** (`/client`) and a Node **backend** (`/server`). Deploy the backend first so you have its URL to plug into the frontend.

---

## 1. Backend → Render (or Railway)

### Render
1. Push this repo to GitHub/GitLab.
2. In Render: **New → Web Service** → connect the repo.
3. Set **Root Directory** to `server`.
4. Build command: `npm install`
5. Start command: `npm start`
6. Add environment variables (from `server/.env.example`):
   - `NODE_ENV=production`
   - `PORT=5000` (Render provides its own `PORT`; the app reads `process.env.PORT` automatically)
   - `ALLOWED_ORIGINS=https://your-frontend.vercel.app`
   - `MAX_FILE_SIZE_BYTES=2147483648`
   - `REQUEST_TIMEOUT_MS=15000`
   - `RATE_LIMIT_WINDOW_MS=60000`
   - `RATE_LIMIT_MAX_REQUESTS=30`
   - `LOG_LEVEL=info`
7. Deploy. Note the public URL, e.g. `https://fetchr-api.onrender.com`.
8. Verify: `GET https://fetchr-api.onrender.com/health` should return `{ "success": true, ... }`.

### Railway (alternative)
1. **New Project → Deploy from GitHub repo**.
2. Set the service's root directory to `server`.
3. Railway auto-detects Node; confirm start command `npm start`.
4. Add the same environment variables as above in the **Variables** tab.
5. Generate a public domain under **Settings → Networking**.

---

## 2. Frontend → Vercel

1. In Vercel: **New Project** → import the repo.
2. Set **Root Directory** to `client`.
3. Framework preset: **Other** (it's static HTML/CSS/JS — no build step needed).
4. Before deploying, open `client/index.html` and set the backend URL:
   ```html
   <script>
     window.__API_BASE_URL__ = 'https://fetchr-api.onrender.com';
   </script>
   ```
5. Deploy. Vercel will serve `index.html` and the `/assets` folder as-is.

> Tip: if you'd rather not hardcode the URL, you can template it at build time with a simple `sed` replace in a Vercel build command, but for a no-build static site editing the inline script is the simplest path.

---

## 3. Connect the two

1. Copy your Vercel frontend URL, e.g. `https://fetchr.vercel.app`.
2. In Render/Railway, set the backend's `ALLOWED_ORIGINS` to that exact URL (comma-separate multiple origins if needed, e.g. for a custom domain too).
3. Redeploy the backend so the new CORS setting takes effect.
4. Open the frontend, paste a public file URL, and confirm `/info` and `/download` succeed.

---

## 4. Local development

**Backend**
```bash
cd server
cp .env.example .env
npm install
npm run dev   # nodemon, restarts on change
```

**Frontend**
Just open `client/index.html` in a browser, or serve it statically:
```bash
cd client
npx serve .
```
Leave `window.__API_BASE_URL__` pointed at `http://localhost:5000` for local testing.

---

## 5. Health checks & monitoring

- Render/Railway can both be configured to ping `GET /health` as the service health check path.
- Logs are written to stdout (visible in both platforms' log viewers) and, in production, additionally to `server/logs/*.log` if the filesystem is persistent on your plan.
