/* ==========================================================================
   Arogya — serene WebAudio SFX
   Crafted by Vivek Nair (VN) — https://github.com/vivekn4
   All sounds are synthesized in-browser (no audio files). Soft, calming
   tones that match Arogya's gentle personality. Mute is persisted.
   ========================================================================== */
(function () {
  "use strict";

  var MUTE_KEY = "vn_sfx_muted";
  var ctx = null;
  var muted = false;
  try { muted = localStorage.getItem(MUTE_KEY) === "1"; } catch (e) {}

  function ensureCtx() {
    if (!ctx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }

  function tone(freqStart, freqEnd, dur, vol, type, delay) {
    if (muted) return;
    var ac = ensureCtx();
    if (!ac) return;
    var t0 = ac.currentTime + (delay || 0);
    var osc = ac.createOscillator();
    var gain = ac.createGain();
    osc.type = type || "sine";
    osc.frequency.setValueAtTime(freqStart, t0);
    osc.frequency.exponentialRampToValueAtTime(Math.max(freqEnd, 1), t0 + dur);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(vol, t0 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain).connect(ac.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  function noiseWhoosh(dur, vol) {
    if (muted) return;
    var ac = ensureCtx();
    if (!ac) return;
    var t0 = ac.currentTime;
    var len = Math.floor(ac.sampleRate * dur);
    var buf = ac.createBuffer(1, len, ac.sampleRate);
    var data = buf.getChannelData(0);
    for (var i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    var src = ac.createBufferSource();
    src.buffer = buf;
    var filter = ac.createBiquadFilter();
    filter.type = "bandpass";
    filter.Q.value = 1.2;
    filter.frequency.setValueAtTime(400, t0);
    filter.frequency.exponentialRampToValueAtTime(2400, t0 + dur);
    var gain = ac.createGain();
    gain.gain.setValueAtTime(vol, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filter).connect(gain).connect(ac.destination);
    src.start(t0);
  }

  window.VN_SFX = {
    // soft send blip
    blip: function () { tone(520, 780, 0.16, 0.06, "sine"); },
    // gentle two-note reply chime (pentatonic, calming)
    chime: function () { tone(659.25, 659.25, 0.5, 0.05, "sine"); tone(880, 880, 0.7, 0.04, "sine", 0.12); },
    // subtle transition whoosh
    whoosh: function () { noiseWhoosh(0.45, 0.03); },
    // warm success shimmer
    success: function () { tone(523.25, 523.25, 0.4, 0.05, "triangle"); tone(783.99, 783.99, 0.6, 0.04, "triangle", 0.1); },
    toggleMute: function () {
      muted = !muted;
      try { localStorage.setItem(MUTE_KEY, muted ? "1" : "0"); } catch (e) {}
      return muted;
    },
    isMuted: function () { return muted; }
  };
})();
