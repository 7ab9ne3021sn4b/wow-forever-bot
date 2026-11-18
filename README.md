# WoW Forever EU Discord bot

Two features, no server needed:

- **Faction lock alerts.** Every 2 minutes it checks the EU **Normal** and **PvP** rulesets in Blizzard's API and posts in your channel when something changes.
- **`/price <item>`** shows the latest auction house prices, with autocomplete on item names. Prices refresh about once an hour.
- **`/rulesets`** shows exactly what Blizzard's API reports right now. Only you see the reply.

It runs on **Cloudflare Workers (free)** and **GitHub Actions (free)**. You do everything in a browser and install nothing.

---

## Setup (about 30 minutes, all in the browser)

You'll collect a handful of values along the way. Paste them into a notepad as you go. They all become **GitHub secrets** in step 6.

### 1. Put this code on GitHub
1. Create a free account at github.com, then click **New repository**.
2. Name it `wow-forever-bot` and make it **Public**. Public repos get unlimited free Actions minutes. Your keys stay private in Secrets, never in the code.
3. Click **uploading an existing file** and drag in everything from this zip, including the `.github` folder. Then commit.
   - Windows hides folders that start with a dot in some views. If `.github` didn't upload, use **Add file → Create new file**, type `.github/workflows/prices.yml` as the name, and paste the contents. Repeat for `deploy.yml` and `register.yml`.

### 2. Blizzard API client
1. Go to https://develop.battle.net/access/clients and click **Create Client**.
2. Any name works. For the redirect URL, use `https://localhost`. Leave the service URL empty.
3. Copy the **Client ID** → `BLIZZ_ID` and the **Client Secret** → `BLIZZ_SECRET`.

### 3. Cloudflare
1. Create a free account at dash.cloudflare.com.
2. **Account ID:** it's shown on the right side of the **Workers & Pages** overview, or in the URL after `dash.cloudflare.com/`. Save it as `CF_ACCOUNT_ID`.
3. **Storage:** go to **Storage & Databases → KV → Create**. Name it `wow-forever-bot`, then copy its **ID** → `CF_KV_ID`.
4. **API token:** go to **My Profile → API Tokens → Create Token** and use the **"Edit Cloudflare Workers"** template. Under Account Resources, choose your account. Create it and copy it → `CF_API_TOKEN`.

### 4. Discord application
1. Go to https://discord.com/developers/applications and click **New Application**. Name it, e.g. "Forever Watch".
2. On **General Information**, copy:
   - **Application ID** → `DISCORD_APP_ID`
   - **Public Key** → `DISCORD_PUBLIC_KEY`
3. On **Bot**, click **Reset Token** and copy it → `DISCORD_BOT_TOKEN`. This is used only to register the commands.
4. (Recommended) For your server ID: in Discord go to **Settings → Advanced → Developer Mode on**, then right-click your server → **Copy Server ID** → `DISCORD_GUILD_ID`. This makes the commands appear instantly in that server.

### 5. Alert channel webhook
In your Discord channel, go to **Edit Channel → Integrations → Webhooks → New Webhook → Copy Webhook URL** → `ALERT_WEBHOOK_URL`.

### 6. Add the secrets on GitHub
In your repo, go to **Settings → Secrets and variables → Actions → New repository secret**. Add each one:

| Secret | From step |
|---|---|
| `BLIZZ_ID`, `BLIZZ_SECRET` | 2 |
| `CF_ACCOUNT_ID`, `CF_KV_ID`, `CF_API_TOKEN` | 3 |
| `DISCORD_APP_ID`, `DISCORD_PUBLIC_KEY`, `DISCORD_BOT_TOKEN`, `DISCORD_GUILD_ID` | 4 |
| `ALERT_WEBHOOK_URL` | 5 |

### 7. Run the three workflows
On the repo's **Actions** tab, click **"I understand… enable them"** if GitHub asks. Then run each of these with **Run workflow**:

1. **Deploy bot.** When it finishes, the log shows your worker's address, e.g. `https://wow-forever-bot.<you>.workers.dev`.
2. **Register Discord commands.**
3. **Update auction prices.** The first run takes a few minutes because it also looks up item names. After that it runs by itself every hour.

### 8. Connect Discord to the worker
1. In the Discord Developer Portal, open **General Information**. Paste the worker address into **Interactions Endpoint URL** and click **Save**. Discord tests the address right away. If it saves, everything is connected.
2. To add the bot to your server, go to **Installation**, tick **Guild Install**, choose scope `applications.commands`, then open the install link and pick your server.

Done. Try `/price Linen Cloth` and `/rulesets`.

---

## After setup

**Find out what the faction lock looks like.** The bot alerts on *any* change in the ruleset's API data. That's because nobody has published what Blizzard's `status` field looks like when a faction is locked. Run `/rulesets` while a faction is locked and again when it isn't, and send me both. I'll then make the alerts read like "Horde locked on PvP" and stop alerts on unrelated changes. If the API doesn't show locks at all, we'll switch the alerts to a different source.

**Label the auction houses (optional).** Blizzard lists 15 auction houses (Alliance, Horde and Blackwater) but doesn't say which ruleset each belongs to. At first, `/price` shows them by name and number, e.g. `Horde Auction House #113`. To work out which is which, compare `/price Linen Cloth` with the in-game price on Normal and on PvP. Then edit `worker/src/house-labels.json` on GitHub, for example:

```json
{
  "110": "Normal – Alliance",
  "113": "Normal – Horde",
  "116": "PvP – Alliance"
}
```

Once you've labelled any houses, `/price` shows **only** the labelled ones, so other rulesets drop out. Saving the file redeploys the bot automatically.

**Keep it alive.** GitHub pauses scheduled workflows in a repo that has had no activity for 60 days. If prices stop updating, go to the Actions tab and click **Enable workflow**, or make any small commit.

## How it works

- `worker/src/index.js` runs the slash commands and the 2-minute ruleset check, all on Cloudflare.
- `scripts/build-prices.mjs` runs hourly on GitHub. It downloads every EU auction house (each about 9 MB) and turns it into a small price table: lowest price, market price (average of the cheapest 15% of units) and units listed. It saves that table to Cloudflare so `/price` can answer instantly.
- Item names come from Blizzard's Forever item data, with Classic Era data as a fallback. Items without a name can still be looked up by their ID.
- Blizzard hasn't documented the Forever API yet. If something breaks after a patch, the Actions log or the `/rulesets` output will show what changed.
