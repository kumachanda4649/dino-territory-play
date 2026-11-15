/* 恐竜なわばりカード: 音。Web Audio で短い音を作る(音のファイルは使わない)。
   使い方: DinoSound.play('place', 遅らせるミリ秒, 強さや番号) / DinoSound.setEnabled(false)
   音の名前:
     select(選ぶ) place(置く。3つ目の引数=重さ 1〜3) cpu(CPUが置く。同) big(とても重い着地)
     stamp(足あとが付く。3つ目=何個目か) capture(奪う) step(足ぶみ) hunt(狩り) up(大きさが増える)
     draw(札を引く) turn(番が替わる) tick(結果の1行) pass(パス) error(置けない)
     win / lose / tie(終了) */
(function (root) {
  'use strict';

  var ctx = null, master = null, noiseBuf = null, on = true;

  function context() {
    if (ctx) return ctx;
    var AC = root.AudioContext || root.webkitAudioContext;
    if (!AC) return null;
    try {
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
    } catch (e) { ctx = null; }
    return ctx;
  }

  // 1つの音。f1 から f2 へ高さを動かせる。vol は 0〜1
  function tone(t0, dur, type, f1, f2, vol) {
    var o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f1, t0);
    if (f2 && f2 !== f1) o.frequency.exponentialRampToValueAtTime(f2, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g);
    g.connect(master);
    o.start(t0);
    o.stop(t0 + dur + 0.03);
  }

  // ざらっとした音(砂ぼこり、風切り)。kind: 'lowpass' | 'highpass' | 'bandpass'
  function noise(t0, dur, kind, freq, vol) {
    if (!noiseBuf) {
      var n = Math.floor(ctx.sampleRate * 0.8), data;
      noiseBuf = ctx.createBuffer(1, n, ctx.sampleRate);
      data = noiseBuf.getChannelData(0);
      for (var i = 0; i < n; i++) data[i] = Math.random() * 2 - 1;
    }
    var src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    src.buffer = noiseBuf;
    f.type = kind;
    f.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f);
    f.connect(g);
    g.connect(master);
    src.start(t0);
    src.stop(t0 + dur + 0.03);
  }

  // 置く音: 重いほど低く、長く、砂ぼこりが多い
  function thud(t, w, base) {
    w = w === 2 ? 2 : (w >= 3 ? 3 : 1);
    var f = base / (1 + (w - 1) * 0.35), dur = 0.14 + w * 0.05;
    tone(t, dur, 'sine', f, f * 0.45, 0.42 + w * 0.08);
    tone(t, 0.05, 'triangle', f * 2.9, 0, 0.1);
    noise(t, 0.08 + w * 0.04, 'lowpass', 900 - w * 180, 0.08 + w * 0.05);
  }

  var SOUNDS = {
    select:  function (t) { tone(t, 0.07, 'triangle', 620, 760, 0.16); },
    place:   function (t, w) { thud(t, w, 200); },
    cpu:     function (t, w) { thud(t, w, 165); },
    big:     function (t) {
      tone(t, 0.55, 'sine', 82, 34, 0.9);
      tone(t, 0.3, 'sawtooth', 110, 48, 0.16);
      noise(t, 0.45, 'lowpass', 420, 0.5);
      tone(t + 0.16, 0.5, 'sine', 58, 30, 0.4);
    },
    stamp:   function (t, k) { var f = 300 + Math.min(6, k || 0) * 42; tone(t, 0.06, 'sine', f, f * 0.7, 0.2); noise(t, 0.04, 'bandpass', 1400, 0.05); },
    capture: function (t) { tone(t, 0.07, 'square', 520, 1040, 0.07); tone(t + 0.06, 0.12, 'triangle', 1040, 1560, 0.1); noise(t, 0.08, 'highpass', 2600, 0.06); },
    step:    function (t) { tone(t, 0.16, 'sine', 150, 62, 0.6); noise(t, 0.2, 'lowpass', 700, 0.22); },
    hunt:    function (t) { tone(t, 0.2, 'sawtooth', 280, 90, 0.11); noise(t, 0.12, 'bandpass', 900, 0.1); },
    up:      function (t) { tone(t, 0.09, 'triangle', 660, 0, 0.12); tone(t + 0.07, 0.12, 'triangle', 880, 0, 0.12); },
    draw:    function (t) { noise(t, 0.12, 'highpass', 3200, 0.07); tone(t + 0.02, 0.06, 'sine', 900, 1300, 0.04); },
    // カード集め: get(カードをもらう) dig(掘る) flip(候補がめくれる)
    get:     function (t) { [784, 988, 1319, 1568].forEach(function (f, k) { tone(t + k * 0.07, 0.22, 'triangle', f, 0, 0.14); }); },
    dig:     function (t) { [0, 0.16].forEach(function (d) { tone(t + d, 0.07, 'square', 900, 500, 0.05); noise(t + d, 0.1, 'bandpass', 1800, 0.16); }); },
    flip:    function (t) { noise(t, 0.09, 'highpass', 2400, 0.08); tone(t + 0.05, 0.08, 'triangle', 700, 0, 0.08); },
    turn:    function (t) { tone(t, 0.09, 'sine', 440, 550, 0.08); },
    tick:    function (t, k) { tone(t, 0.08, 'triangle', 520 + (k || 0) * 90, 0, 0.14); },
    pass:    function (t) { tone(t, 0.13, 'sine', 330, 240, 0.2); },
    error:   function (t) { tone(t, 0.09, 'square', 150, 130, 0.06); },
    // 見せ場: vs(VS の一撃) cutin(カットインのうなり) stop(そこまで!) hit(発掘の打撃。k=何回目) crack(岩が割れる)
    //         unlock(場所が開く) ok(決定)
    vs:      function (t) { tone(t, 0.5, 'sine', 72, 30, 0.9); tone(t, 0.16, 'sawtooth', 220, 60, 0.2); noise(t, 0.35, 'lowpass', 600, 0.5); tone(t + 0.02, 0.3, 'triangle', 880, 440, 0.12); },
    cutin:   function (t) { tone(t, 0.7, 'sawtooth', 58, 140, 0.16); noise(t, 0.6, 'bandpass', 500, 0.18); tone(t + 0.5, 0.3, 'sawtooth', 160, 70, 0.14); },
    stop:    function (t) { tone(t, 0.35, 'sine', 110, 55, 0.7); noise(t, 0.25, 'lowpass', 500, 0.4); tone(t, 0.2, 'triangle', 660, 330, 0.12); },
    hit:     function (t, k) { tone(t, 0.09, 'square', 520 + (k || 0) * 70, 200, 0.08); noise(t, 0.14, 'bandpass', 1500, 0.3); tone(t, 0.12, 'sine', 140, 70, 0.4); },
    crack:   function (t) {
      noise(t, 0.4, 'highpass', 1200, 0.35); tone(t, 0.3, 'sine', 120, 40, 0.6);
      [1200, 1600, 2100].forEach(function (f, k) { tone(t + 0.05 + k * 0.05, 0.25, 'triangle', f, 0, 0.1); });
    },
    unlock:  function (t) { [392, 523, 659, 784].forEach(function (f, k) { tone(t + k * 0.08, 0.3, 'triangle', f, 0, 0.16); }); noise(t, 0.2, 'highpass', 3000, 0.08); },
    ok:      function (t) { tone(t, 0.08, 'triangle', 520, 0, 0.14); tone(t + 0.07, 0.12, 'triangle', 780, 0, 0.14); },
    win:     function (t) {
      [523, 659, 784, 1047].forEach(function (f, k) { tone(t + k * 0.1, 0.22, 'triangle', f, 0, 0.22); });
      [523, 659, 784, 1047, 1319].forEach(function (f) { tone(t + 0.46, 0.9, 'triangle', f, 0, 0.1); });
      tone(t + 0.46, 0.9, 'sine', 131, 0, 0.3);
      noise(t + 0.46, 0.5, 'highpass', 5000, 0.05);
    },
    lose:    function (t) { [330, 277, 220].forEach(function (f, k) { tone(t + k * 0.2, 0.34, 'sine', f, 0, 0.16); }); },
    tie:     function (t) { [440, 440].forEach(function (f, k) { tone(t + k * 0.16, 0.2, 'triangle', f, 0, 0.2); }); }
  };

  // delayMs: 遅らせて鳴らす(演出の着地に合わせる)。arg: 音ごとの数(重さ、番号)
  function play(name, delayMs, arg) {
    if (!on || !SOUNDS[name]) return;
    // まだ1度も操作されていない間は、ブラウザが音を出させない(警告だけが出る)ので、何もしない
    var ua = root.navigator && root.navigator.userActivation;
    if (ua && !ua.hasBeenActive) return;
    var c = context();
    if (!c) return;
    try {
      if (c.state === 'suspended' && c.resume) c.resume();
      SOUNDS[name](c.currentTime + 0.01 + (delayMs > 0 ? delayMs / 1000 : 0), arg);
    } catch (e) { /* 音が出せなくても遊べる */ }
  }

  root.DinoSound = {
    play: play,
    setEnabled: function (v) { on = !!v; },
    isEnabled: function () { return on; }
  };
})(typeof window !== 'undefined' ? window : this);
