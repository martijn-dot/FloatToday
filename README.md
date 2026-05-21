# Float Today

Daily Float schedule overview for Vercel.

## How it works

- `index.html` renders the schedule in the browser.
- `api/float.mjs` runs on Vercel and calls the Float API.
- The Float token stays private in the `FLOAT_API_TOKEN` environment variable.

## Deploy

1. Create a Float API token in Float account settings.
2. In Vercel, add an environment variable named `FLOAT_API_TOKEN`.
3. Deploy this folder to Vercel.

The page will call `/api/float?date=YYYY-MM-DD` automatically when hosted. If you open `index.html` directly from your computer, it uses mock data.
