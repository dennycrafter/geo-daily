// Posts to Slack after each pull: a ping when someone finishes, and one results post per day.
// Needs SLACK_WEBHOOK_URL (a Slack "incoming webhook"). Without it, does nothing.
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = async (f, d) => { try { return JSON.parse(await readFile(join(ROOT, f), "utf8")); } catch { return d; } };
const fmt = (n) => Math.round(n).toLocaleString("en-US");
const dayLabel = (d) => new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
const kmStr = (k) => (k < 1 ? Math.round(k * 1000) + " m" : k < 100 ? k.toFixed(1) + " km" : fmt(k) + " km");
const medal = ["🥇", "🥈", "🥉"];
const mmss = (t) => `${Math.floor(t / 60)}:${String(Math.round(t % 60)).padStart(2, "0")}`;
const ordinal = (n) => n + (["th", "st", "nd", "rd"][(n % 100 - 20) % 10] || ["th", "st", "nd", "rd"][n % 100] || "th");
const regionName = (() => { try { const d = new Intl.DisplayNames(["en"], { type: "region" }); return (c) => { try { return c ? d.of(c.toUpperCase()) : "somewhere"; } catch { return c; } }; } catch { return (c) => c || "somewhere"; } })();
function weekTotal(data, id, day) { // Mon to Fri of the week containing day
  const t = new Date(day + "T12:00:00Z"), wd = (t.getUTCDay() + 6) % 7; t.setUTCDate(t.getUTCDate() - wd);
  const mon = t.toISOString().slice(0, 10); t.setUTCDate(t.getUTCDate() + 4); const fri = t.toISOString().slice(0, 10);
  let total = 0, days = 0;
  for (const [d, D] of Object.entries(data.days)) if (d >= mon && d <= fri && D.players[id]) { total += D.players[id].total; days++; }
  return days ? { total, days } : null;
}
// The five round scores as a small lined-up table (Slack shows it in a grey box).
function roundTable(rounds) {
  const vals = rounds.map((x) => fmt(x.points));
  const w = Math.max(5, ...vals.map((v) => v.length));
  const head = rounds.map((_, i) => String(i + 1).padStart(w)).join("  ");
  const row = vals.map((v) => v.padStart(w)).join("  ");
  return "```\n" + head + "\n" + row + "\n```";
}

