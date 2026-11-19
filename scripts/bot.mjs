// The bot account: plays each daily with throwaway pins in incognito (off the leaderboards),
// so the friends scoreboard unlocks and everyone's round scores can be read. It never tries to score.
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FILE = join(ROOT, "data", "bot.json");
const idsFrom = (arr) => (Array.isArray(arr) ? arr : arr?.items || arr?.requests || [])
  .map((x) => String(x?.userId || x?.id || x?.user?.userId || x?.user?.id || "").toLowerCase()).filter(Boolean);

export async function botProfile(bot) {
  const r = await bot.get("/api/v3/profiles");
  if (r.status === 401 || r.status === 403) throw new Error("Bot cookie rejected. Grab a fresh _ncfa for the bot account.");
  const u = r.body?.user || {};
  return { id: String(u.id || u.userId || "").toLowerCase(), nick: u.nick || "the bot" };
}

// Play today's daily if the bot hasn't yet. Returns "already" | "played" | "failed: ...".
export async function botPlay(bot, token) {
  // GeoGuessr's "my result for today": has a totalScore once the daily is finished
  const done = async () => { const r = await bot.get("/api/v3/challenges/daily-challenges/me"); return r.status === 200 && typeof r.body?.totalScore === "number"; };
  if (await done()) return "already";

  await bot.send("PUT", `/api/v3/challenges/daily-challenges/${token}/incognito`, { Incognito: true }); // stay off leaderboards
  const join = await bot.send("POST", `/api/v3/challenges/${token}`);
  const gameToken = join.body?.token || join.body?.game?.token;
  if (!gameToken) return `failed: join ${join.status} ${JSON.stringify(join.body).slice(0, 200)}`;

  let last = null;
  for (let i = 0; i < 7; i++) {
    const g = await bot.get(`/api/v3/games/${gameToken}?client=web`);
    last = g.body;
    if (g.body?.state === "finished") break;
    const guess = await bot.send("POST", `/api/v3/games/${gameToken}`, { token: gameToken, lat: 0, lng: 0, timedOut: false, stepsCount: 0 });
    if (guess.status >= 300) return `failed: guess ${guess.status} ${JSON.stringify(guess.body).slice(0, 200)}`;
    last = guess.body;
    if (guess.body?.state === "finished") break;
  }
  if (await done()) return "played";
  return `unsure: game state ${last?.state}, round ${last?.round}, guesses ${last?.player?.guesses?.length}`;
}

// Make the bot friends with everyone in the group: accept their requests, or send one (once).
export async function botFriends(bot, targetIds) {
  let st = { requested: {} };
  try { st = JSON.parse(await readFile(FILE, "utf8")); } catch {}
  st.requested ||= {};
  const before = JSON.stringify(st);
  const friends = new Set(idsFrom((await bot.get("/api/v3/social/friends/summary")).body?.friends));
  const received = new Set(idsFrom((await bot.get("/api/v3/social/friends/received")).body));
  const out = { accepted: 0, sent: 0, friends: friends.size };
  for (const id of new Set(targetIds.map((x) => String(x).toLowerCase()).filter((x) => /^[0-9a-f]{24}$/.test(x)))) {
    if (friends.has(id)) continue;
    if (received.has(id)) { const r = await bot.send("PUT", `/api/v3/social/friends/${id}?context=`); if (r.status < 300) out.accepted++; continue; }
    if (st.requested[id]) continue;
    const r = await bot.send("POST", `/api/v3/social/friends/${id}?context=`);
    if (r.status < 300 || r.status === 400) { st.requested[id] = new Date().toISOString(); if (r.status < 300) out.sent++; } // 400 = already requested
    else { console.log(`Bot could not send request to ${id}: ${r.status}`); if (r.status === 429) break; } // too many: try again next run
  }
  if (JSON.stringify(st) !== before) await writeFile(FILE, JSON.stringify(st, null, 1) + "\n");
  return out;
}
