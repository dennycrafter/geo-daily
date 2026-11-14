// Fake GeoGuessr API with the same response shapes, for testing scripts/fetch.mjs offline.
import http from "node:http";

const mkPlayer = (id, nick, pts) => ({
  game: {
    mapName: "World", timeLimit: 180,
    rounds: ["cr", "jp", "br", "za", "fi"].map((c, i) => ({ lat: i, lng: i, region: { country: c } })),
    player: {
      id, nick, countryCode: "IE",
      totalScoreInPoints: pts.reduce((a, b) => a + b, 0),
      totalDistanceInMeters: 1234567, totalTime: 400,
      guesses: pts.map((p, i) => ({ lat: 10 + i, lng: 20 - i, roundScoreInPoints: p, distanceInMeters: (5000 - p) * 1000 + 50, time: 60 + i, timedOut: false, timedOutWithGuess: false })),
    },
  },
});

const routes = {
  "/api/v3/challenges/daily-challenges/today": { token: "TODAY", date: "2026-11-14T02:35:00Z" },
  "/api/v3/challenges/daily-challenges/previous": [
    { token: "D13", date: "2026-11-13T01:36:00Z" },
    { token: "D12", date: "2026-11-12T01:36:00Z" },
  ],
  "/api/v3/results/highscores/D13": { items: [mkPlayer("a1", "denis", [0, 4000, 2310, 3000, 2000]), mkPlayer("b2", "driplessbeing", [4999, 4100, 3000, 1200, 4500])] },
  "/api/v3/results/highscores/D12": { items: [mkPlayer("b2", "driplessbeing", [3000, 3000, 3000, 3000, 3000])] },
};

// friend features: aaaa... already a friend, bbbb... sent Denis a request, cccc... is brand new
const A = "a".repeat(24), B = "b".repeat(24), C = "c".repeat(24);
const calls = [];
routes["/api/v3/social/friends/summary"] = { friends: [{ userId: A, nick: "already_friend" }] };
routes["/api/v3/social/friends/received"] = [{ userId: B, nick: "sent_me_one" }];
routes[`/api/v3/users/${A}`] = { nick: "already_friend" };
routes[`/api/v3/users/${B}`] = { nick: "sent_me_one" };
routes[`/api/v3/users/${C}`] = { nick: "brand_new" };
routes["/api/join"] = [{ id: A, name: "Andy", at: "2026-11-14T00:00:00Z" }, { id: B, name: "Bea", at: "2026-11-14T00:00:00Z" }, { id: C, name: "Cal", at: "2026-11-14T00:00:00Z" }];
routes["/__calls"] = calls;

http.createServer((req, res) => {
  if (req.method !== "GET") calls.push(req.method + " " + req.url);
  if (req.url.startsWith("/api/join") || req.url.startsWith("/__calls")) { res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify(routes[req.url.split("?")[0]])); }
  if (!String(req.headers.cookie || "").includes("_ncfa=good")) { res.writeHead(401); return res.end(); }
  const path = req.url.split("?")[0];
  if (path === "/api/v3/results/highscores/TODAY") { res.writeHead(404); return res.end('{"message":"User hasn\'t played challenge yet."}'); }
  if (req.method !== "GET" && path.startsWith("/api/v3/social/friends/")) { res.writeHead(200); return res.end(); }
  const body = routes[path];
  if (!body) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}).listen(4789, () => console.log("mock on 4789"));