const QUIPS = [
  [24000, [
    "Absolute cartographer. Frame this one.",
    "Are you sure you didn't just live there?",
    "Google Street View owes you royalties.",
    "That wasn't geography, that was witchcraft.",
    "Someone check this person's browser history for the answers.",
    "The globe called. It wants to know how you knew.",
    "Scouting report: dangerous. Approach with caution.",
    "That's a passport-full of correct guesses.",
    "Pin it, print it, put it on the fridge.",
    "The pros are taking notes.",
    "You could guide tours in five countries off that run.",
    "Everyone else is now playing for second.",
    "Statistically that should not have happened.",
    "Bollard whisperer behaviour.",
    "The map just asked for your autograph.",
  ]],
  [20000, [
    "Google Maps is shaking.",
    "Big brain geography hours.",
    "Very respectable. Mildly suspicious.",
    "You read those road signs like a local.",
    "Solid run. The pins were mostly on the right continent and then some.",
    "That's a strong morning for the atlas.",
    "Somebody's been studying their bollards.",
    "Tidy work. No notes. Well, a few notes.",
    "Sharp. Just shy of showing off.",
    "That's the kind of score you mention casually twice.",
    "Your geography teacher would be proud. Finally.",
    "Low-key cooking today.",
    "Clean run. The compass is pleased.",
    "That's a podium-shaped number.",
    "A score worth screenshotting, honestly.",
  ]],
  [15000, [
    "Solid. Respectable. Mildly boring.",
    "Not bad, the bollards are proud of you.",
    "Middle of the map, middle of the pack.",
    "Right continent, mostly. That counts.",
    "Decent. The kind of score nobody talks about, in a good way.",
    "Some bangers, some guesses. Classic.",
    "Perfectly fine. Like a sandwich.",
    "A B-minus day. We take those.",
    "You got a few right and blamed the others on the camera.",
    "Respectable effort with a side of vibes.",
    "Not your best, not your worst, very much a Tuesday.",
    "You were close enough to wave at the right answer.",
    "That's a 'could have been worse' score.",
    "Steady hands, questionable round three.",
    "The map was confusing today. We believe you.",
  ]],
  [10000, [
    "Was that a guess or a sneeze?",
    "Directionally correct. Like, the general direction.",
    "The compass was upside down, wasn't it?",
    "Bold choices were made.",
    "Some of those pins are going to need a passport.",
    "You played confidently. That's the main thing.",
    "Geography is hard and today it won.",
    "Every pin a little adventure.",
    "Points were scored. Not many, but some.",
    "You and the map need to have a talk.",
    "A brave run through the fog.",
    "Close enough if you squint from space.",
    "Tomorrow is a new map.",
    "Somebody blindfolded you at round two, right?",
    "Not ideal, but the Street View car tried its best too.",
  ]],
  [0, [
    "Did you play with your eyes closed?",
    "Bold strategy: guess the ocean.",
    "Lost. Possibly still lost.",
    "That's one way to see the world.",
    "The pins went on holiday without you.",
    "A truly global spread of guesses.",
    "Interesting interpretation of the map.",
    "The globe is round, the score is also round.",
    "We'll call it a scouting mission.",
    "Somewhere a geography teacher just sighed.",
    "Character-building run.",
    "The only way is up from here.",
    "Did the cat walk on the keyboard?",
    "You visited every continent except the right one.",
    "Points are overrated anyway.",
  ]],
];
// Picks a joke for the score's range, skipping any posted recently so nothing repeats.
function quip(score, seed, recent = []) {
  const tier = QUIPS.find(([min]) => score >= min)[1];
  let h = 0; for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  for (let i = 0; i < tier.length; i++) { const q = tier[(h + i) % tier.length]; if (!recent.includes(q)) { recent.push(q); return q; } }
  const q = tier[h % tier.length]; recent.push(q); return q;
}

