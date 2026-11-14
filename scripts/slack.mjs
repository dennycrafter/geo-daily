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

export async function notify({ before, after, now = new Date(), post }) {
  const cfg = await read("data/config.json", {});
  const names = await read("data/names.json", {});
  const state = await read("data/slack-state.json", { pinged: {}, recapped: [] });
  const sc = cfg.slack || {};
  const site = cfg.siteUrl || "";
  const nameOf = (id, nick) => names[nick || after.players?.[id]?.nick] || nick || after.players?.[id]?.nick || "?";
  const days = Object.keys(after.days || {}).sort().reverse();
  const latest = days[0];
  const msgs = [];
  if (!latest) return { msgs, state };

  // 1. pings for people who newly finished the latest day
  const ageDays = (now - new Date(latest + "T12:00:00Z")) / 864e5;
  if (ageDays < 2) {
    const D = after.days[latest];
    const had = new Set([...Object.keys(before.days?.[latest]?.players || {}), ...(state.pinged[latest] || [])]);
    const fresh = Object.keys(D.players).filter((id) => !had.has(id));
    if (fresh.length) {
      const ranked = Object.entries(D.players).sort((a, b) => b[1].total - a[1].total).map(([id]) => id);
      const known = Object.keys(after.players || {});
      const left = known.filter((id) => !D.players[id]).map((id) => nameOf(id));
      const who = fresh.map((id) => {
        const p = D.players[id];
        return sc.scoresInPings ? `*${nameOf(id, p.nick)}* (${fmt(p.total)}, ${ranked.indexOf(id) + 1} of ${ranked.length} so far)` : `*${nameOf(id, p.nick)}*`;
      });
      const verb = fresh.length === 1 ? "finished" : "finished";
      let text = `✅ ${who.join(", ")} ${verb} the daily (${dayLabel(latest)}). ${Object.keys(D.players).length} of ${known.length} done.`;
      if (left.length) text += ` Still to play: ${left.join(", ")}.`;
      msgs.push(text);
      state.pinged[latest] = [...new Set([...(state.pinged[latest] || []), ...fresh])];
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
