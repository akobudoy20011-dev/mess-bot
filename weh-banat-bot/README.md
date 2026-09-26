# /weh Banat Bot

A standalone Messenger bot living inside the weh-banat-bot/ folder of the ECLIPSE repository.

It does not modify or depend on ECLIPSE's existing !banat on/off system.

## Features

- /weh — admin-only toggle for automatic banat
- /weh on — admin-only enable it
- /weh off — admin-only disable it
- /weh status — show the current state
- Reaction-based banat categories
- Dynamic response chance based on message type
- Automatic random Tagalog banat replies
- Every generated banat includes one of the three configured Facebook links
- Link selection is randomized
- Per-thread cooldown and response chance prevent flooding
- Thread state is saved locally in weh-state.json
- Messenger session comes from FB_COOKIES

## Environment

Set:

- FB_COOKIES — JSON cookie/app-state array for the Messenger account
- PORT — optional HTTP health-check port; Render supplies this automatically
- WEH_ADMIN_IDS — comma-separated Messenger user IDs allowed to control WEH; if omitted, the bot also accepts the parent ECLIPSE `ADMIN_IDS` value

Do not commit cookies or app state.

**Important:** run WEH with its own Messenger session/cookie set. Do not run the same Facebook session simultaneously in ECLIPSE and WEH, because two `ws3-fca` listeners using the same account can interfere with each other.

## Render

When deploying this folder as its own Render service from the existing repository, set:

- Root Directory: weh-banat-bot
- Build Command: npm install
- Start Command: npm start

The parent ECLIPSE bot remains untouched.

## Behavior

After /weh is enabled in a thread, normal messages have a limited chance of receiving a banat. The bot ignores its own messages and commands.

Every banat includes one randomly selected Facebook link.
