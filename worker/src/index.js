// WoW Forever EU bot — runs on a free Cloudflare Worker.
//  - /price <item>  : latest auction house prices (data prepared hourly by GitHub Actions)
//  - /rulesets      : raw ruleset status from Blizzard's API (handy for checking what it reports)
//  - every 2 minutes: checks the EU Normal + PvP rulesets and posts to a Discord webhook when anything changes

import HOUSE_LABELS from "./house-labels.json";

const API = "https://eu.api.blizzard.com";
const NAMESPACE = "dynamic-forever-eu";
const RULESETS = { 2: "Normal", 1: "PvP" };
const SHARDS = 16; // must match scripts/build-prices.mjs

export default {
  async fetch(request, env) {
    if (request.method !== "POST") return new Response("WoW Forever bot is running.");

    const signature = request.headers.get("X-Signature-Ed25519");
    const timestamp = request.headers.get("X-Signature-Timestamp");
    const body = await request.text();
    if (!signature || !timestamp || !(await verifyDiscord(env.DISCORD_PUBLIC_KEY, signature, timestamp + body))) {
      return new Response("Bad request signature", { status: 401 });
    }

    const interaction = JSON.parse(body);
    if (interaction.type === 1) return json({ type: 1 }); // Discord's PING

    if (interaction.type === 4) {
      try {
        return json(await handleAutocomplete(interaction, env));
      } catch {
        return json({ type: 8, data: { choices: [] } });
      }
    }

    if (interaction.type === 2) {
      try {
        return json(await handleCommand(interaction, env));
      } catch (e) {
        return json(reply(`Something went wrong: ${e.message}`, true));
      }
    }

    return new Response("Unknown interaction", { status: 400 });
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(checkRulesets(env));
  },
};

// ---------- Discord plumbing ----------

const json = (obj) => new Response(JSON.stringify(obj), { headers: { "Content-Type": "application/json" } });

function reply(content, ephemeral = false, embeds) {
  return { type: 4, data: { content, embeds, flags: ephemeral ? 64 : 0 } };
}

function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

async function verifyDiscord(publicKey, signature, message) {
  const data = new TextEncoder().encode(message);
  const algorithms = [{ name: "Ed25519" }, { name: "NODE-ED25519", namedCurve: "NODE-ED25519" }];
  for (const alg of algorithms) {
    try {
      const key = await crypto.subtle.importKey("raw", hexToBytes(publicKey), alg, false, ["verify"]);
      return await crypto.subtle.verify(alg.name, key, hexToBytes(signature), data);
    } catch {
      // runtime doesn't know this algorithm name; try the next one
    }
  }
  return false;
}

async function handleCommand(interaction, env) {
  const options = Object.fromEntries((interaction.data.options || []).map((o) => [o.name, o.value]));
  switch (interaction.data.name) {
    case "price":
      return priceCommand(options, env);
    case "rulesets":
      return rulesetsCommand(env);
    default:
      return reply("Unknown command.", true);
  }
}

// ---------- Item names / search ----------

async function loadNames(env) {
  return (await env.KV.get("names", { type: "json", cacheTtl: 300 })) || [];
}

function findItems(names, query, limit = 25) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const exact = [], starts = [], wordStarts = [], contains = [];
  for (const entry of names) {
    const [id, name] = entry;
    const lower = name.toLowerCase();
    if (lower === q || String(id) === q) exact.push(entry);
    else if (lower.startsWith(q)) starts.push(entry);
    else if (lower.includes(` ${q}`)) wordStarts.push(entry);
    else if (lower.includes(q)) contains.push(entry);
  }
  return [...exact, ...starts, ...wordStarts, ...contains].slice(0, limit);
}

async function handleAutocomplete(interaction, env) {
  const focused = (interaction.data.options || []).find((o) => o.focused);
  const names = await loadNames(env);
  const choices = findItems(names, String(focused?.value ?? "")).map(([id, name]) => ({
    name: name.slice(0, 100),
    value: String(id),
  }));
  return { type: 8, data: { choices } };
}

// ---------- /price ----------

function gold(copper) {
  const c = Math.round(copper);
  const g = Math.floor(c / 10000);
  const s = Math.floor((c % 10000) / 100);
  const cc = c % 100;
  const parts = [];
  if (g) parts.push(`${g.toLocaleString("en-GB")}g`);
  if (s) parts.push(`${s}s`);
  if (cc || parts.length === 0) parts.push(`${cc}c`);
  return parts.join(" ");
}

