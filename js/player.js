/* SPILL THE LETTERS - player (phone)
   Dumb client: sends "answer" / "vote", renders whatever view the host pushes. */
(function () {
  "use strict";

  var U = window.UI;

  var me = { pid: null, name: "", color: "", org: "" };
  var code = "";
  var link = null;
  var view = null;
  var key = "";
  var draft = "";
  var localDeadline = 0, localTotal = 0;
  var barT = 0;
  var online = false;

  function pid() {
    var v = null;
    try { v = localStorage.getItem("spill.pid"); } catch (e) {}
    if (!v) {
      v = "p-" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
      try { localStorage.setItem("spill.pid", v); } catch (e) {}
    }
    return v;
  }

  function loadProfile() {
    try {
      var raw = JSON.parse(localStorage.getItem("spill.profile") || "{}");
      me.name = raw.name || "";
      me.color = raw.color || "";
      me.org = raw.org || "";
    } catch (e) {}
    me.pid = pid();
  }
  function saveProfile() {
    try {
      localStorage.setItem("spill.profile", JSON.stringify({ name: me.name, color: me.color, org: me.org }));
    } catch (e) {}
  }

  /* ---------------- join screen ---------------- */
  function paintJoin(err) {
    if (!me.color) me.color = U.COLORS[(Math.random() * U.COLORS.length) | 0];
    U.render(
      '<div class="phone">' +
        '<div class="phone-top">' +
          '<div class="host-brand"><div class="seal" style="width:44px;height:44px"><span style="font-size:15px">UGC</span></div>' +
          '<div class="name" style="font-size:17px">Spill<em>The Letters</em></div></div>' +
          '<div class="phone-score">' + U.esc(code) + '</div>' +
        '</div>' +
        '<div class="phone-body">' +
          (err ? '<div class="toast bad" style="position:static;transform:none;max-width:none">' + U.esc(err) + '</div>' : '') +
          '<div><label class="field-lbl" for="nm">Your name</label>' +
          '<input class="field" id="nm" maxlength="18" autocomplete="off" autocapitalize="words" ' +
          'placeholder="What everyone calls you" value="' + U.esc(me.name) + '"></div>' +
          '<div><span class="field-lbl">Your chapter (optional)</span>' +
          '<div class="orgpick-crests" id="orgs">' +
            window.ORGS.map(function (o) {
              return '<button data-org="' + U.esc(o.id) + '" aria-pressed="' + (me.org === o.id) + '" ' +
                'title="' + U.esc(o.name) + '">' +
                '<span class="crest" style="--cc:' + o.color + '">' +
                  '<span class="lt">' + o.letters + '</span>' +
                  '<span class="ab">' + U.esc(o.id) + '</span>' +
                '</span></button>';
            }).join("") +
          '</div></div>' +
          '<div><span class="field-lbl">Your colour</span>' +
          '<div class="swatches" id="sw">' +
            U.COLORS.map(function (c) {
              return '<button class="sw" data-c="' + c + '" style="background:' + c + '" aria-pressed="' + (me.color === c) + '"></button>';
            }).join("") +
          '</div></div>' +
        '</div>' +
        '<div class="phone-foot"><button class="btn block" id="go">Join the game</button></div>' +
      '</div>'
    );

    U.on("[data-org]", "click", function (e) {
      var o = e.currentTarget.getAttribute("data-org");
      me.org = me.org === o ? "" : o;
      U.qa("[data-org]").forEach(function (n) {
        n.setAttribute("aria-pressed", String(n.getAttribute("data-org") === me.org));
      });
      U.buzz(10);
    });
    U.on("[data-c]", "click", function (e) {
      me.color = e.currentTarget.getAttribute("data-c");
      U.qa("[data-c]").forEach(function (n) {
        n.setAttribute("aria-pressed", String(n.getAttribute("data-c") === me.color));
      });
      U.buzz(10);
    });
    U.on("#go", "click", submitJoin);
    U.on("#nm", "keydown", function (e) { if (e.key === "Enter") submitJoin(); });
    setTimeout(function () { var n = U.q("#nm"); if (n && !me.name) n.focus(); }, 250);
  }

  function submitJoin() {
    var n = U.q("#nm");
    var name = U.clean(n ? n.value : "", 18);
    if (!name) { U.toast("Put a name in first", true); if (n) n.focus(); return; }
    me.name = name;
    saveProfile();
    U.buzz(20);
    connect();
  }

  /* ---------------- networking ---------------- */
  function connect() {
    paintStatus("Connecting", "Hooking up to the room", true);
    if (link) link.destroy();
    link = NET.join(code, {
      onOpen: function () {
        online = true;
        link.send({ t: "join", pid: me.pid, name: me.name, color: me.color, org: me.org });
      },
      onMsg: function (msg) {
        if (!msg || msg.t !== "view") return;
        apply(msg);
      },
      onDrop: function () {
        online = false;
        var b = U.q("#offline");
        if (b) b.classList.remove("hidden");
      },
      onNoRoom: function () {
        if (!view) paintStatus("Room not found", "Check the code on the big screen, or scan the QR again. Still trying…", true);
      },
      onGiveUp: function () {
        paintStatus("Lost the room", "Reload this page to try again.", false);
      }
    });
  }

  /* ---------------- render ---------------- */
  function apply(v) {
    var prev = view;
    view = v;

    if (v.phase === "gone") {
      paintStatus("Removed", "The host restarted the game. Reload to rejoin.", false);
      return;
    }

    var k = [v.phase, v.seq, v.submitted ? 1 : 0, v.voted || "", v.isAuthor ? 1 : 0].join("|");
    if (k !== key) {
      key = k;
      if (typeof v.ms === "number") {
        localDeadline = Date.now() + v.ms;
        localTotal = v.total || v.ms;
      } else {
        localDeadline = 0;
      }
      paintPhase(v, prev);
    } else {
      patchHeader(v);
    }
  }

  function header(v) {
    return '<div class="phone-top">' +
      '<div class="phone-me"><span class="dot" style="background:' + U.esc(v.you.color) + '"></span>' +
      '<span class="nm">' + U.esc(v.you.name) + '</span></div>' +
      '<div class="phone-score" id="scoreN">' + (v.you.score || 0).toLocaleString() + '</div>' +
      '</div>' +
      '<div class="toast bad hidden" id="offline" style="position:static;transform:none;max-width:none;margin:0">' +
      'Reconnecting…</div>';
  }

  function patchHeader(v) {
    var s = U.q("#scoreN");
    if (s) s.textContent = (v.you.score || 0).toLocaleString();
    var nm = U.q(".phone-me .nm");
    if (nm) nm.textContent = v.you.name;
    var off = U.q("#offline");
    if (off) off.classList.toggle("hidden", online);
  }

  function timerBar() {
    return '<div class="bar" id="tbar"><i style="width:100%"></i></div>';
  }

  function paintStatus(big, sub, spin, cls) {
    U.render(
      '<div class="phone">' +
        (view ? header(view) : '<div class="phone-top"><div class="phone-me"><span class="nm">Spill the Letters</span></div>' +
          '<div class="phone-score">' + U.esc(code) + '</div></div>') +
        '<div class="phone-body"><div class="status">' +
          (spin ? '<div class="spinner"></div>' : '') +
          '<div class="big ' + (cls || "") + '">' + U.esc(big) + '</div>' +
          (sub ? '<div class="sub">' + U.esc(sub) + '</div>' : '') +
        '</div></div>' +
        '<div class="phone-foot"></div>' +
      '</div>'
    );
  }

  function paintPhase(v) {
    if (v.phase === "lobby") {
      U.render(
        '<div class="phone">' + header(v) +
          '<div class="phone-body"><div class="status">' +
            '<div class="big gold">You are in</div>' +
            '<div class="sub">' + v.count + ' player' + (v.count === 1 ? "" : "s") +
            ' so far. Keep an eye on the big screen.</div>' +
            '<div class="spinner"></div>' +
          '</div></div>' +
          '<div class="phone-foot"><button class="btn ghost block" id="edit">Change name or colour</button></div>' +
        '</div>'
      );
      U.on("#edit", "click", function () {
        key = "";
        paintJoinEdit();
      });
      return;
    }

    if (v.phase === "intro") {
      paintStatus("Round " + v.round, "of " + v.totalRounds + " — get ready", false, "gold");
      return;
    }

    if (v.phase === "answer") {
      if (v.submitted) {
        U.render(
          '<div class="phone">' + header(v) +
            '<div class="phone-body"><div class="status">' +
              '<div class="big ok">Locked in</div>' +
              '<div class="phone-answer ' + (v.text.length > 40 ? "xlong" : "") + '">&ldquo;' + U.esc(v.text) + '&rdquo;</div>' +
              '<div class="sub">Waiting on everyone else.</div>' +
            '</div></div>' +
            '<div class="phone-foot">' + timerBar() + '</div>' +
          '</div>'
        );
        return;
      }
      U.render(
        '<div class="phone">' + header(v) +
          '<div class="phone-body">' +
            '<div class="phone-prompt">' + U.promptHTML(v.prompt) + '</div>' +
            '<div><textarea class="field" id="ans" rows="3" maxlength="' + (v.maxLen || 90) + '" ' +
            'autocomplete="off" autocapitalize="sentences" placeholder="Answer honestly. Short is funnier."></textarea>' +
            '<div class="charcount" id="cc">0 / ' + (v.maxLen || 90) + '</div></div>' +
          '</div>' +
          '<div class="phone-foot">' + timerBar() +
            '<button class="btn block" id="send" style="margin-top:12px" disabled>Send it</button></div>' +
        '</div>'
      );
      var ta = U.q("#ans"), cc = U.q("#cc"), btn = U.q("#send");
      if (draft) ta.value = draft;
      function upd() {
        draft = ta.value;
        var n = ta.value.length, max = v.maxLen || 90;
        cc.textContent = n + " / " + max;
        cc.classList.toggle("warn", n > max - 12);
        btn.disabled = !U.clean(ta.value, max);
      }
      ta.addEventListener("input", upd);
      ta.addEventListener("keydown", function (e) {
        if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); doSend(); }
      });
      btn.addEventListener("click", doSend);
      upd();
      setTimeout(function () { ta.focus(); }, 200);
      function doSend() {
        var txt = U.clean(ta.value, v.maxLen || 90);
        if (!txt) return;
        draft = "";
        U.buzz(25);
        link.send({ t: "answer", text: txt });
        btn.disabled = true;
        btn.textContent = "Sent";
      }
      return;
    }

    if (v.phase === "vote") {
      if (v.isAuthor) {
        U.render(
          '<div class="phone">' + header(v) +
            '<div class="phone-body"><div class="status">' +
              '<div class="shh">🤫</div>' +
              '<div class="big gold">This one is yours</div>' +
              '<div class="phone-answer ' + (v.text.length > 40 ? "xlong" : "") + '">&ldquo;' + U.esc(v.text) + '&rdquo;</div>' +
              '<div class="sub">Poker face. Everyone else is guessing right now.</div>' +
            '</div></div>' +
            '<div class="phone-foot">' + timerBar() + '</div>' +
          '</div>'
        );
        U.buzz([15, 60, 15]);
        return;
      }
      if (v.voted) {
        var pick = (v.options || []).filter(function (o) { return o.id === v.voted; })[0];
        U.render(
          '<div class="phone">' + header(v) +
            '<div class="phone-body"><div class="status">' +
              '<div class="big">You said</div>' +
              '<div class="big gold">' + U.esc(pick ? pick.name : "?") + '</div>' +
              '<div class="sub">Locked in. Watch the screen.</div>' +
            '</div></div>' +
            '<div class="phone-foot">' + timerBar() + '</div>' +
          '</div>'
        );
        return;
      }
      U.render(
        '<div class="phone">' + header(v) +
          '<div class="phone-body" style="justify-content:flex-start;gap:12px">' +
            '<div class="kicker">Who said it?</div>' +
            '<div class="phone-answer ' + (v.text.length > 40 ? "xlong" : "") + '">&ldquo;' + U.esc(v.text) + '&rdquo;</div>' +
            '<div class="vote-grid" id="grid">' +
              (v.options || []).map(function (o) {
                return '<button class="vbtn" data-id="' + U.esc(o.id) + '">' +
                  '<span class="dot" style="background:' + U.esc(o.color) + '"></span>' +
                  '<span class="nm">' + U.esc(o.name) + '</span></button>';
              }).join("") +
            '</div>' +
          '</div>' +
          '<div class="phone-foot">' + timerBar() + '</div>' +
        '</div>'
      );
      U.on("[data-id]", "click", function (e) {
        var id = e.currentTarget.getAttribute("data-id");
        U.qa("[data-id]").forEach(function (n) { n.setAttribute("aria-pressed", String(n === e.currentTarget)); });
        U.buzz(25);
        link.send({ t: "vote", target: id });
      });
      return;
    }

    if (v.phase === "reveal") {
      var big, sub, cls;
      if (v.isAuthor) {
        big = v.correctCount ? v.correctCount + " called it" : "Nobody got you";
        sub = v.correctCount
          ? "Out of " + v.voterCount + " guesses. You are more readable than you think."
          : "Certified enigma.";
        cls = v.correctCount ? "gold" : "ok";
      } else if (v.right === true) {
        big = "Nailed it"; sub = "That was " + v.authorName + "."; cls = "ok";
      } else if (v.right === false) {
        big = "Not quite"; sub = "That was " + v.authorName + "."; cls = "bad";
      } else {
        big = v.authorName; sub = "You did not vote on this one."; cls = "";
      }
      U.render(
        '<div class="phone">' + header(v) +
          '<div class="phone-body"><div class="status">' +
            '<div class="big ' + cls + '">' + U.esc(big) + '</div>' +
            (v.gained ? '<div class="pts">+' + v.gained + '</div>' : '') +
            '<div class="sub">' + U.esc(sub) + '</div>' +
          '</div></div>' +
          '<div class="phone-foot"></div>' +
        '</div>'
      );
      U.buzz(v.right === true || (v.isAuthor && v.gained) ? [20, 50, 30] : 15);
      return;
    }

    if (v.phase === "scores") {
      U.render(
        '<div class="phone">' + header(v) +
          '<div class="phone-body"><div class="status">' +
            '<div class="big gold">#' + v.you.rank + '</div>' +
            '<div class="sub">of ' + v.of + ' after round ' + v.round + '</div>' +
            (v.gained ? '<div class="pts">+' + v.gained + ' this round</div>' : '<div class="sub">No points that round. Next one.</div>') +
          '</div></div>' +
          '<div class="phone-foot"></div>' +
        '</div>'
      );
      return;
    }

    if (v.phase === "final") {
      var first = v.you.rank === 1;
      U.render(
        '<div class="phone">' + header(v) +
          '<div class="phone-body"><div class="status">' +
            (first ? '<div class="shh">👑</div>' : '') +
            '<div class="big gold">#' + v.you.rank + ' of ' + v.of + '</div>' +
            '<div class="pts">' + (v.you.score || 0).toLocaleString() + '</div>' +
            (v.award ? '<div class="big ok" style="font-size:clamp(22px,7vw,34px)">' + U.esc(v.award) + '</div>' : '') +
            '<div class="sub">' + (first ? "You know these people." : "Winner: " + U.esc(v.winner || "—")) + '</div>' +
          '</div></div>' +
          '<div class="phone-foot"></div>' +
        '</div>'
      );
      if (first) U.confetti(4500);
      U.buzz([25, 60, 25, 60, 40]);
      return;
    }

    paintStatus("Hold tight", "Waiting for the big screen.", true);
  }

  function paintJoinEdit() {
    paintJoin();
    var go = U.q("#go");
    if (go) {
      go.textContent = "Save";
      go.addEventListener("click", function () {
        var n = U.q("#nm");
        var name = U.clean(n ? n.value : "", 18);
        if (!name) return;
        me.name = name;
        saveProfile();
        link.send({ t: "rename", name: me.name, color: me.color, org: me.org });
        key = "";
      }, true);
    }
  }

  /* ---------------- local countdown ---------------- */
  function tick() {
    var bar = U.q("#tbar");
    if (!bar) return;
    if (!localDeadline || !localTotal) { bar.style.opacity = "0"; return; }
    bar.style.opacity = "1";
    var left = Math.max(0, localDeadline - Date.now());
    var f = Math.max(0, Math.min(1, left / localTotal));
    var i = bar.firstElementChild;
    if (i) i.style.width = (f * 100).toFixed(1) + "%";
    bar.classList.toggle("low", left < 10000);
  }

  function start(roomCode) {
    code = String(roomCode || "").toUpperCase();
    loadProfile();
    clearInterval(barT);
    barT = setInterval(tick, 200);
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "visible" && link && !link.isOpen()) {
        var b = U.q("#offline"); if (b) b.classList.remove("hidden");
      }
    });
    if (me.name) connect(); else paintJoin();

    window.SPILL_PLAYER = {
      get view() { return view; },
      answer: function (t) { link.send({ t: "answer", text: t }); },
      vote: function (id) { link.send({ t: "vote", target: id }); }
    };
  }

  window.PLAYER = { start: start };
})();
