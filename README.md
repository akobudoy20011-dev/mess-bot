# Messenger Bot (cookie-based login)

Automates a personal Facebook account via Messenger using a saved browser
session (`appState`) instead of a username/password or the official API.

⚠️ **Read this first:** Facebook's Terms of Service prohibit automating a
personal account outside their official Messenger Platform API. Using this
kind of bot can get the account flagged, rate-limited, or banned — this is
more likely if you send lots of messages fast, or contact people who haven't
messaged the bot first. Use at your own risk, ideally on a low-stakes/burner
account, not your main one.

## 1. Get your cookies

1. Log into Facebook normally in your browser.
2. Install a cookie-export extension (e.g. "EditThisCookie" or "Cookie-Editor").
3. Export cookies for `facebook.com` as JSON.
4. Save that JSON — this is your `appState` / `FB_COOKIES` value.

Cookies expire. If the bot suddenly can't log in anymore, redo this step.

## 2. Run locally

```bash
npm install
FB_COOKIES="$(cat cookies.json)" ADMIN_IDS="your_fb_id" node index.js
```

## 3. Push to GitHub

```bash
git init
git add .
git commit -m "initial commit"
git branch -M main
git remote add origin <your-repo-url>
git push -u origin main
```

`cookies.json` is git-ignored — never commit real session cookies to a repo,
public or private.

## 4. Deploy on Render

1. New → Web Service → connect your GitHub repo.
2. Build command: `npm install`
3. Start command: `npm start`
4. Environment variables (Render dashboard → Environment):
   - `FB_COOKIES` → paste the full cookie JSON as one line
   - `ADMIN_IDS` → comma-separated Facebook user IDs allowed to use admin commands
   - `STARTUP_THREAD_ID` → (optional) thread ID to message on boot
5. Deploy. Render's free tier spins down when idle — the bot's Messenger
   listener drops with it. For an always-on bot, use a paid instance type or
   a scheduled ping to keep it awake.

## Commands built in

- `!ping` → replies "pong"
- `!help` → lists commands
- `!broadcast <text>` → admin-only, sends `<text>` back to the thread

## Trigger-word banter

`triggers.js` defines 5 groups of preset one-liners (bot jokes, trash talk,
casual comebacks, short one-liners, deflections). Each group cycles through
its own list in order — every time its trigger fires, it sends the next line
and wraps back to the start after the last one. The cycle position resets
whenever the bot restarts (e.g. every Render redeploy).

Single-word triggers (like `sige`, `ano`, `o`, `k`) only match whole words,
not substrings — but they're still common words, so expect them to fire
often in normal conversation. Edit the `triggers` arrays in `triggers.js` to
narrow or change them.

Add your own logic inside `handleMessage()` in `index.js`.


## YouTube playback

YouTube may block downloads from cloud-hosted server IPs with a bot check. If `!play` reports `Sign in to confirm you’re not a bot` or `Failed to extract any player response`, export a fresh **Netscape-format** cookie file for `youtube.com` and add its contents as the `YOUTUBE_COOKIES` environment variable.

Do not commit YouTube cookies to GitHub. The bot writes this secret to a temporary file only while downloading and deletes it afterward. After adding the variable in Render, redeploy the service.


## Eclipse RPG

The bot now includes a persistent RPG foundation under the !rpg command. Character profiles, domains, buildings, armies, and marches are stored in Neon. RPG purchases use the existing wallet and banking system; use !withdraw <amount> to move banked coins into the wallet before spending.

- !rpg help — show RPG commands
- !rpg profile — view character and balances
- !rpg class knight — choose a class
- !rpg property buy cottage — start a domain
- !rpg build farm — develop a building
- !rpg train infantry 10 — train troops
- !rpg march ironspine — travel by map distance

Marches persist across restarts and are not limited by a global two-minute cap.

## Gemini AI configuration

Lucien uses the official Google Gemini API. Set these environment variables in Render (never commit them):

- GEMINI_API_KEY — required Gemini API key
- AI_MODEL — required Gemini model name, such as gemini-2.0-flash
- ALAIZA_MESSENGER_ID — the authorized Devoura/Alaiza Messenger user ID

The AI handler checks authorization before calling Gemini. Unauthorized users do not trigger an AI request.