export async function notify({ before, after, now = new Date(), post, memberEvents = [] }) {
  const cfg = await read("data/config.json", {});
  const names = await read("data/names.json", {});
  const members = await read("data/members.json", {});
  const state = await read("data/slack-state.json", { pinged: {}, recapped: [] });
  const sc = cfg.slack || {};
  const site = cfg.siteUrl || "";
  const nameOf = (id, nick) => members[id]?.name || names[nick || after.players?.[id]?.nick] || nick || after.players?.[id]?.nick || "?";
  const days = Object.keys(after.days || {}).sort().reverse();
  const latest = days[0];
  const msgs = [];
  const owner = cfg.ownerName || "Denis";
  for (const e of (sc.welcomes ? memberEvents : [])) { // welcome posts are off unless slack.welcomes is true
    // One short line per person. If we had to send them a request, the line says to accept it; no second post when they do.
    if (e.type === "requested") msgs.push(`👋 *${e.name}* joined Geo Daily. Accept ${owner}'s friend request on GeoGuessr to show up here.`);
    if (e.type === "joined" && !e.afterRequest) msgs.push(`👋 *${e.name}* joined Geo Daily`);
  }
  if (!latest) { for (const text of msgs) await post(text); return { msgs, state }; }

  // 1. a "GEO ALERT" for each person who newly finished the latest day
  const ageDays = (now - new Date(latest + "T12:00:00Z")) / 864e5;
  if (ageDays < 2) {
    const D = after.days[latest];
    const had = new Set([...Object.keys(before.days?.[latest]?.players || {}), ...(state.pinged[latest] || [])]);
    const fresh = Object.keys(D.players).filter((id) => !had.has(id)).sort((a, b) => D.players[a].total - D.players[b].total);
    const known = Object.keys(after.players || {});
    for (const id of fresh) {
      const p = D.players[id], name = nameOf(id, p.nick);
      // standings among people who had finished by the time this person did (fresh ones count in score order)
      const done = Object.keys(D.players).filter((x) => had.has(x) || fresh.indexOf(x) <= fresh.indexOf(id));
      const ranked = done.sort((a, b) => D.players[b].total - D.players[a].total);
      const place = ranked.indexOf(id) + 1;
      const tookLead = place === 1 && ranked.length > 1;
      const rounds = p.rounds || []; // no countries here: that would spoil the rounds for people who haven't played
      const left = known.filter((x) => !D.players[x]).map((x) => nameOf(x));
      const body = [`🎯 *${fmt(p.total)}*  ·  ⏱️ ${mmss(p.time)}`];
      if (rounds.length) body.push(roundTable(rounds));
      body.push(`_💬 ${quip(p.total, id + latest, (state.recentQuips ||= []))}_`);
      msgs.push({ text: `🌍 *${name}* just finished the daily`, attachments: [{ color: "#1D9E75", text: body.join("\n"), mrkdwn_in: ["text"] }] });
      state.pinged[latest] = [...new Set([...(state.pinged[latest] || []), id])];
    }
  }

  // 2. one results post per day, at or after recapHour local time on that day
  const local = new Intl.DateTimeFormat("en-CA", { timeZone: sc.timeZone || "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const part = (t) => local.find((x) => x.type === t).value;
  const localDay = `${part("year")}-${part("month")}-${part("day")}`, localHour = +part("hour");
  for (const d of (sc.resultsPost ? days.slice(0, 3) : [])) { // 5pm results post is off unless slack.resultsPost is true
    if (state.recapped.includes(d)) continue;
    const due = localDay > d || (localDay === d && localHour >= (sc.recapHour ?? 17));
    if (!due || (now - new Date(d + "T12:00:00Z")) / 864e5 > 3) continue;
    const D = after.days[d];
    const rows = Object.entries(D.players).map(([id, p]) => ({ id, ...p })).sort((a, b) => b.total - a.total);
    if (!rows.length) continue;
    const lines = rows.map((r, i) => `${medal[i] || `${i + 1}.`} ${nameOf(r.id, r.nick)}  *${fmt(r.total)}*`);
    const all = rows.flatMap((r) => (r.rounds || []).map((x) => ({ r, ...x })));
    const closest = all.length ? all.reduce((a, b) => (b.km < a.km ? b : a)) : null;
    const whiff = all.length ? all.reduce((a, b) => (b.km > a.km ? b : a)) : null;
    let text = `🏁 *Daily results, ${dayLabel(d)}*\n${lines.join("\n")}`;
    if (closest) text += `\n\n🎯 Closest guess: ${nameOf(closest.r.id, closest.r.nick)}, ${kmStr(closest.km)}\n🛰️ Biggest whiff: ${nameOf(whiff.r.id, whiff.r.nick)}, ${kmStr(whiff.km)}`;
    if (site) text += `\n\n<${site}|Full scoreboard>`;
    msgs.push(text);
    state.recapped.push(d);
  }
  state.recapped = state.recapped.sort().slice(-30);
  if (state.recentQuips) state.recentQuips = state.recentQuips.slice(-40);
  for (const k of Object.keys(state.pinged).sort().slice(0, -7)) delete state.pinged[k];

  for (const text of msgs) await post(text);
  return { msgs, state };
}

export async function slackPost(url, msg) {
  const payload = typeof msg === "string" ? { text: msg } : msg;
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ unfurl_links: false, ...payload }) });
  if (!res.ok) throw new Error(`Slack said ${res.status}: ${await res.text()}`);
}

export async function saveState(state) {
  await writeFile(join(ROOT, "data/slack-state.json"), JSON.stringify(state, null, 1) + "\n");
}
