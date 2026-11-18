// Registers the bot's slash commands with Discord. Run from the "Register Discord commands" workflow
// on GitHub (again whenever the commands change).
//
// /price is for everyone. /sticky and /rulesets need the "Manage Server" permission, so regular members
// don't even see them. You can fine-tune this per role/channel in Server Settings → Integrations → Auction House.

const { DISCORD_APP_ID, DISCORD_BOT_TOKEN, DISCORD_GUILD_ID } = process.env;
if (!DISCORD_APP_ID || !DISCORD_BOT_TOKEN) throw new Error("Missing DISCORD_APP_ID or DISCORD_BOT_TOKEN secret");

const MANAGE_SERVER = "32";

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
    name: "sticky",
    description: "Manage the sticky message that always stays at the bottom of this channel",
    default_member_permissions: MANAGE_SERVER,
    dm_permission: false,
    options: [
      { type: 1, name: "set", description: "Write or edit the sticky message for this channel" },
      { type: 1, name: "remove", description: "Turn the sticky message off" },
    ],
  },
  {
    name: "rulesets",
    description: "Show what Blizzard's API currently reports for the EU Normal and PvP rulesets",
    default_member_permissions: MANAGE_SERVER,
    dm_permission: false,
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
