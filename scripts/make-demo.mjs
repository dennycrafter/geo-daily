// Makes data/demo.json: made-up players and scores so the dashboard can be previewed.
import { writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "demo.json");
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

const players = [
  { id: "p1", nick: "atlas_andy", skill: 0.78 },
  { id: "p2", nick: "bollardking", skill: 0.84 },
  { id: "p3", nick: "lostinlesotho", skill: 0.62 },
  { id: "p4", nick: "meta_mo", skill: 0.71 },
  { id: "p5", nick: "pinpusher", skill: 0.55 },
];
const countries = ["br","jp","za","fi","cl","nz","th","ca","ru","ar","id","no","mx","ke","pl","au","us","fr","tr","in","es","se","co","ph","ro","gh","pt","my"];

const days = {};
const start = new Date("2026-10-21T00:00:00Z");
for (let d = 0; d < 24; d++) {
  const day = new Date(start.getTime() + d * 864e5).toISOString().slice(0, 10);
  const rounds = Array.from({ length: 5 }, () => ({ country: countries[Math.floor(rnd() * countries.length)], lat: 0, lng: 0 }));
  const roundDifficulty = rounds.map(() => 0.55 + rnd() * 0.6);
  const entry = { token: "DEMO" + d, map: "World", timeLimit: 180, rounds, players: {} };
  for (const p of players) {
    if (rnd() < 0.12) continue; // skipped a day
    const rs = roundDifficulty.map((diff) => {
      let pct = Math.min(1, Math.max(0, p.skill * diff + (rnd() - 0.5) * 0.55));
      if (rnd() < 0.06) pct = 1;
      if (rnd() < 0.05) pct = 0;
      const points = Math.round(5000 * Math.pow(pct, 1.4));
      const kmv = points >= 4999 ? Math.round(rnd() * 150) / 1000 : Math.round(Math.pow(1 - pct, 2) * 9000 + rnd() * 80);
      const time = Math.round(25 + rnd() * 150);
      return { points, km: kmv, time, timedOut: time > 178 };
    });
    entry.players[p.id] = {
      nick: p.nick, country: "us",
      total: rs.reduce((a, r) => a + r.points, 0),
      time: rs.reduce((a, r) => a + r.time, 0),
      km: Math.round(rs.reduce((a, r) => a + r.km, 0) * 10) / 10,
      rounds: rs,
    };
  }
  days[day] = entry;
}
const sorted = Object.fromEntries(Object.entries(days).sort((a, b) => b[0].localeCompare(a[0])));
const data = {
  demo: true,
  updatedAt: new Date(Date.UTC(2026, 10, 13, 23, 40)).toISOString(),
  days: sorted,
  players: Object.fromEntries(players.map((p) => [p.id, { nick: p.nick, firstSeen: "2026-10-21" }])),
};
await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, JSON.stringify(data) + "\n");
console.log("Wrote data/demo.json");
