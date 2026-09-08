/* SPILL THE LETTERS - shared UI helpers */
(function () {
  "use strict";

  var app = null;
  function root() { return app || (app = document.getElementById("app")); }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function render(html) { root().innerHTML = html; return root(); }
  function q(sel, scope) { return (scope || document).querySelector(sel); }
  function qa(sel, scope) { return Array.prototype.slice.call((scope || document).querySelectorAll(sel)); }

  function on(sel, ev, fn, scope) {
    qa(sel, scope).forEach(function (n) { n.addEventListener(ev, fn); });
  }

  /* Player colours - readable on black and distinct from each other.
     24 of them so a 20-person room never has two people sharing one. */
  var COLORS = [
    "#FFC53D", "#E8384F", "#4CD98A", "#4CC9F0", "#B57BFF", "#FF8A3D",
    "#FF6FB5", "#6EE7C8", "#F2E14C", "#7C9CFF", "#FF5C5C", "#9BE15D",
    "#00D3C7", "#D66BFF", "#FFA8A8", "#5CE1E6", "#C6F04E", "#3FBF5F",
    "#2E8BFF", "#8A6BFF", "#FF4FD8", "#A0E9FF", "#D9D2C5", "#E0A85C"
  ];

  /* Turn "My toxic trait is ___" into markup with a gold blank. */
  function promptHTML(text) {
    return esc(text).replace(/_{2,}/g, '<span class="blank">______</span>');
  }

  /* Pick a size class so long answers still fit the screen. */
  function fitClass(text) {
    var n = (text || "").length;
    if (n > 64) return "xlong";
    if (n > 26) return "long";
    return "";
  }

  function ringHTML(id) {
    return '<div class="ring" id="' + id + '">' +
      '<svg viewBox="0 0 100 100"><circle class="trk" cx="50" cy="50" r="44" fill="none" stroke-width="8"/>' +
      '<circle class="bar" cx="50" cy="50" r="44" fill="none" stroke-width="8" stroke-linecap="round" ' +
      'stroke-dasharray="276.5" stroke-dashoffset="0"/></svg>' +
      '<div class="num">0</div></div>';
  }

  function setRing(el, msLeft, msTotal) {
    if (!el) return;
    var f = msTotal > 0 ? Math.max(0, Math.min(1, msLeft / msTotal)) : 0;
    var bar = el.querySelector(".bar");
    var num = el.querySelector(".num");
    if (bar) bar.style.strokeDashoffset = String(276.5 * (1 - f));
    var secs = Math.max(0, Math.ceil(msLeft / 1000));
    if (num && num.textContent !== String(secs)) num.textContent = String(secs);
    el.classList.toggle("low", secs <= 10);
  }

  /* ---------------- sound (host screen only) ---------------- */
  var actx = null, muted = false;
  function ctx() {
    if (!actx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (AC) actx = new AC();
    }
    if (actx && actx.state === "suspended") actx.resume();
    return actx;
  }
  function tone(freq, dur, type, vol, delay) {
    var c = ctx(); if (!c || muted) return;
    var t0 = c.currentTime + (delay || 0);
    var o = c.createOscillator(), g = c.createGain();
    o.type = type || "sine"; o.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(vol == null ? 0.16 : vol, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(c.destination);
    o.start(t0); o.stop(t0 + dur + 0.03);
  }
  var sfx = {
    setMuted: function (m) { muted = !!m; },
    isMuted: function () { return muted; },
    join:    function () { tone(660, 0.10, "triangle", 0.10); tone(990, 0.12, "triangle", 0.08, 0.07); },
    submit:  function () { tone(520, 0.08, "square", 0.07); },
    start:   function () { [392, 523, 659, 784].forEach(function (f, i) { tone(f, 0.22, "triangle", 0.12, i * 0.09); }); },
    tick:    function () { tone(1200, 0.04, "square", 0.05); },
    reveal:  function () { [220, 330, 440].forEach(function (f, i) { tone(f, 0.5, "sawtooth", 0.07, i * 0.05); }); },
    right:   function () { [659, 880].forEach(function (f, i) { tone(f, 0.18, "triangle", 0.12, i * 0.08); }); },
    wrong:   function () { tone(180, 0.28, "sawtooth", 0.09); },
    win:     function () { [523, 659, 784, 1047].forEach(function (f, i) { tone(f, 0.45, "triangle", 0.13, i * 0.13); }); },
    round:   function () { tone(330, 0.16, "square", 0.10); tone(494, 0.22, "square", 0.10, 0.11); }
  };

  function buzz(ms) { if (navigator.vibrate) { try { navigator.vibrate(ms || 20); } catch (e) {} } }

  /* ---------------- toast ---------------- */
  var toastEl = null, toastT = 0;
  function toast(msg, bad) {
    if (toastEl) toastEl.remove();
    toastEl = document.createElement("div");
    toastEl.className = "toast" + (bad ? " bad" : "");
    toastEl.textContent = msg;
    document.body.appendChild(toastEl);
    clearTimeout(toastT);
    toastT = setTimeout(function () {
      if (toastEl) { toastEl.remove(); toastEl = null; }
    }, bad ? 5000 : 2600);
  }

  /* ---------------- confetti ---------------- */
  function confetti(ms) {
    var cv = document.createElement("canvas");
    cv.className = "confetti";
    document.body.appendChild(cv);
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    function size() { cv.width = innerWidth * dpr; cv.height = innerHeight * dpr; }
    size();
    var g = cv.getContext("2d");
    var cols = ["#FFC53D", "#E8384F", "#F6F0E2", "#4CD98A", "#B57BFF"];
    var bits = [];
    for (var i = 0; i < 220; i++) {
      bits.push({
        x: Math.random() * cv.width, y: -Math.random() * cv.height * 0.6,
        w: (6 + Math.random() * 9) * dpr, h: (9 + Math.random() * 14) * dpr,
        vy: (2.2 + Math.random() * 4) * dpr, vx: (Math.random() - 0.5) * 2.6 * dpr,
        rot: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.24,
        c: cols[(Math.random() * cols.length) | 0]
      });
    }
    var end = performance.now() + (ms || 5200);
    (function loop(t) {
      g.clearRect(0, 0, cv.width, cv.height);
      bits.forEach(function (b) {
        b.x += b.vx; b.y += b.vy; b.rot += b.vr;
        if (b.y > cv.height + 40) { b.y = -30; b.x = Math.random() * cv.width; }
        g.save(); g.translate(b.x, b.y); g.rotate(b.rot);
        g.fillStyle = b.c; g.fillRect(-b.w / 2, -b.h / 2, b.w, b.h); g.restore();
      });
      if (t < end) requestAnimationFrame(loop);
      else cv.remove();
    })(performance.now());
  }

  /* ---------------- misc ---------------- */
  function shuffle(a) {
    for (var i = a.length - 1; i > 0; i--) {
      var j = (Math.random() * (i + 1)) | 0, t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function keepAwake() {
    if (!("wakeLock" in navigator)) return;
    var lock = null;
    function get() {
      navigator.wakeLock.request("screen").then(function (l) {
        lock = l;
        l.addEventListener("release", function () { lock = null; });
      }).catch(function () {});
    }
    get();
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "visible" && !lock) get();
    });
  }

  function initials(name) {
    var parts = String(name || "").trim().split(/\s+/);
    return ((parts[0] || "?")[0] + (parts[1] ? parts[1][0] : "")).toUpperCase();
  }

  function clean(s, max) {
    return String(s == null ? "" : s).replace(/\s+/g, " ").trim().slice(0, max || 40);
  }

  window.UI = {
    esc: esc, render: render, q: q, qa: qa, on: on, root: root,
    COLORS: COLORS, promptHTML: promptHTML, fitClass: fitClass,
    ringHTML: ringHTML, setRing: setRing,
    sfx: sfx, buzz: buzz, toast: toast, confetti: confetti,
    shuffle: shuffle, keepAwake: keepAwake, initials: initials, clean: clean
  };
})();
