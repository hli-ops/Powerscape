// Powerscape multiplayer server: serves the game and relays presence + casts over WebSocket.
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { WebSocketServer } = require("ws");

const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, "public");
const MAX_PER_ROOM = 16;
const TICK_MS = 100; // how often peer lists are pushed to clients

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

/* ---------- static files ---------- */
const server = http.createServer((req, res) => {
  let p;
  try {
    p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  } catch {
    res.writeHead(400);
    return res.end("Bad request");
  }
  if (p === "/") p = "/index.html";
  const file = path.normalize(path.join(PUBLIC, p));
  if (!file.startsWith(PUBLIC + path.sep)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }
  fs.readFile(file, (err, buf) => {
    if (err) {
      res.writeHead(404);
      return res.end("Not found");
    }
    res.writeHead(200, {
      "Content-Type": MIME[path.extname(file)] || "application/octet-stream",
      "Cache-Control": "no-cache",
    });
    res.end(buf);
  });
});

/* ---------- multiplayer ---------- */
const wss = new WebSocketServer({ server, path: "/ws", maxPayload: 4096 });
const rooms = new Map(); // roomName -> Set<ws>
const dirty = new Set(); // rooms whose peer list changed since last tick

const num = (v, lo, hi, d = 0) => {
  v = Number(v);
  return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d;
};

// Only keep the fields the game uses, with sane ranges.
function cleanPresence(d) {
  if (!d || !d.on) return { on: null };
  return {
    on: 1,
    x: num(d.x, -1e5, 1e5),
    z: num(d.z, -1e5, 1e5),
    n: String(d.n || "Player").slice(0, 24),
    c: num(d.c, 0, 0xffffff),
    l: num(d.l, 1, 999999, 1),
    w: num(d.w, 1, 999999, 1),
  };
}

function send(ws, obj) {
  if (ws.readyState === 1) ws.send(JSON.stringify(obj));
}

function pushPeers(roomName) {
  const set = rooms.get(roomName);
  if (!set) return;
  const all = [...set].map((c) => ({ peer: c.id, presence: c.presence }));
  for (const c of set) send(c, { t: "peers", peers: all.filter((p) => p.peer !== c.id) });
}

setInterval(() => {
  for (const r of dirty) pushPeers(r);
  dirty.clear();
}, TICK_MS);

wss.on("connection", (ws, req) => {
  const q = new URL(req.url, "http://x").searchParams;
  const roomName = (q.get("room") || "lobby").replace(/[^\w-]/g, "").slice(0, 32) || "lobby";
  let set = rooms.get(roomName);
  if (!set) rooms.set(roomName, (set = new Set()));
  if (set.size >= MAX_PER_ROOM) {
    send(ws, { t: "full" });
    return ws.close(1013, "Room full");
  }

  ws.id = crypto.randomUUID();
  ws.room = roomName;
  ws.presence = { on: null };
  ws.alive = true;
  ws.tokens = 60;
  ws.lastRefill = Date.now();
  set.add(ws);
  dirty.add(roomName);
  send(ws, { t: "hello", id: ws.id, room: roomName });

  ws.on("pong", () => (ws.alive = true));

  ws.on("message", (raw) => {
    // rate limit: ~40 msgs/s with a burst of 60
    const now = Date.now();
    ws.tokens = Math.min(60, ws.tokens + ((now - ws.lastRefill) / 1000) * 40);
    ws.lastRefill = now;
    if (ws.tokens < 1) return;
    ws.tokens -= 1;

    let m;
    try {
      m = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (!m || typeof m !== "object") return;

    if (m.t === "presence") {
      ws.presence = cleanPresence(m.d);
      dirty.add(ws.room);
    } else if (m.t === "emit" && typeof m.n === "string" && /^[a-z]{1,16}$/.test(m.n)) {
      for (const c of rooms.get(ws.room) || []) {
        if (c !== ws) send(c, { t: "msg", n: m.n, d: m.d, from: ws.id });
      }
    }
  });

  ws.on("close", () => {
    const s = rooms.get(ws.room);
    if (!s) return;
    s.delete(ws);
    if (s.size) dirty.add(ws.room);
    else rooms.delete(ws.room);
  });

  ws.on("error", () => {});
});

// drop dead connections
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.alive) {
      ws.terminate();
      continue;
    }
    ws.alive = false;
    ws.ping();
  }
}, 30000);

server.listen(PORT, "0.0.0.0", () => console.log("Powerscape running on port " + PORT));
