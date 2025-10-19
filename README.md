# RateGenius — Dynamic Pricing for Self-Storage (Render + Vercel ready)

This repo contains:
- Frontend (Vite + React) deploy-ready to Vercel
- Backend (Node + Express + Playwright) deploy-ready to Render
- render.yaml and vercel.json for one-click-ish deployments
- Playwright scraping that visits public websites returned from Google Places and extracts price hints

IMPORTANT:
- Provide a valid `GOOGLE_PLACES_API_KEY` before running in production.
- Playwright runs headless browsers; ensure the target hosting plan allows Playwright (Render supports Docker).
- Respect robots.txt and site ToS. This scraper focuses on public data only.

Quick local dev (without Docker)
1. Backend
   ```bash
   cd backend
   npm install
   # install browsers
   npx playwright install --with-deps
   npm run dev
   ```
2. Frontend
   ```bash
   cd frontend
   npm install
   npm run dev
   ```
3. Test endpoints:
   - Frontend dev runs on Vite default port; it proxies /api to backend during dev via Vite config.

Docker (recommended for parity with Render)
```bash
docker-compose up --build
```

Deploy notes:
- Frontend: point Vercel to `frontend/` and set `VITE_API_URL` to your backend URL.
- Backend: deploy the `backend/` Docker image to Render (render.yaml provided). Set env vars in Render dashboard.

ENV variables (copy to backend/.env or set in Render):
- GOOGLE_PLACES_API_KEY=your_key
- PORT=5000
- ALLOWED_ORIGIN=https://your-frontend-domain


## One-click deploy guide (high level)

1. Push this repo to GitHub.
2. On Render: Create a new service from `render.yaml` (connect GitHub) and set env var `GOOGLE_PLACES_API_KEY`.
3. On Vercel: Create a new project, point to frontend folder, set env `VITE_API_URL` to Render service URL.

After both build, open your Vercel frontend and it will call the Render backend.
