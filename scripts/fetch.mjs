// Pulls the group's GeoGuessr daily challenge scores and saves them to data/scores.json.
// Secrets: GEO_BOT_NCFA (bot account's _ncfa cookie, preferred) and/or GEO_NCFA (Denis's).
// Run: GEO_BOT_NCFA=xxxx node scripts/fetch.mjs

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { notify, slackPost, saveState } from "./slack.mjs";
import { syncMembers } from "./members.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "data", "scores.json");
const BASE = process.env.GEO_BASE_URL || "https://www.geoguessr.com";
import { geoClient } from "./geo.mjs";
import { botProfile, botPlay, botFriends } from "./bot.mjs";

// Two possible logins: the bot account (GEO_BOT_NCFA, preferred) and Denis's (GEO_NCFA, optional now).
const MAIN = (process.env.GEO_NCFA || "").trim();
const BOTC = (process.env.GEO_BOT_NCFA || "").trim();
if (!MAIN && !BOTC) {
  console.error("Missing GEO_BOT_NCFA / GEO_NCFA (GeoGuessr _ncfa cookies). Nothing fetched.");
  process.exit(1);
}
const main_ = MAIN ? geoClient(MAIN) : null;
const bot = BOTC ? geoClient(BOTC) : null;
const primary = bot || main_;
const { get, send } = primary;

const km = (m) => Math.round((Number(m) || 0) / 100) / 10; // meters -> km, 1 decimal

function parseGame(item) {
  const g = item.game || {};
  const p = g.player || {};
  return {
    id: p.id,
    nick: p.nick,
    country: (p.countryCode || "").toLowerCase(),
    total: p.totalScoreInPoints ?? p.totalScore?.amount ?? 0,
    time: p.totalTime ?? 0,
    km: km(p.totalDistanceInMeters),
    rounds: (p.guesses || []).map((x) => ({
      points: x.roundScoreInPoints ?? 0,
      lat: typeof x.lat === "number" ? Math.round(x.lat * 1e4) / 1e4 : null,
      lng: typeof x.lng === "number" ? Math.round(x.lng * 1e4) / 1e4 : null,
      km: km(x.distanceInMeters),
      time: x.time ?? 0,
      timedOut: !!(x.timedOut && !x.timedOutWithGuess),
    })),
  };
}

function parseRounds(item) {
  const rounds = item?.game?.rounds || [];
  return rounds.map((r) => ({
    country: (r.region?.country || r.streakLocationCode || "").toLowerCase(),
    lat: typeof r.lat === "number" ? Math.round(r.lat * 1e4) / 1e4 : null,
    lng: typeof r.lng === "number" ? Math.round(r.lng * 1e4) / 1e4 : null,
  }));
}

function require_members() { return require_text(join(ROOT, "data", "members.json")); }
import { readFileSync } from "node:fs";
function require_text(f) { return readFileSync(f, "utf8"); }

