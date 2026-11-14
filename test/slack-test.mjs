// Offline test of the Slack messages: fake before/after data, prints what would be posted.
import { notify } from "../scripts/slack.mjs";
const mk = (nick, total) => ({ nick, total, km: 900, time: 400, rounds: [{ points: 5000, km: 0.06 }, { points: 1000, km: 4200.5 }] });
const before = { days: { "2026-11-16": { players: { a: mk("denis", 15000) } } }, players: { a: { nick: "denis" }, b: { nick: "driplessbeing" }, c: { nick: "CoolCity337" } } };
const after = JSON.parse(JSON.stringify(before));
after.days["2026-11-16"].players.b = mk("driplessbeing", 18200);
const out = [];
let r = await notify({ before, after, now: new Date("2026-11-16T18:00:00Z"), post: (t) => out.push(t) }); // noon Austin
console.log("--- noon run:\n" + out.join("\n---\n"));
out.length = 0;
r = await notify({ before: after, after, now: new Date("2026-11-16T23:00:00Z"), post: (t) => out.push(t) }); // 5pm Austin
console.log("--- 5pm run:\n" + out.join("\n---\n"));
