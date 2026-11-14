// Pulls your GeoGuessr friends' daily challenge scores and saves them to data/scores.json.
// Needs one secret: GEO_NCFA = the value of the "_ncfa" cookie from geoguessr.com while logged in.
// Run: GEO_NCFA=xxxx node scripts/fetch.mjs

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "data", "scores.json");
const BASE = process.env.GEO_BASE_URL || "https://www.geoguessr.com";
const COOKIE = (process.env.GEO_NCFA || "").trim();

if (!COOKIE) {
  console.error("Missing GEO_NCFA (your GeoGuessr _ncfa cookie). Nothing fetched.");
  process.exit(1);
}

async function get(path) {
  const res = await fetch(BASE + path, {
    headers: {
      cookie: `_ncfa=${COOKIE}`,
      accept: "application/json",
      "user-agent": "Mozilla/5.0 (geo-daily friends dashboard)",
    },
  });
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { status: res.status, body };
}

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

async function main() {
  let data = { updatedAt: null, days: {}, players: {} };
  try { data = JSON.parse(await readFile(OUT, "utf8")); } catch {}
  data.days ||= {};
  data.players ||= {};
  const before = JSON.stringify({ d: data.days, p: data.players });

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

  // 2. For each one, get the friends scoreboard
  let authOk = false;
  for (const c of challenges) {
    const r = await get(`/api/v3/results/highscores/${c.token}?friends=true&limit=26&minRounds=5`);
    if (r.status === 401) throw new Error("Cookie rejected on scoreboard. Grab a fresh _ncfa cookie.");
    if (r.status === 404) { console.log(`${c.day}: locked (you haven't played it yet)`); continue; }
    if (r.status !== 200 || !Array.isArray(r.body?.items)) { console.log(`${c.day}: skipped (status ${r.status})`); continue; }
    authOk = true;

    const items = r.body.items.filter((i) => i?.game?.player?.id);
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

  if (!authOk) console.log("No unlocked days this run (play today's daily to unlock the friends scoreboard).");

  const after = JSON.stringify({ d: data.days, p: data.players });
  if (after === before) { console.log("No changes."); return; }

  // keep days sorted, newest first
  data.days = Object.fromEntries(Object.entries(data.days).sort((a, b) => b[0].localeCompare(a[0])));
  data.updatedAt = new Date().toISOString();
  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(data, null, 1) + "\n");
  console.log("Saved data/scores.json");
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
