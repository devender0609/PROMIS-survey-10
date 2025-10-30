
# Adaptive PROMIS — Deployable API (2025-10-30 v2)

## Deploy (GitHub + Vercel)
```powershell
git init
git add .
git commit -m "init: Adaptive PROMIS API (2025-10-30 v2)"
git branch -M main
git remote add origin https://github.com/<USER>/<REPO>.git
git push -u origin main

npx vercel login
npx vercel link --confirm
npx vercel --prod
```

Vercel Settings → Build & Development
- Framework: Other
- Build Command: (blank)
- Output Directory: (blank)
- Node.js Version: 20.x
- Root Directory: (blank)

## API
- GET /api/model
- POST /api/model {"action":"score","domain":"PI","survey_t":61.3}
- POST /api/model {"action":"batch","items":[{"domain":"PF","survey_t":55}]}
- POST /api/model {"action":"route","domain":"A","interim_se":3.6,"theta_t":68,"discordant":true}
