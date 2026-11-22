/* Powerscape multiplayer server: serves the game from /public and relays players over WebSocket (/ws).
   Players in the same room see each other (name tag + position) and their attacks help each other. */
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { WebSocketServer } = require("ws");

const PORT = process.env.PORT || 3000;
const MAX_ROOM = +process.env.MAX_ROOM || 24;          // players per room
const MAX_TOTAL = +process.env.MAX_TOTAL || 400;       // players on the whole server
const ORIGINS = (process.env.ALLOWED_ORIGINS || "").split(",").map(s => s.trim()).filter(Boolean); // optional lock-down
const PUB = path.join(__dirname, "public");
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".png": "image/png", ".ico": "image/x-icon", ".svg": "image/svg+xml", ".json": "application/json" };

/* ---------- static files ---------- */
const server = http.createServer((req, res) => {
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, "http://x").pathname); }
  catch { res.writeHead(400); return res.end("bad request"); }
  if (pathname === "/health") { res.writeHead(200, { "content-type": "text/plain" }); return res.end("ok"); }
  if (pathname === "/") pathname = "/index.html";
  const file = path.normalize(path.join(PUB, pathname));
  if (!file.startsWith(PUB + path.sep)) { res.writeHead(403); return res.end("forbidden"); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, { "content-type": "text/plain" }); return res.end("not found"); }
    res.writeHead(200, { "content-type": MIME[path.extname(file)] || "application/octet-stream", "cache-control": "no-cache" });
    res.end(buf);
  });
});

/* ---------- multiplayer ---------- */
const wss = new WebSocketServer({ server, path: "/ws", maxPayload: 4096 });
const rooms = new Map(); // name -> { clients:Set, dirty:boolean }
let total = 0;

const num = (v, lo, hi) => { v = +v; return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : 0; };
const cleanPresence = p => {
  if (!p || typeof p !== "object" || !p.on) return { on: null };
  return { on: 1, x: num(p.x, -1e6, 1e6), z: num(p.z, -1e6, 1e6), n: String(p.n == null ? "Player" : p.n).slice(0, 24),
    c: num(p.c, 0, 0xffffff) | 0, l: num(p.l, 1, 1e4) | 0, w: num(p.w, 0, 1e6) | 0, r: num(p.r, 0, 5) | 0 };
};
const cleanCast = d => {
  if (!d || typeof d !== "object") return null;
  return { t: num(d.t, 0, 9) | 0, a: num(d.a, 0, 5) | 0, x: num(d.x, -1e6, 1e6), z: num(d.z, -1e6, 1e6),
    dx: num(d.dx, -1, 1), dz: num(d.dz, -1, 1), tx: num(d.tx, -1e6, 1e6), tz: num(d.tz, -1e6, 1e6),
    c: num(d.c, 0, 0xffffff) | 0, k: String(d.k || "magic").slice(0, 12), r: num(d.r, 0, 5) | 0,
    d: num(d.d, 0, 1e6), l: num(d.l, 1, 1e4) | 0, o: num(d.o, 0, 5) | 0 };
};

wss.on("connection", (ws, req) => {
  if (ORIGINS.length && !ORIGINS.includes(req.headers.origin)) return ws.close(1008, "origin");
  if (total >= MAX_TOTAL) return ws.close(1013, "server full");
  let name = "lobby";
  try { name = (new URL(req.url, "http://x").searchParams.get("room") || "lobby").toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 24) || "lobby"; } catch {}
  let room = rooms.get(name);
  if (!room) { room = { clients: new Set(), dirty: false }; rooms.set(name, room); }
  if (room.clients.size >= MAX_ROOM) return ws.close(1013, "room full");

  const c = { ws, id: crypto.randomBytes(4).toString("hex"), p: { on: null }, alive: true, msgs: 0, casts: 0 };
  room.clients.add(c); total++;
  ws.send(JSON.stringify({ t: "hi", id: c.id }));

  ws.on("pong", () => { c.alive = true; });
  ws.on("message", raw => {
    if (++c.msgs > 60) { if (c.msgs > 300) ws.terminate(); return; }   // at most 60 messages per second
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m !== "object") return;
    if (m.t === "p") { c.p = cleanPresence(m.p); room.dirty = true; }
    else if (m.t === "e" && m.k === "cast") {
      if (++c.casts > 25) return;                                       // at most 25 attacks per second
      const d = cleanCast(m.d); if (!d) return;
      const out = JSON.stringify({ t: "cast", id: c.id, d });
      for (const o of room.clients) if (o !== c && o.ws.readyState === 1) o.ws.send(out);
    }
  });
  ws.on("close", () => {
    room.clients.delete(c); total--; room.dirty = true;
    if (!room.clients.size) rooms.delete(name);
  });
  ws.on("error", () => {});
  room.dirty = true;
});

// every 100ms: send each room its player list if anything changed
setInterval(() => {
  for (const room of rooms.values()) {
    if (!room.dirty) continue;
    room.dirty = false;
    const list = [];
    for (const c of room.clients) if (c.p.on) list.push({ id: c.id, p: c.p });
    const out = JSON.stringify({ t: "peers", peers: list });
    for (const c of room.clients) if (c.ws.readyState === 1) c.ws.send(out);
  }
}, 100);
setInterval(() => { for (const room of rooms.values()) for (const c of room.clients) { c.msgs = 0; c.casts = 0; } }, 1000);
// keep connections alive through proxies and drop dead ones
setInterval(() => { for (const room of rooms.values()) for (const c of room.clients) {
  if (!c.alive) { c.ws.terminate(); continue; } c.alive = false; try { c.ws.ping(); } catch {} } }, 25000);

server.listen(PORT, "0.0.0.0", () => console.log("Powerscape listening on port " + PORT));
