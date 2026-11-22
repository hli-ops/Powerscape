/* Powerscape multiplayer client. The game talks to window.claude.use("room"); this file provides that
   room object over a WebSocket to the server in this repo, so the game code needs no other change. */
(function () {
  var q = new URLSearchParams(location.search);
  var ROOM = (q.get("room") || "").toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 24);
  if (!ROOM) {
    // no room in the link: make a private one and put it in the address bar so you can share the link
    ROOM = Math.random().toString(36).slice(2, 7);
    try { q.set("room", ROOM); history.replaceState(null, "", location.pathname + "?" + q.toString() + location.hash); } catch (e) {}
  }
  window.PS_ROOM = ROOM;
  var ws = null, me = null, peers = [], pres = null, pcb = [], ecb = {}, retry = 0, timer = null;
  function firePeers() { var ch = { peers: peers }; pcb.forEach(function (f) { try { f(ch); } catch (e) {} }); }
  function send(o) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); }
  function connect() {
    var proto = location.protocol === "https:" ? "wss:" : "ws:";
    ws = new WebSocket(proto + "//" + location.host + "/ws?room=" + encodeURIComponent(ROOM));
    ws.onopen = function () { retry = 0; if (pres) send({ t: "p", p: pres }); };
    ws.onmessage = function (ev) {
      var m; try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (m.t === "hi") me = m.id;
      else if (m.t === "peers") {
        peers = (m.peers || []).map(function (p) { return { peer: p.id, sameTab: p.id === me, kind: "viewer", presence: p.p }; });
        firePeers();
      } else if (m.t === "cast") {
        (ecb.cast || []).forEach(function (f) { try { f({ data: m.d, sameTab: false, peer: m.id }); } catch (e) {} });
      }
    };
    ws.onclose = function () { peers = []; firePeers(); clearTimeout(timer); timer = setTimeout(connect, Math.min(10000, 500 * Math.pow(2, retry++))); };
    ws.onerror = function () { try { ws.close(); } catch (e) {} };
  }
  var room = {
    peers: function () { return peers; },
    onPeers: function (f) { pcb.push(f); },
    on: function (t, f) { (ecb[t] = ecb[t] || []).push(f); },
    emit: function (t, d) { send({ t: "e", k: t, d: d }); return Promise.resolve(); },
    presence: function (p) { pres = p; send({ t: "p", p: p }); return Promise.resolve(); }
  };
  window.claude = { use: function (name) { return Promise.resolve(name === "room" ? room : null); } };
  connect();
  // click the online status line to copy the invite link
  addEventListener("DOMContentLoaded", function () {
    var n = document.getElementById("net"); if (!n) return;
    n.style.cursor = "pointer"; n.title = "Click to copy the invite link";
    n.addEventListener("click", function () {
      var url = location.origin + location.pathname + "?room=" + ROOM;
      if (navigator.clipboard) navigator.clipboard.writeText(url).then(function () { n.textContent = "Invite link copied: " + url; }, function () {});
    });
  });
})();
