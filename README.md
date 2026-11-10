# Mile 1 Outreach

A small CRM for Mile 1's own prospecting. Add a prospect by name or website, read the gaps in their content, find the person who owns it, then draft every message from first touch to kickoff.

Pipeline: Prospect, Gaps, POC, Outreach, Follow-up, Meeting, Converted (plus Parked).

## What is in the box

```
server.js            Express server: password, REST API, static files
lib/store.js         Saved data: Postgres when DATABASE_URL is set, otherwise a JSON file
lib/ai.js            Calls the Gemini API (the prompts live in public/index.html)
lib/fetchsite.js     Reads a prospect's website (homepage, about, blog) with SSRF protection
lib/seed.js          Three example prospects
public/index.html    The whole app (Mile 1 brand: charcoal, blue, sand, the climbing-bars mark)
public/shim.js       Connects the page to the REST API
public/fonts.css     Where to switch on Satoshi (see "Brand font")
render.yaml          Render Blueprint: web service + Postgres
scripts/selftest.js  Offline tests. Run: npm test
```

## Run it locally

```bash
npm install
cp .env.example .env        # fill in GEMINI_API_KEY and APP_PASSWORD
node --env-file=.env server.js
# open http://localhost:3000  (any username, the password you set)
```

With no `DATABASE_URL`, data is saved to `./data/db.json`. To load the three example prospects, stop the server and run `npm run seed`.

## Deploy on Render

1. Push this folder to a GitHub repository.
2. In Render choose **New > Blueprint**, pick the repository. Render reads `render.yaml` and creates the web service and the Postgres database.
3. When asked, enter `APP_PASSWORD` (the password for the whole app) and `GEMINI_API_KEY`.
4. Deploy. Open the service URL, sign in with any username and that password.
5. Optional: add the environment variable `SEED_EXAMPLES=true` for the first deploy to start with three example prospects. Remove them from the app with "Remove example prospects", then delete the variable.

Doing it by hand instead: create a Postgres database, then a Web Service with build command `npm install`, start command `npm start`, health check path `/healthz`, and the environment variables below.

| Variable | Required | Purpose |
| --- | --- | --- |
| `APP_PASSWORD` | yes in production | Protects everything. The server refuses to start in production without it. |
| `GEMINI_API_KEY` | yes | Drafting and gap reads. Create one at aistudio.google.com/apikey. |
| `DATABASE_URL` | yes on Render | Postgres connection string. Without it, data is lost on every deploy. |
| `GEMINI_MODEL` | no | Defaults to `gemini-3.8-flash`. |
| `SEED_EXAMPLES` | no | `true` seeds examples into an empty database. |

## Things worth knowing

- **Free plans.** Free Render web services sleep when idle, so the first load after a quiet spell takes a while. Check Render's current terms for free Postgres before relying on it: free databases have historically been time limited. For long-term client data use a paid database, and keep an occasional `pg_dump` backup.
- **Cost.** Each gap read or draft is one Gemini API call on your Google account. The server limits the AI route to 30 requests a minute.
- **Security.** One shared password over HTTPS. That is enough for a private tool but is not per-user accounts. The website reader only fetches public http(s) addresses on ports 80 and 443 and refuses private, local and cloud-metadata addresses, including after redirects.
- **Read website.** Some sites block automated readers or build pages in JavaScript. When that happens the app says so and you paste the text yourself.
- **Brand font.** Satoshi could not be bundled. Download it from fontshare.com, put `Satoshi-Regular.woff2`, `Satoshi-Medium.woff2` and `Satoshi-Bold.woff2` in `public/fonts/`, and uncomment the rules in `public/fonts.css`. Until then the app uses DM Sans, the fallback named in the brand's own logo files.
- **Your details.** Open "Sender profile" in the app and set your name, what Mile 1 offers, and real proof points. Drafts only quote proof points you enter. The default name is "Joel", which was a guess.
- **Changing the writing rules.** The voice rules and every prompt are in `public/index.html` (search for `VOICE_RULES`, `gapPrompt` and `msgPrompt`).
