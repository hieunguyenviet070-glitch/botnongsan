# Notibot — Discord Selfbot → Official Bot Forwarder

A Vietnamese Discord bot for the **Play Together** game community. It reads messages from a selfbot account (user account) on source channels and forwards them via an official Discord bot to target channels. Includes an invite-tracking system, reminder embeds, and a slash-command setup panel.

## Stack

- **Runtime:** Node.js (CommonJS)
- **Discord selfbot:** `discord.js-selfbot-v13`
- **Official bot:** `discord.js` v13
- **Database:** MongoDB via Mongoose
- **Package manager:** pnpm (workspace package `@workspace/notibot`)

## How to run

The workflow **Notibot** starts the bot automatically:

```
pnpm --filter @workspace/notibot run dev
```

## Required secrets

Set these in Replit Secrets before starting:

| Secret | Description |
|---|---|
| `DISCORD_TOKEN` | Discord user account token (selfbot) |
| `BOT_TOKEN` | Official Discord bot token |
| `MONGODB_URI` | MongoDB connection string |

Optional:
- `ADMIN_IDS` — comma-separated Discord user IDs for bot admins (defaults to a hardcoded ID in `setup.js`)

## Configuration

Edit `bots/notibot/config.json` to set:

- `channelMappings` — source → target channel pairs (with optional webhook URLs), typed as `seeds`, `weather`, `tools`, or `refresh`
- `targetGuildId` — your Discord server ID
- `setupChannelId` — channel where the slash-command setup panel is posted
- Other flags: `ignoreBots`, `preventPings`, `messageDelay`, etc.

Edit `bots/notibot/emojis.json` to customize seed/weather/tool emojis and role IDs without touching the main code.

## Project structure

```
bots/notibot/
  index.js          # Main bot logic
  setup.js          # Token/admin config (reads from env)
  db.js             # MongoDB connection
  config.json       # Channel mappings and server config
  emojis.json       # Emoji and role ID mappings
  models/           # Mongoose models (Creator, JoinRecord, UserInvite)
  listeners/        # Event listeners (inviteSystem, reminderEmbed)
  scripts/          # Utility scripts (reset-channel, send-rules)
```

## User preferences
