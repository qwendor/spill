/* SPILL THE LETTERS - host (the big screen)
   Host-authoritative: this screen owns all state, timers and scoring.
   Phones only send "answer" and "vote" and render whatever view they are given. */
(function () {
  "use strict";

  var U = window.UI;
  var params = new URLSearchParams(location.search);
  var FAST = params.has("fast");
  var TS = FAST ? 0.22 : 1;

  var T = {
    intro:  Math.round(2600 * TS),
    answer: Math.round(75000 * TS),
    vote:   Math.round(30000 * TS),
    reveal: Math.round(9000 * TS),
    scores: Math.round(11000 * TS),
    grace:  Math.round(1300 * TS)
  };

  var PTS = { correct: 1000, speed: 400, openBook: 150, enigma: 600 };
  var MAX_ANSWER = 90;

  var G = null;
  var net = null;
  var painted = "";
  var tickT = 0;
  var phaseT = 0;
  var botT = [];

  /* ---------------- helpers ---------------- */
  function now() { return Date.now(); }
  function P(pid) { return G.players[pid]; }
  function list() { return G.order.map(P).filter(Boolean); }
  function active() { return list().filter(function (p) { return p.connected || p.bot; }); }
  function ranked() {
    return list().slice().sort(function (a, b) {
      return b.score - a.score || a.joinedAt - b.joinedAt;
    });
  }
  function rankOf(pid) {
    var r = ranked(), i;
    for (i = 0; i < r.length; i++) if (r[i].pid === pid) return i + 1;
    return r.length;
  }
  function stat(pid) {
    return G.stats[pid] || (G.stats[pid] = {
      correct: 0, timesGuessed: 0, votesGot: 0, featured: 0, answered: 0
    });
  }
  function clearBots() { botT.forEach(clearTimeout); botT = []; }
  function later(fn, ms) { var id = setTimeout(fn, ms); botT.push(id); return id; }

  /* ---------------- game setup ---------------- */
  function newGame() {
    var saved = {};
    try { saved = JSON.parse(localStorage.getItem("spill.setup") || "{}"); } catch (e) {}
    G = {
      phase: "lobby",
      round: 0,
      totalRounds: saved.rounds || 8,
      packs: saved.packs || { classic: true, campus: true, greek: true, deep: true, chaos: true },
      players: {}, order: [],
      deck: [], prompt: null,
      answers: {}, spotQueue: [], spot: null,
      stats: {}, gains: {},
      deadline: 0, duration: 0,
      seq: 0
    };
  }

  function saveSetup() {
    try {
      localStorage.setItem("spill.setup", JSON.stringify({ rounds: G.totalRounds, packs: G.packs }));
    } catch (e) {}
  }

  function buildDeck() {
    var pool = window.PROMPTS.filter(function (x) { return G.packs[x.p]; });
    if (!pool.length) pool = window.PROMPTS.slice();
    G.deck = U.shuffle(pool.slice());
  }

  function drawPrompt() {
    if (!G.deck.length) buildDeck();
    return G.deck.pop();
  }

  /* ---------------- joining ---------------- */
  function uniqueName(name, pid) {
    var base = U.clean(name, 18) || "Player";
    var taken = {}, i;
    G.order.forEach(function (id) {
      if (id !== pid && G.players[id]) taken[G.players[id].name.toLowerCase()] = 1;
    });
    if (!taken[base.toLowerCase()]) return base;
    for (i = 2; i < 60; i++) if (!taken[(base + " " + i).toLowerCase()]) return base + " " + i;
    return base + " " + Math.floor(Math.random() * 900 + 100);
  }

  function onJoin(msg) {
    var pid = String(msg.pid || "").slice(0, 40);
    var existing = pid && G.players[pid];

    if (existing) {                       // reconnect: keep score and identity
      existing.connected = true;
      existing.name = uniqueName(msg.name || existing.name, pid);
      existing.color = msg.color || existing.color;
      existing.org = U.clean(msg.org, 10);
      schedulePush();
      repaintSoft();
      return pid;
    }

    if (G.order.length >= 40) return null;
    if (!pid) return null;

    var used = {};
    list().forEach(function (p) { used[p.color] = 1; });
    var free = U.COLORS.filter(function (c) { return !used[c]; });
    var color = msg.color && !used[msg.color] ? msg.color
      : (free.length ? free[(Math.random() * free.length) | 0]
        : U.COLORS[G.order.length % U.COLORS.length]);

    G.players[pid] = {
      pid: pid,
      name: uniqueName(msg.name, pid),
      org: U.clean(msg.org, 10),
      color: color,
      score: 0,
      connected: true,
      bot: false,
      joinedAt: now()
    };
    G.order.push(pid);
    stat(pid);
    U.sfx.join();
    schedulePush();
    repaintSoft();
    return pid;
  }

  function onLeave(pid) {
    var p = P(pid);
    if (!p) return;
    p.connected = false;
    repaintSoft();
    checkAutoAdvance();
  }

  function onMsg(pid, msg) {
    var p = P(pid);
    if (!p || !msg) return;

    if (msg.t === "answer" && G.phase === "answer") {
      var txt = U.clean(msg.text, MAX_ANSWER);
      if (!txt) return;
      G.answers[pid] = txt;
      stat(pid).answered++;
      send(pid, viewFor(pid));
      repaintSoft();
      checkAutoAdvance();
      return;
    }

    if (msg.t === "vote" && G.phase === "vote" && G.spot) {
      if (pid === G.spot.pid) return;                 // author cannot vote
      if (G.spot.votes[pid]) return;                  // one vote each
      if (!P(msg.target) || msg.target === pid) return;
      var left = Math.max(0, G.deadline - now());
      G.spot.votes[pid] = { target: msg.target, left: left };
      send(pid, viewFor(pid));
      repaintSoft();
      checkAutoAdvance();
      return;
    }

    if (msg.t === "rename") {
      p.name = uniqueName(msg.name, pid);
      p.color = msg.color || p.color;
      p.org = U.clean(msg.org, 10);
      schedulePush();
      repaintSoft();
    }
  }

  /* ---------------- outbound views ---------------- */
  function send(pid, view) {
    var p = P(pid);
    if (!p || p.bot || !net) return;
    net.send(pid, view);
  }

  var pushT = 0;
  function schedulePush() {
    clearTimeout(pushT);
    pushT = setTimeout(pushAll, 40);
  }
  function pushAll() {
    G.order.forEach(function (pid) { send(pid, viewFor(pid)); });
  }

  function msLeft() { return Math.max(0, G.deadline - now()); }

  function viewFor(pid) {
    var p = P(pid);
    if (!p) return { t: "view", phase: "gone" };
    var base = {
      t: "view",
      phase: G.phase,
      seq: G.seq,
      round: G.round,
      totalRounds: G.totalRounds,
      you: { name: p.name, color: p.color, org: p.org, score: p.score, rank: rankOf(pid) },
      of: G.order.length
    };

    if (G.phase === "lobby") {
      base.count = G.order.length;
      return base;
    }
    if (G.phase === "intro") return base;

    if (G.phase === "answer") {
      base.prompt = G.prompt ? G.prompt.t : "";
      base.pack = G.prompt ? G.prompt.p : "";
      base.ms = msLeft();
      base.total = G.duration;
      base.submitted = !!G.answers[pid];
      base.text = G.answers[pid] || "";
      base.maxLen = MAX_ANSWER;
      return base;
    }

    if (G.phase === "vote" && G.spot) {
      base.text = G.spot.text;
      base.prompt = G.spot.prompt;
      base.ms = msLeft();
      base.total = G.duration;
      base.isAuthor = pid === G.spot.pid;
      base.voted = G.spot.votes[pid] ? G.spot.votes[pid].target : null;
      base.options = base.isAuthor ? [] : list()
        .filter(function (o) { return o.pid !== pid; })
        .sort(function (a, b) { return a.name.localeCompare(b.name); })
        .map(function (o) { return { id: o.pid, name: o.name, color: o.color }; });
      return base;
    }

    if (G.phase === "reveal" && G.spot) {
      var a = P(G.spot.pid);
      var mine = G.spot.votes[pid];
      base.text = G.spot.text;
      base.authorName = a ? a.name : "?";
      base.authorColor = a ? a.color : "#fff";
      base.isAuthor = pid === G.spot.pid;
      base.right = mine ? mine.target === G.spot.pid : null;
      base.gained = G.spot.gains && G.spot.gains[pid] ? G.spot.gains[pid] : 0;
      base.correctCount = G.spot.correctCount || 0;
      base.voterCount = Object.keys(G.spot.votes).length;
      return base;
    }

    if (G.phase === "scores") {
      base.gained = G.gains[pid] || 0;
      return base;
    }

    if (G.phase === "final") {
      base.award = (G.awards || []).filter(function (a) { return a.pid === pid; })
        .map(function (a) { return a.title; })[0] || null;
      base.winner = G.winnerName || "";
      return base;
    }
    return base;
  }

  /* ---------------- phase machine ---------------- */
  function setPhase(name, dur) {
    clearTimeout(phaseT);
    clearBots();
    G.phase = name;
    G.seq++;
    G.duration = dur || 0;
    G.deadline = dur ? now() + dur : 0;
    painted = "";
    paint();
    pushAll();
  }

  function startGame() {
    if (active().length < 2) { U.toast("Need at least 2 players", true); return; }
    buildDeck();
    G.round = 0;
    G.stats = {};
    list().forEach(function (p) { p.score = 0; stat(p.pid); });
    U.sfx.start();
    nextRound();
  }

  function nextRound() {
    if (G.round >= G.totalRounds) { finish(); return; }
    G.round++;
    G.gains = {};
    U.sfx.round();
    setPhase("intro", T.intro);
    phaseT = setTimeout(beginAnswer, T.intro);
  }

  function beginAnswer() {
    G.prompt = drawPrompt();
    G.answers = {};
    setPhase("answer", T.answer);
    phaseT = setTimeout(endAnswer, T.answer);
    scheduleBotAnswers();
  }

  function endAnswer() {
    clearTimeout(phaseT);
    clearBots();
    buildSpotQueue();
    nextSpot();
  }

  function buildSpotQueue() {
    var pool = active().filter(function (p) { return !!G.answers[p.pid]; });
    var perRound = Math.max(2, Math.min(4, Math.ceil(active().length / G.totalRounds)));
    if (active().length < 4) perRound = Math.min(perRound, Math.max(1, pool.length));

    // Fewest features first, shuffled inside each tier, so everyone gets a turn.
    U.shuffle(pool);
    pool.sort(function (a, b) { return stat(a.pid).featured - stat(b.pid).featured; });
    G.spotQueue = pool.slice(0, Math.min(perRound, pool.length)).map(function (p) { return p.pid; });
  }

  function nextSpot() {
    if (!G.spotQueue.length) { showScores(); return; }
    var pid = G.spotQueue.shift();
    var text = G.answers[pid];
    if (!text || !P(pid)) { nextSpot(); return; }
    stat(pid).featured++;
    G.spot = {
      pid: pid, text: text,
      prompt: G.prompt ? G.prompt.t : "",
      votes: {}, gains: {}, correctCount: 0
    };
    U.sfx.tick();
    setPhase("vote", T.vote);
    phaseT = setTimeout(endVote, T.vote);
    scheduleBotVotes();
  }

  function skipSpot() {
    clearTimeout(phaseT);
    clearBots();
    G.spot = null;
    nextSpot();
  }

  function endVote() {
    clearTimeout(phaseT);
    clearBots();
    scoreSpot();
    U.sfx.reveal();
    setPhase("reveal", T.reveal);
    phaseT = setTimeout(nextSpot, T.reveal);
  }

  function scoreSpot() {
    var s = G.spot;
    if (!s) return;
    var voters = Object.keys(s.votes);
    var correct = [];

    voters.forEach(function (v) {
      var vote = s.votes[v];
      stat(vote.target).votesGot++;
      if (vote.target === s.pid) {
        correct.push(v);
        var frac = G.duration ? vote.left / G.duration : 0;
        var pts = PTS.correct + Math.round(PTS.speed * Math.max(0, Math.min(1, frac)));
        award(v, pts);
        s.gains[v] = (s.gains[v] || 0) + pts;
        stat(v).correct++;
      }
    });

    s.correctCount = correct.length;
    s.correct = correct;
    stat(s.pid).timesGuessed += correct.length;

    if (correct.length) {
      var bonus = PTS.openBook * correct.length;
      award(s.pid, bonus);
      s.gains[s.pid] = (s.gains[s.pid] || 0) + bonus;
    } else if (voters.length >= 2) {
      award(s.pid, PTS.enigma);
      s.gains[s.pid] = (s.gains[s.pid] || 0) + PTS.enigma;
    }
  }

  function award(pid, pts) {
    var p = P(pid);
    if (!p) return;
    p.score += pts;
    G.gains[pid] = (G.gains[pid] || 0) + pts;
  }

  function showScores() {
    G.spot = null;
    setPhase("scores", T.scores);
    phaseT = setTimeout(nextRound, T.scores);
  }

  function finish() {
    G.spot = null;
    G.awards = computeAwards();
    var top = ranked()[0];
    G.winnerName = top ? top.name : "";
    setPhase("final", 0);
    U.sfx.win();
    U.confetti(7000);
  }

  function computeAwards() {
    var out = [], all = list().filter(function (p) { return stat(p.pid).answered > 0 || p.score > 0; });
    if (!all.length) return out;

    function best(title, desc, key, dir, guard) {
      var pool = all.filter(guard || function () { return true; });
      if (!pool.length) return;
      pool = pool.slice().sort(function (a, b) {
        var d = (stat(b.pid)[key] - stat(a.pid)[key]) * dir;
        return d || (b.score - a.score);
      });
      var w = pool[0];
      if (!w || stat(w.pid)[key] === 0 && dir > 0) return;
      out.push({ pid: w.pid, title: title, desc: desc, name: w.name, val: stat(w.pid)[key] });
    }

    best("Mind Reader", "most people read correctly", "correct", 1);
    best("Open Book", "everybody knows you", "timesGuessed", 1,
      function (p) { return stat(p.pid).featured > 0; });
    best("The Enigma", "hardest to figure out", "timesGuessed", -1,
      function (p) { return stat(p.pid).featured > 0; });
    best("Vote Magnet", "most votes received", "votesGot", 1);

    // No duplicate winners on the board.
    var seen = {};
    return out.filter(function (a) {
      if (seen[a.pid]) return false;
      seen[a.pid] = 1;
      return true;
    });
  }

  /* ---------------- auto-advance ---------------- */
  var graceT = 0;
  function checkAutoAdvance() {
    clearTimeout(graceT);
    var act = active();
    if (G.phase === "answer") {
      if (act.length && act.every(function (p) { return !!G.answers[p.pid]; })) {
        graceT = setTimeout(function () {
          if (G.phase === "answer") endAnswer();
        }, T.grace);
      }
    } else if (G.phase === "vote" && G.spot) {
      var voters = act.filter(function (p) { return p.pid !== G.spot.pid; });
      if (voters.length && voters.every(function (p) { return !!G.spot.votes[p.pid]; })) {
        graceT = setTimeout(function () {
          if (G.phase === "vote") endVote();
        }, T.grace);
      }
    }
  }

  /* ---------------- test bots ---------------- */
  function addBots(n) {
    var names = ["Ana", "Marcus", "Priya", "Jayden", "Sofia", "Kenji", "Imani", "Diego",
      "Leilani", "Omar", "Yuki", "Camila", "Tobi", "Nadia", "Rafa", "Mei",
      "Andres", "Zara", "Kofi", "Lucia", "Sam", "Trini", "Devon", "Rin"];
    for (var i = 0; i < n; i++) {
      var pid = "bot-" + Math.random().toString(36).slice(2, 9);
      var used = {};
      list().forEach(function (p) { used[p.color] = 1; });
      var free = U.COLORS.filter(function (c) { return !used[c]; });
      G.players[pid] = {
        pid: pid,
        name: uniqueName(names[(G.order.length) % names.length], pid),
        org: window.ORGS[(Math.random() * (window.ORGS.length - 1)) | 0],
        color: free.length ? free[0] : U.COLORS[G.order.length % U.COLORS.length],
        score: 0, connected: false, bot: true, joinedAt: now()
      };
      G.order.push(pid);
      stat(pid);
    }
    repaintSoft();
  }

  function scheduleBotAnswers() {
    list().filter(function (p) { return p.bot; }).forEach(function (p) {
      later(function () {
        if (G.phase !== "answer" || G.answers[p.pid]) return;
        var bank = window.BOT_ANSWERS;
        G.answers[p.pid] = bank[(Math.random() * bank.length) | 0];
        stat(p.pid).answered++;
        repaintSoft();
        checkAutoAdvance();
      }, (1200 + Math.random() * Math.min(9000, T.answer * 0.55)) * (FAST ? 0.3 : 1));
    });
  }

  function scheduleBotVotes() {
    var s = G.spot;
    list().filter(function (p) { return p.bot && p.pid !== s.pid; }).forEach(function (p) {
      later(function () {
        if (G.phase !== "vote" || !G.spot || G.spot.votes[p.pid]) return;
        var others = list().filter(function (o) { return o.pid !== p.pid; });
        // 35% of the time the bot actually knows the answer, so scores look real.
        var target = (Math.random() < 0.35 && P(s.pid) && s.pid !== p.pid)
          ? s.pid
          : others[(Math.random() * others.length) | 0].pid;
        G.spot.votes[p.pid] = { target: target, left: Math.max(0, G.deadline - now()) };
        repaintSoft();
        checkAutoAdvance();
      }, (900 + Math.random() * Math.min(7000, T.vote * 0.6)) * (FAST ? 0.3 : 1));
    });
  }

  /* ================================================================
     RENDER
     ================================================================ */
  function joinURL() {
    var base = location.origin + location.pathname.replace(/index\.html?$/i, "");
    return base + "#" + (G.code || "");
  }

  function shell(body, bar) {
    var players = G.order.length;
    return '' +
      '<div class="host">' +
        '<div class="host-top">' +
          '<div class="host-brand">' +
            '<div class="seal"><span>UGC</span></div>' +
            '<div class="name">Spill<em>The Letters</em></div>' +
          '</div>' +
          '<div class="host-meta">' +
            (G.phase !== "lobby" && G.phase !== "final"
              ? '<div class="meta-block"><div class="v">' + G.round + '/' + G.totalRounds + '</div><div class="k">Round</div></div>'
              : '') +
            '<div class="meta-block"><div class="v">' + players + '</div><div class="k">Players</div></div>' +
            (G.phase !== "lobby"
              ? '<div class="meta-block"><div class="v" style="font-size:22px">' + U.esc(G.code || "") + '</div><div class="k">Room</div></div>'
              : '') +
          '</div>' +
        '</div>' +
        '<div class="host-body">' + body + '</div>' +
        '<div class="hostbar">' + (bar || "") + '</div>' +
      '</div>';
  }

  function paint() {
    if (painted === G.phase + ":" + G.seq) return;
    painted = G.phase + ":" + G.seq;
    var fn = ({
      lobby: paintLobby, intro: paintIntro, answer: paintAnswer,
      vote: paintVote, reveal: paintReveal, scores: paintScores, final: paintFinal
    })[G.phase];
    if (fn) fn();
  }

  /* Light refresh that must not restart entrance animations. */
  function repaintSoft() {
    if (G.phase === "lobby") return updateLobby();
    if (G.phase === "answer") return updateAnswer();
    if (G.phase === "vote") return updateVote();
  }

  function pcardHTML(p) {
    return '<div class="pcard' + (p.connected || p.bot ? "" : " off") + '" data-pid="' + U.esc(p.pid) + '">' +
      '<span class="dot" style="background:' + U.esc(p.color) + '"></span>' +
      '<span class="nm">' + U.esc(p.name) + '</span>' +
      (p.org ? '<span class="org">' + U.esc(p.org) + '</span>' : '') +
      '</div>';
  }

  function paintLobby() {
    var packChips = window.PACKS.map(function (k) {
      return '<button class="chip" data-pack="' + k.id + '" aria-pressed="' + (!!G.packs[k.id]) + '">' + U.esc(k.label) + '</button>';
    }).join("");
    var roundChips = [5, 8, 12].map(function (n) {
      return '<button class="chip" data-rounds="' + n + '" aria-pressed="' + (G.totalRounds === n) + '">' + n + ' rounds</button>';
    }).join("");

    U.render(shell(
      '<div class="lobby">' +
        '<div class="lobby-left">' +
          '<div class="wordmark"><div class="l1">Spill</div><div class="l2">The</div><div class="l3">Letters</div>' +
            '<div class="ugc-tag">Unified Greek Council &middot; VCU</div></div>' +
          '<div class="joinbox">' +
            '<div class="qrwrap" id="qr"></div>' +
            '<div class="joininfo">' +
              '<div><div class="lbl">Scan, or go to</div><div class="url">' + U.esc(joinURL().replace(/^https?:\/\//, "")) + '</div></div>' +
              '<div><div class="lbl">Room code</div><div class="codebig" id="codebig">' + U.esc(G.code || "....") + '</div></div>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div class="lobby-right">' +
          '<div class="roster-head"><div class="n"><span id="pcount">' + G.order.length + '</span> in</div>' +
            '<div class="kicker dim">Waiting for the room</div></div>' +
          '<div class="roster" id="roster">' + list().map(pcardHTML).join("") + '</div>' +
          '<div class="setup">' +
            '<div class="setup-row"><span class="lbl">Packs</span>' + packChips + '</div>' +
            '<div class="setup-row"><span class="lbl">Length</span>' + roundChips + '</div>' +
          '</div>' +
        '</div>' +
      '</div>',
      '<button class="btn" id="startBtn"' + (active().length < 2 ? " disabled" : "") + '>Start the game</button>' +
      '<button class="btn ghost" id="muteBtn">' + (U.sfx.isMuted() ? "Sound off" : "Sound on") + '</button>' +
      '<span class="hint">Space to start</span>'
    ));

    drawQR();
    U.on("[data-pack]", "click", function (e) {
      var id = e.currentTarget.getAttribute("data-pack");
      var onCount = window.PACKS.filter(function (k) { return G.packs[k.id]; }).length;
      if (G.packs[id] && onCount <= 1) { U.toast("Keep at least one pack on"); return; }
      G.packs[id] = !G.packs[id];
      e.currentTarget.setAttribute("aria-pressed", String(!!G.packs[id]));
      saveSetup();
    });
    U.on("[data-rounds]", "click", function (e) {
      G.totalRounds = parseInt(e.currentTarget.getAttribute("data-rounds"), 10);
      U.qa("[data-rounds]").forEach(function (n) {
        n.setAttribute("aria-pressed", String(parseInt(n.getAttribute("data-rounds"), 10) === G.totalRounds));
      });
      saveSetup();
    });
    U.on("#startBtn", "click", startGame);
    U.on("#muteBtn", "click", function (e) {
      U.sfx.setMuted(!U.sfx.isMuted());
      e.currentTarget.textContent = U.sfx.isMuted() ? "Sound off" : "Sound on";
    });
  }

  function updateLobby() {
    var roster = U.q("#roster");
    if (!roster) return;
    var have = {};
    U.qa(".pcard", roster).forEach(function (n) { have[n.getAttribute("data-pid")] = n; });
    list().forEach(function (p) {
      if (have[p.pid]) {
        have[p.pid].classList.toggle("off", !(p.connected || p.bot));
        var nm = have[p.pid].querySelector(".nm");
        if (nm && nm.textContent !== p.name) nm.textContent = p.name;
        delete have[p.pid];
      } else {
        roster.insertAdjacentHTML("beforeend", pcardHTML(p));
      }
    });
    Object.keys(have).forEach(function (pid) { have[pid].remove(); });
    var c = U.q("#pcount"); if (c) c.textContent = String(G.order.length);
    var mb = U.qa(".meta-block .v")[0];
    if (mb) mb.textContent = String(G.order.length);
    var sb = U.q("#startBtn"); if (sb) sb.disabled = active().length < 2;
    var cb = U.q("#codebig"); if (cb && G.code) cb.textContent = G.code;
  }

  function paintIntro() {
    U.render(shell(
      '<div class="slam"><div class="r">Round <em>' + G.round + '</em></div>' +
      '<div class="sub">of ' + G.totalRounds + '</div></div>', ""
    ));
  }

  function paintAnswer() {
    U.render(shell(
      '<div class="stage">' +
        '<div class="flyer prompt-card"><div class="tape"></div>' +
          '<div class="pack">Everyone answers &middot; ' + U.esc(packLabel(G.prompt && G.prompt.p)) + '</div>' +
          '<div class="prompt-text">' + U.promptHTML(G.prompt ? G.prompt.t : "") + '</div>' +
        '</div>' +
        '<div style="display:flex;align-items:center;gap:clamp(18px,3vw,44px)">' +
          U.ringHTML("ring") +
          '<div><div class="count-line" id="cline"><b>0</b> of ' + active().length + ' in</div>' +
          '<div class="progress-dots" id="dots">' + dotsHTML() + '</div></div>' +
        '</div>' +
      '</div>',
      '<button class="btn ghost" id="skipBtn">Skip to voting</button><span class="hint">Space to skip</span>'
    ));
    U.on("#skipBtn", "click", endAnswer);
    updateAnswer();
  }

  function dotsHTML() {
    return active().map(function (p) {
      return '<i data-pid="' + U.esc(p.pid) + '"></i>';
    }).join("");
  }

  function packLabel(id) {
    var f = window.PACKS.filter(function (k) { return k.id === id; })[0];
    return f ? f.label : "";
  }

  function updateAnswer() {
    var n = 0, act = active();
    act.forEach(function (p) { if (G.answers[p.pid]) n++; });
    var cl = U.q("#cline");
    if (cl) cl.innerHTML = "<b>" + n + "</b> of " + act.length + " in";
    var dots = U.q("#dots");
    if (dots) {
      var have = {};
      U.qa("i", dots).forEach(function (i) { have[i.getAttribute("data-pid")] = i; });
      act.forEach(function (p) {
        var el = have[p.pid];
        if (!el) {
          dots.insertAdjacentHTML("beforeend", '<i data-pid="' + U.esc(p.pid) + '"></i>');
          el = dots.lastElementChild;
        }
        var got = !!G.answers[p.pid];
        el.classList.toggle("in", got);
        el.style.background = got ? p.color : "";
        delete have[p.pid];
      });
      Object.keys(have).forEach(function (pid) { have[pid].remove(); });
    }
  }

  function paintVote() {
    var s = G.spot;
    var cls = U.fitClass(s.text);
    U.render(shell(
      '<div class="stage">' +
        '<div class="kicker">Who said it?</div>' +
        '<div class="flyer answer-card"><div class="tape"></div>' +
          '<div class="answer-prompt-sm">' + U.esc(String(s.prompt).replace(/_{2,}/g, "…")) + '</div>' +
          '<div class="answer-text ' + cls + '">&ldquo;' + U.esc(s.text) + '&rdquo;</div>' +
        '</div>' +
        '<div style="display:flex;align-items:center;gap:clamp(18px,3vw,44px)">' +
          U.ringHTML("ring") +
          '<div class="count-line" id="vline"><b>0</b> of ' + Math.max(0, active().length - 1) + ' voted</div>' +
        '</div>' +
      '</div>',
      '<button class="btn ghost" id="revealBtn">Reveal now</button>' +
      '<button class="btn ghost" id="skipBtn">Skip this one</button>' +
      '<span class="hint">Space to reveal</span>'
    ));
    U.on("#revealBtn", "click", endVote);
    U.on("#skipBtn", "click", skipSpot);
    updateVote();
  }

  function updateVote() {
    if (!G.spot) return;
    var n = Object.keys(G.spot.votes).length;
    var need = Math.max(0, active().filter(function (p) { return p.pid !== G.spot.pid; }).length);
    var el = U.q("#vline");
    if (el) el.innerHTML = "<b>" + n + "</b> of " + need + " voted";
  }

  function paintReveal() {
    var s = G.spot, a = P(s.pid);
    var right = (s.correct || []).map(function (v) { return P(v); }).filter(Boolean);
    U.render(shell(
      '<div class="stage">' +
        '<div class="kicker">That was</div>' +
        '<div class="reveal-name" style="color:' + U.esc(a ? a.color : "#fff") + '">' + U.esc(a ? a.name : "?") + '</div>' +
        (a && a.org ? '<div class="kicker dim">' + U.esc(a.org) + '</div>' : '') +
        '<div class="flyer" style="padding:18px 30px;max-width:min(1000px,92%)">' +
          '<div class="answer-text ' + U.fitClass(s.text) + '" style="font-size:clamp(20px,2.6vw,42px)">&ldquo;' + U.esc(s.text) + '&rdquo;</div>' +
        '</div>' +
        (right.length
          ? '<div><div class="kicker dim" style="margin-bottom:12px">' + right.length + ' called it</div>' +
            '<div class="reveal-strip">' + right.map(function (p, i) {
              return '<span class="guesser" style="animation-delay:' + (i * 0.06) + 's">' +
                '<i class="dot" style="background:' + U.esc(p.color) + '"></i>' + U.esc(p.name) + '</span>';
            }).join("") + '</div></div>'
          : '<div class="nobody">Nobody guessed it &middot; +' + PTS.enigma + '</div>') +
      '</div>',
      '<button class="btn ghost" id="nextBtn">Next</button><span class="hint">Space to continue</span>'
    ));
    U.on("#nextBtn", "click", function () { clearTimeout(phaseT); nextSpot(); });
    if (right.length) U.sfx.right(); else U.sfx.wrong();
  }

  function paintScores() {
    var r = ranked();
    var cols = r.length > 24 ? 3 : r.length > 10 ? 2 : 1;
    var rows = Math.ceil(r.length / cols);
    U.render(shell(
      '<div class="board">' +
        '<div class="kicker" style="text-align:center">Standings after round ' + G.round + '</div>' +
        '<div class="board-grid ' + (cols === 3 ? "three" : cols === 2 ? "two" : "") +
          '" style="--rows:' + rows + '">' +
          r.map(function (p, i) {
            var g = G.gains[p.pid] || 0;
            return '<div class="row ' + (i === 0 ? "top1 " : i === 1 ? "top2 " : i === 2 ? "top3 " : "") +
              (g > 0 ? "rise" : "") + '" style="animation-delay:' + Math.min(i * 0.035, 1) + 's">' +
              '<span class="rk">' + (i + 1) + '</span>' +
              '<span class="dot" style="background:' + U.esc(p.color) + '"></span>' +
              '<span class="nm">' + U.esc(p.name) + '</span>' +
              (g > 0 ? '<span class="gain">+' + g + '</span>' : '') +
              '<span class="sc">' + p.score.toLocaleString() + '</span>' +
              '</div>';
          }).join("") +
        '</div>' +
      '</div>',
      '<button class="btn ghost" id="nextBtn">' + (G.round >= G.totalRounds ? "Final results" : "Next round") + '</button>' +
      '<span class="hint">Space to continue</span>'
    ));
    U.on("#nextBtn", "click", function () { clearTimeout(phaseT); nextRound(); });
  }

  function paintFinal() {
    var r = ranked();
    var order = [r[1], r[0], r[2]];
    var cls = ["p2", "p1", "p3"], marks = ["2", "1", "3"], crowns = ["", "👑", ""];
    U.render(shell(
      '<div class="stage" style="gap:clamp(12px,2vh,26px)">' +
        '<div class="kicker">Final</div>' +
        '<div class="podium">' +
          order.map(function (p, i) {
            if (!p) return "";
            return '<div class="plinth ' + cls[i] + '">' +
              (crowns[i] ? '<div class="crown">' + crowns[i] + '</div>' : '') +
              '<div class="who" style="color:' + U.esc(p.color) + '">' + U.esc(p.name) + '</div>' +
              '<div class="sc">' + p.score.toLocaleString() + '</div>' +
              '<div class="base">' + marks[i] + '</div></div>';
          }).join("") +
        '</div>' +
        (G.awards && G.awards.length
          ? '<div class="awards">' + G.awards.map(function (a, i) {
              return '<div class="award" style="animation-delay:' + (0.7 + i * 0.12) + 's">' +
                '<div class="t">' + U.esc(a.title) + '</div>' +
                '<div class="w">' + U.esc(a.name) + '</div>' +
                '<div class="d">' + U.esc(a.desc) + '</div></div>';
            }).join("") + '</div>'
          : '') +
      '</div>',
      '<button class="btn" id="againBtn">Play again</button>' +
      '<button class="btn ghost" id="rosterBtn">Back to lobby</button>'
    ));
    U.on("#againBtn", "click", function () {
      list().forEach(function (p) { p.score = 0; });
      G.stats = {}; list().forEach(function (p) { stat(p.pid); });
      startGame();
    });
    U.on("#rosterBtn", "click", function () {
      list().forEach(function (p) { p.score = 0; });
      G.stats = {}; G.round = 0; G.gains = {};
      list().forEach(function (p) { stat(p.pid); });
      setPhase("lobby", 0);
    });
  }

  function drawQR() {
    var el = U.q("#qr");
    if (!el || !window.QRCode || !G.code) return;
    el.innerHTML = "";
    try {
      new window.QRCode(el, {
        text: joinURL(),
        width: 320, height: 320,
        colorDark: "#08070B", colorLight: "#F6F0E2",
        correctLevel: window.QRCode.CorrectLevel.M
      });
    } catch (e) {}
  }

  /* ---------------- ticker ---------------- */
  function tick() {
    if (!G) return;
    if (G.duration) {
      var el = U.q("#ring");
      if (el) U.setRing(el, msLeft(), G.duration);
    }
    var m = msLeft();
    if (G.duration && (G.phase === "answer" || G.phase === "vote")) {
      var s = Math.ceil(m / 1000);
      if (s <= 5 && s > 0 && s !== tick._last) { tick._last = s; U.sfx.tick(); }
    }
  }

  /* ---------------- keyboard ---------------- */
  function onKey(e) {
    if (e.target && /input|textarea/i.test(e.target.tagName)) return;
    if (e.code === "Space" || e.code === "Enter") {
      e.preventDefault();
      if (G.phase === "lobby") startGame();
      else if (G.phase === "answer") endAnswer();
      else if (G.phase === "vote") endVote();
      else if (G.phase === "reveal") { clearTimeout(phaseT); nextSpot(); }
      else if (G.phase === "scores") { clearTimeout(phaseT); nextRound(); }
    } else if (e.key === "m" || e.key === "M") {
      U.sfx.setMuted(!U.sfx.isMuted());
      U.toast(U.sfx.isMuted() ? "Sound off" : "Sound on");
      var b = U.q("#muteBtn"); if (b) b.textContent = U.sfx.isMuted() ? "Sound off" : "Sound on";
    }
  }

  /* ---------------- boot ---------------- */
  function start() {
    newGame();
    U.keepAwake();
    paint();

    net = NET.host({
      onReady: function (code) {
        G.code = code;
        painted = "";
        paint();
        U.toast("Room " + code + " is live");
      },
      onJoin: onJoin,
      onLeave: onLeave,
      onMsg: onMsg,
      onError: function (err) {
        U.toast("Connection problem: " + (err && err.type ? err.type : "unknown") + ". Reload the page.", true);
      }
    });

    clearInterval(tickT);
    tickT = setInterval(tick, 120);
    document.addEventListener("keydown", onKey);

    var bots = parseInt(params.get("bots") || "0", 10);
    if (bots > 0) {
      setTimeout(function () {
        addBots(Math.min(bots, 30));
        if (params.has("auto")) setTimeout(startGame, 600);
      }, 400);
    }

    window.SPILL = {
      get game() { return G; },
      addBots: addBots,
      start: startGame,
      skip: function () {
        if (G.phase === "answer") endAnswer();
        else if (G.phase === "vote") endVote();
        else if (G.phase === "reveal") { clearTimeout(phaseT); nextSpot(); }
        else if (G.phase === "scores") { clearTimeout(phaseT); nextRound(); }
        else if (G.phase === "intro") { clearTimeout(phaseT); beginAnswer(); }
      },
      jumpToEnd: function () { G.round = G.totalRounds; clearTimeout(phaseT); finish(); },
      state: function () {
        return {
          phase: G.phase, round: G.round + "/" + G.totalRounds,
          players: G.order.length, code: G.code,
          answers: Object.keys(G.answers).length,
          votes: G.spot ? Object.keys(G.spot.votes).length : 0,
          scores: ranked().map(function (p) { return p.name + ":" + p.score; })
        };
      }
    };
  }

  window.HOST = { start: start };
})();
