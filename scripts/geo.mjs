// A tiny GeoGuessr client for one logged-in account (its _ncfa cookie).
export function geoClient(cookie, base = process.env.GEO_BASE_URL || "https://www.geoguessr.com") {
  const headers = { cookie: `_ncfa=${cookie}`, accept: "application/json", "user-agent": "Mozilla/5.0 (geo-daily friends dashboard)" };
  async function call(method, path, body) {
    const res = await fetch(base + path, { method, headers: body === undefined ? headers : { ...headers, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = text; }
    return { status: res.status, body: json };
  }
  return {
    get: (path) => call("GET", path),
    send: (method, path, body) => call(method, path, body),
  };
}
