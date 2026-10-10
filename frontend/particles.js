/* ==========================================================================
   Arogya — serene floating-particle background
   Crafted by Vivek Nair (VN) — https://github.com/vivekn4
   Soft glowing orbs drift slowly upward behind the UI. Calming palette,
   zero interaction cost (pointer-events: none). Respects
   prefers-reduced-motion: renders a single static frame instead.
   ========================================================================== */
(function () {
  "use strict";

  var REDUCED = window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  var canvas = document.createElement("canvas");
  canvas.id = "vn-particles";
  canvas.setAttribute("aria-hidden", "true");
  document.body.insertBefore(canvas, document.body.firstChild);

  var ctx = canvas.getContext("2d");
  var W = 0, H = 0, orbs = [];

  var PALETTE = [
    [214, 186, 140],  // warm sand
    [168, 196, 170],  // sage
    [140, 180, 190],  // soft teal
    [232, 200, 160],  // honey
    [190, 170, 200]   // muted lavender
  ];

  function resize() {
    W = canvas.width = window.innerWidth;
    H = canvas.height = window.innerHeight;
  }

  function makeOrb(anyY) {
    var c = PALETTE[(Math.random() * PALETTE.length) | 0];
    return {
      x: Math.random() * W,
      y: anyY ? Math.random() * H : H + 20,
      r: 8 + Math.random() * 26,
      vy: 0.12 + Math.random() * 0.35,
      sway: Math.random() * Math.PI * 2,
      swaySpeed: 0.002 + Math.random() * 0.006,
      swayAmp: 10 + Math.random() * 30,
      alpha: 0.05 + Math.random() * 0.10,
      c: c
    };
  }

  function init() {
    resize();
    var n = Math.min(42, Math.floor((W * H) / 42000));
    orbs = [];
    for (var i = 0; i < n; i++) orbs.push(makeOrb(true));
  }

  function drawOrb(o) {
    var g = ctx.createRadialGradient(o.x, o.y, 0, o.x, o.y, o.r);
    var rgb = o.c[0] + "," + o.c[1] + "," + o.c[2];
    g.addColorStop(0, "rgba(" + rgb + "," + o.alpha + ")");
    g.addColorStop(1, "rgba(" + rgb + ",0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(o.x, o.y, o.r, 0, Math.PI * 2);
    ctx.fill();
  }

  function frame() {
    ctx.clearRect(0, 0, W, H);
    for (var i = 0; i < orbs.length; i++) {
      var o = orbs[i];
      o.sway += o.swaySpeed * 16;
      o.y -= o.vy;
      var x = o.x + Math.sin(o.sway) * o.swayAmp;
      if (o.y < -o.r - 20) { orbs[i] = makeOrb(false); continue; }
      drawOrb({ x: x, y: o.y, r: o.r, alpha: o.alpha, c: o.c });
    }
    if (!REDUCED) requestAnimationFrame(frame);
  }

  window.addEventListener("resize", resize);
  init();
  frame(); // single static frame when reduced motion is preferred
})();
