/* SPILL THE LETTERS - background music (host screen only)

   Synthesised live in Web Audio rather than played from a file, so there is
   nothing to license, nothing to download at the venue, and the bed can follow
   the game: mellow in the lobby, driving while people answer, tense while the
   room votes, ducked under the reveal.

   A dembow-ish groove in A minor over Am - F - C - G, 100 BPM, four-bar loop.
   To use a real track instead, see FILE_OVERRIDE at the bottom. */
(function () {
  "use strict";

  var BPM = 100;
  var SIXTEENTH = (60 / BPM) / 4;   // 0.15s
  var STEPS = 64;                   // four bars of sixteenths
  var LOOKAHEAD = 0.14;             // schedule this far ahead, in seconds
  var TICK = 25;                    // ms between scheduler wake-ups

  /* Semitone offsets from A2 (110 Hz). */
  var PROG = [
    { root:  0, triad: [ 0,  3,  7] },   // Am
    { root: -4, triad: [-4,  0,  3] },   // F
    { root:  3, triad: [ 3,  7, 10] },   // C
    { root: -2, triad: [-2,  2,  5] }    // G
  ];
  var PENT = [0, 3, 5, 7, 10, 12, 15];   // A minor pentatonic for the top line

  /* Per-phase mix. hat 1 = eighths, 2 = sixteenths. cut = master lowpass. */
  var PHASE = {
    lobby:  { vol: 0.85, kick: 1, bass: 1, pad: 1, rim: 1, hat: 1, arp: 0, cut: 1500 },
    intro:  { vol: 1.00, kick: 1, bass: 1, pad: 1, rim: 1, hat: 2, arp: 1, cut: 3200 },
    answer: { vol: 0.80, kick: 1, bass: 1, pad: 1, rim: 1, hat: 2, arp: 0, cut: 2200 },
    vote:   { vol: 0.95, kick: 1, bass: 1, pad: 1, rim: 1, hat: 2, arp: 1, cut: 3200 },
    reveal: { vol: 0.40, kick: 0, bass: 1, pad: 1, rim: 0, hat: 0, arp: 0, cut: 800 },
    scores: { vol: 0.75, kick: 1, bass: 1, pad: 1, rim: 1, hat: 1, arp: 0, cut: 1900 },
    final:  { vol: 1.00, kick: 1, bass: 1, pad: 1, rim: 1, hat: 2, arp: 1, cut: 4200 }
  };

  var BASE_GAIN = 0.17;             // sits under the sound effects

  var ctx = null, master = null, filter = null, noise = null;
  var running = false, enabled = true, muted = false;
  var step = 0, nextTime = 0, timer = 0;
  var mix = PHASE.lobby;
  var fileEl = null;

  function freq(semi) { return 110 * Math.pow(2, semi / 12); }

  function noiseBuffer() {
    if (noise) return noise;
    var n = Math.floor(ctx.sampleRate * 2);
    noise = ctx.createBuffer(1, n, ctx.sampleRate);
    var d = noise.getChannelData(0);
    for (var i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    return noise;
  }

  /* ---------------- voices ---------------- */
  function kick(t, vel) {
    var o = ctx.createOscillator(), g = ctx.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(155, t);
    o.frequency.exponentialRampToValueAtTime(44, t + 0.11);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.9 * vel, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.26);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + 0.3);
  }

  function bass(t, semi, dur) {
    var o = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter();
    o.type = "sawtooth";
    o.frequency.setValueAtTime(freq(semi), t);
    f.type = "lowpass";
    f.frequency.setValueAtTime(260, t);
    f.frequency.exponentialRampToValueAtTime(120, t + dur);
    f.Q.value = 6;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.30, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(f); f.connect(g); g.connect(master);
    o.start(t); o.stop(t + dur + 0.05);
  }

  function pad(t, triad, dur) {
    triad.forEach(function (semi, i) {
      var o = ctx.createOscillator(), g = ctx.createGain();
      o.type = i === 0 ? "triangle" : "sine";
      o.frequency.setValueAtTime(freq(semi + 24), t);
      o.detune.setValueAtTime((i - 1) * 5, t);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.045, t + 0.18);
      g.gain.linearRampToValueAtTime(0.030, t + dur * 0.6);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(master);
      o.start(t); o.stop(t + dur + 0.05);
    });
  }

  function rim(t) {
    var s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = noiseBuffer();
    s.playbackRate.value = 1.4;
    f.type = "bandpass"; f.frequency.value = 1900; f.Q.value = 7;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.16, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
    s.connect(f); f.connect(g); g.connect(master);
    s.start(t, Math.random()); s.stop(t + 0.1);
  }

  function hat(t, open) {
    var s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = noiseBuffer();
    f.type = "highpass"; f.frequency.value = 7600;
    var d = open ? 0.13 : 0.035;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(open ? 0.07 : 0.055, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    s.connect(f); f.connect(g); g.connect(master);
    s.start(t, Math.random()); s.stop(t + d + 0.03);
  }

  function pluck(t, semi) {
    var o = ctx.createOscillator(), g = ctx.createGain();
    o.type = "triangle";
    o.frequency.setValueAtTime(freq(semi + 24), t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.085, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.30);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + 0.34);
  }

  /* ---------------- pattern ---------------- */
  /* Dembow: kick on 1 and 3, rim on the classic 3-6-11-14 sixteenths. */
  var KICK = [0, 8];
  var RIM  = [3, 6, 11, 14];
  var BASSHITS = [0, 6, 8, 14];

  function playStep(s, t) {
    var bar = (s >> 4) & 3;
    var i = s & 15;
    var chord = PROG[bar];

    if (mix.kick && KICK.indexOf(i) >= 0) kick(t, i === 0 ? 1 : 0.85);
    if (mix.rim && RIM.indexOf(i) >= 0) rim(t);

    if (mix.hat) {
      if (mix.hat === 2 || i % 2 === 0) hat(t, i === 14);
    }

    if (mix.bass && BASSHITS.indexOf(i) >= 0) {
      bass(t, chord.root, i === 0 || i === 8 ? 0.34 : 0.2);
    }

    if (mix.pad && i === 0) pad(t, chord.triad, SIXTEENTH * 15);

    if (mix.arp && i % 2 === 1) {
      // walk the pentatonic, biased to notes that sit in the current chord
      var n = PENT[(((s * 3) >> 1) + bar * 2) % PENT.length];
      if (i === 7 || i === 15) n += 12;
      pluck(t, n + (bar === 1 ? -4 : bar === 3 ? -2 : 0));
    }
  }

  function schedule() {
    if (!running) return;
    while (nextTime < ctx.currentTime + LOOKAHEAD) {
      if (nextTime > ctx.currentTime - 0.05) playStep(step, nextTime);
      nextTime += SIXTEENTH;
      step = (step + 1) % STEPS;
    }
  }

  /* ---------------- control ---------------- */
  function build() {
    ctx = window.UI.audioCtx();
    if (!ctx) return false;
    if (master) return true;
    master = ctx.createGain();
    filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = mix.cut;
    filter.Q.value = 0.6;
    master.gain.value = 0;
    master.connect(filter);
    filter.connect(ctx.destination);
    return true;
  }

  function targetGain() {
    return (!enabled || muted) ? 0 : BASE_GAIN * mix.vol;
  }

  function ramp(sec) {
    if (!master) return;
    var t = ctx.currentTime;
    master.gain.cancelScheduledValues(t);
    master.gain.setValueAtTime(master.gain.value, t);
    master.gain.linearRampToValueAtTime(targetGain(), t + (sec || 0.6));
    filter.frequency.cancelScheduledValues(t);
    filter.frequency.setValueAtTime(filter.frequency.value, t);
    filter.frequency.exponentialRampToValueAtTime(Math.max(80, mix.cut), t + (sec || 0.6));
  }

  function start() {
    if (fileEl) { if (enabled && !muted) fileEl.play().catch(function () {}); return; }
    if (!build()) return;
    if (ctx.state === "suspended") ctx.resume();
    if (running) { ramp(0.4); return; }
    running = true;
    step = 0;
    nextTime = ctx.currentTime + 0.08;
    clearInterval(timer);
    timer = setInterval(schedule, TICK);
    ramp(1.6);
  }

  function stop() {
    running = false;
    clearInterval(timer);
    if (master) master.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.4);
    if (fileEl) fileEl.pause();
  }

  function setPhase(name) {
    var m = PHASE[name];
    if (!m) return;
    mix = m;
    if (fileEl) { fileEl.volume = targetGain() * 2.6; return; }
    if (running) ramp(name === "reveal" ? 0.25 : 0.7);
  }

  function setEnabled(v) {
    enabled = !!v;
    if (enabled) start(); else stop();
  }

  function setMuted(v) {
    muted = !!v;
    if (fileEl) { fileEl.volume = targetGain() * 2.6; return; }
    if (muted) { if (master) ramp(0.3); }
    else if (enabled) start();
  }

  /* Swap in a real track: drop a file at audio/loop.mp3 (or change this path)
     and it plays instead of the synth, still ducking under the reveal. */
  var FILE_OVERRIDE = "";
  function useFile(src) {
    var url = src || FILE_OVERRIDE;
    if (!url) return false;
    fileEl = new Audio(url);
    fileEl.loop = true;
    fileEl.volume = targetGain() * 2.6;
    return true;
  }
  if (FILE_OVERRIDE) useFile();

  /* Diagnostic: RMS of what is actually reaching the speakers, 0 to 1.
     Handy for answering "is the music on?" without being able to hear it. */
  var probe = null;
  function level() {
    if (!filter || !ctx) return 0;
    if (!probe) {
      probe = ctx.createAnalyser();
      probe.fftSize = 2048;
      filter.connect(probe);
    }
    var buf = new Float32Array(probe.fftSize);
    probe.getFloatTimeDomainData(buf);
    var sum = 0;
    for (var i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    return Math.sqrt(sum / buf.length);
  }

  window.MUSIC = {
    level: level,
    start: start,
    stop: stop,
    setPhase: setPhase,
    setEnabled: setEnabled,
    setMuted: setMuted,
    isEnabled: function () { return enabled; },
    isRunning: function () { return running || !!(fileEl && !fileEl.paused); },
    useFile: useFile
  };
})();
