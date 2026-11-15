/* 恐竜なわばりカード: 演出の道具。局面や規則には触らない。
   画面は先に「打った後の形」に描いてあり、ここはその上に動きを重ねるだけ。
   どの演出も、後始末は setTimeout で行う(画面が描かれていない時でも、最後の形に必ず落ち着くように)。
   使い方: DinoFX.active() が true の時だけ、ui.js が各関数を呼ぶ。 */
(function (root) {
  'use strict';

  var on = true;             // 「演出: 入/切」
  var reduce = false;        // prefers-reduced-motion
  var layer = null;          // 画面全体に重ねる層(飛ぶ札、紙吹雪)
  var timers = [];
  var anims = [];            // 動かしている途中のもの(Web Animations)
  var tweens = [];           // 数え上げの途中のもの
  var confettiStop = null;

  function now() { return (root.performance && root.performance.now) ? root.performance.now() : Date.now(); }
  function raf(fn) { return (root.requestAnimationFrame || function (f) { return setTimeout(f, 16); })(fn); }

  function init() {
    layer = document.getElementById('fx-layer');
    if (root.matchMedia) {
      var mq = root.matchMedia('(prefers-reduced-motion: reduce)');
      reduce = mq.matches;
      var onChange = function () { reduce = mq.matches; sync(); };
      if (mq.addEventListener) mq.addEventListener('change', onChange);
      else if (mq.addListener) mq.addListener(onChange);
    }
    sync();
  }

  function active() { return on && !reduce && !!layer && typeof layer.animate === 'function'; }
  function sync() { if (document.body) document.body.classList.toggle('fx-off', !(on && !reduce)); }
  function setEnabled(v) { on = !!v; sync(); if (!on) clear(); }

  function later(fn, ms) {
    var id = setTimeout(function () {
      var k = timers.indexOf(id);
      if (k >= 0) timers.splice(k, 1);
      fn();
    }, ms);
    timers.push(id);
    return id;
  }

  // 進行中の演出を全部消して、最後の形にする(一手戻す、やり直し、開始、設定に戻る時)
  function clear() {
    timers.forEach(function (id) { clearTimeout(id); });
    timers = [];
    anims.forEach(function (a) { try { a.cancel(); } catch (e) { /* 既に終わっている */ } });
    anims = [];
    tweens.slice().forEach(function (tw) { tw.end(); });
    if (layer) layer.innerHTML = '';
    var list = document.querySelectorAll('[data-fly],[data-land],[data-stamp],[data-flip],[data-pop],[data-rev],[data-deal],[data-ok]');
    for (var i = 0; i < list.length; i++) {
      ['data-fly', 'data-land', 'data-stamp', 'data-flip', 'data-pop', 'data-rev', 'data-deal', 'data-ok'].forEach(function (a) { list[i].removeAttribute(a); });
    }
    list = document.querySelectorAll('.fxl, #turn-banner');
    for (i = 0; i < list.length; i++) list[i].innerHTML = '';
    list = document.querySelectorAll('.fx-tmp');
    for (i = 0; i < list.length; i++) if (list[i].parentNode) list[i].parentNode.removeChild(list[i]);
    if (confettiStop) confettiStop();
  }

  // 要素に印(属性)を付け、ms 後に外す。見た目は CSS が受け持つ
  function mark(el, attr, value, ms, delay) {
    var set = function () {
      el.setAttribute(attr, value);
      later(function () { if (el.getAttribute(attr) === value) el.removeAttribute(attr); }, ms);
    };
    if (delay > 0) later(set, delay); else set();
  }

  // 一時的な部品を足し、ms 後に取り除く
  function temp(parent, html, ms, delay) {
    var add = function () {
      var d = document.createElement('div');
      d.className = 'fx-tmp';
      d.innerHTML = html;
      parent.appendChild(d);
      later(function () { if (d.parentNode) d.parentNode.removeChild(d); }, ms);
    };
    if (delay > 0) later(add, delay); else add();
  }

  // 要素を動かす(Web Animations)。止まったままにならないよう、時間が来たら必ず取り消す
  function anim(el, frames, opts) {
    if (!el || typeof el.animate !== 'function') return;
    var a;
    try { a = el.animate(frames, opts); } catch (e) { return; }
    anims.push(a);
    later(function () {
      var k = anims.indexOf(a);
      if (k >= 0) anims.splice(k, 1);
      try { a.cancel(); } catch (e) { /* 既に終わっている */ }
    }, (opts.duration || 0) + (opts.delay || 0) + 80);
  }

  function tf(x, y, s, r) { return 'translate(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px) scale(' + s.toFixed(3) + ') rotate(' + r + 'deg)'; }

  // 札を from(画面上の四角)から toEl の位置へ飛ばす。html は飛ぶ札の中身。着いたら done
  function fly(html, from, toEl, ms, done) {
    var to = toEl.getBoundingClientRect();
    var g = document.createElement('div');
    g.className = 'fly';
    g.style.left = to.left + 'px';
    g.style.top = to.top + 'px';
    g.style.width = to.width + 'px';
    g.style.height = to.height + 'px';
    g.innerHTML = html;
    layer.appendChild(g);
    var dx = (from.left + from.width / 2) - (to.left + to.width / 2);
    var dy = (from.top + from.height / 2) - (to.top + to.height / 2);
    var sc = Math.max(0.35, Math.min(1.5, from.width / Math.max(1, to.width)));
    var lift = Math.min(70, 20 + Math.abs(dx) * 0.05 + Math.abs(dy) * 0.1);
    var fin = false;
    var end = function () {
      if (fin) return;
      fin = true;
      if (g.parentNode) g.parentNode.removeChild(g);
      if (done) done();
    };
    try {
      var a = g.animate([
        { transform: tf(dx, dy, sc, dx > 0 ? 7 : -7), opacity: 0.9 },
        { transform: tf(dx * 0.38, dy * 0.38 - lift, 1.14, dx > 0 ? -3 : 3), opacity: 1, offset: 0.6 },
        { transform: tf(0, 0, 1, 0), opacity: 1 }
      ], { duration: ms, easing: 'cubic-bezier(.4,.05,.35,1)', fill: 'forwards' });
      a.onfinish = end;
    } catch (e) { /* 動かせなくても、時間が来たら着地させる */ }
    later(end, ms + 90);
  }

  // 数字を数え上げる(下げる)。delay 後に ms かけて to へ
  function count(el, to, ms, delay) {
    to = +to;
    if (el.__tw && el.__tw.to === to) return;          // 同じ行き先へ向かっている最中
    if (el.__tw) el.__tw.end(true);
    var from = parseInt(el.textContent, 10);
    if (!active() || isNaN(from) || from === to) { el.textContent = String(to); return; }
    delay = delay || 0;
    var t0 = now() + delay, tw = { to: to, dead: false };
    tw.end = function (keep) {
      if (tw.dead) return;
      tw.dead = true;
      if (el.__tw === tw) el.__tw = null;
      var k = tweens.indexOf(tw);
      if (k >= 0) tweens.splice(k, 1);
      el.removeAttribute('data-count');
      if (!keep) el.textContent = String(to);
    };
    var step = function () {
      if (tw.dead) return;
      var k = (now() - t0) / ms;
      if (k >= 1) { tw.end(); return; }
      if (k > 0) {
        el.setAttribute('data-count', to > from ? 'up' : 'down');
        el.textContent = String(Math.round(from + (to - from) * (1 - Math.pow(1 - k, 3))));
      }
      raf(step);
    };
    el.__tw = tw;
    tweens.push(tw);
    raf(step);
    setTimeout(function () { tw.end(); }, delay + ms + 150);   // 画面が描かれていない時の保険
  }

  // 小さく揺らす
  function shake(el, px, ms) {
    var f = [], n = 9;
    for (var k = 0; k <= n; k++) {
      var d = px * (1 - k / n);
      f.push({ transform: 'translate(' + ((k % 2 ? -1 : 1) * d).toFixed(1) + 'px,' + ((k % 3 === 0 ? -0.6 : 0.5) * d).toFixed(1) + 'px)' });
    }
    f[n] = { transform: 'none' };
    anim(el, f, { duration: ms, easing: 'linear' });
  }

  // 番の知らせを、盤面の上の端で横切らせる
  function banner(text, cls) {
    var host = document.getElementById('turn-banner');
    if (!host) return;
    host.innerHTML = '';
    temp(host, '<span class="tb ' + cls + '">' + text + '</span>', 900);
  }

  // 紙吹雪(勝った時)
  function confetti(ms) {
    if (!layer) return;
    if (confettiStop) confettiStop();
    var c = document.createElement('canvas'), w = root.innerWidth, h = root.innerHeight, g = c.getContext && c.getContext('2d');
    if (!g) return;
    c.className = 'confetti';
    c.width = w; c.height = h;
    layer.appendChild(c);
    var colors = ['#62b06d', '#49b5b2', '#d3aa4c', '#5aa7ee', '#ffe08a', '#f5efe0'], ps = [], i;
    for (i = 0; i < 150; i++) {
      var side = i % 2 ? 1 : -1;
      ps.push({
        x: w / 2 + side * (40 + Math.random() * w * 0.18), y: h * 0.32 + Math.random() * 30,
        vx: side * (1 + Math.random() * 5.5), vy: -(5 + Math.random() * 8),
        s: 5 + Math.random() * 6, r: Math.random() * 6.3, vr: (Math.random() - 0.5) * 0.4,
        c: colors[i % colors.length], w: 0.5 + Math.random() * 0.5
      });
    }
    var t0 = now(), dead = false;
    var stop = function () {
      if (dead) return;
      dead = true;
      if (c.parentNode) c.parentNode.removeChild(c);
      if (confettiStop === stop) confettiStop = null;
    };
    var step = function () {
      if (dead) return;
      var t = now() - t0;
      if (t > ms) { stop(); return; }
      g.clearRect(0, 0, w, h);
      g.globalAlpha = t > ms - 500 ? Math.max(0, (ms - t) / 500) : 1;
      for (var k = 0; k < ps.length; k++) {
        var p = ps[k];
        p.vy += 0.22; p.vx *= 0.992; p.x += p.vx; p.y += p.vy; p.r += p.vr;
        g.save();
        g.translate(p.x, p.y);
        g.rotate(p.r);
        g.fillStyle = p.c;
        g.fillRect(-p.s / 2, -p.s * p.w / 2, p.s, p.s * p.w);
        g.restore();
      }
      raf(step);
    };
    confettiStop = stop;
    raf(step);
    setTimeout(stop, ms + 300);
  }

  root.DinoFX = {
    init: init, active: active, setEnabled: setEnabled, isEnabled: function () { return on; },
    later: later, clear: clear, mark: mark, temp: temp, anim: anim,
    fly: fly, count: count, shake: shake, banner: banner, confetti: confetti
  };
})(typeof window !== 'undefined' ? window : this);
