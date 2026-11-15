/* 恐竜なわばりカード: 光と粒の演出。画面いっぱいの canvas に描く(`window.DinoSpark`)。
   DOM の演出(fx.js)が苦手な「たくさんの粒」「光の筋」「画面全体の光」を受け持つ。
   演出が切の時と、OS の「動きを減らす」設定の時は、どの呼び出しも何もしない。粒が無い間は描画を止める。
   座標はすべて画面(ビューポート)の px。色は '#rrggbb'。時間は life が秒、delay がミリ秒。

   DinoSpark.at(el, fx, fy)            要素の中の点 { x, y, w, h, left, top }(fx, fy は 0〜1。省くと中心)
   DinoSpark.burst(x, y, o)            はじける粒。o: n, colors|color, kind('dot' 光の粒 / 'spark' 火花の筋 / 'star' きらめき /
                                       'shard' かけら / 'conf' 紙吹雪), speed, spread(ラジアン), angle(向き。0 が右、-PI/2 が上),
                                       life, size, gravity, drag, jitter(出どころのばらつき px), delay, stagger
   DinoSpark.ring(x, y, o)             広がる輪。o: color, r0, r1, life, width, delay
   DinoSpark.dust(x, y, o)             足もとの土けむり。o: n, color, w(広がる幅), size, life, delay
   DinoSpark.rays(x, y, o)             回る後光。o: color, n, r, life, spin, delay
   DinoSpark.pillar(x, y, o)           立ちのぼる光の柱(y が下端)。o: color, w, h, life, delay
   DinoSpark.sweep(rect, o)            四角の中を走る光の帯。rect: { left, top, w, h }。o: color, life, dir(1 右へ / -1 左へ), delay
   DinoSpark.slash(x, y, o)            爪あと。o: color, n, len, angle, life, delay
   DinoSpark.crack(x, y, o)            ひび。o: color, n, len, life, delay
   DinoSpark.trail(x0, y0, x1, y1, o)  飛んでいく光の粒。o: n, color, life, arc(山の高さ), stagger, size, done(着いた時に1回呼ぶ)
   DinoSpark.confetti(o)               紙吹雪。o: n, colors, life。x, y を渡すとそこから吹き上がる。無ければ上から降る
   DinoSpark.flash(o)                  画面全体の光。o: color, alpha, life, delay
   DinoSpark.text(x, y, str, o)        飛び出す文字。o: color, stroke, size, life, rise, delay
   DinoSpark.setEnabled(v) / active() / clear() / stats() / freeze(秒)(確認用: その秒数だけ進めて止める) */
