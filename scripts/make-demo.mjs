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
const spots = { br: [-15.8, -47.9], jp: [36.2, 138.3], za: [-29.0, 24.0], fi: [64.0, 26.0], cl: [-33.4, -70.6], nz: [-41.3, 174.8], th: [15.9, 100.9], ca: [53.7, -105.0], ru: [56.0, 60.0], ar: [-34.6, -63.0], id: [-2.5, 117.0], no: [61.0, 9.0], mx: [23.6, -102.5], ke: [-0.0, 37.9], pl: [52.0, 19.0], au: [-25.3, 133.8], us: [39.8, -98.6], fr: [46.6, 2.2], tr: [39.0, 35.2], in: [21.0, 78.0], es: [40.4, -3.7], se: [62.0, 15.0], co: [4.6, -74.1], ph: [12.9, 121.8], ro: [45.9, 24.9], gh: [7.9, -1.0], pt: [39.4, -8.2], my: [4.2, 101.9] };
const countries = Object.keys(spots);
const R = 6371;
function offset([lat, lng], km) { // move km in a random direction
  const b = rnd() * 2 * Math.PI, d = km / R, la = lat * Math.PI / 180, lo = lng * Math.PI / 180;
  const la2 = Math.asin(Math.sin(la) * Math.cos(d) + Math.cos(la) * Math.sin(d) * Math.cos(b));
  const lo2 = lo + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(la), Math.cos(d) - Math.sin(la) * Math.sin(la2));
  let lng2 = lo2 * 180 / Math.PI; lng2 = ((lng2 + 540) % 360) - 180;
  return [Math.round(la2 * 180 / Math.PI * 1e4) / 1e4, Math.round(lng2 * 1e4) / 1e4];
}

const days = {};
const start = new Date("2026-10-21T00:00:00Z");
for (let d = 0; d < 24; d++) {
  const day = new Date(start.getTime() + d * 864e5).toISOString().slice(0, 10);
  const rounds = Array.from({ length: 5 }, () => { const c = countries[Math.floor(rnd() * countries.length)]; const [lat, lng] = offset(spots[c], rnd() * 300); return { country: c, lat, lng }; });
  const roundDifficulty = rounds.map(() => 0.55 + rnd() * 0.6);
  const entry = { token: "DEMO" + d, map: "World", timeLimit: 180, rounds, players: {} };
  for (const p of players) {
    if (rnd() < 0.12) continue; // skipped a day
    if (d === 23 && p.id === "p3") continue; // one person still to play today, to show the lock
    const rs = roundDifficulty.map((diff, ri) => {
      let pct = Math.min(1, Math.max(0, p.skill * diff + (rnd() - 0.5) * 0.55));
      if (rnd() < 0.06) pct = 1;
      if (rnd() < 0.05) pct = 0;
      const points = Math.round(5000 * Math.pow(pct, 1.4));
      const kmv = points >= 4999 ? Math.round(rnd() * 150) / 1000 : Math.round(Math.pow(1 - pct, 2) * 9000 + rnd() * 80);
      const time = Math.round(25 + rnd() * 150);
      const [glat, glng] = offset([rounds[ri].lat, rounds[ri].lng], Math.min(kmv, 15000));
      return { points, lat: glat, lng: glng, km: kmv, time, timedOut: time > 178 };
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
