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
const QUIPS = [
  [24000, ["Absolute cartographer. Frame this one.", "Are you sure you didn't just live there?", "Google Street View owes you royalties."]],
  [20000, ["Google Maps is shaking.", "Big brain geography hours.", "That's a passport stamp of a score."]],
  [15000, ["Solid. Respectable. Mildly boring.", "Not bad, the bollards are proud of you.", "Middle of the map, middle of the pack."]],
  [10000, ["Was that a guess or a sneeze?", "Somewhere on Earth, roughly. Respect.", "The compass was upside down, wasn't it?"]],
  [0, ["Did you play with your eyes closed?", "Bold strategy: guess the ocean.", "Lost. Possibly still lost."]],
];
function quip(score, seed) { const tier = QUIPS.find(([min]) => score >= min)[1]; let h = 0; for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return tier[h % tier.length]; }

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
  for (const e of memberEvents) {
    const tag = e.nick && e.nick !== e.name ? ` (${e.nick} on GeoGuessr)` : "";
    if (e.type === "joined") msgs.push(`👋 *${e.name}*${tag} just joined Geo Daily! Their scores will show up here after their first daily. 🌍`);
    if (e.type === "requested") msgs.push(`👋 *${e.name}*${tag} signed up for Geo Daily. ${owner} sent them a GeoGuessr friend request, accept it to start showing up. 📨`);
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
      const perfect = rounds.filter((x) => x.points >= 5000).length;
      const wk = weekTotal(after, id, latest);
      const left = known.filter((x) => !D.players[x]).map((x) => nameOf(x));
      const lines = [
        `💥🌍 *GEO ALERT* 🌍💥`,
        `🔥🔥 *${name}* just finished the daily! 🔥🔥`,
        ``,
        `🎯 Score: *${fmt(p.total)}*  (${ordinal(place)} of ${ranked.length} so far)`,
        rounds.length ? `🔢 Rounds: ${rounds.map((x) => fmt(x.points)).join("  ·  ")}` : null,
        perfect ? `⭐ Perfect 5Ks: ${perfect}` : null,
        `⏱️ Time: ${mmss(p.time)}`,
        ``,
        tookLead ? `👑 New leader for ${dayLabel(latest)}!` : null,
        `_${quip(p.total, id + latest)}_`,
        wk ? `📅 ${name}'s week so far: ${fmt(wk.total)} over ${wk.days} day${wk.days === 1 ? "" : "s"} 📈` : null,
        left.length ? `⏳ Still to play: ${left.join(", ")}` : `✅ Everyone's done!`,
      ].filter((x) => x !== null);
      msgs.push(lines.join("\n"));
      state.pinged[latest] = [...new Set([...(state.pinged[latest] || []), id])];
    }
  }

  // 2. one results post per day, at or after recapHour local time on that day
  const local = new Intl.DateTimeFormat("en-CA", { timeZone: sc.timeZone || "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const part = (t) => local.find((x) => x.type === t).value;
  const localDay = `${part("year")}-${part("month")}-${part("day")}`, localHour = +part("hour");
  for (const d of days.slice(0, 3)) {
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
  for (const k of Object.keys(state.pinged).sort().slice(0, -7)) delete state.pinged[k];

  for (const text of msgs) await post(text);
  return { msgs, state };
}

export async function slackPost(url, text) {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text, unfurl_links: false }) });
  if (!res.ok) throw new Error(`Slack said ${res.status}: ${await res.text()}`);
}

export async function saveState(state) {
  await writeFile(join(ROOT, "data/slack-state.json"), JSON.stringify(state, null, 1) + "\n");
}