async function main() {
  let data = { updatedAt: null, days: {}, players: {} };
  try { data = JSON.parse(await readFile(OUT, "utf8")); } catch {}
  data.days ||= {};
  data.players ||= {};
  const before = JSON.stringify({ d: data.days, p: data.players });
  const beforeData = JSON.parse(JSON.stringify(data));

  // 1. Which daily challenges exist right now (today + the last few days)
  const today = await get("/api/v3/challenges/daily-challenges/today");
  if (today.status === 401 || today.status === 403) throw new Error("Cookie rejected. Grab a fresh _ncfa cookie.");
  const prev = await get("/api/v3/challenges/daily-challenges/previous");
  const list = [];
  if (today.status === 200 && today.body?.token) list.push(today.body);
  if (prev.status === 200 && Array.isArray(prev.body)) list.push(...prev.body);

  const seen = new Set();
  const challenges = list
    .filter((c) => c?.token && !seen.has(c.token) && seen.add(c.token))
    .map((c) => ({ token: c.token, day: String(c.date || "").slice(0, 10) }))
    .filter((c) => c.day);

  // 1b. The bot: make sure it's friends with everyone, and play today's daily so the rounds unlock
  let botId = "";
  let cfg = {}; try { cfg = JSON.parse(await readFile(join(ROOT, "data", "config.json"), "utf8")); } catch {}
  if (bot) {
    try {
      const me = await botProfile(bot);
      botId = me.id;
      const members = (() => { try { return JSON.parse(require_members()); } catch { return {}; } })();
      const targets = [...Object.keys(data.players || {}), ...Object.keys(members), (String(cfg.ownerProfile || "").match(/[0-9a-f]{24}/i) || [])[0]].filter(Boolean).filter((x) => x !== botId);
      const f = await botFriends(bot, targets);
      console.log(`Bot ${me.nick}: ${f.friends} friends, accepted ${f.accepted}, sent ${f.sent} request(s)`);
      if (today.status === 200 && today.body?.token) console.log(`Bot daily: ${await botPlay(bot, today.body.token)}`);
    } catch (e) { console.error("Bot step failed: " + (e.message || e)); }
  }

  // Read from the bot first, then Denis's account, and merge (until everyone has accepted the bot)
  const readers = [bot, main_].filter(Boolean);
  let authOk = false;
  for (const reader of readers) {
  const today = await reader.get("/api/v3/challenges/daily-challenges/today");

  // 2a. Today's friends list: GeoGuessr gives every friend's total for today, even before you've played.
  //     No round-by-round here; those get filled in from the scoreboard below once you've played.
  const todayDay = today.status === 200 ? String(today.body?.date || "").slice(0, 10) : "";
  if (todayDay && Array.isArray(today.body?.friends) && today.body.friends.length) {
    const day = (data.days[todayDay] ||= { token: today.body.token, players: {} });
    day.token = today.body.token;
    for (const f of today.body.friends) {
      if (!f?.id || typeof f.totalScore !== "number" || String(f.id).toLowerCase() === botId) continue;
      const prev = day.players[f.id];
      if (prev?.rounds?.length) continue; // already have the full game
      day.players[f.id] = { nick: f.nick, country: (f.countryCode || "").toLowerCase(), total: f.totalScore, time: f.totalTime ?? 0, km: km(f.totalDistance), rounds: [] };
      const known = (data.players[f.id] ||= { nick: f.nick, firstSeen: todayDay });
      known.nick = f.nick;
    }
    console.log(`${todayDay}: ${today.body.friends.length} friend(s) from today's list`);
  }

  // 2b. For each day, get the friends scoreboard (full rounds; only opens after you've played)
  for (const c of challenges) {
    const r = await reader.get(`/api/v3/results/highscores/${c.token}?friends=true&limit=50&minRounds=5`);
    if (r.status === 401) throw new Error("Cookie rejected on scoreboard. Grab a fresh _ncfa cookie.");
    if (r.status === 404) { console.log(`${c.day}: locked (you haven't played it yet)`); continue; }
    if (r.status !== 200 || !Array.isArray(r.body?.items)) { console.log(`${c.day}: skipped (status ${r.status})`); continue; }
    authOk = true;

    const items = r.body.items.filter((i) => i?.game?.player?.id && String(i.game.player.id).toLowerCase() !== botId);
    if (!items.length) continue;

    const day = (data.days[c.day] ||= { token: c.token, players: {} });
    day.token = c.token;
    day.map = items[0].game.mapName || day.map || "World";
    day.timeLimit = items[0].game.timeLimit ?? day.timeLimit ?? null;
    const rounds = parseRounds(items[0]);
    if (rounds.length) day.rounds = rounds;

    for (const item of items) {
      const p = parseGame(item);
      if (!p.id) continue;
      day.players[p.id] = { nick: p.nick, country: p.country, total: p.total, time: p.time, km: p.km, rounds: p.rounds };
      const known = (data.players[p.id] ||= { nick: p.nick, firstSeen: c.day });
      known.nick = p.nick;
      if (c.day < known.firstSeen) known.firstSeen = c.day;
    }
    console.log(`${c.day}: ${items.length} player(s)`);
  }

  } // end readers
  if (!authOk) console.log("No unlocked days this run (play today's daily to unlock the friends scoreboard).");

  const after = JSON.stringify({ d: data.days, p: data.players });

  // New people who joined on the site: make them friends and save their names
  const hook = (process.env.SLACK_WEBHOOK_URL || "").trim();
  let memberEvents = [];
  try {
    const r = await syncMembers({ get: primary.get, send: (m, p) => primary.send(m, p), siteUrl: process.env.GEO_SITE_URL || cfg.siteUrl, viaName: bot ? "GeoDailyBot" : null });
    memberEvents = r.events;
    for (const e of memberEvents) console.log(`Member ${e.type}: ${e.name}`);
  } catch (e) { console.error("Member sync failed: " + (e.message || e)); }

  // Slack (runs every time, so the 5pm results post goes out even with no new scores)
  if (hook) {
    try {
      const { msgs, state } = await notify({ before: beforeData, after: data, memberEvents, post: (t) => slackPost(hook, t) });
      await saveState(state);
      console.log(`Slack: ${msgs.length} message(s) sent`);
    } catch (e) { console.error("Slack failed: " + (e.message || e)); }
  }

  if (after === before) { console.log("No changes."); return; }

  // keep days sorted, newest first
  data.days = Object.fromEntries(Object.entries(data.days).sort((a, b) => b[0].localeCompare(a[0])));
  data.updatedAt = new Date().toISOString();
  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(data, null, 1) + "\n");
  console.log("Saved data/scores.json");
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
