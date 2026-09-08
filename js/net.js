/* SPILL THE LETTERS - networking (PeerJS, host-authoritative)
   The big screen is the host peer. Phones open a data connection to it.
   Peer id is "spltl-<CODE>" so the QR only has to carry a 4-letter code. */
(function () {
  "use strict";

  var ALPHA = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no I O 0 1
  var PREFIX = "spltl-";
  var PING_MS = 7000;
  var STALE_MS = 26000;

  function code(n) {
    var s = "";
    for (var i = 0; i < (n || 4); i++) s += ALPHA[(Math.random() * ALPHA.length) | 0];
    return s;
  }

  function peerOpts() {
    var o = { debug: 0 };
    var custom = new URLSearchParams(location.search).get("peerhost");
    if (custom) {
      o.host = custom;
      o.secure = true;
      o.port = 443;
      o.path = "/";
    }
    return o;
  }

  /* ------------------------------------------------------------------
     HOST
     ------------------------------------------------------------------ */
  function host(cb) {
    var peer = null, roomCode = null, tries = 0, dead = false;
    var conns = {};      // pid -> DataConnection
    var pending = [];    // connections that have not sent "join" yet
    var lastSeen = {};   // pid -> timestamp

    function boot() {
      if (dead) return;
      roomCode = code(4);
      peer = new Peer(PREFIX + roomCode, peerOpts());

      peer.on("open", function () {
        tries = 0;
        cb.onReady && cb.onReady(roomCode);
      });

      peer.on("connection", function (conn) {
        pending.push(conn);
        var bound = null;

        conn.on("data", function (msg) {
          if (!msg || typeof msg !== "object") return;
          if (msg.t === "join") {
            var pid = cb.onJoin ? cb.onJoin(msg, conn) : null;
            if (!pid) { try { conn.close(); } catch (e) {} return; }
            // A returning player replaces their old socket.
            if (conns[pid] && conns[pid] !== conn) { try { conns[pid].close(); } catch (e) {} }
            bound = pid;
            conns[pid] = conn;
            lastSeen[pid] = Date.now();
            var i = pending.indexOf(conn); if (i >= 0) pending.splice(i, 1);
            return;
          }
          if (!bound) return;
          lastSeen[bound] = Date.now();
          if (msg.t === "ping") { try { conn.send({ t: "pong" }); } catch (e) {} return; }
          cb.onMsg && cb.onMsg(bound, msg);
        });

        conn.on("close", function () {
          var i = pending.indexOf(conn); if (i >= 0) pending.splice(i, 1);
          if (bound && conns[bound] === conn) {
            delete conns[bound];
            cb.onLeave && cb.onLeave(bound);
          }
        });
        conn.on("error", function () {});
      });

      peer.on("disconnected", function () {
        if (!dead) { try { peer.reconnect(); } catch (e) {} }
      });

      peer.on("error", function (err) {
        if (err && err.type === "unavailable-id" && tries < 8) {
          tries++;
          try { peer.destroy(); } catch (e) {}
          setTimeout(boot, 120);
          return;
        }
        if (err && (err.type === "peer-unavailable" || err.type === "network")) return;
        cb.onError && cb.onError(err);
      });
    }

    setInterval(function () {
      var now = Date.now();
      Object.keys(conns).forEach(function (pid) {
        if (now - (lastSeen[pid] || 0) > STALE_MS) {
          try { conns[pid].close(); } catch (e) {}
          delete conns[pid];
          cb.onLeave && cb.onLeave(pid);
        }
      });
    }, 5000);

    boot();

    return {
      get code() { return roomCode; },
      isConnected: function (pid) { var c = conns[pid]; return !!(c && c.open); },
      send: function (pid, msg) {
        var c = conns[pid];
        if (c && c.open) { try { c.send(msg); return true; } catch (e) {} }
        return false;
      },
      broadcast: function (msg) {
        Object.keys(conns).forEach(function (pid) {
          var c = conns[pid];
          if (c && c.open) { try { c.send(msg); } catch (e) {} }
        });
      },
      destroy: function () { dead = true; try { peer.destroy(); } catch (e) {} }
    };
  }

  /* ------------------------------------------------------------------
     PLAYER
     ------------------------------------------------------------------ */
  function join(roomCode, cb) {
    var peer = null, conn = null, dead = false, attempts = 0, pingT = 0, retryT = 0;
    var target = PREFIX + String(roomCode || "").toUpperCase();

    function fail(reason) {
      if (dead) return;
      clearInterval(pingT);
      cb.onDrop && cb.onDrop(reason);
      schedule();
    }

    function schedule() {
      if (dead) return;
      attempts++;
      if (attempts > 40) { cb.onGiveUp && cb.onGiveUp(); return; }
      clearTimeout(retryT);
      retryT = setTimeout(boot, Math.min(1000 + attempts * 700, 6000));
    }

    function boot() {
      if (dead) return;
      try { if (peer) peer.destroy(); } catch (e) {}
      peer = new Peer(peerOpts());

      peer.on("open", function () {
        conn = peer.connect(target, { reliable: true, serialization: "json" });
        var opened = false;

        var guard = setTimeout(function () {
          if (!opened) { try { conn.close(); } catch (e) {} fail("timeout"); }
        }, 12000);

        conn.on("open", function () {
          opened = true;
          clearTimeout(guard);
          attempts = 0;
          cb.onOpen && cb.onOpen();
          clearInterval(pingT);
          pingT = setInterval(function () {
            if (conn && conn.open) { try { conn.send({ t: "ping" }); } catch (e) {} }
          }, PING_MS);
        });

        conn.on("data", function (msg) {
          if (msg && msg.t === "pong") return;
          cb.onMsg && cb.onMsg(msg);
        });

        conn.on("close", function () { clearTimeout(guard); fail("closed"); });
        conn.on("error", function () { clearTimeout(guard); });
      });

      peer.on("error", function (err) {
        var t = err && err.type;
        if (t === "peer-unavailable") { cb.onNoRoom && cb.onNoRoom(); schedule(); return; }
        if (t === "network" || t === "server-error" || t === "socket-error" || t === "socket-closed") {
          fail("network"); return;
        }
        if (t === "unavailable-id") { schedule(); return; }
        cb.onError && cb.onError(err);
      });

      peer.on("disconnected", function () {
        if (!dead) { try { peer.reconnect(); } catch (e) {} }
      });
    }

    boot();

    return {
      send: function (msg) {
        if (conn && conn.open) { try { conn.send(msg); return true; } catch (e) {} }
        return false;
      },
      isOpen: function () { return !!(conn && conn.open); },
      destroy: function () {
        dead = true; clearInterval(pingT); clearTimeout(retryT);
        try { peer.destroy(); } catch (e) {}
      }
    };
  }

  window.NET = { host: host, join: join, code: code, PREFIX: PREFIX, ALPHA: ALPHA };
})();
