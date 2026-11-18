// Registers the bot's slash commands with Discord. Run once (and again if you change the commands)
// from the "Register Discord commands" workflow on GitHub.

const { DISCORD_APP_ID, DISCORD_BOT_TOKEN, DISCORD_GUILD_ID } = process.env;
if (!DISCORD_APP_ID || !DISCORD_BOT_TOKEN) throw new Error("Missing DISCORD_APP_ID or DISCORD_BOT_TOKEN secret");

const commands = [
  {
    name: "price",
    description: "Auction house price for an item (WoW Forever EU)",
    options: [
      { type: 3, name: "item", description: "Item name or ID", required: true, autocomplete: true },
      {
        type: 3,
        name: "faction",
        description: "Only show one faction's auction houses",
        required: false,
        choices: [
          { name: "Alliance", value: "alliance" },
          { name: "Horde", value: "horde" },
          { name: "Blackwater (neutral)", value: "blackwater" },
        ],
      },
    ],
  },
  {
    name: "rulesets",
    description: "Show what Blizzard's API currently reports for the EU Normal and PvP rulesets",
  },
];

const url = DISCORD_GUILD_ID
  ? `https://discord.com/api/v10/applications/${DISCORD_APP_ID}/guilds/${DISCORD_GUILD_ID}/commands`
  : `https://discord.com/api/v10/applications/${DISCORD_APP_ID}/commands`;

const res = await fetch(url, {
  method: "PUT",
  headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}`, "Content-Type": "application/json" },
  body: JSON.stringify(commands),
});
if (!res.ok) throw new Error(`Discord said ${res.status}: ${await res.text()}`);
console.log(`Registered ${commands.length} commands ${DISCORD_GUILD_ID ? "in your server" : "globally"}.`);