(function (root) {
  'use strict';

  var doc = root.document;
  var TAU = Math.PI * 2;
  var MAX = 1100;                 // 粒の上限。超えたら古い粒から消す
  var cv = null, ctx = null, W = 0, H = 0, DPR = 1;
  var on = true, reduce = false, running = false, frozen = false, lastT = 0;
  var P = [];
  var sprites = {}, rgbCache = {};
  var st = { peak: 0, frames: 0, ms: 0, maxMs: 0 };
  var FONT = 'sans-serif';
  // 描く順。0 後ろの光 / 1 土けむり / 2 光の粒 / 3 かけらと紙 / 4 画面全体の光 / 5 文字
  var LAYER = { pillar: 0, rays: 0, sweep: 0, dust: 1, dot: 2, spark: 2, star: 2, ring: 2, slash: 2, crack: 2, trail: 2, shard: 3, conf: 3, flash: 4, text: 5 };
  var ADD = { 0: true, 2: true };  // 重ねると明るくなる描き方をする層

  function now() { return (root.performance && root.performance.now) ? root.performance.now() : Date.now(); }
  function raf(fn) { return (root.requestAnimationFrame || function (f) { return setTimeout(function () { f(now()); }, 16); })(fn); }
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function pick(a) { return a[(Math.random() * a.length) | 0]; }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function easeOut(u) { u = 1 - u; return 1 - u * u * u; }
  function num(v, d) { return typeof v === 'number' && isFinite(v) ? v : d; }

  // '#rrggbb' → 'r,g,b'
  function rgb(c) {
    if (!c) return '255,255,255';
    if (rgbCache[c]) return rgbCache[c];
    var s = String(c).trim(), out = '255,255,255', m;
    if (s.charAt(0) === '#') {
      var h = s.slice(1);
      if (h.length === 3) h = h.charAt(0) + h.charAt(0) + h.charAt(1) + h.charAt(1) + h.charAt(2) + h.charAt(2);
      var n = parseInt(h.slice(0, 6), 16);
      if (isFinite(n)) out = ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255);
    } else if ((m = s.match(/(\d+)[,\s]+(\d+)[,\s]+(\d+)/))) {
      out = m[1] + ',' + m[2] + ',' + m[3];
    }
    rgbCache[c] = out;
    return out;
  }
  function cols(o, def) { return (o.colors && o.colors.length ? o.colors : [o.color || def]).map(rgb); }

  // 色ごとに1枚だけ作る、ぼんやり光る丸
  function sprite(col) {
    var s = sprites[col];
    if (s) return s;
    s = doc.createElement('canvas');
    s.width = s.height = 64;
    var g = s.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.18, 'rgba(' + col + ',.95)');
    gr.addColorStop(0.5, 'rgba(' + col + ',.3)');
    gr.addColorStop(1, 'rgba(' + col + ',0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 64, 64);
    sprites[col] = s;
    return s;
  }

  function resize() {
    if (!cv) return;
    DPR = Math.min(2, root.devicePixelRatio || 1);
    W = root.innerWidth; H = root.innerHeight;
    cv.width = Math.max(1, Math.round(W * DPR));
    cv.height = Math.max(1, Math.round(H * DPR));
    if (frozen) draw();
  }

  function init() {
    if (cv || !doc || !doc.body) return;
    cv = doc.createElement('canvas');
    cv.id = 'spark-layer';
    cv.setAttribute('aria-hidden', 'true');
    cv.style.cssText = 'position:fixed;left:0;top:0;width:100%;height:100%;z-index:61;pointer-events:none;';
    doc.body.appendChild(cv);
    ctx = cv.getContext('2d');
    if (!ctx) { cv = null; return; }
    try {
      var mq = root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)');
      if (mq) {
        reduce = mq.matches;
        var onChange = function () { reduce = mq.matches; if (reduce) clear(); };
        if (mq.addEventListener) mq.addEventListener('change', onChange); else if (mq.addListener) mq.addListener(onChange);
      }
      FONT = root.getComputedStyle(doc.body).fontFamily || FONT;
    } catch (e) { /* 古いブラウザ */ }
    resize();
    root.addEventListener('resize', resize);
  }

  function active() { return on && !reduce && !!ctx; }
  function setEnabled(v) { on = !!v; if (!on) clear(); }
  function clear() {
    P.length = 0;
    frozen = false; running = false;
    if (ctx) { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, cv.width, cv.height); }
  }

  function add(p) {
    if (P.length >= MAX) P.shift();
    p.age = -(p.delay || 0) / 1000;
    p.L = LAYER[p.t];
    P.push(p);
    if (P.length > st.peak) st.peak = P.length;
    if (!running && !frozen) { running = true; lastT = 0; raf(frame); }
  }

  /* ---------- 進める ---------- */

  function step(dt) {
    var k = 0, i, p, u;
    for (i = 0; i < P.length; i++) {
      p = P[i];
      p.age += dt;
      if (p.age >= p.life) { if (p.done) { var d = p.done; p.done = null; d(); } continue; }
      P[k++] = p;
      if (p.age < 0) continue;
      switch (p.t) {
        case 'dot': case 'spark': case 'star': case 'shard':
          p.vy += p.g * dt;
          u = Math.exp(-p.drag * dt);
          p.vx *= u; p.vy *= u;
          p.x += p.vx * dt; p.y += p.vy * dt;
          p.rot += p.vr * dt;
          break;
        case 'conf':
          p.vy += p.g * dt;
          u = Math.exp(-p.drag * dt);
          p.vx *= u; p.vy *= u;
          p.x += (p.vx + Math.sin(p.age * p.fl + p.rot) * 46) * dt;
          p.y += p.vy * dt;
          p.rot += p.vr * dt;
          break;
        case 'dust':
          u = Math.exp(-3 * dt);
          p.vx *= u; p.vy *= u;
          p.x += p.vx * dt; p.y += p.vy * dt;
          break;
        case 'trail':
          u = easeOut(clamp(p.age / p.life, 0, 1));
          var v = 1 - u;
          p.x = v * v * p.x0 + 2 * v * u * p.cx + u * u * p.x1;
          p.y = v * v * p.y0 + 2 * v * u * p.cy + u * u * p.y1;
          // 尾を残す
          if (P.length < MAX - 8 && Math.random() < 0.7) {
            P.push({ t: 'dot', L: 2, x: p.x, y: p.y, vx: rnd(-20, 20), vy: rnd(-20, 20), g: 0, drag: 2, life: 0.35, age: 0, size: p.size * 0.6, col: p.col, rot: 0, vr: 0 });
          }
          break;
      }
    }
    P.length = k;
  }

  /* ---------- 描く ---------- */

  function fade(u) { return 1 - u * u; }                 // 終わりぎわに消える
  function envelope(u, a, b) {                           // a までに現れ、b から消える
    return u < a ? u / a : (u > b ? (1 - u) / (1 - b) : 1);
  }

  function drawOne(p) {
    var u = clamp(p.age / p.life, 0, 1), a, s, i, r, x, y;
    switch (p.t) {
      case 'dot':
        a = fade(u); s = p.size * (2.6 - 0.9 * u);
        ctx.globalAlpha = a;
        ctx.drawImage(sprite(p.col), p.x - s, p.y - s, s * 2, s * 2);
        break;
      case 'spark':
        a = fade(u);
        ctx.globalAlpha = a;
        ctx.strokeStyle = 'rgb(' + p.col + ')';
        ctx.lineWidth = Math.max(0.6, p.size * (1 - 0.6 * u));
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - p.vx * 0.04, p.y - p.vy * 0.04);
        ctx.stroke();
        ctx.globalAlpha = a * 0.9;
        s = p.size * 1.6;
        ctx.drawImage(sprite(p.col), p.x - s, p.y - s, s * 2, s * 2);
        break;
      case 'star':
        a = fade(u) * (0.55 + 0.45 * Math.sin(p.age * 22 + p.rot));
        s = p.size * (1 + 0.6 * Math.sin(u * Math.PI));
        ctx.globalAlpha = clamp(a, 0, 1);
        ctx.drawImage(sprite(p.col), p.x - s * 4, p.y - s * 0.7, s * 8, s * 1.4);
        ctx.drawImage(sprite(p.col), p.x - s * 0.7, p.y - s * 4, s * 1.4, s * 8);
        ctx.drawImage(sprite(p.col), p.x - s * 1.4, p.y - s * 1.4, s * 2.8, s * 2.8);
        break;
      case 'ring':
        r = p.r0 + (p.r1 - p.r0) * easeOut(u);
        ctx.globalAlpha = (1 - u) * (1 - u);
        ctx.strokeStyle = 'rgb(' + p.col + ')';
        ctx.lineWidth = Math.max(0.5, p.width * (1 - 0.7 * u));
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, TAU);
        ctx.stroke();
        break;
      case 'dust':
        s = p.size * (1 + 1.8 * u);
        ctx.globalAlpha = 0.5 * (1 - u);
        ctx.drawImage(sprite(p.col), p.x - s, p.y - s, s * 2, s * 2);
        break;
      case 'shard':
        ctx.globalAlpha = fade(u);
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = 'rgb(' + p.col + ')';
        ctx.strokeStyle = 'rgba(0,0,0,.45)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (i = 0; i < p.poly.length; i += 2) {
          if (i) ctx.lineTo(p.poly[i] * p.size, p.poly[i + 1] * p.size); else ctx.moveTo(p.poly[i] * p.size, p.poly[i + 1] * p.size);
        }
        ctx.closePath();
        ctx.fill(); ctx.stroke();
        ctx.restore();
        break;
      case 'conf':
        ctx.globalAlpha = u > 0.8 ? (1 - u) / 0.2 : 1;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.scale(1, Math.cos(p.age * p.fl));
        ctx.fillStyle = 'rgb(' + p.col + ')';
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
        break;
      case 'rays':
        a = envelope(u, 0.15, 0.6) * 0.5;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot + p.spin * p.age);
        var gr = ctx.createRadialGradient(0, 0, p.r * 0.08, 0, 0, p.r);
        gr.addColorStop(0, 'rgba(' + p.col + ',' + a.toFixed(3) + ')');
        gr.addColorStop(1, 'rgba(' + p.col + ',0)');
        ctx.fillStyle = gr;
        ctx.globalAlpha = 1;
        ctx.beginPath();
        for (i = 0; i < p.n; i++) {
          var a0 = i * TAU / p.n, hw = (i % 2 ? 0.34 : 0.2) * TAU / p.n;
          ctx.moveTo(0, 0);
          ctx.lineTo(Math.cos(a0 - hw) * p.r, Math.sin(a0 - hw) * p.r);
          ctx.lineTo(Math.cos(a0 + hw) * p.r, Math.sin(a0 + hw) * p.r);
          ctx.closePath();
        }
        ctx.fill();
        ctx.restore();
        break;
      case 'pillar':
        a = envelope(u, 0.12, 0.45);
        s = p.w * (0.55 + 0.45 * a);
        var gp = ctx.createLinearGradient(p.x - s / 2, 0, p.x + s / 2, 0);
        gp.addColorStop(0, 'rgba(' + p.col + ',0)');
        gp.addColorStop(0.5, 'rgba(' + p.col + ',' + (0.75 * a).toFixed(3) + ')');
        gp.addColorStop(1, 'rgba(' + p.col + ',0)');
        ctx.globalAlpha = 1;
        ctx.fillStyle = gp;
        ctx.fillRect(p.x - s / 2, p.y - p.h, s, p.h);
        ctx.globalAlpha = a;
        r = s * 0.9;
        ctx.drawImage(sprite(p.col), p.x - r, p.y - r * 0.35, r * 2, r * 0.7);
        break;
      case 'sweep':
        a = envelope(u, 0.1, 0.7);
        var band = Math.max(60, p.w * 0.35), sx = p.dir > 0 ? p.left - band + (p.w + band) * u : p.left + p.w - (p.w + band) * u;
        ctx.save();
        ctx.beginPath();
        ctx.rect(p.left, p.top, p.w, p.h);
        ctx.clip();
        var gs = ctx.createLinearGradient(sx, 0, sx + band, 0);
        gs.addColorStop(0, 'rgba(' + p.col + ',0)');
        gs.addColorStop(0.5, 'rgba(' + p.col + ',' + (0.6 * a).toFixed(3) + ')');
        gs.addColorStop(1, 'rgba(' + p.col + ',0)');
        ctx.globalAlpha = 1;
        ctx.fillStyle = gs;
        // 帯を斜めにする(四角の上端を基準にずらす)
        ctx.translate(p.h * 0.175, p.top);
        ctx.transform(1, 0, -0.35, 1, 0, 0);
        ctx.fillRect(sx - p.h, 0, band + p.h * 2, p.h);
        ctx.restore();
        break;
      case 'slash':
        var grow = clamp(u * 3.2, 0, 1);
        a = u < 0.35 ? 1 : (1 - u) / 0.65;
        ctx.lineCap = 'round';
        for (i = 0; i < p.n; i++) {
          var off = (i - (p.n - 1) / 2) * p.gap, ca = Math.cos(p.ang), sa = Math.sin(p.ang);
          x = p.x - sa * off - ca * p.len / 2; y = p.y + ca * off - sa * p.len / 2;
          var ex = x + ca * p.len * grow, ey = y + sa * p.len * grow, bx = (x + ex) / 2 - sa * p.len * 0.12, by = (y + ey) / 2 + ca * p.len * 0.12;
          ctx.globalAlpha = a * 0.55;
          ctx.strokeStyle = 'rgb(' + p.col + ')';
          ctx.lineWidth = 9 * (1 - 0.5 * u);
          ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(bx, by, ex, ey); ctx.stroke();
          ctx.globalAlpha = a;
          ctx.strokeStyle = '#fff';
          ctx.lineWidth = 3 * (1 - 0.5 * u);
          ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(bx, by, ex, ey); ctx.stroke();
        }
        break;
      case 'crack':
        grow = clamp(u * 4, 0, 1);
        a = u < 0.5 ? 1 : (1 - u) / 0.5;
        ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        for (i = 0; i < p.lines.length; i++) {
          var ln = p.lines[i], m = Math.max(2, Math.ceil(ln.length / 2 * grow));
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          for (var j = 0; j < m; j++) ctx.lineTo(p.x + ln[j * 2], p.y + ln[j * 2 + 1]);
          ctx.globalAlpha = a * 0.5; ctx.strokeStyle = 'rgb(' + p.col + ')'; ctx.lineWidth = 6; ctx.stroke();
          ctx.globalAlpha = a; ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
        }
        break;
      case 'trail':
        ctx.globalAlpha = 1;
        s = p.size * 2.6;
        ctx.drawImage(sprite(p.col), p.x - s, p.y - s, s * 2, s * 2);
        break;
      case 'flash':
        ctx.globalAlpha = p.alpha * (1 - u) * (1 - u);
        ctx.fillStyle = 'rgb(' + p.col + ')';
        ctx.fillRect(0, 0, W, H);
        break;
      case 'text':
        // はねて現れ、少し浮いて消える
        s = u < 0.18 ? 0.4 + (u / 0.18) * 0.85 : (u < 0.3 ? 1.25 - ((u - 0.18) / 0.12) * 0.25 : 1);
        a = u > 0.7 ? (1 - u) / 0.3 : 1;
        y = p.y - p.rise * easeOut(u);
        ctx.save();
        ctx.translate(p.x, y);
        ctx.scale(s, s);
        ctx.globalAlpha = a;
        ctx.font = '900 ' + p.size + 'px ' + FONT;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.lineJoin = 'round';
        ctx.lineWidth = Math.max(3, p.size / 4.5);
        ctx.strokeStyle = 'rgb(' + p.stroke + ')';
        ctx.strokeText(p.str, 0, 0);
        ctx.fillStyle = 'rgb(' + p.col + ')';
        ctx.fillText(p.str, 0, 0);
        ctx.restore();
        break;
    }
  }

  function draw() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    for (var L = 0; L <= 5; L++) {
      ctx.globalCompositeOperation = ADD[L] ? 'lighter' : 'source-over';
      for (var i = 0; i < P.length; i++) {
        var p = P[i];
        if (p.L === L && p.age >= 0) drawOne(p);
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  function frame(t) {
    if (!running) return;
    var dt = lastT ? Math.min(0.05, (t - lastT) / 1000) : 0.016;
    lastT = t;
    var t0 = now();
    step(dt);
    draw();
    var ms = now() - t0;
    st.frames++; st.ms += ms;
    if (ms > st.maxMs) st.maxMs = ms;
    if (P.length) raf(frame); else running = false;
  }

  /* ---------- 呼び出し口 ---------- */

  function at(el, fx, fy) {
    var r = el.getBoundingClientRect();
    return { x: r.left + r.width * num(fx, 0.5), y: r.top + r.height * num(fy, 0.5), w: r.width, h: r.height, left: r.left, top: r.top };
  }

  function burst(x, y, o) {
    if (!active()) return;
    o = o || {};
    var n = num(o.n, 18), cs = cols(o, '#ffe08a'), kind = LAYER[o.kind] != null ? o.kind : 'dot';
    var sp = num(o.speed, 260), spread = num(o.spread, TAU), ang = num(o.angle, 0), jit = num(o.jitter, 0);
    var conf = kind === 'conf';
    for (var i = 0; i < n; i++) {
      var a = ang + rnd(-spread / 2, spread / 2), v = sp * rnd(0.35, 1), size = num(o.size, conf ? 6 : 3) * rnd(0.6, 1.3);
      var p = {
        t: kind, x: x + rnd(-jit, jit), y: y + rnd(-jit, jit), vx: Math.cos(a) * v, vy: Math.sin(a) * v,
        g: num(o.gravity, conf ? 900 : 320), drag: num(o.drag, conf ? 1.2 : 1.6),
        life: num(o.life, conf ? 2.4 : 0.6) * rnd(0.6, 1), size: size, col: pick(cs),
        delay: num(o.delay, 0) + rnd(0, num(o.stagger, 0)), rot: rnd(0, TAU), vr: rnd(-8, 8)
      };
      if (kind === 'shard') p.poly = [rnd(-1, -0.3), rnd(-1, -0.2), rnd(0.3, 1), rnd(-0.8, 0.2), rnd(-0.2, 0.6), rnd(0.4, 1), rnd(-1, -0.4), rnd(0.2, 0.8)];
      if (conf) { p.w = size * rnd(1.6, 2.6); p.h = size * rnd(0.9, 1.4); p.fl = rnd(6, 12); }
      add(p);
    }
  }

  function ring(x, y, o) {
    if (!active()) return;
    o = o || {};
    add({ t: 'ring', x: x, y: y, col: rgb(o.color || '#ffffff'), r0: num(o.r0, 6), r1: num(o.r1, 80), life: num(o.life, 0.45), width: num(o.width, 4), delay: num(o.delay, 0) });
  }

  function dust(x, y, o) {
    if (!active()) return;
    o = o || {};
    var n = num(o.n, 8), w = num(o.w, 60), c = rgb(o.color || '#d8c9a0');
    for (var i = 0; i < n; i++) {
      var side = i % 2 ? 1 : -1;
      add({ t: 'dust', x: x + rnd(-w * 0.15, w * 0.15), y: y + rnd(-4, 4), vx: side * rnd(0.5, 1.6) * w, vy: -rnd(8, 40), col: c,
        size: num(o.size, 16) * rnd(0.7, 1.3), life: num(o.life, 0.7) * rnd(0.7, 1), delay: num(o.delay, 0) });
    }
  }

  function rays(x, y, o) {
    if (!active()) return;
    o = o || {};
    add({ t: 'rays', x: x, y: y, col: rgb(o.color || '#ffe08a'), n: num(o.n, 12), r: num(o.r, 170), life: num(o.life, 1.4), spin: num(o.spin, 0.6), rot: rnd(0, TAU), delay: num(o.delay, 0) });
  }

  function pillar(x, y, o) {
    if (!active()) return;
    o = o || {};
    add({ t: 'pillar', x: x, y: y, col: rgb(o.color || '#ffe08a'), w: num(o.w, 130), h: num(o.h, 460), life: num(o.life, 0.9), delay: num(o.delay, 0) });
  }

  function sweep(rect, o) {
    if (!active() || !rect) return;
    o = o || {};
    add({ t: 'sweep', left: rect.left, top: rect.top, w: rect.w, h: rect.h, col: rgb(o.color || '#ffffff'), life: num(o.life, 0.5), dir: o.dir < 0 ? -1 : 1, delay: num(o.delay, 0) });
  }

  function slash(x, y, o) {
    if (!active()) return;
    o = o || {};
    add({ t: 'slash', x: x, y: y, col: rgb(o.color || '#ff5a4a'), n: num(o.n, 3), len: num(o.len, 70), gap: num(o.gap, 13), ang: num(o.angle, 0.9), life: num(o.life, 0.4), delay: num(o.delay, 0) });
  }

  function crack(x, y, o) {
    if (!active()) return;
    o = o || {};
    var n = num(o.n, 5), len = num(o.len, 40), lines = [];
    for (var i = 0; i < n; i++) {
      var a = i * TAU / n + rnd(-0.4, 0.4), pts = [], seg = 4, d = 0;
      for (var j = 1; j <= seg; j++) {
        d = len * j / seg * rnd(0.8, 1.1);
        a += rnd(-0.45, 0.45);
        pts.push(Math.cos(a) * d, Math.sin(a) * d);
      }
      lines.push(pts);
    }
    add({ t: 'crack', x: x, y: y, col: rgb(o.color || '#ffe9a8'), lines: lines, life: num(o.life, 0.45), delay: num(o.delay, 0) });
  }

  function trail(x0, y0, x1, y1, o) {
    o = o || {};
    if (!active()) { if (o.done) o.done(); return; }
    var n = num(o.n, 8), c = rgb(o.color || '#ffe08a'), life = num(o.life, 0.7), arc = num(o.arc, 70), stg = num(o.stagger, 45);
    for (var i = 0; i < n; i++) {
      add({ t: 'trail', x0: x0 + rnd(-8, 8), y0: y0 + rnd(-8, 8), x1: x1, y1: y1, x: x0, y: y0,
        cx: (x0 + x1) / 2 + rnd(-arc, arc) * 0.6, cy: Math.min(y0, y1) - arc * rnd(0.6, 1.3),
        col: c, size: num(o.size, 4) * rnd(0.8, 1.2), life: life * rnd(0.85, 1.1), delay: num(o.delay, 0) + i * stg,
        done: i === n - 1 ? (o.done || null) : null });
    }
  }

  var PARTY = ['#ffd45e', '#ff7b5e', '#5ecbff', '#8be36b', '#ffffff', '#c48bff'];
  function confetti(o) {
    if (!active()) return;
    o = o || {};
    var n = num(o.n, 120), cs = o.colors && o.colors.length ? o.colors : PARTY;
    if (typeof o.x === 'number') {
      burst(o.x, o.y, { kind: 'conf', n: n, colors: cs, speed: num(o.speed, 760), spread: num(o.spread, 1.7), angle: -Math.PI / 2, life: num(o.life, 2.4), delay: o.delay });
      return;
    }
    var c2 = cs.map(rgb);
    for (var i = 0; i < n; i++) {
      var size = rnd(4, 8);
      add({ t: 'conf', x: rnd(0, W), y: rnd(-60, -10), vx: rnd(-60, 60), vy: rnd(140, 340), g: 130, drag: 0.25, life: num(o.life, 3.2) * rnd(0.8, 1.1),
        size: size, w: size * rnd(1.6, 2.6), h: size * rnd(0.9, 1.4), fl: rnd(6, 12), col: pick(c2), rot: rnd(0, TAU), vr: rnd(-6, 6),
        delay: num(o.delay, 0) + rnd(0, num(o.stagger, 900)) });
    }
  }

  function flash(o) {
    if (!active()) return;
    o = o || {};
    add({ t: 'flash', col: rgb(o.color || '#ffffff'), alpha: num(o.alpha, 0.45), life: num(o.life, 0.28), delay: num(o.delay, 0) });
  }

  function text(x, y, str, o) {
    if (!active()) return;
    o = o || {};
    add({ t: 'text', x: x, y: y, str: String(str), col: rgb(o.color || '#ffffff'), stroke: rgb(o.stroke || '#1c1a15'), size: num(o.size, 30), life: num(o.life, 1), rise: num(o.rise, 36), delay: num(o.delay, 0) });
  }

  // 確認用: sec 秒だけ進めた所で止めて、1枚描く。clear() で元に戻る
  function freeze(sec) {
    if (!ctx) return;
    running = false; frozen = true;
    for (var t = 0; t < sec; t += 1 / 60) step(1 / 60);
    draw();
  }

  function stats() {
    return { alive: P.length, peak: st.peak, frames: st.frames, avgMs: st.frames ? +(st.ms / st.frames).toFixed(2) : 0, maxMs: +st.maxMs.toFixed(2) };
  }

  root.DinoSpark = {
    init: init, active: active, setEnabled: setEnabled, clear: clear, at: at,
    burst: burst, ring: ring, dust: dust, rays: rays, pillar: pillar, sweep: sweep, slash: slash, crack: crack,
    trail: trail, confetti: confetti, flash: flash, text: text, freeze: freeze, stats: stats
  };

  if (doc) {
    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', init); else init();
  }
})(typeof window !== 'undefined' ? window : this);
