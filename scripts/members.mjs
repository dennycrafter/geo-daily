// Handles join requests from the site: makes each person Denis's GeoGuessr friend and saves their real name.
// Uses the same GeoGuessr login (GEO_NCFA) as the score puller.
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FILE = join(ROOT, "data", "members.json");

const idsFrom = (arr) => (Array.isArray(arr) ? arr : arr?.items || arr?.requests || [])
  .map((x) => String(x?.userId || x?.id || x?.user?.userId || x?.user?.id || x?.sender?.userId || x?.from?.userId || "").toLowerCase())
  .filter(Boolean);

export async function syncMembers({ get, send, siteUrl, joins: given }) {
  let members = {};
  try { members = JSON.parse(await readFile(FILE, "utf8")); } catch {}
  const before = JSON.stringify(members);
  const events = []; // { type: "joined" | "requested", id, name, nick }

  let joins = given;
  if (!joins) {
    if (!siteUrl) return { members, events };
    try { joins = await (await fetch(siteUrl.replace(/\/$/, "") + "/api/join", { cache: "no-store" })).json(); } catch { joins = []; }
  }
  if (!Array.isArray(joins) || !joins.length) return { members, events };

  const fr = await get("/api/v3/social/friends/summary");
  const friends = new Set(idsFrom(fr.body?.friends));
  const rec = await get("/api/v3/social/friends/received");
  const received = new Set(idsFrom(rec.body));

  for (const j of joins) {
    const id = String(j.id || "").toLowerCase();
    if (!/^[0-9a-f]{24}$/.test(id)) continue;
    const m = (members[id] ||= { name: j.name, status: "new", joinedAt: j.at });
    if (j.name && j.name !== m.name) m.name = j.name;
    if (!m.nick) { const u = await get(`/api/v3/users/${id}`); if (u.status === 200 && u.body?.nick) m.nick = u.body.nick; }
    if (m.status === "friends") continue; // already done, never repeat

    if (friends.has(id)) {
      if (m.status !== "friends") { const was = m.status; m.status = "friends"; events.push({ type: "joined", id, name: m.name, nick: m.nick, afterRequest: was === "requested" }); }
      continue;
    }
    if (received.has(id)) {
      const r = await send("PUT", `/api/v3/social/friends/${id}?context=`);
      if (r.status < 300) { m.status = "friends"; events.push({ type: "joined", id, name: m.name, nick: m.nick }); }
      else console.log(`Could not accept friend request from ${id}: ${r.status}`);
      continue;
    }
    if (m.status === "new") {
      const r = await send("POST", `/api/v3/social/friends/${id}?context=`);
      if (r.status < 300) { m.status = "requested"; m.requestedAt = new Date().toISOString(); events.push({ type: "requested", id, name: m.name, nick: m.nick }); }
      else console.log(`Could not send friend request to ${id}: ${r.status}`);
    }
  }

  if (JSON.stringify(members) !== before) await writeFile(FILE, JSON.stringify(members, null, 1) + "\n");
  return { members, events };
}