async function priceCommand(options, env) {
  const input = String(options.item ?? "").trim();
  const names = await loadNames(env);

  let id, name;
  if (/^\d+$/.test(input)) {
    id = Number(input);
    name = names.find(([x]) => x === id)?.[1] ?? `Item ${id}`;
  } else {
    const match = findItems(names, input, 1)[0];
    if (!match) return reply(`Nothing listed right now matches **${input}**. Try the item ID instead.`, true);
    [id, name] = match;
  }

  const [shard, meta] = await Promise.all([
    env.KV.get(`p:${id % SHARDS}`, { type: "json", cacheTtl: 300 }),
    env.KV.get("meta", { type: "json", cacheTtl: 300 }),
  ]);
  if (!meta) return reply("No price data yet. Run the **Update auction prices** workflow on GitHub first.", true);

  const entry = shard?.[id];
  if (!entry) return reply(`**${name}** has no buyout listings in the latest scan.`);

  const onlyLabelled = Object.keys(HOUSE_LABELS).length > 0;
  const faction = options.faction;
  const rows = Object.entries(entry)
    .map(([houseId, [min, market, units, listings]]) => {
      const houseName = meta.houses?.[houseId] ?? "Auction House";
      return { houseId, houseName, label: HOUSE_LABELS[houseId] ?? `${houseName} #${houseId}`, min, market, units, listings };
    })
    .filter((r) => !onlyLabelled || HOUSE_LABELS[r.houseId])
    .filter((r) => !faction || `${r.label} ${r.houseName}`.toLowerCase().includes(faction))
    .sort((a, b) => a.label.localeCompare(b.label));

  if (!rows.length) return reply(`**${name}** has no matching listings in the latest scan.`);

  const lines = rows.map(
    (r) => `**${r.label}**\nmin **${gold(r.min)}** · market ${gold(r.market)} · ${r.units.toLocaleString("en-GB")} up (${r.listings} listings)`
  );
  const scanned = `Scanned <t:${Math.floor(meta.updated / 1000)}:R>`;
  return {
    type: 4,
    data: {
      embeds: [
        {
          title: name,
          description: `${lines.join("\n\n")}\n\n${scanned} · item ID ${id}`.slice(0, 4000),
          color: 0xf2b84b,
          footer: { text: "Market = average of the cheapest 15% of units" },
        },
      ],
    },
  };
}

// ---------- Blizzard API ----------

async function blizzardToken(env) {
  const cached = await env.KV.get("token", { type: "json" });
  if (cached && cached.expires > Date.now() + 120_000) return cached.token;

  const res = await fetch("https://oauth.battle.net/token", {
    method: "POST",
    headers: {
      Authorization: "Basic " + btoa(`${env.BLIZZ_ID}:${env.BLIZZ_SECRET}`),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) throw new Error(`Blizzard login failed (${res.status})`);
  const data = await res.json();
  await env.KV.put("token", JSON.stringify({ token: data.access_token, expires: Date.now() + data.expires_in * 1000 }), {
    expirationTtl: Math.max(60, data.expires_in),
  });
  return data.access_token;
}

async function getRuleset(env, id) {
  const token = await blizzardToken(env);
  const res = await fetch(`${API}/data/wow/ruleset/${id}?namespace=${NAMESPACE}&locale=en_GB`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Blizzard API returned ${res.status} for ruleset ${id}`);
  const data = await res.json();
  delete data._links;
  delete data.auctions; // just a link to the auction index, not status
  return data;
}

async function rulesetsCommand(env) {
  const parts = [];
  for (const [id, label] of Object.entries(RULESETS)) {
    try {
      const data = await getRuleset(env, id);
      parts.push(`**EU ${label}** (ruleset ${id})\n\`\`\`json\n${JSON.stringify(data, null, 1).slice(0, 800)}\n\`\`\``);
    } catch (e) {
      parts.push(`**EU ${label}**: ${e.message}`);
    }
  }
  return reply(parts.join("\n"), true);
}

// ---------- Faction lock watcher ----------

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function flatten(value, prefix = "", out = {}) {
  if (value && typeof value === "object") {
    for (const key of Object.keys(value)) flatten(value[key], prefix ? `${prefix}.${key}` : key, out);
  } else {
    out[prefix] = value;
  }
  return out;
}

async function checkRulesets(env) {
  for (const [id, label] of Object.entries(RULESETS)) {
    let data;
    try {
      data = await getRuleset(env, id);
    } catch (e) {
      console.log(e.message);
      continue;
    }

    const key = `state:${id}`;
    const now = stableStringify(data);
    const previous = await env.KV.get(key);
    if (previous === now) continue;

    await env.KV.put(key, now);
    if (previous === null) continue; // first run: just remember the current state

    await postChange(env, label, JSON.parse(previous), data);
  }
}

async function postChange(env, label, before, after) {
  const a = flatten(before);
  const b = flatten(after);
  const changes = [...new Set([...Object.keys(a), ...Object.keys(b)])]
    .filter((k) => a[k] !== b[k])
    .map((k) => `\`${k}\`: ${a[k] ?? "—"} → **${b[k] ?? "—"}**`);

  const factionRelated = changes.some((c) => /alliance|horde|faction|lock|restrict/i.test(c));
  const title = factionRelated ? `⚖️ EU ${label}: faction availability changed` : `🔔 EU ${label} ruleset status changed`;

  await fetch(env.ALERT_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: "WoW Forever Watch",
      embeds: [
        {
          title,
          description: changes.join("\n").slice(0, 4000) || "Something changed.",
          color: factionRelated ? 0xe0533d : 0x4b8bf2,
          timestamp: new Date().toISOString(),
        },
      ],
    }),
  });
}
