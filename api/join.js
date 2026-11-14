// POST: someone joins with their GeoGuessr profile link, name and the group code.
// GET:  the list of join requests (id + name only), read by the score robot.
import { put, list } from "@vercel/blob";

const ID = /[0-9a-f]{24}/i;

export default async function handler(req, res) {
  try {
    if (req.method === "GET") {
      const { blobs } = await list({ prefix: "joins/", limit: 1000 });
      const joins = await Promise.all(blobs.map(async (b) => { try { return await (await fetch(b.url, { cache: "no-store" })).json(); } catch { return null; } }));
      res.setHeader("cache-control", "no-store");
      return res.status(200).json(joins.filter(Boolean));
    }
    if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });

    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    const code = String(body.code || "").trim().toLowerCase();
    if (!process.env.JOIN_CODE || code !== process.env.JOIN_CODE.trim().toLowerCase()) return res.status(403).json({ error: "That group code isn't right. Ask in the Slack channel." });
    const id = (String(body.link || "").match(ID) || [])[0]?.toLowerCase();
    if (!id) return res.status(400).json({ error: "That doesn't look like a GeoGuessr profile link. It should have /user/ and a long code in it." });
    const name = String(body.name || "").replace(/\s+/g, " ").trim().slice(0, 30);
    if (!name) return res.status(400).json({ error: "Add your name." });

    await put(`joins/${id}.json`, JSON.stringify({ id, name, at: new Date().toISOString() }), {
      access: "public", contentType: "application/json", addRandomSuffix: false, allowOverwrite: true, cacheControlMaxAge: 60,
    });
    return res.status(200).json({ ok: true, id, name });
  } catch (e) {
    return res.status(500).json({ error: "Something broke saving that. Try again in a minute." });
  }
}
