// Provides window.claude.use("room") on top of the WebSocket server,
// so the game's multiplayer code works unchanged outside Claude.
(function () {
  if (window.claude && typeof window.claude.use === "function") return;

  const roomName = new URLSearchParams(location.search).get("room") || "lobby";
  const wsUrl =
    (location.protocol === "https:" ? "wss://" : "ws://") +
    location.host + "/ws?room=" + encodeURIComponent(roomName);

  let ws = null, retry = 0, myPresence = null, peers = [];
  const peerCbs = [], handlers = {};

  const send = (o) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); };
  const notify = () => peerCbs.forEach((cb) => { try { cb({ peers }); } catch (e) { console.error(e); } });

  function connect() {
    ws = new WebSocket(wsUrl);
    ws.onopen = () => { retry = 0; if (myPresence) send({ t: "presence", d: myPresence }); };
    ws.onmessage = (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      if (m.t === "peers") {
        peers = m.peers.map((p) => ({ peer: p.peer, kind: "viewer", sameTab: false, presence: p.presence }));
        notify();
      } else if (m.t === "msg") {
        (handlers[m.n] || []).forEach((cb) => { try { cb({ data: m.d, sameTab: false, from: m.from }); } catch (e) { console.error(e); } });
      }
    };
    ws.onclose = () => {
      peers = []; notify();
      setTimeout(connect, Math.min(5000, 500 * 2 ** retry++));
    };
  }
  connect();

  const room = {
    onPeers: (cb) => { peerCbs.push(cb); },
    on: (name, cb) => { (handlers[name] = handlers[name] || []).push(cb); },
    emit: (name, data) => { send({ t: "emit", n: name, d: data }); return Promise.resolve(); },
    presence: (d) => { myPresence = d; send({ t: "presence", d }); return Promise.resolve(); },
    peers: () => peers,
  };

  window.claude = window.claude || {};
  window.claude.use = (name) => Promise.resolve(name === "room" ? room : null);
})();
