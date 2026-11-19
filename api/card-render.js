// Draws the round-score card (PNG) shown in Slack pings. Shared by the API route and local tests.
import satori from "satori";
import { Resvg } from "@resvg/resvg-js";
import { readFile } from "node:fs/promises";

const fontFile = (w) => new URL(`./fonts/saira-condensed-latin-${w}-normal.woff`, import.meta.url);
const h = (type, style, ...children) => ({ type, props: { style, children: children.length <= 1 ? children[0] : children } });
const fmt = (n) => Math.round(n).toLocaleString("en-US");

const C = { bar: "#1b1336", edge: "#3a2c6e", tile: "#2a1f52", tileEdge: "#45367f", pin: "#7d5cf2", pinDark: "#5b3fd1", score: "#d8ccff", label: "#a48cf5", total: "#ffffff", gold: "#f5c542" };

// a simple map pin with the round number inside (our own drawing)
const pin = (n, gold) => h("div", { display: "flex", position: "relative", width: 44, height: 54, alignItems: "flex-start", justifyContent: "center" },
  h("svg", { position: "absolute", top: 0, left: 0, width: 44, height: 54 },
    { type: "path", props: { d: "M22 2C11 2 3 10 3 20.5 3 34 22 52 22 52S41 34 41 20.5C41 10 33 2 22 2Z", fill: gold ? C.gold : C.pin, stroke: gold ? "#c99a06" : C.pinDark, "stroke-width": 2 } }),
  h("div", { display: "flex", marginTop: 6, fontSize: 24, fontWeight: 800, color: gold ? "#3d2a00" : "#ffffff" }, String(n)));

export async function renderCard({ rounds, total }) {
  const [f700, f800] = await Promise.all([readFile(fontFile(700)), readFile(fontFile(800))]);
  const tiles = rounds.slice(0, 5).map((p, i) => h("div", { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", width: 132, height: 136, background: C.tile, border: `2px solid ${C.tileEdge}`, borderRadius: 16, gap: 6 },
    pin(i + 1, p >= 5000),
    h("div", { display: "flex", fontSize: 34, fontWeight: 700, color: p >= 5000 ? C.gold : C.score, letterSpacing: 0.5 }, fmt(p))));
  const root = h("div", { display: "flex", width: 1000, height: 200, background: "transparent", alignItems: "center", justifyContent: "center", fontFamily: "Saira" },
    h("div", { display: "flex", alignItems: "center", gap: 14, height: 176, padding: "0 26px 0 18px", background: C.bar, border: `2px solid ${C.edge}`, borderRadius: 24 },
      h("div", { display: "flex", width: 34, height: 136, alignItems: "center", justifyContent: "center" },
        h("div", { display: "flex", transform: "rotate(-90deg)", fontSize: 22, fontWeight: 800, color: C.label, letterSpacing: 3 }, "ROUND")),
      ...tiles,
      h("div", { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", marginLeft: 12, width: 150 },
        h("div", { display: "flex", fontSize: 24, fontWeight: 800, color: C.label, letterSpacing: 3 }, "TOTAL"),
        h("div", { display: "flex", fontSize: 50, fontWeight: 800, color: C.total, lineHeight: 1 }, fmt(total)))));
  const svg = await satori(root, { width: 1000, height: 200, fonts: [{ name: "Saira", data: f700, weight: 700, style: "normal" }, { name: "Saira", data: f800, weight: 800, style: "normal" }] });
  const png = new Resvg(svg, { fitTo: { mode: "width", value: 2000 } }).render().asPng(); // 2x for sharp text
  return png;
}
