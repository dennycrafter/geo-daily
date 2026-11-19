// GET /api/card?r=4345,4076,4199,3387,4635&t=20642  ->  PNG of the round-score card
import { renderCard } from "./card-render.js";

export async function GET(request) {
  const q = new URL(request.url).searchParams;
  const rounds = String(q.get("r") || "").split(",").map((x) => Math.max(0, Math.min(5000, parseInt(x, 10) || 0))).slice(0, 5);
  if (rounds.length !== 5) return new Response("Need 5 rounds", { status: 400 });
  const total = Math.max(0, Math.min(25000, parseInt(q.get("t"), 10) || rounds.reduce((a, b) => a + b, 0)));
  const png = await renderCard({ rounds, total });
  return new Response(png, { headers: { "content-type": "image/png", "cache-control": "public, max-age=31536000, immutable" } });
}
