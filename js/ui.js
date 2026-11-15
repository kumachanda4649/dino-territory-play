/* 恐竜なわばりカード: 画面。
   規則は engine.js、カードは cards.js、CPU は ai.js、演出の道具は fx.js、音は sound.js。ここは表示と操作を受け持つ。
   流れ: 設定 → 引き直し → 対戦 → 結果。
   描き方: 手を打ったら、まず画面を「打った後の形」に描き、その上に演出(飛ぶ札、押される足あと、数え上げ)を重ねる。
           cpuDelay: 0 で始めた時と、演出を切った時は、演出を出さずに進む。
   確認用の入口: window.DinoUI(いちばん下)。URL に ?seed=123 があれば、その種で始める。 */
(function () {
  'use strict';

  var E = window.DinoEngine, C = window.DinoCards, AI = window.DinoAI, FX = window.DinoFX, K = window.DinoCollection;
  var ROWS = E.ROWS, COLS = E.COLS, N = E.N, LANDS = C.LANDS;

  // gentle(とてもやさしい)は、続けて負けたライバル戦でだけ出る。じゆう対戦では選べない
  var LEVELS = { gentle: 'とてもやさしい', easy: 'やさしい', normal: 'ふつう', hard: 'つよい' };
  var FREE_LEVELS = { easy: 1, normal: 1, hard: 1 };
  var DIETS = { herb: '草食', carn: '肉食' };
  var SCREENS = ['map', 'deck', 'setup', 'mull', 'play'];
  var STORE_KEY = 'dinoNawabari.sound';
  var STORE_FX = 'dinoNawabari.fx';
  var STORE_INTRO = 'dinoNawabari.intro';
  var CPU_DELAY = 550;      // CPU が打つまでの間(ミリ秒)
  var FX_MS = 900;          // 直前の手を目立たせる長さ
  var END_DELAY = 650;      // 終わってから結果を出すまでの間
  var HINT_MS = 2400;       // ひとことの知らせを出しておく長さ
  var TURNING_MIN = 0.25;   // これより小さい差は「分かれ目」と呼ばない
  var ANALYZE_SAMPLES = 8;

  // 絵のファイルが無い間に出す影絵(index.html の d-<名前>)。形が崩れたものは、ここから外せば景色だけになる。
  // 後から足した12種は、近い形の影絵を借りる
  var SIL = {
    tyranno: 'tyranno', trike: 'trike', stego: 'stego', spino: 'spino', parasa: 'parasa', pachy: 'pachy',
    raptor: 'raptor', deino: 'deino', compy: 'compy', galli: 'galli', proto: 'proto', hypsi: 'hypsi',
    troodon: 'raptor', psitta: 'proto', coelo: 'compy', ovi: 'galli', eorap: 'compy', minmi: 'stego',
    theri: 'parasa', iguano: 'parasa', bary: 'spino', ankylo: 'stego', brachi: 'stego', giga: 'tyranno'
  };

  var URL_SEED = (function () {
    var m = /[?&]seed=(-?\d+)/.exec(window.location.search || '');
    return m ? (parseInt(m[1], 10) | 0) : null;
  })();

  var G = {
    screen: 'map',
    // じゆう対戦の設定。opp: 相手のデッキ('starter' 最初のデッキ / 'random' ばらばら)
    cfg: { scoring: 'sum', level: 'normal', land: false, herdHunt: false, first: 'lot', opp: 'starter' },
    // いまの対戦の相手。rival: ライバル(じゆう対戦は null)、level: その対戦での強さ、name: 画面に出す名前
    match: { rival: null, level: 'normal', name: 'CPU' },
    rewarded: false,       // この対戦のごほうびを、もう渡したか(渡すのは1戦に1回だけ)
    sound: true,
    fxOn: true,            // 「演出: 入/切」
    s: null,               // 局面(DinoEngine の state)
    seed: 0, fixed: false, // fixed: 種を指定して始めた(CPU の乱数も種から作る)
    cpuRand: Math.random,
    cpuDelay: CPU_DELAY,
    sel: -1,               // 選んでいる手札の位置
    hover: -1,             // 指しているマス
    mullSel: [],           // 引き直しで戻す札
    busy: false,           // CPU の番の間 true
    token: 0,              // 古いタイマーを無効にするための番号
    log: [],               // 手の記録 { p, n, text, extra }
    records: [],           // 人間の手ごとの記録 { ply, before, move, logLen, done, diff, best }
    fx: null,              // 直前の手の目印
    instant: false,        // true の間は演出なしで描く(戻す時など)
    numDelay: 0,           // 数字の数え上げを始めるまでの間(札が着地する時に合わせる)
    fxUntil: 0,            // 進行中の演出が終わる時刻
    hint: '',
    result: null,          // { sc, turning }
    cpuTimer: 0, fxTimer: 0, hintTimer: 0, endTimer: 0, anTimer: 0
  };

  var ART = {};            // id -> true(絵がある) / false(無い)
  var cellEl = [], cinEl = [], pvEl = [], fxlEl = [], totEl = [];
  var confirmCb = null;

  /* ---------- 小さな道具 ---------- */

  function $(id) { return document.getElementById(id); }
  function esc(t) {
    return String(t).replace(/[&<>"]/g, function (ch) {
      return ch === '&' ? '&amp;' : (ch === '<' ? '&lt;' : (ch === '>' ? '&gt;' : '&quot;'));
    });
  }
  function icon(id, cls) {
    return '<svg class="ic' + (cls ? ' ' + cls : '') + '" aria-hidden="true" focusable="false"><use href="#' + id + '"></use></svg>';
  }
  function setText(el, v) { v = String(v); if (el.textContent !== v) el.textContent = v; }
  function setHtml(el, h) { if (el.__h !== h) { el.__h = h; el.innerHTML = h; } }
  function setAttr(el, name, v) {
    if (v === null || v === undefined) { if (el.hasAttribute(name)) el.removeAttribute(name); }
    else if (el.getAttribute(name) !== String(v)) el.setAttribute(name, String(v));
  }
  function sound(name, delayMs, arg) { if (G.sound && window.DinoSound) window.DinoSound.play(name, delayMs, arg); }
  function cellName(i) { return LANDS[(i / COLS) | 0] + 'の' + (i % COLS + 1) + 'マス目'; }
  // 画面に出す名前。相手は、ライバル戦ならその名前、じゆう対戦なら CPU
  function who(p) { return p === 0 ? 'あなた' : G.match.name; }
  function sameMove(a, b) { return a.t === b.t && (a.t === 'pass' || (a.id === b.id && a.i === b.i)); }

  // 演出を出してよいか。cpuDelay: 0(待たずに進める)、演出: 切、動きを控える設定、戻す途中、では出さない
  function fxActive() { return !!FX && G.fxOn && G.cpuDelay > 0 && !G.instant && FX.active(); }
  function fxClear() { stageCancel(); if (FX) FX.clear(); if (SPK) SPK.clear(); G.fxUntil = 0; }

  // 光と粒(spark.js)。演出を出してよい時だけ、道具を返す。使い方: var S = sp(); if (S) S.ring(...)
  var SPK = window.DinoSpark;
  // 指で触る端末か(説明の言葉を「クリック」から「タップ」に変えるのに使う)
  var TOUCH = (function () { try { return !!(window.matchMedia && window.matchMedia('(hover: none)').matches); } catch (e) { return false; } })();
  var COL = { me: '#5aa7ee', cpu: '#f29b4c', glow: '#ffe08a', gold: '#ffd45e', good: '#6fe39a', dust: '#d8c9a0', white: '#ffffff' };
  function sp() { return SPK && fxActive() ? SPK : null; }
  function pcol(p) { return p === 0 ? COL.me : COL.cpu; }
  // 要素の中の点(画面の座標)。fx, fy は 0〜1。省くと中心
  function mid(el, fx, fy) {
    var r = el.getBoundingClientRect();
    return { x: r.left + r.width * (fx === undefined ? 0.5 : fx), y: r.top + r.height * (fy === undefined ? 0.5 : fy), w: r.width, h: r.height, left: r.left, top: r.top };
  }

  // 数字を入れる。演出が入っていれば数え上げる
  function setNum(el, v) {
    if (fxActive()) { FX.count(el, v, 380, G.numDelay); return; }
    if (el.__tw) el.__tw.end(true);
    setText(el, v);
  }

  /* ---------- 設定 ---------- */

  function applyCfg(o) {
    if (!o) return;
    if (o.scoring === 'sum' || o.scoring === 'lanes') G.cfg.scoring = o.scoring;
    if (FREE_LEVELS[o.level]) G.cfg.level = o.level;
    if (o.opp === 'starter' || o.opp === 'random') G.cfg.opp = o.opp;
    if (typeof o.land === 'boolean') G.cfg.land = o.land;
    if (typeof o.herdHunt === 'boolean') G.cfg.herdHunt = o.herdHunt;
    if (o.first === 0 || o.first === 'me') G.cfg.first = 'me';
    else if (o.first === 1 || o.first === 'cpu') G.cfg.first = 'cpu';
    else if (o.first === 'lot' || o.first === null) G.cfg.first = 'lot';
  }

  function syncForm() {
    var f = $('setup-form');
    ['scoring', 'level', 'first', 'opp'].forEach(function (name) {
      var list = f.querySelectorAll('input[name="' + name + '"]');
      for (var k = 0; k < list.length; k++) list[k].checked = list[k].value === G.cfg[name];
    });
    f.querySelector('input[name="land"]').checked = G.cfg.land;
    f.querySelector('input[name="herdHunt"]').checked = G.cfg.herdHunt;
  }

  function readForm() {
    var f = $('setup-form'), o = {};
    ['scoring', 'level', 'first', 'opp'].forEach(function (name) {
      var el = f.querySelector('input[name="' + name + '"]:checked');
      if (el) o[name] = el.value;
    });
    o.land = f.querySelector('input[name="land"]').checked;
    o.herdHunt = f.querySelector('input[name="herdHunt"]').checked;
    return o;
  }

  function loadStored() {
    try {
      if (window.localStorage.getItem(STORE_KEY) === '0') G.sound = false;
      if (window.localStorage.getItem(STORE_FX) === '0') G.fxOn = false;
    } catch (e) { /* 覚えられなくても動く */ }
  }
  function setSound(v) {
    G.sound = !!v;
    if (window.DinoSound) window.DinoSound.setEnabled(G.sound);
    try { window.localStorage.setItem(STORE_KEY, G.sound ? '1' : '0'); } catch (e) { /* 同上 */ }
    var b = $('btn-sound');
    b.textContent = G.sound ? '音: 入' : '音: 切';
    b.setAttribute('aria-pressed', G.sound ? 'true' : 'false');
  }
  function setFxOn(v) {
    G.fxOn = !!v;
    if (!G.fxOn) stageCancel();
    if (FX) FX.setEnabled(G.fxOn);
    if (SPK) SPK.setEnabled(G.fxOn);
    try { window.localStorage.setItem(STORE_FX, G.fxOn ? '1' : '0'); } catch (e) { /* 同上 */ }
    var b = $('btn-fx');
    b.textContent = G.fxOn ? '演出: 入' : '演出: 切';
    b.setAttribute('aria-pressed', G.fxOn ? 'true' : 'false');
    if (G.screen === 'play' && G.s) renderAll();
  }

  /* ---------- 画面の切り替え ---------- */

  function show(name) {
    G.screen = name;
    SCREENS.forEach(function (n) { $('scr-' + n).hidden = n !== name; });
  }
  function openOv(id) { $(id).hidden = false; }
  function closeOv(id) { $(id).hidden = true; }
  function ovOpen(id) { return !$(id).hidden; }
  function closeAllOv() {
    ['ov-result', 'ov-confirm', 'ov-help', 'ov-rival', 'ov-dig', 'ov-tasks', 'ov-save', 'ov-intro'].forEach(closeOv);
  }

  function stopTimers() {
    G.token++;
    clearTimeout(G.cpuTimer); clearTimeout(G.fxTimer); clearTimeout(G.hintTimer); clearTimeout(G.endTimer);
  }

  // じゆう対戦の設定へ
  function toSetup() {
    stopTimers();
    fxClear();
    G.busy = false;
    closeAllOv();
    syncForm();
    show('setup');
  }

  /* ---------- 対戦を始める ---------- */

  /* opts.rivalId があればライバル戦(相手のデッキと強さはライバルのもの。先手はくじ。土地と群れ狩りは切り)。
     無ければ、じゆう対戦(設定画面の内容)。opts.again は「もう一度」(同じ相手と)。自分のデッキは、いつも K.deck() */
  function start(opts) {
    opts = opts || {};
    var rival = null;
    if (opts.rivalId !== undefined && opts.rivalId !== null) {
      rival = K.RIVAL[opts.rivalId] || null;
      if (!rival || !K.rivalOpen(rival.id)) return null;     // 知らない相手、まだ挑めない相手
    } else if (opts.again && G.match.rival) {
      rival = G.match.rival;
    }
    if (!rival) applyCfg(opts);
    if (typeof opts.cpuDelay === 'number' && opts.cpuDelay >= 0) G.cpuDelay = opts.cpuDelay;
    stopTimers();
    fxClear();

    var seed, fixed = true;
    if (typeof opts.seed === 'number' && isFinite(opts.seed)) seed = opts.seed | 0;
    else if (URL_SEED !== null) seed = URL_SEED;
    else { seed = ((Math.random() * 0x7ffffffe) | 0) + 1; fixed = false; }

    var level, first, land, herd, scoring, oppDeck;
    if (rival) {
      level = K.rivalLevel(rival.id);       // 続けて負けると、相手が手加減する
      first = undefined; land = false; herd = false; scoring = 'sum';
      oppDeck = rival.deck.slice();
    } else {
      level = G.cfg.level;
      first = G.cfg.first === 'me' ? 0 : (G.cfg.first === 'cpu' ? 1 : undefined);
      land = G.cfg.land; herd = G.cfg.herdHunt; scoring = G.cfg.scoring;
      oppDeck = G.cfg.opp === 'random' ? C.randomLegalDeck(fixed ? E.makeRng((seed ^ 0x51f15e) | 0) : Math.random) : C.STARTER.slice();
    }
    G.match = { rival: rival, level: level, name: rival ? rival.name : 'CPU' };
    G.rewarded = false;
    G.s = E.newGame({
      seed: seed,
      decks: [K.deck(), oppDeck],
      // comp 'side': 後手は森の列の足あとが2で始まる(自動対戦で、先手の勝率が50〜53%になった補正)
      // rescue 2: 置ける札が無い時の「足ぶみ」を、1人1試合に2回まで
      opts: { scoring: scoring, land: land, herdHunt: herd, comp: 'side', rescue: 2 },
      first: first
    });
    G.seed = seed;
    G.fixed = fixed;
    G.cpuRand = fixed ? E.makeRng((seed ^ 0x2f6e2b1) | 0) : Math.random;
    G.sel = -1; G.busy = false; G.fx = null; G.hint = ''; G.result = null;
    G.log = []; G.records = []; G.mullSel = [];
    closeAllOv();
    syncForm();
    setText($('btn-mull-back'), rival ? '地図に戻る' : '設定に戻る');
    setText($('btn-quit'), rival ? '地図に戻る' : '設定に戻る');
    show('mull');
    renderMull();
    if (Array.isArray(opts.mulligan)) doMulligan(opts.mulligan);
    else if (rival && fxActive()) vsScreen(rival, function () { dealIn($('mull-hand')); });   // ライバル戦は VS の画面から
    else dealIn($('mull-hand'));
    return G.s;
  }

  /* ---------- 見せ場: 画面いっぱいに重ねる短い演出(VS、カットイン、そこまで!、カードを手に入れる、起動) ----------
     どれも、時間が来たら setTimeout で必ず終わる。skip が true のものは、クリックかキーで飛ばせる。
     終わる時に done を呼ぶ(stageCancel は呼ばずに消すだけ。対戦をやめる時や、戻す時に使う)。 */

  var STAGE = { kind: '', done: null, timer: 0, skip: false };

  function stageShow(kind, html, ms, done, skip) {
    stageCancel();
    var el = $('stage');
    el.className = 'stage st-' + kind;
    el.innerHTML = html;
    el.hidden = false;
    STAGE.kind = kind; STAGE.done = done || null; STAGE.skip = !!skip;
    STAGE.timer = setTimeout(stageEnd, ms);
  }
  function stageHide() {
    clearTimeout(STAGE.timer);
    STAGE.kind = ''; STAGE.done = null;
    var el = $('stage');
    el.hidden = true;
    el.innerHTML = '';
  }
  function stageEnd() {
    if (!STAGE.kind) return false;
    var done = STAGE.done, kind = STAGE.kind;
    stageHide();
    if (SPK && kind !== 'cut' && kind !== 'end') SPK.clear();     // 飛ばした時に、光だけ残らないように
    if (done) done();
    return true;
  }
  function stageCancel() { if (STAGE.kind) stageHide(); }
  function stageSkip() { return STAGE.kind && STAGE.skip ? stageEnd() : false; }

  function heaviest(ids) {
    var best = ids[0];
    ids.forEach(function (id) {
      var a = E.CARDS[id], b = E.CARDS[best];
      if (a.w > b.w || (a.w === b.w && a.size > b.size)) best = id;
    });
    return best;
  }

  // VS: 左から自分(デッキでいちばん重い恐竜)、右からライバル。中央に「VS」が打ち込まれる
  function vsScreen(rival, done) {
    var mine = heaviest(K.deck()), st = K.get(), cx = window.innerWidth / 2, cy = window.innerHeight * 0.45, S;
    stageShow('vs', '<div class="vs">' +
      '<div class="vs-side me"><div class="vs-pic land-' + E.CARDS[mine].land + '">' + artHtml(mine) + '</div>' +
      '<b>あなた</b><span>' + esc(st.decks[st.cur].name) + '</span></div>' +
      '<div class="vs-mark">VS</div>' +
      '<div class="vs-side cpu"><div class="vs-pic round land-' + E.CARDS[rival.card].land + '">' + artHtml(rival.card) + '</div>' +
      '<b>' + esc(rival.name) + '</b><span>' + esc(rival.title) + '</span><p>「' + esc(rival.say) + '」</p></div>' +
      '<div class="skip-note">クリックで進む</div></div>', 1700, done, true);
    S = sp();
    if (S) {
      S.flash({ color: '#ffffff', alpha: 0.5, life: 0.3, delay: 430 });
      S.ring(cx, cy, { color: COL.glow, r1: 280, width: 6, life: 0.5, delay: 430 });
      S.ring(cx, cy, { color: '#ffffff', r1: 170, life: 0.35, delay: 470 });
      S.burst(cx, cy, { kind: 'spark', n: 48, colors: [COL.glow, '#ffffff', COL.me, COL.cpu], speed: 640, life: 0.7, delay: 430 });
    }
    sound('vs', 430);
  }

  // カットイン: 重さ3をもとの大きさで置く時。斜めの帯が横切り、恐竜の大きな絵と名前が走る(約0.9秒)
  function cutIn(id, p, v) {
    var cd = E.CARDS[id];
    stageShow('cut', '<div class="cutin o' + p + '"><div class="cut-band"></div><div class="cut-lines"></div>' +
      '<div class="cut-pic">' + picHtml(id) + '</div>' +
      '<div class="cut-text"><b>' + esc(cd.name) + '</b><span>大きさ ' + v + '</span></div></div>', 900, null, false);
    sound('cutin');
  }

  // 「そこまで!」: 終局の合図。打ち込まれてから、結果へ
  function endStamp(done) {
    var cx = window.innerWidth / 2, cy = window.innerHeight * 0.42, S;
    stageShow('end', '<div class="endw"><b>そこまで!</b></div>', 800, done, false);
    S = sp();
    if (S) {
      S.ring(cx, cy, { color: '#ffffff', r1: 320, width: 5, life: 0.5, delay: 130 });
      S.burst(cx, cy, { kind: 'spark', n: 34, colors: [COL.glow, '#ffffff'], speed: 560, life: 0.6, delay: 130 });
    }
    sound('stop', 110);
  }

  // 起動した時: 題名が打ち込まれ、足あとが横切る(約1.2秒)
  function bootShow(done) {
    var cx = window.innerWidth / 2, cy = window.innerHeight * 0.44, S;
    stageShow('boot', '<div class="boot"><div class="boot-feet">' + feetIcons(9) + '</div>' +
      '<h1>恐竜なわばりカード</h1><p>足あとを広げて、なわばりを取り合う</p><div class="skip-note">クリックで進む</div></div>', 1350, done, true);
    S = sp();
    if (S) {
      S.ring(cx, cy, { color: COL.glow, r1: 340, width: 5, life: 0.55, delay: 330 });
      S.burst(cx, cy, { kind: 'spark', n: 40, colors: [COL.glow, '#ffffff', '#62b06d', '#49b5b2', '#d3aa4c'], speed: 600, life: 0.7, delay: 330 });
    }
    sound('stop', 320);
  }

  /* カードを手に入れる演出(ライバルの切り札、発掘、課題のカードで共通)。
     光の柱 → カードが回りながら現れる → 後光ときらめき → 「新しいカード!」。重さ3は金色で一段大きく。
     list: [{ id, added, isNew }]。1枚ずつ出し、クリックで次へ。全部済んだら done */
  function cardShow(list, done) {
    var cards = (list || []).filter(function (c) { return c && c.added; }), k = 0;
    if (!cards.length || !fxActive()) { if (done) done(); return; }
    var next = function () {
      if (k >= cards.length) { if (done) done(); return; }
      var c = cards[k++], cd = E.CARDS[c.id], gold = cd.w >= 3, S = sp();
      var cx = window.innerWidth / 2, cy = window.innerHeight * 0.44;
      stageShow('get', '<div class="getc' + (gold ? ' gold' : '') + '"><div class="get-rays"></div>' +
        '<div class="get-card">' + cardHtml(c.id, { h: 0, hunt: true, plain: true }) + '</div>' +
        '<div class="get-word">' + (c.isNew ? '新しいカード!' : '2枚目!') + '</div>' +
        '<div class="get-name">' + esc(cd.name) + '</div><div class="skip-note">クリックで進む</div></div>', gold ? 2300 : 1800, next, true);
      if (S) {
        S.pillar(cx, window.innerHeight, { color: gold ? COL.gold : '#bfe6ff', w: gold ? 240 : 160, h: window.innerHeight, life: 0.9 });
        S.ring(cx, cy, { color: gold ? COL.gold : '#ffffff', r1: gold ? 340 : 250, width: 5, life: 0.55, delay: 430 });
        S.burst(cx, cy, { kind: 'star', n: gold ? 46 : 24, colors: [COL.gold, '#ffffff'], speed: gold ? 460 : 360, life: 1.1, delay: 430 });
        if (gold) {
          S.flash({ color: '#fff3c0', alpha: 0.4, life: 0.35, delay: 410 });
          S.burst(cx, cy, { kind: 'star', n: 26, colors: [COL.gold, '#fff6d0'], speed: 260, life: 1.2, delay: 900 });
        }
      }
      sound('get', 400);
    };
    next();
  }

  /* ---------- 引き直し ---------- */

  function renderMull() {
    var s = G.s, h = '', n = 0;
    s.hands[0].forEach(function (id, k) {
      if (G.mullSel[k]) n++;
      h += cardHtml(id, { h: k, back: !!G.mullSel[k] });
    });
    setHtml($('mull-hand'), h);
    setText($('mull-first'), (G.match.rival ? G.match.rival.title + 'の' + G.match.name + 'との対戦。' : '') +
      '先手は' + who(s.first) + 'です' + (G.match.rival || G.cfg.first === 'lot' ? '(くじ)。' : '。'));
    var redo = $('btn-mull-redo'), keep = $('btn-mull-keep');
    redo.disabled = n === 0;
    setText(redo, n ? '引き直す(' + n + '枚)' : '引き直す');
    redo.classList.toggle('primary', n > 0);
    keep.classList.toggle('primary', n === 0);
  }

  // 配る演出: 札が下から順に入ってくる
  function dealIn(host) {
    if (!fxActive()) return;
    // 入ってくる途中の札が、下のボタンへのクリックを取らないようにする
    FX.mark(host, 'data-deal', '1', 320 + host.children.length * 85);
    for (var k = 0; k < host.children.length; k++) {
      FX.anim(host.children[k], [
        { transform: 'translateY(46px) scale(.9) rotate(-4deg)', opacity: 0 },
        { transform: 'none', opacity: 1 }
      ], { duration: 300, delay: k * 85, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'backwards' });
      sound('draw', k * 85);
    }
  }

  function doMulligan(idxs) {
    var s = G.s;
    if (!s || s.phase !== 'mulligan' || s.mull[0]) return false;
    var seen = {}, list = [];
    (idxs || []).forEach(function (k) {
      k = k | 0;
      if (k >= 0 && k < s.hands[0].length && !seen[k]) { seen[k] = 1; list.push(k); }
    });
    E.mulligan(s, 0, list);
    var cm = AI.chooseMulligan(s, 1);
    E.mulligan(s, 1, cm);
    addLog(-1, '先手は' + who(s.first));
    addLog(0, list.length ? list.length + '枚を引き直した' : '引き直しなし');
    addLog(1, cm.length ? cm.length + '枚を引き直した' : '引き直しなし');
    // 後手への補正(エンジンの opts.comp)で、足あとが2つから始まるマスがあれば知らせる
    for (var r = 0; r < ROWS; r++) {
      var edge = r * COLS + (s.first === 0 ? COLS - 1 : 0);
      if (s.cells[edge].f > 1) addLog(-1, '後手の' + who(1 - s.first) + 'は、' + LANDS[r] + 'の足あとが' + s.cells[edge].f + 'つで始まる');
    }
    if (s.hands[1 - s.first].length > E.HAND0) addLog(-1, '後手の' + who(1 - s.first) + 'は、手札が1枚多く始まる');
    fxClear();
    setHtml($('hand'), '');        // 手札を空にしておくと、最初の手札が山から滑り込んでくる
    show('play');
    G.instant = true;              // 盤面と数字は、はじめの形をそのまま出す
    renderTop(); renderBoard();
    G.instant = false;
    nextTurn();
    return true;
  }

  /* ---------- カードの絵と部品 ---------- */

  // 絵があるかを先に確かめる。無い時は影絵(それも無ければ土地の景色だけ)
  function probeArt() {
    C.LIST.forEach(function (cd) {
      var im = new Image();
      im.onload = function () { ART[cd.id] = true; renderHero(); renderScreen(); };
      im.onerror = function () { ART[cd.id] = false; };
      im.src = 'assets/dino/' + cd.id + '.png';
    });
  }

  // 恐竜の姿: 絵のファイルがあればそれ(体全体が入るように収める)、無ければ影絵
  function picHtml(id) {
    if (ART[id]) return '<img class="pic" src="assets/dino/' + id + '.png" alt="">';
    if (SIL[id]) return '<svg class="pic" viewBox="0 0 120 64" preserveAspectRatio="xMidYMax meet" aria-hidden="true" focusable="false"><use href="#d-' + SIL[id] + '"></use></svg>';
    return '';
  }

  function artHtml(id, extra) {
    var land = E.CARDS[id].land;
    return '<span class="art land-' + land + '">' +
      '<svg class="bg" aria-hidden="true" focusable="false"><use href="#bg-' + land + '"></use></svg>' +
      picHtml(id) + (extra || '') + '</span>';
  }

  // 題名の絵に並べる3頭
  function renderHero() {
    var h = '';
    ['stego', 'spino', 'tyranno'].forEach(function (id, k) {
      var inner = ART[id] ? '<img src="assets/dino/' + id + '.png" alt="">'
        : (SIL[id] ? '<svg viewBox="0 0 120 64" preserveAspectRatio="xMidYMax meet"><use href="#d-' + SIL[id] + '"></use></svg>' : '');
      h += '<span class="hd p' + k + '">' + inner + '</span>';
    });
    setHtml($('hero-dinos'), h);
  }

  // 置くのに要る足あとの、いちばん少ない数(二段構えの札は小さい方)
  function minWeight(cd) { return cd.alt && cd.alt.w < cd.w ? cd.alt.w : cd.w; }

  function feetIcons(n) { var h = ''; for (var k = 0; k < n; k++) h += icon('i-foot'); return h; }

  // 足あとの形: 3行×5マス。まん中が置いたマス、右が前
  function patHtml(cd) {
    var on = {}, k, h;
    for (k = 0; k < cd.pat.length; k++) {
      var c = 2 + cd.pat[k][0], r = 1 + cd.pat[k][1];
      if (c >= 0 && c < 5 && r >= 0 && r < 3) on[r * 5 + c] = 1;
    }
    h = '<span class="pat" title="足あとの形(まん中が置いたマス、右が前)">';
    for (k = 0; k < 15; k++) h += '<i class="' + (k === 7 ? 'me' : (on[k] ? 'on' : '')) + '"></i>';
    return h + '</span>';
  }

  // 手札のカード。o: { h 手札の位置, sel, dim, back, dark(持っていない札の影), hunt(「狩り」の印を必ず出す) }
  function cardHtml(id, o) {
    var cd = E.CARDS[id], hunt = cd.ab === 'hunt' && (o.hunt || (!!G.s && G.s.opts.herdHunt));
    var cls = 'card land-' + cd.land + (cd.alt ? ' alt' : '') + (o.sel ? ' sel' : '') + (o.dim ? ' dim' : '') + (o.back ? ' back' : '') + (o.dark ? ' dark' : '');
    var tip = cd.name + ': 重さ ' + cd.w + '、大きさ ' + cd.size + '、' + DIETS[cd.diet] + '、得意な土地は' + LANDS[cd.land] +
      (hunt ? '、狩りをする' : '') +
      (cd.alt ? '。二段構え: 足あと' + cd.alt.w + 'のマスにも置ける(その時は大きさ' + cd.alt.size + ')' : '') +
      (o.dim ? '。いまは置けるマスがありません' : '');
    // 二段構えの札は、絵の下に1行そえる
    var altNote = cd.alt ? '<span class="alt-note">足あと' + cd.alt.w + 'なら大きさ' + cd.alt.size + '</span>' : '';
    // plain: 押せない見本(デッキ編成の大きい表示)
    var open = o.plain ? '<span class="' + cls + '" data-id="' + id + '">'
      : '<button type="button" class="' + cls + '" data-h="' + o.h + '" data-id="' + id + '" title="' + esc(tip) + '" aria-pressed="' + (o.sel || o.back ? 'true' : 'false') + '">';
    return open +
      '<span class="c-head"><span class="c-w">' + feetIcons(cd.w) + '</span><span class="c-size">' + cd.size + '</span></span>' +
      artHtml(id, altNote) +
      '<span class="c-name">' + esc(cd.name) + '</span>' +
      '<span class="c-bot">' + patHtml(cd) + '<span class="c-tags">' +
        '<span class="chip ' + cd.diet + '">' + icon(cd.diet === 'herb' ? 'i-leaf' : 'i-fang') + DIETS[cd.diet] + '</span>' +
        '<span class="chip land">' + LANDS[cd.land] + '</span>' +
        (hunt ? '<span class="chip hunt">狩り</span>' : '') +
      '</span></span>' +
      (o.back ? '<span class="back-tag">戻す</span>' : '') +
      (o.plain ? '</span>' : '</button>');
  }

  // 盤面のカード(絵を全面に敷き、名前の帯と大きさを重ねる)
  function bcardHtml(s, i) {
    var k = s.cells[i].c, cd = E.CARDS[k.id], v = E.sizeAt(s, i);
    var tip = who(k.o) + 'の' + cd.name + ': 大きさ ' + v + (v !== cd.size ? '(元は ' + cd.size + ')' : '') + '、' + DIETS[cd.diet] + '、得意な土地は' + LANDS[cd.land];
    return '<div class="bcard o' + k.o + ' land-' + cd.land + '" title="' + esc(tip) + '">' +
      artHtml(k.id) +
      '<div class="b-name' + (cd.name.length >= 9 ? ' long' : '') + '"><span class="nm">' + esc(cd.name) + '</span>' +
        icon(cd.diet === 'herb' ? 'i-leaf' : 'i-fang') + '</div>' +
      '<span class="b-size' + (v > cd.size ? ' up' : (v < cd.size ? ' down' : '')) + '">' + v + '</span>' +
      '</div>';
  }

  /* ---------- 盤面を作る(1回だけ) ---------- */

  // 列の景色(盤面と、探検の地図で使う)。同じ形がいつも出るよう、決まった数列で並べる。sfx: 色の名前が重ならないための印
  function sceneSvg(r, sfx) {
    var a = 17 + r * 31, x, d, hh, w, k;
    var R = function () { a = (a * 9301 + 49297) % 233280; return a / 233280; };
    var h = '<svg class="scene" viewBox="0 0 1000 120" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">';
    sfx = sfx || '';
    if (r === 0) {
      // 森: 奥の木立、手前の暗い木、木もれ日
      h += '<defs><linearGradient id="sg0' + sfx + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#274a34"/><stop offset="1" stop-color="#1a3324"/></linearGradient></defs>' +
        '<rect width="1000" height="120" fill="url(#sg0' + sfx + ')"/>';
      d = '';
      for (x = -10; x < 1015; x += 27) {
        hh = 34 + R() * 30; w = 20 + R() * 12;
        d += 'M' + (x - w / 2).toFixed(0) + ' 84L' + x.toFixed(0) + ' ' + (84 - hh).toFixed(0) + 'l' + (w / 2).toFixed(0) + ' ' + hh.toFixed(0) + 'z';
      }
      h += '<path d="' + d + '" fill="#3b7149" opacity=".5"/>';
      d = '';
      for (x = 0; x < 1020; x += 58) {
        hh = 62 + R() * 40; w = 40 + R() * 18; k = x + R() * 26;
        d += 'M' + (k - w / 2).toFixed(0) + ' 128L' + k.toFixed(0) + ' ' + (128 - hh).toFixed(0) + 'l' + (w / 2).toFixed(0) + ' ' + hh.toFixed(0) + 'z';
      }
      h += '<path d="' + d + '" fill="#11251a" opacity=".62"/>';
      h += '<g class="shaft" fill="#e4f6c0" opacity=".07"><path d="M170 0h64l-96 120h-52z"/><path d="M500 0h44l-76 120h-42z"/><path d="M800 0h74l-104 120h-62z"/></g>';
      // ゆっくり落ちる葉
      for (k = 0; k < 7; k++) {
        h += '<ellipse class="leaf" cx="' + (90 + k * 135 + R() * 60).toFixed(0) + '" cy="0" rx="5" ry="2.4" fill="#9fd68a" style="animation-delay:' + (-(k * 1.3 + R() * 2)).toFixed(1) + 's"/>';
      }
    } else if (r === 1) {
      // 水辺: ゆっくり流れる波、きらめき、両端の葦
      var wave = function (y, amp) {
        var p = 'M-240 ' + y;
        for (var q = -240; q < 1240; q += 60) p += 'q15 ' + (-amp) + ' 30 0t30 0';
        return p;
      };
      h += '<defs><linearGradient id="sg1' + sfx + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#215457"/><stop offset="1" stop-color="#173b40"/></linearGradient></defs>' +
        '<rect width="1000" height="120" fill="url(#sg1' + sfx + ')"/>';
      h += '<g class="w1" fill="none" stroke="#c8f4ef" stroke-linecap="round">' +
        '<path d="' + wave(16, 5) + '" stroke-width="1.5" opacity=".15"/><path d="' + wave(58, 6) + '" stroke-width="1.8" opacity=".2"/><path d="' + wave(100, 6) + '" stroke-width="2" opacity=".22"/></g>';
      h += '<g class="w2" fill="none" stroke="#c8f4ef" stroke-linecap="round">' +
        '<path d="' + wave(37, 5) + '" stroke-width="1.5" opacity=".14"/><path d="' + wave(79, 6) + '" stroke-width="1.8" opacity=".18"/></g>';
      for (k = 0; k < 10; k++) {
        h += '<ellipse class="glint" cx="' + (60 + R() * 880).toFixed(0) + '" cy="' + (12 + R() * 96).toFixed(0) + '" rx="' + (7 + R() * 8).toFixed(0) + '" ry="1.5" fill="#f0fffb" opacity=".05"/>';
      }
      d = '';
      [8, 18, 30, 44, 958, 970, 982, 994].forEach(function (rx) {
        var top = 22 + R() * 40;
        d += '<g class="sway"><path d="M' + rx + ' 124V' + top.toFixed(0) + '" stroke="#0f2b2e" stroke-width="2.5" fill="none" opacity=".7"/>' +
          '<ellipse cx="' + rx + '" cy="' + (top - 6).toFixed(0) + '" rx="3" ry="9" fill="#0f2b2e" opacity=".7"/></g>';
      });
      h += d;
    } else {
      // 平原: 夕方の空、遠い丘、ゆっくり流れる雲、足もとの草
      h += '<defs><linearGradient id="sg2' + sfx + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#665730"/><stop offset=".38" stop-color="#5c4b22"/><stop offset="1" stop-color="#433515"/></linearGradient></defs>' +
        '<rect width="1000" height="120" fill="url(#sg2' + sfx + ')"/>';
      h += '<circle cx="884" cy="26" r="36" fill="#ffd98a" opacity=".08"/><circle cx="884" cy="26" r="19" fill="#ffd98a" opacity=".22"/>';
      h += '<g class="cloud" fill="#fff3d0" opacity=".08"><ellipse cx="190" cy="15" rx="64" ry="6"/><ellipse cx="560" cy="22" rx="86" ry="7"/><ellipse cx="760" cy="12" rx="48" ry="5"/></g>';
      h += '<path d="M0 50q120-26 260-8t260-6 240 2 240-10V74H0z" fill="#7a652c" opacity=".4"/>';
      h += '<path d="M0 70q160-16 330-6t340-6 330 4V128H0z" fill="#3a2d10" opacity=".35"/>';
      d = '';
      for (x = 4; x < 1000; x += 19) {
        hh = 9 + R() * 16; k = x + R() * 8;
        d += 'M' + k.toFixed(0) + ' 124l3 ' + (-hh).toFixed(0) + ' 3 ' + hh.toFixed(0) + 'z';
      }
      h += '<path class="gsway" d="' + d + '" fill="#8d7431" opacity=".55"/>';
    }
    return h + '</svg>';
  }

  function buildBoard() {
    var h = '<div class="brow bhead"><span></span><span class="th me">あなた</span>', r, c, i;
    for (c = 0; c < COLS; c++) h += '<span>' + (c + 1) + '</span>';
    h += '<span class="th cpu" id="th-cpu">CPU</span></div>';
    for (r = 0; r < ROWS; r++) {
      h += '<div class="brow land-' + r + '">' + sceneSvg(r) +
        '<div class="land-name">' + icon('i-land-' + r) + '<span>' + LANDS[r] + '</span></div>';
      h += '<div class="tot me" title="あなたの合計"><b class="num">0</b><i class="delta"></i></div>';
      for (c = 0; c < COLS; c++) {
        h += '<div class="cell" data-i="' + (r * COLS + c) + '" role="button" tabindex="-1"><div class="cin"></div><div class="pv"></div><div class="fxl"></div></div>';
      }
      h += '<div class="tot cpu" title="CPUの合計"><b class="num">0</b><i class="delta"></i></div></div>';
    }
    var board = $('board');
    board.innerHTML = h;

    var cells = board.querySelectorAll('.cell');
    for (i = 0; i < cells.length; i++) {
      cellEl[i] = cells[i];
      cinEl[i] = cells[i].querySelector('.cin');
      pvEl[i] = cells[i].querySelector('.pv');
      fxlEl[i] = cells[i].querySelector('.fxl');
      bindCell(cells[i], i);
    }
    var rows = board.querySelectorAll('.brow:not(.bhead)');
    for (r = 0; r < rows.length; r++) totEl[r] = [rows[r].querySelector('.tot.me'), rows[r].querySelector('.tot.cpu')];
  }

  function bindCell(el, i) {
    el.addEventListener('mouseenter', function () { setHover(i); });
    el.addEventListener('mouseleave', function () { if (G.hover === i) setHover(-1); });
    el.addEventListener('focus', function () { setHover(i); });
    el.addEventListener('blur', function () { if (G.hover === i) setHover(-1); });
    el.addEventListener('click', function () { clickCell(i); });
    el.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); clickCell(i); }
    });
  }

  function setHover(i) {
    if (G.hover === i) return;
    G.hover = i;
    if (G.screen === 'play' && G.s) renderPreview();
  }

  /* ---------- 対戦画面を描く ---------- */

  function canAct() {
    var s = G.s;
    return G.screen === 'play' && !!s && s.phase === 'play' && !s.over && s.turn === 0 && !G.busy;
  }
  function placesFor(id) {
    return E.legalMoves(G.s, 0).filter(function (m) { return m.t === 'place' && m.id === id; });
  }
  function hasPlace() {
    return E.legalMoves(G.s, 0).some(function (m) { return m.t === 'place'; });
  }
  // 足ぶみできるマス(置ける札が無く、回数が残っている時だけ、エンジンが返す)
  function rescueCells() {
    return E.legalMoves(G.s, 0).filter(function (m) { return m.t === 'rescue'; }).map(function (m) { return m.i; });
  }
  function rescueLeft(p) {
    var s = G.s;
    return Math.max(0, (s.opts.rescue || 0) - ((s.rescued && s.rescued[p]) || 0));
  }
  // いまの盤面で人間が置ける札(番に関係なく、エンジンの手の一覧から決める。手札を薄くするかどうかに使う)
  function placeableIds() {
    var ok = {};
    E.legalMoves(G.s, 0).forEach(function (m) { if (m.t === 'place') ok[m.id] = 1; });
    return ok;
  }

  function renderScreen() {
    if (G.screen === 'map') renderMap();
    else if (G.screen === 'deck') renderDeck();
    else if (!G.s) return;
    else if (G.screen === 'mull') renderMull();
    else if (G.screen === 'play') renderAll();
  }

  function renderAll() {
    if (G.screen !== 'play' || !G.s) return;
    renderTop(); renderBoard(); renderPreview(); renderHand(); renderStatus(); renderLog();
  }

  function renderTop() {
    var s = G.s, sc = E.score(s), lanes = s.opts.scoring === 'lanes', p;
    for (p = 0; p < 2; p++) {
      setNum($('pts-' + p), sc.pts[p]);
      setText($('unit-' + p), lanes ? '列' : '点');
      setText($('sub-' + p), lanes ? '総計 ' + sc.sum[p] : '');
      setText($('deck-' + p), s.decks[p].length);
      setText($('hand-' + p), s.hands[p].length);
      setText($('res-' + p), rescueLeft(p));
      $('resbox-' + p).hidden = !s.opts.rescue;
      var side = $('side-' + p);
      side.classList.toggle('lead', sc.winner === p);
      side.classList.toggle('turn', !s.over && s.turn === p);
    }
    $('side-1').classList.toggle('thinking', G.busy && !s.over);
    setText($('who-1'), who(1));
    setText($('th-cpu'), who(1));
    setText($('pile-n'), s.decks[0].length);
    $('pile').classList.toggle('empty', !s.decks[0].length);
    setText($('rule-label'), lanes ? '得点: 取っている列の数' : '得点: 勝っている列の合計');
    var chips = (G.match.rival ? '<span>ライバル戦</span>' : '') + '<span>強さ: ' + LEVELS[G.match.level] + '</span>';
    if (s.opts.land) chips += '<span>土地</span>';
    if (s.opts.herdHunt) chips += '<span>群れと狩り</span>';
    setHtml($('rule-chips'), chips);
  }

  // 列の端の「勝っている側」の色。札が着地する時に合わせて替える
  function setLead(el, on) {
    el.__lead = on;
    if (el.classList.contains('lead') === on) return;
    if (fxActive() && G.numDelay > 0) FX.later(function () { el.classList.toggle('lead', el.__lead); }, G.numDelay);
    else el.classList.toggle('lead', on);
  }

  function renderBoard() {
    var s = G.s, sc = E.score(s), fx = G.fx, i, r, p;
    for (i = 0; i < N; i++) {
      var cell = s.cells[i], cls = 'cell', inner = '', label = cellName(i);
      if (cell.o >= 0) cls += ' own' + cell.o;
      if (cell.c) {
        cls += ' has';
        inner = bcardHtml(s, i);
        label += '。' + who(cell.c.o) + 'の' + E.CARDS[cell.c.id].name + '、大きさ ' + E.sizeAt(s, i);
      } else if (cell.o >= 0 && cell.f > 0) {
        inner = '<div class="feet o' + cell.o + '">' + feetIcons(cell.f) + '</div>';
        label += '。' + who(cell.o) + 'の足あと ' + cell.f;
      } else {
        label += '。空き';
      }
      if (fx) {
        if (fx.placed === i) cls += ' last last' + fx.p;
        if (fx.live) {
          if (fx.gained.indexOf(i) >= 0) cls += ' fx-gain fxp' + fx.p;
          if (fx.captured.indexOf(i) >= 0) cls += ' fx-cap';
        }
      }
      if (cellEl[i].className !== cls) cellEl[i].className = cls;
      setHtml(cinEl[i], inner);
      setAttr(cellEl[i], 'aria-label', label);
    }
    for (r = 0; r < ROWS; r++) {
      for (p = 0; p < 2; p++) {
        setNum(totEl[r][p].querySelector('.num'), sc.tot[r][p]);
        setLead(totEl[r][p], sc.lanes[r] === p);
      }
    }
  }

  // 置けるマスの光と、置く前の予告(足あとが付くマス、奪うマス、大きさが変わるカード、列の合計の増減)
  function renderPreview() {
    var s = G.s, id = null, cd = null, rescue = false, legal = {}, small = {}, pv = {}, html = {}, deltas = null, aim = -1, i, r, p;
    if (canAct()) {
      var moves = E.legalMoves(s, 0);
      if (G.sel >= 0 && G.sel < s.hands[0].length) {
        // 札を選んでいる: その札を置けるマス。小さく置くことになるマスは別に覚える
        id = s.hands[0][G.sel];
        cd = E.CARDS[id];
        moves.forEach(function (m) {
          if (m.t === 'place' && m.id === id) { legal[m.i] = 1; if (m.small) small[m.i] = 1; }
        });
      } else {
        // 札を選んでいない: 足ぶみできるマス(置ける札が無い時だけ、手の一覧に入っている)
        moves.forEach(function (m) { if (m.t === 'rescue') { legal[m.i] = 1; rescue = true; } });
      }
      if (legal[G.hover]) aim = G.hover;
    }
    // 二段構えの札を選んでいる間は、置けるマスごとに、置いた時の大きさを出す
    if (cd && cd.alt) {
      for (i = 0; i < N; i++) {
        if (!legal[i]) continue;
        var t = E.clone(s);
        E.applyMove(t, { t: 'place', id: id, i: i });
        html[i] = '<span class="badge ' + (small[i] ? 'small' : 'full') + '">大きさ' + E.sizeAt(t, i) + '</span>';
      }
    }
    if (aim >= 0) {
      var a = E.clone(s);
      E.applyMove(a, rescue ? { t: 'rescue', i: aim } : { t: 'place', id: id, i: aim });
      var info = a.last;
      if (!rescue) E.patternTargets(0, aim, id).forEach(function (k) { pv[k] = 'no'; });
      info.gained.forEach(function (k) { pv[k] = 'gain'; html[k] = '<span class="badge gain">' + icon('i-foot') + '+1</span>'; });
      info.captured.forEach(function (k) { pv[k] = 'cap'; html[k] = '<span class="badge cap">奪う</span>'; });
      for (i = 0; i < N; i++) {
        if (i === aim || !s.cells[i].c) continue;
        var d = E.sizeAt(a, i) - E.sizeAt(s, i);
        if (d) { pv[i] = 'size'; html[i] = '<span class="badge ' + (d > 0 ? 'up' : 'down') + '">' + (d > 0 ? '+' + d : '−' + (-d)) + '</span>'; }
      }
      if (!rescue) {
        var v = E.sizeAt(a, aim);
        pv[aim] = 'aim';
        html[aim] = '<div class="pv-card"><span class="g-name">' + esc(cd.name) + '</span>' +
          '<span class="g-size' + (v > cd.size ? ' up' : (v < cd.size ? ' down' : '')) + '">' + v + '</span>' +
          (info.small ? '<span class="g-note">小さく置く</span>' : '') + '</div>';
      }
      var s1 = E.score(s), s2 = E.score(a);
      deltas = [];
      for (r = 0; r < ROWS; r++) deltas.push([s2.tot[r][0] - s1.tot[r][0], s2.tot[r][1] - s1.tot[r][1]]);
    }
    for (i = 0; i < N; i++) {
      setAttr(cellEl[i], 'data-can', legal[i] ? '1' : null);
      setAttr(cellEl[i], 'data-small', small[i] ? '1' : null);
      setAttr(cellEl[i], 'data-pv', pv[i] || null);
      setAttr(cellEl[i], 'tabindex', legal[i] ? '0' : '-1');
      setHtml(pvEl[i], html[i] || '');
    }
    for (r = 0; r < ROWS; r++) {
      for (p = 0; p < 2; p++) {
        var dv = deltas ? deltas[r][p] : 0;
        setText(totEl[r][p].querySelector('.delta'), dv ? (dv > 0 ? '+' + dv : '−' + (-dv)) : '');
      }
    }
  }

  function renderHand() {
    var s = G.s, hand = s.hands[0], act = canAct(), ok = placeableIds(), h = '';
    if (G.sel >= hand.length) G.sel = -1;
    hand.forEach(function (id, k) {
      h += cardHtml(id, { h: k, sel: act && k === G.sel, dim: !s.over && !ok[id] });
    });
    var el = $('hand'), old = null, k;
    if (el.__h !== h && fxActive()) {
      // 描き直す前の位置を覚えておく(残った札は横へ滑り、新しい札は山から来る)
      old = {};
      for (k = 0; k < el.children.length; k++) old[el.children[k].getAttribute('data-id')] = el.children[k].getBoundingClientRect().left;
    }
    setHtml(el, h);
    el.classList.toggle('wait', !act);
    fitHand();
    if (old) moveHand(el, old);
  }

  function moveHand(el, old) {
    var pile = $('pile').getBoundingClientRect(), n = 0;
    for (var k = 0; k < el.children.length; k++) {
      var c = el.children[k], id = c.getAttribute('data-id'), r = c.getBoundingClientRect();
      if (old[id] === undefined) {
        FX.anim(c, [
          { transform: 'translate(' + (pile.left - r.left).toFixed(0) + 'px,' + (pile.top - r.top - 30).toFixed(0) + 'px) scale(.4) rotate(-8deg)', opacity: 0.2 },
          { transform: 'none', opacity: 1 }
        ], { duration: 320, delay: n * 80, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'backwards' });
        sound('draw', n * 80);
        n++;
      } else if (Math.abs(old[id] - r.left) > 1) {
        FX.anim(c, [{ transform: 'translateX(' + (old[id] - r.left).toFixed(0) + 'px)' }, { transform: 'none' }], { duration: 200, easing: 'cubic-bezier(.2,.8,.2,1)' });
      }
    }
  }

  // 手札が多くて入りきらない時は、重ねて並べる
  function fitHand() {
    var el = $('hand'), n = el.children.length, ov = 0;
    if (G.screen === 'play' && n > 1) {
      var w = el.children[0].offsetWidth, need = n * w + (n - 1) * 8, avail = el.clientWidth - 10;
      if (w > 0 && avail > 0 && need > avail) ov = Math.ceil((need - avail) / (n - 1));
    }
    el.style.setProperty('--ov', ov + 'px');
  }

  function renderStatus() {
    var s = G.s, chip, cls, msg, note = '', act = canAct(), can = act && hasPlace(), step = act && !can && rescueCells().length > 0;
    if (s.over) {
      chip = '終了'; cls = 'end'; msg = '対戦が終わりました。';
    } else if (!act) {
      chip = who(1) + 'の番'; cls = 'cpu'; msg = esc(who(1)) + 'が考えています<span class="dots"><i></i><i></i><i></i></span>';
    } else {
      chip = 'あなたの番'; cls = 'me';
      if (G.sel >= 0) msg = TOUCH ? '光っているマスをタップすると置きます。同じ札をもう一度タップで選び直し。' : '光っているマスをクリックすると置きます。Esc で選び直し。';
      else if (can) msg = '手札から、置く札を選んでください。';
      else if (step) msg = '置けるマスがありません。足ぶみができます(あと' + rescueLeft(0) + '回)。光っているマスを選ぶと、足あとを1つ付けます。';
      else msg = '置ける札がありません。「パス」を押してください。';
      if (s.passes === 1) note = who(1) + 'はパスしました。あなたもパスすると終わります。';
    }
    if (G.hint) msg = esc(G.hint);
    var chipEl = $('turn-chip');
    setText(chipEl, chip);
    chipEl.className = 'turn-chip ' + cls;
    setHtml($('status-msg'), msg);
    setText($('status-note'), note);

    var pass = $('btn-pass');
    pass.disabled = !act;
    pass.classList.toggle('urge', act && !can && !step);
    $('btn-undo').disabled = G.busy || !G.records.length;
    $('btn-result').hidden = !(s.over && G.result && !ovOpen('ov-result'));
  }

  function addLog(p, text, extra, n) { G.log.push({ p: p, n: n || 0, text: text, extra: extra || '' }); }

  function renderLog() {
    var h = '';
    G.log.forEach(function (e) {
      var cls = e.p === 0 ? 'p0' : (e.p === 1 ? 'p1' : 'sys');
      var t = (e.p >= 0 ? '<b>' + esc(who(e.p)) + '</b>: ' : '') + esc(e.text);
      h += '<li class="' + cls + '"><span class="n">' + (e.n || '') + '</span><span class="t">' + t +
        (e.extra ? '<small>' + esc(e.extra) + '</small>' : '') + '</span></li>';
    });
    var el = $('log');
    if (el.__h !== h) { setHtml(el, h); el.scrollTop = el.scrollHeight; }
  }

  function hint(text) {
    G.hint = text;
    renderStatus();
    clearTimeout(G.hintTimer);
    G.hintTimer = setTimeout(function () {
      G.hint = '';
      if (G.screen === 'play' && G.s) renderStatus();
    }, HINT_MS);
  }

  /* ---------- 手を打つ ---------- */

  // 直前の手の目印(置いたマスの枠と、増えた足あとのマスの色)。演出を切っていても出す
  function setFx(info) {
    var fx = {
      p: info.p,
      placed: info.move.t === 'pass' ? -1 : info.move.i,
      gained: info.gained, captured: info.captured,
      live: true
    };
    G.fx = fx;
    clearTimeout(G.fxTimer);
    G.fxTimer = setTimeout(function () {
      if (G.fx !== fx) return;
      fx.live = false;
      if (G.screen === 'play' && G.s) renderBoard();
    }, FX_MS);
  }

  // 札が飛び立つ場所: 人間は手札の札、CPU は上の「手札」の数字のあたり
  function sourceRect(p, id) {
    var el = p === 0 ? $('hand').querySelector('.card[data-id="' + id + '"]') : null, r;
    if (el) return el.getBoundingClientRect();
    r = (p === 0 ? $('pile') : $('hand-1')).getBoundingClientRect();
    return { left: r.left + r.width / 2 - 35, top: r.top + r.height / 2 - 48, width: 70, height: 96 };
  }

  // 奪ったマス: 相手の色の足あとが弾けて消える(下には、もう自分の足あとが描いてある)
  function burstFx(k, delay, before, p) {
    FX.temp(fxlEl[k], '<div class="old o' + (1 - p) + '" style="--sd:' + delay + 'ms">' + feetIcons(before.cells[k].f) + '</div>', delay + 760);
    sound('capture', delay + 120);
  }

  /* 手の演出。画面はもう「打った後の形」になっている。
     pre: カットインの時間(重さ3をもとの大きさで置く時だけ)、flyMs: 札が飛ぶ時間(置く手だけ)。
     光と粒(spark)は、時刻をずらして先に全部頼んでおく */
  function playMoveFx(before, info, src, flyMs, pre) {
    var s = G.s, m = info.move, p = info.p, S = sp(), UP = -Math.PI / 2, i, d, c, q;
    if (m.t === 'pass') { sound('pass'); return; }

    if (m.t === 'rescue') {
      // 足ぶみ: 踏みつけて、輪と土けむりが広がる
      c = mid(cellEl[m.i]);
      cellEl[m.i].style.setProperty('--sd', '0ms');
      FX.mark(cellEl[m.i], 'data-stamp', 'step', 520);
      if (info.captured.length) burstFx(m.i, 0, before, p);
      FX.shake(cellEl[m.i], 3, 300);
      if (S) {
        S.ring(c.x, c.y, { color: pcol(p), r0: 8, r1: c.w * 0.8, width: 4, life: 0.45, delay: 130 });
        S.dust(c.x, c.y + c.h * 0.3, { n: 10, w: c.w * 0.8, delay: 130 });
        if (info.captured.length) {
          S.burst(c.x, c.y, { kind: 'shard', n: 9, color: pcol(1 - p), speed: 230, life: 0.6, delay: 110 });
          S.text(c.x, c.y - c.h * 0.5, '奪った!', { color: pcol(p), size: 24, delay: 260 });
        }
      }
      sound('step', 130);
      return;
    }

    // 重さ: 小さく置いた時は、小さい方の重さで扱う(ふつうの演出)。重さ3をそのまま置いた時だけ特別扱い
    var cd = E.CARDS[m.id], w = info.small ? cd.alt.w : cd.w, big = w >= 3, tl = pre + flyMs;
    c = mid(cellEl[m.i]);
    // 札が飛んで、着地で沈む。重い札ほど深く。重さ3は、カットインの後に、画面ごと揺れる
    var landed = function () {
      cellEl[m.i].removeAttribute('data-fly');
      FX.mark(cellEl[m.i], 'data-land', big ? 'big' : String(w), 460);
      if (big) FX.shake($('scr-play'), 9, 520);
      else if (w === 2) FX.shake($('board'), 3, 220);
    };
    var takeoff = function () {
      if (src) FX.fly(bcardHtml(s, m.i), src, cellEl[m.i], flyMs, landed); else landed();
    };
    if (pre) { cutIn(m.id, p, E.sizeAt(s, m.i)); FX.later(takeoff, pre); } else takeoff();
    if (big) sound('big', tl); else sound(p === 0 ? 'place' : 'cpu', tl, w);
    if (S) {
      var by = c.y + c.h * 0.42;
      if (big) {
        S.flash({ color: '#ffffff', alpha: 0.5, life: 0.28, delay: tl });
        S.ring(c.x, c.y, { color: '#ffffff', r1: 200, width: 6, life: 0.5, delay: tl });
        S.ring(c.x, c.y, { color: pcol(p), r1: 320, width: 4, life: 0.65, delay: tl + 70 });
        S.dust(c.x, by, { n: 18, w: 200, size: 22, life: 0.9, delay: tl });
        S.burst(c.x, by, { kind: 'spark', n: 36, colors: [pcol(p), COL.glow, '#ffffff'], speed: 540, spread: Math.PI, angle: UP, life: 0.7, delay: tl });
      } else if (w === 2) {
        S.ring(c.x, c.y, { color: pcol(p), r1: 105, width: 4, life: 0.4, delay: tl });
        S.dust(c.x, by, { n: 10, w: 90, delay: tl });
        S.burst(c.x, by, { kind: 'spark', n: 12, colors: [pcol(p), '#ffffff'], speed: 300, spread: Math.PI, angle: UP, life: 0.5, delay: tl });
      } else {
        S.dust(c.x, by, { n: 6, w: 56, size: 12, delay: tl });
        S.burst(c.x, by, { kind: 'spark', n: 6, colors: [pcol(p), '#ffffff'], speed: 200, spread: Math.PI, angle: UP, life: 0.4, delay: tl });
      }
    }

    // 足あと: 着地の後、近いマスから1つずつ押される。付くたびに、その人の色の小さな光。奪う時は相手の色がはじける
    var order = info.gained.slice().sort(function (x, y) { return dist(x, m.i) - dist(y, m.i) || x - y; });
    order.forEach(function (k, n) {
      var cap = info.captured.indexOf(k) >= 0;
      d = tl + 70 + n * 85;
      cellEl[k].style.setProperty('--sd', d + 'ms');
      FX.mark(cellEl[k], 'data-stamp', '1', d + 400);
      if (cap) burstFx(k, d, before, p); else sound('stamp', d, n);
      if (S) {
        q = mid(cellEl[k]);
        S.burst(q.x, q.y, { n: 6, color: pcol(p), speed: 110, life: 0.45, size: 3, delay: d + 60 });
        if (cap) S.burst(q.x, q.y, { kind: 'shard', n: 9, color: pcol(1 - p), speed: 230, life: 0.6, delay: d + 110 });
      }
    });
    if (S && info.captured.length) {
      // 文字は、奪ったマスのまん中に出す
      var sx = 0, sy = 0;
      info.captured.forEach(function (k) { q = mid(cellEl[k]); sx += q.x; sy += q.y; });
      S.text(sx / info.captured.length, sy / info.captured.length - c.h * 0.1, info.captured.length >= 2 ? info.captured.length + 'マス奪った!' : '奪った!',
        { color: pcol(p), size: 26, delay: tl + 300 });
    }

    // 大きさが変わった札: 狩りで減る(爪あと)、群れで増える(緑のきらめき)。揺れて、数字が動く
    d = tl + 160;
    for (i = 0; i < N; i++) {
      if (i === m.i || !s.cells[i].c || !before.cells[i].c) continue;
      var v0 = E.sizeAt(before, i), v1 = E.sizeAt(s, i);
      if (v0 === v1) continue;
      var up = v1 > v0, el = cellEl[i].querySelector('.b-size');
      FX.temp(fxlEl[i], '<span class="float ' + (up ? 'up' : 'down') + '" style="--sd:' + d + 'ms">' + (up ? '+' + (v1 - v0) : '−' + (v0 - v1)) + '</span>', d + 1050);
      FX.mark(cellEl[i], 'data-pop', up ? 'up' : 'down', 420, d);
      if (el) { el.textContent = String(v0); FX.count(el, v1, 360, d + 80); }
      if (S) {
        q = mid(cellEl[i]);
        if (up) S.burst(q.x, q.y, { kind: 'star', n: 12, colors: [COL.good, '#ffffff'], speed: 170, life: 0.8, delay: d });
        else S.slash(q.x, q.y, { color: '#ff5a4a', n: 3, len: q.w * 0.7, life: 0.45, delay: d });
      }
      sound(up ? 'up' : 'hunt', d);
    }

    // 列の優勢が入れ替わった時: その列に光の帯、合計の数字がはねる。相手から取り返した時は「逆転!」
    var l0 = E.score(before).lanes, l1 = E.score(s).lanes;
    for (i = 0; i < ROWS; i++) {
      if (l0[i] === l1[i]) continue;
      if (l1[i] !== 1) FX.mark(totEl[i][0], 'data-flip', '1', 950, tl + 60);
      if (l1[i] !== 0) FX.mark(totEl[i][1], 'data-flip', '1', 950, tl + 60);
      if (S) {
        var rr = totEl[i][0].parentNode.getBoundingClientRect();
        S.sweep({ left: rr.left, top: rr.top, w: rr.width, h: rr.height }, { color: l1[i] >= 0 ? pcol(l1[i]) : '#ffffff', life: 0.55, dir: l1[i] === 1 ? -1 : 1, delay: tl + 60 });
        if (l1[i] === p && l0[i] === 1 - p) {
          // 列のまん中に大きく。「奪った!」と重ならないよう、少し後に出す
          S.text(rr.left + rr.width / 2, rr.top + rr.height / 2, '逆転!', { color: pcol(p), size: 38, delay: tl + (info.captured.length ? 760 : 160) });
          sound('up', tl + (info.captured.length ? 760 : 160));
        }
      }
    }
  }
  function dist(a, b) { return Math.abs(((a / COLS) | 0) - ((b / COLS) | 0)) + Math.abs(a % COLS - b % COLS); }

  // 演出なしの時の音(その場で鳴らす)
  function plainSounds(m, info, p) {
    if (m.t === 'pass') { sound('pass'); return; }
    if (m.t === 'rescue') sound('step');
    else sound(p === 0 ? 'place' : 'cpu', 0, info.small ? E.CARDS[m.id].alt.w : E.CARDS[m.id].w);
    if (info.captured.length) sound('capture');
    if (info.hunted >= 0) sound('hunt');
  }

  // 人間と CPU の両方の手がここを通る
  function commitMove(m) {
    var s = G.s, p = s.turn, n = s.ply + 1, fx = fxActive();
    var before = E.clone(s);          // 打つ前の局面(記録と、演出の「前の姿」に使う)
    if (p === 0) {
      G.records.push({ ply: n, before: before, move: m, logLen: G.log.length, done: false, diff: 0, best: null });
      queueAnalysis();
    }
    var src = fx && m.t === 'place' ? sourceRect(p, m.id) : null;
    E.applyMove(s, m);
    var info = s.last;
    if (m.t === 'pass') {
      addLog(p, 'パス', '', n);
    } else if (m.t === 'rescue') {
      // 足ぶみ: カードは置かない(m.id は無い)
      addLog(p, '足ぶみ(' + cellName(m.i) + ')' + (info.captured.length ? '。足あとを奪った' : ''), '', n);
    } else {
      var extra = [];
      if (info.small) extra.push('小さく置いた: 大きさ' + E.sizeAt(s, m.i));
      if (info.captured.length) extra.push('足あとを' + info.captured.length + 'マス奪った');
      if (info.hunted >= 0) extra.push('狩り: ' + E.CARDS[s.cells[info.hunted].c.id].name + 'が小さくなった');
      addLog(p, E.CARDS[m.id].name + 'を' + cellName(m.i) + 'に', extra.join('、'), n);
    }
    G.sel = -1;
    G.hint = '';
    setFx(info);

    if (!fx) {
      plainSounds(m, info, p);
      nextTurn();
      return;
    }
    // 演出あり: 先に画面を打った後の形にし(飛んでいる間、置いた札は隠す)、その上に動きを重ねる
    // 重さ3をもとの大きさで置く時は、先にカットイン(約0.9秒)を入れる
    var flyMs = m.t === 'place' ? 240 + E.CARDS[m.id].w * 40 : 0;
    var pre = m.t === 'place' && E.CARDS[m.id].w >= 3 && !info.small ? 900 : 0;
    if (src) cellEl[m.i].setAttribute('data-fly', '1');
    G.numDelay = pre + flyMs;
    G.fxUntil = Date.now() + pre + flyMs + (m.t === 'pass' ? 0 : 120 + info.gained.length * 85 + 300);
    nextTurn();
    G.numDelay = 0;
    playMoveFx(before, info, src, flyMs, pre);
  }

  function nextTurn() {
    var s = G.s;
    if (s.over) { finish(); return; }
    if (s.turn === 1) { cpuTurn(); return; }
    G.busy = false;
    renderAll();
    if (fxActive()) FX.banner('あなたの番', 'me');
  }

  function cpuTurn() {
    G.busy = true;
    G.sel = -1;
    renderAll();
    var token = G.token, wait = G.cpuDelay;
    var run = function () {
      if (token !== G.token) return;
      var m;
      try { m = AI.chooseMove(G.s, 1, G.match.level, G.cpuRand); }
      catch (e) { m = { t: 'pass' }; if (window.console) console.error(e); }
      commitMove(m || { t: 'pass' });
    };
    if (fxActive()) {
      FX.banner(esc(who(1)) + 'の番', 'cpu');
      wait = Math.max(wait, G.fxUntil - Date.now() + 160);   // 自分の手の演出が済んでから打つ
    }
    if (wait > 0) G.cpuTimer = setTimeout(run, wait); else run();
  }

  function selectCard(h) {
    if (!canAct()) return false;
    h = h | 0;
    var id = G.s.hands[0][h];
    if (id === undefined) return false;
    if (G.sel === h) { G.sel = -1; refreshSel(); return true; }      // もう一度クリックで選択解除
    if (!placesFor(id).length) {
      sound('error');
      hint('「' + E.CARDS[id].name + '」は、いまは置けません(足あとが' + minWeight(E.CARDS[id]) + 'つ以上あるマスが要ります)。');
      return false;
    }
    G.sel = h;
    G.hint = '';
    sound('select');
    refreshSel();
    return true;
  }
  function refreshSel() { renderHand(); renderPreview(); renderStatus(); }

  function clickCell(i) {
    if (!canAct()) return false;
    i = i | 0;
    if (G.sel < 0) {
      // 札を選んでいない時: 足ぶみできるなら足ぶみ
      var steps = rescueCells();
      if (!steps.length) { hint('先に、手札から置く札を選んでください。'); return false; }
      if (steps.indexOf(i) < 0) { sound('error'); hint('そのマスでは足ぶみできません。光っているマスを選んでください。'); return false; }
      commitMove({ t: 'rescue', i: i });
      return true;
    }
    var id = G.s.hands[0][G.sel];
    var mv = placesFor(id).filter(function (m) { return m.i === i; })[0];
    if (!mv) { sound('error'); hint('そのマスには置けません。光っているマスを選んでください。'); return false; }
    commitMove(mv);          // 小さく置く手には small: true が付いている
    return true;
  }

  function doPass() {
    if (!canAct()) return false;
    commitMove({ t: 'pass' });
    return true;
  }

  // 画面の「パス」ボタン。置ける手や足ぶみがあるのにパスする時は確かめる
  function onPassButton() {
    if (!canAct()) return;
    var end = G.s.passes === 1 ? 'いまパスすると対戦が終わります。' : '';
    if (hasPlace()) askConfirm('まだ置ける札があります。' + end + 'パスしますか?', 'パスする', doPass);
    else if (rescueCells().length) askConfirm('足ぶみができます(あと' + rescueLeft(0) + '回)。' + end + 'パスしますか?', 'パスする', doPass);
    else doPass();
  }

  /* ---------- 一手戻す、やり直す ---------- */

  // k 番目の人間の手を打つ前の局面に戻す(演出は出さない)
  function restoreTo(k) {
    var rec = G.records[k];
    if (!rec) return false;
    stopTimers();
    fxClear();
    G.s = E.clone(rec.before);
    G.log.length = rec.logLen;
    G.records.length = k;
    G.sel = -1; G.busy = false; G.fx = null; G.hint = ''; G.result = null;
    closeOv('ov-result'); closeOv('ov-confirm');
    show('play');
    G.instant = true;
    renderAll();
    G.instant = false;
    return true;
  }

  function undo() {
    if (G.busy || !G.records.length) return false;
    return restoreTo(G.records.length - 1);
  }

  function retryTurning() {
    if (!G.result || !G.result.turning) return false;
    return restoreTo(G.result.turning.k);
  }

  /* ---------- 分かれ目の分析 ---------- */

  function analyzeRecord(rec) {
    if (rec.done) return;
    rec.done = true;
    try {
      if (E.legalMoves(rec.before, 0).length <= 1) return;       // パスしか無かった
      var rand = G.fixed ? E.makeRng((G.seed * 31 + rec.ply * 7919) | 0) : Math.random;
      var list = AI.analyze(rec.before, 0, rand, ANALYZE_SAMPLES), mine = null;
      for (var j = 0; j < list.length; j++) if (sameMove(list[j].m, rec.move)) { mine = list[j]; break; }
      if (list.length && mine) { rec.best = list[0].m; rec.diff = list[0].v - mine.v; }
    } catch (e) { rec.diff = 0; rec.best = null; }
  }

  // 重いので、手を打った後の空き時間に1つずつ(演出の最中は避ける)
  function queueAnalysis() {
    if (G.anTimer) return;
    G.anTimer = setTimeout(function step() {
      G.anTimer = 0;
      var rest = G.records.filter(function (r) { return !r.done; });
      if (!rest.length) return;
      if (Date.now() < G.fxUntil) { G.anTimer = setTimeout(step, 200); return; }
      analyzeRecord(rest[0]);
      if (rest.length > 1) G.anTimer = setTimeout(step, 60);
    }, 150);
  }

  function flushAnalysis() { G.records.forEach(analyzeRecord); }

  function moveDid(m) {
    if (m.t === 'pass') return 'パスしました。';
    if (m.t === 'rescue') return cellName(m.i) + 'で足ぶみをしました。';
    return '『' + E.CARDS[m.id].name + '』を' + cellName(m.i) + 'に' + (m.small ? '小さく' : '') + '置きました。';
  }
  function moveBetter(m) {
    if (m.t === 'pass') return 'パスするほうが有利でした。';
    if (m.t === 'rescue') return cellName(m.i) + 'で足ぶみをするほうが有利でした。';
    return '『' + E.CARDS[m.id].name + '』を' + cellName(m.i) + 'に' + (m.small ? '小さく' : '') + '置くほうが有利でした。';
  }

  function findTurning() {
    var best = null;
    G.records.forEach(function (r, k) {
      if (r.best && r.diff > TURNING_MIN && (!best || r.diff > best.diff)) {
        best = { k: k, ply: r.ply, diff: r.diff, text: r.ply + '手目: ' + moveDid(r.move) + moveBetter(r.best) };
      }
    });
    return best;
  }

  /* ---------- 終わりと結果 ---------- */

  function finish() {
    var fx = fxActive();
    G.busy = false;
    G.sel = -1;
    flushAnalysis();
    G.result = { sc: E.score(G.s), turning: findTurning(), reward: null, practice: false };
    // ごほうびは1戦に1回だけ。一手戻して終わり直した時や、分かれ目からやり直した時は、練習として扱う
    if (!G.rewarded) {
      G.rewarded = true;
      try {
        G.result.reward = K.finishGame(K.summarize(G.s, 0, { level: G.match.level, rivalId: G.match.rival ? G.match.rival.id : null }));
      } catch (e) { if (window.console) console.error(e); }
      // 地図に戻った時に、新しく開いた場所と、初めて勝った相手を光らせる
      var rw = G.result.reward;
      if (rw) {
        rw.unlocked.forEach(function (u) { NEWLY[u.key] = 1; });
        if (rw.firstWin && G.match.rival) NEWLY[G.match.rival.id] = 1;
      }
    } else {
      G.result.practice = true;
    }
    renderAll();
    var token = G.token;
    var open = function () {
      if (token !== G.token) return;
      openResult(true);
    };
    if (G.cpuDelay <= 0) { open(); return; }
    // 最後の手の演出が済んでから、「そこまで!」を打ち込んで、結果へ
    G.endTimer = setTimeout(function () {
      if (token !== G.token) return;
      if (fxActive()) endStamp(open); else open();
    }, fx ? Math.max(350, G.fxUntil - Date.now() + 250) : END_DELAY);
  }

  function headText(w) { return w === 0 ? 'あなたの勝ち' : (w === 1 ? 'あなたの負け' : '引き分け'); }
  function headClass(w) { return w === 0 ? 'win' : (w === 1 ? 'lose' : 'tie'); }

  function resultHtml() {
    var s = G.s, sc = G.result.sc, w = sc.winner, lanes = s.opts.scoring === 'lanes', r, h;
    h = '<div class="r-rays"></div><div class="r-head ' + headClass(w) + '" id="result-head">' + headText(w) + '</div>';
    h += '<div class="r-pts"><b class="p0">' + sc.pts[0] + '</b><i>対</i><b class="p1">' + sc.pts[1] + '</b></div>';
    if (lanes) {
      h += '<div class="r-cap">取った列の数' +
        (sc.won[0] === sc.won[1] ? '(同じ数なので、大きさの総計 ' + sc.sum[0] + ' 対 ' + sc.sum[1] + ' で決まりました)' : '') + '</div>';
    } else {
      h += '<div class="r-cap">勝った列の合計</div>';
    }
    h += '<table><thead><tr><th>列</th><th>あなた</th><th>' + esc(who(1)) + '</th><th>取った側</th></tr></thead><tbody>';
    for (r = 0; r < ROWS; r++) {
      var ln = sc.lanes[r];
      h += '<tr><td class="land l' + r + '">' + icon('i-land-' + r) + LANDS[r] + '</td>' +
        '<td class="' + (ln === 0 ? 'win0' : '') + '">' + sc.tot[r][0] + '</td>' +
        '<td class="' + (ln === 1 ? 'win1' : '') + '">' + sc.tot[r][1] + '</td>' +
        '<td class="' + (ln >= 0 ? 'win' + ln : '') + '">' + (ln >= 0 ? esc(who(ln)) : '同点') + '</td></tr>';
    }
    h += '</tbody><tfoot><tr><td class="land">大きさの総計</td><td>' + sc.sum[0] + '</td><td>' + sc.sum[1] + '</td><td></td></tr></tfoot></table>';

    if (w !== 0) {
      var t = G.result.turning;
      h += '<div class="turning"><h3>分かれ目の一手</h3>';
      if (t) {
        h += '<p>' + esc(t.text) + '</p><div class="actions"><button type="button" class="btn" data-act="retry">その場面からやり直す</button></div>';
      } else {
        h += '<p>大きな分かれ目は見つかりませんでした。</p>';
      }
      h += '</div>';
    }
    h += rewardHtml();
    var rw = G.result.reward, got = !!rw && rewardCards(rw).some(function (c) { return c.added; });
    h += '<div class="actions center">' +
      '<button type="button" class="btn ghost" data-act="board">盤面を見る</button>' +
      '<button type="button" class="btn" data-act="map">地図へ</button>' +
      (got ? '<button type="button" class="btn" data-act="deck">デッキを組む</button>' : '') +
      '<button type="button" class="btn primary" data-act="again">もう一度</button></div>';
    h += '<div class="seed">種: ' + G.seed + '</div>';
    return h;
  }

  /* ごほうび(K.finishGame の戻り値)の表示 */

  // もらったカード: ライバルの切り札と、課題のごほうび
  function rewardCards(rw) {
    var a = rw.cards.slice();
    rw.tasks.forEach(function (t) { if (t.card) a.push(t.card); });
    return a;
  }
  function gotWord(c) { return c.added ? (c.isNew ? '新しいカード' : '2枚目') : '化石に替わった'; }
  function gotHtml(c) {
    return '<div class="got">' + miniHtml(c.id) + '<div><b>' + gotWord(c) + '</b><span>' + esc(E.CARDS[c.id].name) +
      (c.added ? '' : '(もう上限まで持っているので、化石' + c.fossils + 'こ)') + '</span></div></div>';
  }
  // 課題などのごほうびを言葉にする。rw: { fossils, card(id か、もらった結果), title }
  function rewardWords(rw) {
    var a = [];
    if (rw.fossils) a.push('化石+' + rw.fossils);
    if (rw.card) a.push('カード「' + E.CARDS[typeof rw.card === 'string' ? rw.card : rw.card.id].name + '」');
    if (rw.title) a.push('称号「' + rw.title + '」');
    return a.join('、');
  }
  function rewardHtml() {
    var res = G.result, rw = res.reward, cards, lines = [], lands = {}, names = [], h;
    if (res.practice) return '<div class="rewards practice">やり直しは練習です。ごほうびは出ません。</div>';
    if (!rw) return '';
    cards = rewardCards(rw);
    h = '<div class="rewards"><h3>ごほうび</h3>' +
      '<div class="rw-fossil">' + icon('i-fossil') + '化石 <b>+<span id="rw-total">' + rw.total + '</span></b>' +
      (rw.total ? '' : '<small>(' + K.MIN_PLACED + '枚以上置くと、勝てなくても' + K.LOSE_FOSSILS + 'こもらえます)</small>') + '</div>';
    if (cards.length) h += '<div class="rw-cards">' + cards.map(gotHtml).join('') + '</div>';
    rw.tasks.forEach(function (t) {
      lines.push('<li>課題「<b>' + esc(t.name) + '</b>」を達成(' + esc(t.text) + '): ' + esc(rewardWords(t)) + '</li>');
    });
    // 新しく開いた場所。土地が開いた時は、その土地のライバルの名前は並べない
    rw.unlocked.forEach(function (u) { if (/^land\d$/.test(u.key)) lands[+u.key.slice(4)] = 1; });
    rw.unlocked.forEach(function (u) {
      var r = K.RIVAL[u.key];
      if (!r || !lands[r.land]) names.push(esc(u.name));
    });
    if (names.length) lines.push('<li>新しく開いた場所: <b>' + names.join('、') + '</b></li>');
    if (rw.eased) lines.push('<li>次は、相手が少し手加減します(強さ: ' + LEVELS[rw.eased] + ')。</li>');
    if (lines.length) h += '<ul class="rw-list">' + lines.join('') + '</ul>';
    return h + '</div>';
  }

  // first: 終わった直後に開く時だけ true(列ごとに順に見せ、最後に勝ち負けを出す)
  function openResult(first) {
    if (!G.result) return;
    var body = $('result-body'), w = G.result.sc.winner, seq = first === true && fxActive();
    if (first !== true) fxClear();
    body.__h = null;
    setHtml(body, resultHtml());
    body.classList.toggle('lost', w === 1);
    body.classList.remove('won');
    openOv('ov-result');
    renderStatus();
    if (seq) resultSeq(body);
    else if (first === true) sound(w === 0 ? 'win' : (w === 1 ? 'lose' : 'tie'));
  }

  function resultSeq(body) {
    var sc = G.result.sc, w = sc.winner, token = G.token, t = 220, k;
    var rows = body.querySelectorAll('tbody tr'), foot = body.querySelector('tfoot tr'), head = $('result-head');
    var p0 = body.querySelector('.r-pts .p0'), p1 = body.querySelector('.r-pts .p1'), turning = body.querySelector('.turning');
    var rewards = body.querySelector('.rewards'), total = $('rw-total'), gots = body.querySelectorAll('.got');
    var alive = function () { return token === G.token && ovOpen('ov-result'); };
    head.className = 'r-head wait';
    head.textContent = '結果';
    p0.textContent = '0'; p1.textContent = '0';
    for (k = 0; k < rows.length; k++) rows[k].classList.add('hid');
    foot.classList.add('hid');
    if (turning) turning.classList.add('hid');
    if (rewards) rewards.classList.add('hid');
    if (total) total.textContent = '0';
    // 列ごとに順に、ドンと入る。取った側の色の小さな火花
    for (k = 0; k < rows.length; k++) {
      (function (tr, n) {
        FX.later(function () {
          if (!alive()) return;
          var S = sp(), ln = sc.lanes[n], q;
          if (n > 0) rows[n - 1].classList.remove('now');
          tr.classList.remove('hid'); tr.classList.add('now');
          if (w !== 1) FX.shake(body, 3, 180);
          if (S && ln >= 0 && w !== 1) {
            q = mid(tr.children[ln + 1]);
            S.burst(q.x, q.y, { kind: 'spark', n: 10, colors: [pcol(ln), '#ffffff'], speed: 240, life: 0.45 });
          }
          sound('tick', 0, n);
        }, t);
      })(rows[k], k);
      t += 420;
    }
    // 総計、得点の数え上げ、最後に勝ち負け
    FX.later(function () {
      if (!alive()) return;
      rows[rows.length - 1].classList.remove('now');
      foot.classList.remove('hid');
      FX.count(p0, sc.pts[0], 520, 150);
      FX.count(p1, sc.pts[1], 520, 150);
    }, t);
    t += 800;
    // 勝ち: 見出しが打ち込まれ、後光と紙吹雪。引き分け: 輪が1つ。負け: 静かに
    FX.later(function () {
      if (!alive()) return;
      var S = sp(), q;
      head.className = 'r-head pop ' + headClass(w);
      head.textContent = headText(w);
      if (turning) turning.classList.remove('hid');
      sound(w === 0 ? 'win' : (w === 1 ? 'lose' : 'tie'));
      if (!S) return;
      q = mid(head);
      if (w === 0) {
        FX.shake(body, 6, 320);
        body.classList.add('won');           // 見出しの後ろに、回る後光(文字が読めるよう、窓の中に置く)
        S.flash({ color: '#fff6d0', alpha: 0.3, life: 0.3 });
        S.ring(q.x, q.y, { color: '#ffffff', r1: 260, width: 5, life: 0.5 });
        S.burst(q.x, q.y, { kind: 'star', n: 32, colors: [COL.glow, '#ffffff'], speed: 440, life: 1.0 });
        S.confetti({ n: 170 });
      } else if (w < 0) {
        S.ring(q.x, q.y, { color: '#cfd6dc', r1: 190, width: 3, life: 0.5 });
      }
    }, t);
    // ごほうび: 化石の粒が数字へ飛んでから数え上がる。もらったカードは、大きく見せる
    t += 620;
    FX.later(function () {
      if (!alive() || !rewards) return;
      var S = sp(), rw = G.result.reward, tot = rw ? rw.total : 0, cards = rw ? rewardCards(rw) : [], a, b;
      rewards.classList.remove('hid');
      if (total) {
        if (S && tot > 0) {
          a = mid(head); b = mid(total);
          S.trail(a.x, a.y + 34, b.x, b.y, { n: Math.min(14, 4 + tot), color: COL.gold, life: 0.5, stagger: 36, arc: 50 });
        }
        FX.count(total, tot, 600, 420);
      }
      for (var q = 0; q < gots.length; q++) FX.mark(gots[q], 'data-rev', '1', 750, 250 + q * 300);
      if (cards.some(function (c) { return c.added; })) {
        FX.later(function () { if (alive() && !STAGE.kind) cardShow(cards); }, 1150);
      }
    }, t);
  }

  function closeResult() {
    fxClear();
    closeOv('ov-result');
    if (G.screen === 'play' && G.s) renderStatus();
  }

  /* ==========================================================================
     カード集め(規則と保存は collection.js。ここは表示と操作だけ)
     ========================================================================== */

  var RV = null;     // ライバルの窓で見ている相手
  var DG = null;     // 発掘の窓の様子 { land, phase: 'ask' | 'offer' | 'got', offer, got, tasks, msg, resumed }
  var DK = null;     // デッキ編成の様子 { slot, ids(組んでいる途中), snap(開いた時の形), focus(大きく出している札), msg }
  var NEWLY = {};    // 直前の対戦で新しく開いた場所や、勝った相手(地図で1回だけ光らせる)

  var LIST_INDEX = {};
  C.LIST.forEach(function (c, k) { LIST_INDEX[c.id] = k; });
  // 重さ → 図鑑の順
  function sortIds(ids) {
    return ids.slice().sort(function (a, b) { return (E.CARDS[a].w - E.CARDS[b].w) || (LIST_INDEX[a] - LIST_INDEX[b]); });
  }
  function cardTip(cd) {
    return cd.name + ': 重さ ' + cd.w + '、大きさ ' + cd.size + (cd.alt ? '(足あと' + cd.alt.w + 'のマスなら' + cd.alt.size + ')' : '') +
      '、' + DIETS[cd.diet] + '、' + LANDS[cd.land] + 'が得意';
  }
  // 小さいカード(一覧、ごほうび)
  function miniHtml(id) {
    var cd = E.CARDS[id];
    return '<span class="mini land-' + cd.land + (cd.alt ? ' alt' : '') + '" title="' + esc(cardTip(cd)) + '">' + artHtml(id) +
      '<span class="m-w">' + feetIcons(cd.w) + '</span><span class="m-size">' + cd.size + '</span>' +
      '<span class="m-name">' + esc(cd.name) + '</span></span>';
  }
  // ライバルの印: 切り札の恐竜の絵を丸枠で
  function rivalPic(r, cls) {
    return '<span class="rv-pic land-' + E.CARDS[r.card].land + (cls ? ' ' + cls : '') + '">' + artHtml(r.card) + '</span>';
  }
  // その土地の発掘で、まだ出るカードの枚数
  function digLeft(land) {
    return K.digPool(land).reduce(function (a, id) { return a + C.maxCopies(id) - K.owned(id); }, 0);
  }
  function costWord(cost) { return cost ? '化石 ' + cost + 'こ' : '最初の1回はただ'; }

  /* ---------- 探検の地図 ---------- */

  function toMap() {
    stopTimers();
    fxClear();
    G.busy = false;
    closeAllOv();
    show('map');
    renderMap();
    return true;
  }

  function renderMap() {
    var st = K.get(), cnt = K.count(), h = '', land, newly = NEWLY, fx = fxActive() && G.screen === 'map';
    var fos = $('st-fossils'), had = parseInt(fos.textContent, 10) || 0;
    if (fx && st.fossils > had && G.mapShown) {
      // 増えた化石は、粒が数へ飛んでから数え上がる
      var S0 = sp(), fq = mid(fos);
      if (S0) S0.trail(window.innerWidth / 2, window.innerHeight * 0.55, fq.x, fq.y, { n: Math.min(16, 5 + st.fossils - had), color: COL.gold, life: 0.55, stagger: 36, arc: 90 });
      FX.count(fos, st.fossils, 600, 520);
    } else if (fx) {
      FX.count(fos, st.fossils, 400, 0);
    } else {
      if (fos.__tw) fos.__tw.end(true);
      setText(fos, st.fossils);
    }
    G.mapShown = true;
    setText($('st-cards'), cnt.cards); setText($('st-cards-max'), cnt.maxCards);
    setText($('st-kinds'), cnt.kinds); setText($('st-kinds-max'), cnt.maxKinds);
    $('st-title').hidden = !st.titles.length;
    if (st.titles.length) setText($('st-title-text'), st.titles[st.titles.length - 1]);

    for (land = 0; land < ROWS; land++) {
      var open = K.landOpen(land), rivals = K.RIVALS.filter(function (r) { return r.land === land; });
      var wonN = rivals.filter(function (r) { return K.beaten(r.id); }).length;
      h += '<div class="band land-' + land + (open ? '' : ' closed') + '"' + (NEWLY['land' + land] ? ' data-new="1"' : '') + '>' + sceneSvg(land, 'm') +
        '<div class="band-name">' + icon('i-land-' + land) + LANDS[land] +
        '<small>' + (open ? rivals.length + '人のうち' + wonN + '人に勝った' : 'まだ開いていない') + '</small></div><div class="band-nodes">';
      rivals.forEach(function (r, ri) {
        var can = K.rivalOpen(r.id), won = K.beaten(r.id), wins = st.rivals[r.id] || 0, lv = K.rivalLevel(r.id);
        var why = can ? '' : (open ? LANDS[land] + 'の2人に勝つと挑める' : '');
        // data-new: 'open' = いま挑めるようになった(飛び出す)、'won' = いま初めて勝った(勝った印が打ち込まれる)
        var nw = NEWLY[r.id] ? (won ? 'won' : 'open') : '';
        h += '<button type="button" class="rv' + (r.boss ? ' boss' : '') + (can ? '' : ' locked') + (won ? ' won' : '') + (can && !won ? ' todo' : '') + '" data-rival="' + r.id + '"' +
          (can ? '' : ' aria-disabled="true"') + (nw ? ' data-new="' + nw + '" style="--k:' + ri + '"' : '') +
          ' title="' + esc(r.title + ' ' + r.name + (can ? '' : (why ? '。' + why : ''))) + '">' +
          (r.boss ? '<span class="mark crown">' + icon('i-crown') + '</span>' : '') +
          rivalPic(r) + (won ? '<span class="mark won">' + icon('i-check') + '</span>' : '') +
          '<span class="rv-name">' + esc(r.name) + '</span><span class="rv-title">' + esc(r.title) + '</span>' +
          (can ? '<span class="rv-meta"><i class="lv ' + lv + '">' + LEVELS[lv] + '</i>' + (wins ? '<i class="wins">勝ち ' + wins + '</i>' : '') + '</span>'
            : (why ? '<span class="rv-lock">' + icon('i-lock') + why + '</span>' : '')) +
          '</button>';
      });
      h += '</div>';
      // 発掘場
      var left = digLeft(land), pend = !!st.pending && st.pending.land === land;
      h += '<button type="button" class="digsite' + (left || pend ? '' : ' out') + (open && left && !K.digCost(land) ? ' freebie' : '') + '" data-dig="' + land + '"' + (NEWLY['land' + land] ? ' data-new="1"' : '') + '>' +
        icon('i-fossil') + '<b>発掘</b>' +
        (left || pend ? '<span class="' + (K.digCost(land) ? '' : 'free') + '">' + costWord(K.digCost(land)) + '</span><span>残り ' + left + '枚</span>'
          : '<span>掘りつくした</span>') +
        (pend ? '<span class="pend">えらび途中</span>' : '') + '</button>';
      if (!open) h += '<div class="band-lock">' + icon('i-lock') + LANDS[land - 1] + 'の2人に勝つと開く</div>';
      // いま開いた土地: 暗い幕が晴れ、かぎが割れて消える(見た目は CSS。光とかけらは mapFx)
      else if (NEWLY['land' + land]) h += '<div class="veil"></div><div class="band-lock gone">' + icon('i-lock') + '開いた!</div>';
      h += '</div>';
    }
    setHtml($('map-body'), h);
    NEWLY = {};
    if (fx) mapFx(newly);
  }

  // 地図に戻った時: 新しく開いた土地に光の帯とかけら、挑めるようになった主の王冠が光る、初めて勝った相手に輪
  function mapFx(newly) {
    var S = sp(), body = $('map-body'), any = false, k;
    if (!S) return;
    var bands = body.querySelectorAll('.band[data-new]');
    for (k = 0; k < bands.length; k++) {
      var r = bands[k].getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      S.crack(cx, cy, { color: COL.glow, n: 7, len: 70, life: 0.5, delay: 250 });
      S.burst(cx, cy, { kind: 'shard', n: 26, colors: [COL.glow, '#3a3f44', '#ffffff'], speed: 420, life: 0.9, delay: 420 });
      S.ring(cx, cy, { color: COL.glow, r1: 200, width: 5, life: 0.5, delay: 420 });
      S.sweep({ left: r.left, top: r.top, w: r.width, h: r.height }, { color: '#fff6d0', life: 0.7, delay: 480 });
      any = true;
    }
    var nodes = body.querySelectorAll('.rv[data-new]');
    for (k = 0; k < nodes.length; k++) {
      var kind = nodes[k].getAttribute('data-new'), q = mid(nodes[k].querySelector('.rv-pic'));
      var idx = +(nodes[k].style.getPropertyValue('--k') || 0), inBand = !!nodes[k].closest('.band[data-new]');
      if (kind === 'won') {
        S.ring(q.x, q.y, { color: COL.good, r1: 90, width: 4, life: 0.5, delay: 200 });
        S.burst(q.x, q.y, { kind: 'star', n: 16, colors: [COL.good, '#ffffff'], speed: 220, life: 0.8, delay: 200 });
      } else {
        var d = (inBand ? 900 : 300) + idx * 150;
        S.ring(q.x, q.y, { color: nodes[k].classList.contains('boss') ? COL.gold : '#ffffff', r1: 80, width: 3, life: 0.45, delay: d });
        if (nodes[k].classList.contains('boss')) S.burst(q.x, q.y - q.h * 0.62, { kind: 'star', n: 18, colors: [COL.gold, '#ffffff'], speed: 200, life: 0.9, delay: d + 80 });
        any = true;
      }
    }
    if (any) sound('unlock', 420);
  }

  /* ---------- ライバルの窓 ---------- */

  function openRival(id) {
    var r = K.RIVAL[id];
    if (!r || !K.rivalOpen(id)) return false;
    if (G.screen !== 'map') toMap();
    RV = r;
    var st = K.get(), won = K.beaten(id), wins = st.rivals[id] || 0, lv = K.rivalLevel(id), h;
    h = '<div class="rvw-top">' + rivalPic(r, r.boss ? 'boss' : '') + '<div><h2>' + esc(r.name) + '</h2>' +
      '<p class="sub">' + esc(r.title) + '(' + LANDS[r.land] + ')</p>' +
      '<p class="rv-meta"><i class="lv ' + lv + '">強さ: ' + LEVELS[lv] + '</i><i class="wins">勝ち数 ' + wins + '</i></p></div></div>' +
      '<p class="say">「' + esc(r.say) + '」</p>' +
      (lv !== r.level ? '<p class="rvw-ease">続けて負けたので、相手が手加減します(いまの強さ: ' + LEVELS[lv] + ')。</p>' : '') +
      '<div class="rvw-row"><div class="rvw-reward"><h3>ごほうびのカード</h3>' + miniHtml(r.card) +
      '<p class="' + (won ? 'done' : '') + '">' + (won ? 'もらった' : '初めて勝つと、1枚もらえる') + '</p></div>' +
      '<div class="rvw-deck"><h3>相手のデッキ(' + r.deck.length + '枚)</h3><div class="mini-grid">' + sortIds(r.deck).map(miniHtml).join('') + '</div></div></div>' +
      '<div class="actions center"><button type="button" class="btn" data-act="close">閉じる</button>' +
      '<button type="button" class="btn primary big" data-act="fight">対戦する</button></div>';
    var body = $('rival-body');
    body.__h = null;
    setHtml(body, h);
    openOv('ov-rival');
    return true;
  }

  /* ---------- 発掘の窓 ---------- */

  function openDig(land) {
    var st = K.get();
    land = land | 0;
    if (!st.pending && !K.landOpen(land)) return false;
    if (G.screen !== 'map') toMap();
    // 選ぶ途中で閉じていた時は、続きから(候補は保存されている)
    if (st.pending) DG = { land: st.pending.land, phase: 'offer', offer: st.pending.offer.slice(), msg: '', resumed: true };
    else DG = { land: land, phase: 'ask', offer: [], msg: '', resumed: false };
    renderDig();
    openOv('ov-dig');
    return true;
  }

  function renderDig() {
    var d = DG, st = K.get(), land = d.land, cost = K.digCost(land), left = digLeft(land), h;
    h = '<h2>' + LANDS[land] + 'の発掘</h2><div class="dig-info">' +
      '<span class="stat fossil">' + icon('i-fossil') + '持っている化石 <b>' + st.fossils + '</b></span>' +
      '<span class="stat">次の費用 <b>' + (cost ? cost + 'こ' : 'ただ') + '</b>' + (cost ? '' : '(最初の1回)') + '</span>' +
      '<span class="stat">残り <b>' + left + '</b>枚</span></div>';
    if (d.phase === 'ask') {
      var why = !left ? 'この土地のカードは、掘りつくしました。' : (st.fossils < cost ? '化石が足りません(' + cost + 'こ要ります)。' : '');
      h += '<div class="rock" id="dig-rock">' + icon('i-fossil') + '</div>' +
        '<p class="dig-text">この土地の恐竜のカードを、最大3枚掘り出します。その中から1枚を選んでもらえます。' +
        '<br>費用は化石' + K.DIG_COST + 'こ。土地ごとに、最初の1回はただです。</p>' +
        '<p class="dig-msg">' + esc(d.msg || why) + '</p>' +
        '<div class="actions center"><button type="button" class="btn" data-act="close">閉じる</button>' +
        '<button type="button" class="btn primary big" data-act="go"' + (why ? ' disabled' : '') + '>' + icon('i-fossil') + '掘る(' + (cost ? '化石' + cost + 'こ' : 'ただ') + ')</button></div>';
    } else if (d.phase === 'offer') {
      h += '<p class="dig-text">' + (d.resumed ? '前に掘り出した候補です。' : '') + 'もらうカードを、1枚選んでください。</p><div class="dig-offer">';
      d.offer.forEach(function (id, k) {
        var own = K.owned(id);
        h += '<div class="pick">' + cardHtml(id, { h: k, hunt: true }) +
          '<span class="tag' + (own ? ' second' : '') + '">' + (own ? '2枚目' : '新しいカード') + '</span></div>';
      });
      h += '</div><p class="save-note">選ばずに閉じても、候補は残ります。</p>' +
        '<div class="actions center"><button type="button" class="btn" data-act="close">閉じる</button></div>';
    } else {
      var c = d.got, lines = '';
      (d.tasks || []).forEach(function (t) { lines += '<li>課題「<b>' + esc(t.name) + '</b>」を達成: ' + esc(rewardWords(t)) + '</li>'; });
      h += '<p class="dig-text">「' + esc(E.CARDS[c.id].name) + '」を手に入れました(' + gotWord(c) + ')。</p>' +
        '<div class="dig-offer"><div class="pick dig-got" id="dig-got">' + cardHtml(c.id, { h: 0, hunt: true, plain: true }) + '</div></div>' +
        (lines ? '<ul class="rw-list">' + lines + '</ul>' : '') +
        '<div class="actions center"><button type="button" class="btn" data-act="close">閉じる</button>' +
        '<button type="button" class="btn" data-act="deck">デッキを組む</button>' +
        '<button type="button" class="btn primary" data-act="more">もう一度掘る</button></div>';
    }
    var body = $('dig-body');
    body.__h = null;
    setHtml(body, h);
  }

  // 掘る: 化石を払って、候補を出す。伏せた化石が、順にめくれる
  function digGo() {
    if (!DG || DG.phase !== 'ask') return false;
    var r = K.digStart(DG.land, Math.random);
    if (!r.ok) { DG.msg = r.reason; sound('error'); renderDig(); return false; }
    DG = { land: r.land, phase: 'offer', offer: r.offer.slice(), msg: '', resumed: !!r.resumed };
    var rock = $('dig-rock'), S = sp(), token = G.token, shown = false;
    // 候補を出す(伏せた化石が、順にめくれる)。岩をたたく演出の後か、クリックで飛ばした時に、1回だけ
    var reveal = function () {
      if (shown || token !== G.token || !DG || DG.phase !== 'offer') return;
      shown = true;
      DG.reveal = null;
      renderDig();
      renderMap();
      if (!fxActive()) return;
      var picks = $('dig-body').querySelectorAll('.pick');
      for (var k = 0; k < picks.length; k++) {
        FX.temp(picks[k], '<span class="cover" style="--sd:' + (120 + k * 240) + 'ms">' + icon('i-fossil') + '</span>', 120 + k * 240 + 560);
        sound('flip', 120 + k * 240);
      }
    };
    if (!S || !rock) { sound('select'); reveal(); return true; }
    // 岩を3回たたく(揺れ、ひび、土けむり、かけら)→ 割れて光があふれる
    var c = mid(rock), go = $('dig-body').querySelector('[data-act="go"]');
    if (go) go.disabled = true;
    DG.reveal = reveal;
    [0, 270, 540].forEach(function (t, j) {
      var x = c.x + (j - 1) * c.w * 0.16, y = c.y + (j === 1 ? -c.h * 0.12 : c.h * 0.08);
      FX.later(function () { if (!shown) FX.shake(rock, 7 + j * 2, 200); }, t);
      S.crack(x, y, { color: '#fff3c4', n: 4 + j, len: 26 + j * 16, life: 0.5, delay: t });
      S.dust(c.x, c.y + c.h * 0.45, { n: 6 + j * 2, w: c.w * 0.9, delay: t });
      S.burst(x, y, { kind: 'shard', n: 6 + j * 4, colors: ['#8a744a', '#d9cba0', '#5a4a2a'], speed: 260 + j * 60, life: 0.7, delay: t });
      S.burst(x, y, { kind: 'spark', n: 6, color: COL.glow, speed: 260, life: 0.35, delay: t });
      sound('hit', t, j);
    });
    S.flash({ color: '#fff6d0', alpha: 0.5, life: 0.35, delay: 830 });
    S.burst(c.x, c.y, { kind: 'shard', n: 34, colors: ['#8a744a', '#d9cba0', '#5a4a2a'], speed: 520, life: 0.9, delay: 830 });
    S.burst(c.x, c.y, { kind: 'star', n: 28, colors: [COL.glow, '#ffffff'], speed: 380, life: 0.9, delay: 830 });
    S.ring(c.x, c.y, { color: COL.glow, r1: 240, width: 5, life: 0.5, delay: 830 });
    S.rays(c.x, c.y, { color: COL.glow, n: 12, r: 220, life: 0.9, delay: 830 });
    sound('crack', 830);
    FX.later(function () { if (!shown && rock.parentNode) rock.classList.add('broken'); }, 830);
    setTimeout(reveal, 1000);
    return true;
  }

  // 候補から1枚もらう。id の代わりに、候補の何番目か(0〜2)でもよい
  function digPick(id) {
    if (!DG || DG.phase !== 'offer') return false;
    if (DG.reveal) DG.reveal();                       // 岩をたたいている途中なら、先に候補を出す
    if (typeof id === 'number') id = DG.offer[id];
    var r = K.digPick(id);
    if (!r.ok) { DG.msg = r.reason; return false; }
    var token = G.token, picks = $('dig-body').querySelectorAll('.pick'), k;
    DG = { land: DG.land, phase: 'got', offer: [], got: r.card, tasks: r.tasks, msg: '' };
    var show = function () {
      if (token !== G.token || !DG || DG.phase !== 'got') return;
      renderDig();
      renderMap();
    };
    if (!fxActive()) { sound('get'); show(); return true; }
    // 選ばなかった札が沈み、選んだ1枚を大きく見せてから、もらった後の形へ
    for (k = 0; k < picks.length; k++) {
      var cardEl = picks[k].querySelector('.card');
      picks[k].classList.add(cardEl && cardEl.getAttribute('data-id') === id ? 'chosen' : 'sunk');
    }
    sound('ok');
    setTimeout(function () {
      if (token !== G.token || !DG || DG.phase !== 'got') return;
      cardShow([r.card], show);
    }, 340);
    return true;
  }

  /* ---------- 課題、保存、はじめての案内 ---------- */

  function openTasks() {
    var st = K.get(), h = '';
    K.TASKS.forEach(function (t) {
      var done = !!st.tasks[t.id];
      h += '<li class="task' + (done ? ' done' : '') + '"><span class="tk">' + icon('i-check') + '</span>' +
        '<div><b>' + esc(t.name) + '</b><span>' + esc(t.text) + '</span></div>' +
        '<span class="trw">' + esc(rewardWords(t.reward)) + (done ? '<br>達成した' : '') + '</span></li>';
    });
    setHtml($('task-list'), h);
    openOv('ov-tasks');
    return true;
  }

  function saveMsg(id, text, bad) {
    var el = $(id);
    setText(el, text);
    el.classList.toggle('bad', !!bad);
  }
  function openSave() {
    $('save-out').value = K.exportText();
    $('save-in').value = '';
    saveMsg('save-out-msg', '');
    saveMsg('save-in-msg', '');
    openOv('ov-save');
    return true;
  }
  function saveCopy() {
    var el = $('save-out'), done = function () { saveMsg('save-out-msg', 'コピーしました。'); };
    var manual = function () {
      el.focus(); el.select();
      try { if (document.execCommand('copy')) done(); else saveMsg('save-out-msg', '欄の文字を選んだので、コピーしてください。'); }
      catch (e) { saveMsg('save-out-msg', '欄の文字を選んだので、コピーしてください。'); }
    };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(el.value).then(done, manual);
    else manual();
  }
  function saveLoad() {
    var r = K.importText($('save-in').value);
    if (!r.ok) { saveMsg('save-in-msg', r.reason, true); return false; }
    saveMsg('save-in-msg', '読み込みました。');
    $('save-out').value = K.exportText();
    renderMap();
    return true;
  }
  function saveReset() {
    askConfirm('集めたカード、デッキ、化石、勝った記録を、すべて最初の形に戻します。元には戻せません。よいですか?', '最初からやり直す', function () {
      K.reset();
      try { window.localStorage.removeItem(STORE_INTRO); } catch (e) { /* 覚えられなくても動く */ }
      closeOv('ov-save');
      renderMap();
      maybeIntro();
    });
  }

  // はじめての案内(1回だけ)
  function maybeIntro() {
    var seen = false;
    try { seen = window.localStorage.getItem(STORE_INTRO) === '1'; } catch (e) { /* 同上 */ }
    if (!seen && !K.get().games) openOv('ov-intro');
  }
  function closeIntro() {
    try { window.localStorage.setItem(STORE_INTRO, '1'); } catch (e) { /* 同上 */ }
    closeOv('ov-intro');
  }

  /* ---------- デッキ編成 ---------- */

  function openDeck() {
    stopTimers();
    fxClear();
    G.busy = false;
    closeAllOv();
    DK = { slot: K.get().cur, ids: K.deck(), snap: K.deck(), focus: null, msg: '', pane: 'coll' };
    show('deck');
    renderDeck();
    return true;
  }
  function deckCount(id) { return DK.ids.filter(function (x) { return x === id; }).length; }

  // 変えるたびに調べ、決まりに合っている間は保存する
  function deckChanged() {
    var res = K.checkDeck(DK.ids);
    if (res.ok) K.setDeck(DK.slot, DK.ids);
    renderDeck();
    return res;
  }
  function deckAdd(id) {
    if (!DK || !E.CARDS[id]) return false;
    var own = K.owned(id), max = C.maxCopies(id), n = deckCount(id);
    DK.focus = id;
    DK.msg = '';
    if (!own) { DK.msg = 'まだ持っていないカードです。'; renderDeck(); return false; }
    if (n >= Math.min(own, max)) {
      DK.msg = E.CARDS[id].name + 'は、これ以上入れられません(' + (own < max ? '持っているのは' + own + '枚' : max + '枚まで') + ')。';
      sound('error');
      renderDeck();
      return false;
    }
    var tile = document.querySelector('#deck-coll .tile[data-id="' + id + '"]'), from = tile ? tile.getBoundingClientRect() : null;
    var wasOk = K.checkDeck(DK.ids).ok;
    DK.ids.push(id);
    sound('select');
    var res = deckChanged();
    deckFx(id, from, null, wasOk, res.ok);
    return true;
  }
  function deckRemove(id) {
    if (!DK) return false;
    var k = DK.ids.indexOf(id);
    if (k < 0) return false;
    var row = document.querySelector('#deck-list .drow[data-id="' + id + '"]'), from = row ? row.getBoundingClientRect() : null;
    var rowHtml = row ? row.outerHTML : '', wasOk = K.checkDeck(DK.ids).ok;
    DK.ids.splice(k, 1);
    DK.focus = id;
    DK.msg = '';
    sound('select');
    var res = deckChanged();
    deckFx(id, from, rowHtml, wasOk, res.ok);
    return true;
  }
  /* デッキ編成の演出: カードが一覧とデッキの間を飛ぶ。重さの棒がはねる。決まりに合った時に緑の光。
     from: 飛び立つ所の四角。rowHtml: 外す時の、行の見た目(入れる時は null) */
  function deckFx(id, from, rowHtml, wasOk, isOk) {
    if (!fxActive()) return;
    var S = sp(), list = $('deck-list'), bar = list.querySelector('.wbar'), q;
    if (from) {
      if (rowHtml === null) {
        var rows = list.querySelectorAll('.drow[data-id="' + id + '"]'), row = rows[rows.length - 1];
        if (row) {
          row.setAttribute('data-fly', '1');
          FX.fly(row.outerHTML.replace(' data-fly="1"', ''), from, row, 260, function () {
            row.removeAttribute('data-fly');
            q = S ? mid(row) : null;
            if (S) S.burst(q.x - q.w * 0.4, q.y, { kind: 'spark', n: 8, colors: [COL.me, '#ffffff'], speed: 200, life: 0.35 });
          });
        }
      } else {
        var tile = document.querySelector('#deck-coll .tile[data-id="' + id + '"]');
        if (tile) {
          var to = tile.getBoundingClientRect(), holder = document.createElement('div');
          // 行の見た目のまま、一覧のカードへ飛んで消える
          holder.style.cssText = 'position:absolute;left:' + (to.left + to.width / 2 - from.width / 2) + 'px;top:' + (to.top + to.height / 2 - from.height / 2) + 'px;width:' + from.width + 'px;height:' + from.height + 'px';
          FX.fly(rowHtml, from, holderBox(holder), 240, function () { FX.mark(tile, 'data-pop', 'up', 300); });
        }
      }
    }
    if (bar) FX.mark(bar, 'data-pop', 'up', 300);
    if (isOk && !wasOk) {
      FX.mark(list, 'data-ok', '1', 700);
      if (S) { q = mid(list.querySelector('.derr')); S.burst(q.x, q.y, { kind: 'star', n: 18, colors: [COL.good, '#ffffff'], speed: 240, life: 0.8 }); }
      sound('ok');
    }
  }
  // FX.fly の行き先に渡す、位置だけを持つ入れ物
  function holderBox(el) {
    return { getBoundingClientRect: function () { return { left: parseFloat(el.style.left), top: parseFloat(el.style.top), width: parseFloat(el.style.width), height: parseFloat(el.style.height) }; } };
  }
  // 決まりに合っていないまま出ようとした時は、保存されないことを確かめる
  function guardDeck(next) {
    if (DK && !K.checkDeck(DK.ids).ok) {
      askConfirm('このデッキは決まりに合っていないので、保存されません。前に保存した形のままになります。よいですか?', 'このまま出る', next);
    } else next();
  }
  function deckSwitch(i) {
    if (!DK || i === DK.slot || i < 0 || i >= K.DECK_SLOTS) return false;
    guardDeck(function () {
      K.setCur(i);
      DK = { slot: i, ids: K.deck(), snap: K.deck(), focus: DK.focus, msg: '' };
      renderDeck();
    });
    return true;
  }
  function deckAuto() {
    if (!DK) return false;
    DK.ids = K.suggestDeck();
    DK.msg = 'おまかせで組みました。';
    deckChanged();
    return true;
  }
  function deckRevert() {
    if (!DK) return false;
    DK.ids = DK.snap.slice();
    DK.msg = '開いた時の形に戻しました。';
    deckChanged();
    return true;
  }
  function leaveDeck() {
    guardDeck(function () { K.clearFresh(); DK = null; toMap(); });
  }

  // 大きく出す札を替える(一覧は描き直さず、印だけ移す)
  function deckFocus(id) {
    if (!DK || DK.focus === id || !E.CARDS[id]) return;
    DK.focus = id;
    var list = document.querySelectorAll('#scr-deck .focus'), k;
    for (k = 0; k < list.length; k++) list[k].classList.remove('focus');
    list = document.querySelectorAll('#scr-deck [data-id="' + id + '"]');
    for (k = 0; k < list.length; k++) if (!list[k].classList.contains('card')) list[k].classList.add('focus');
    setHtml($('deck-detail'), detailHtml(id));
  }

  function tileHtml(cd, own, n, fresh) {
    var max = C.maxCopies(cd.id);
    var cls = 'tile land-' + cd.land + (cd.alt ? ' alt' : '') + (own ? '' : ' none') + (n ? ' indeck' : '') +
      (own && n >= Math.min(own, max) ? ' used' : '') + (DK.focus === cd.id ? ' focus' : '');
    return '<button type="button" class="' + cls + '" data-id="' + cd.id + '" title="' + esc(own ? cardTip(cd) + '。押すとデッキに入れる' : 'まだ持っていない恐竜') + '">' +
      artHtml(cd.id) + '<span class="t-w">' + feetIcons(cd.w) + '</span>' + (own ? '<span class="t-size">' + cd.size + '</span>' : '') +
      '<span class="t-name">' + (own ? esc(cd.name) : '?') + '</span>' +
      '<span class="t-own">' + (own ? '持ち ' + own + '/' + max + (n ? '<b>デッキ ' + n + '</b>' : '') : 'まだ持っていない') + '</span>' +
      (fresh && own ? '<span class="t-new">新</span>' : '') + '</button>';
  }

  // 大きい表示: 札そのものと、手に入る場所など
  function detailHtml(id) {
    if (!id) return '<p class="hint">カードに重ねるか、押すと、ここに大きく出ます。<br><br>左の一覧のカードを押すとデッキに入り、右のデッキのカードを押すと外れます。</p>';
    var cd = E.CARDS[id], own = K.owned(id);
    return cardHtml(id, { h: 0, hunt: true, dark: !own, plain: true }) +
      '<dl class="dinfo"><dt>持っている</dt><dd>' + own + ' / ' + C.maxCopies(id) + '枚' + (own ? '' : '(まだ持っていない)') + '</dd>' +
      '<dt>重さ</dt><dd>' + cd.w + '(足あとが' + cd.w + 'つ以上のマスに置ける)</dd>' +
      '<dt>大きさ</dt><dd>' + cd.size + '</dd>' +
      (cd.alt ? '<dt>二段構え</dt><dd>足あと' + cd.alt.w + 'のマスにも置ける(その時は大きさ' + cd.alt.size + ')</dd>' : '') +
      '<dt>食べ物</dt><dd>' + DIETS[cd.diet] + (cd.ab === 'hunt' ? '。狩りをする(「群れと狩り」を入れた対戦で)' : '') + '</dd>' +
      '<dt>土地</dt><dd>' + LANDS[cd.land] + 'が得意</dd>' +
      '<dt>手に入る場所</dt><dd>' + K.whereToGet(id).map(esc).join('<br>') + '</dd></dl>';
  }

  function renderDeck() {
    if (!DK) return;
    var st = K.get(), res = K.checkDeck(DK.ids), inDeck = {}, h = '', lastW = 0, w = [0, 0, 0, 0], k;
    DK.ids.forEach(function (id) { inDeck[id] = (inDeck[id] || 0) + 1; w[E.CARDS[id].w]++; });

    // 左: 24種の一覧(重さ → 土地の順)
    C.LIST.slice().sort(function (a, b) { return (a.w - b.w) || (a.land - b.land) || (LIST_INDEX[a.id] - LIST_INDEX[b.id]); }).forEach(function (cd) {
      if (cd.w !== lastW) { lastW = cd.w; h += '<h3>重さ ' + cd.w + '</h3>'; }
      h += tileHtml(cd, K.owned(cd.id), inDeck[cd.id] || 0, !!st.fresh[cd.id]);
    });
    setHtml($('deck-coll'), h);

    // まん中: 大きい表示
    setHtml($('deck-detail'), detailHtml(DK.focus));

    // 右: いまのデッキ
    h = '<div class="dtabs">';
    for (k = 0; k < K.DECK_SLOTS; k++) {
      h += '<button type="button" class="dtab' + (k === DK.slot ? ' on' : '') + '" data-slot="' + k + '" title="このデッキに切り替える">' + esc(st.decks[k].name) + '</button>';
    }
    h += '</div><label class="dname">名前<input type="text" id="deck-name" maxlength="12" value="' + esc(st.decks[DK.slot].name) + '"></label>' +
      '<div class="dcount"><span>枚数 <b class="' + (res.count === C.DECK_SIZE ? '' : 'bad') + '">' + res.count + '</b> / ' + C.DECK_SIZE + '</span>' +
      '<span>重さ <b class="' + (res.weight > C.MAX_WEIGHT ? 'bad' : '') + '">' + res.weight + '</b> / ' + C.MAX_WEIGHT + '</span></div>' +
      '<div class="wbar' + (res.weight > C.MAX_WEIGHT ? ' over' : '') + '" title="重さの合計"><i style="width:' + Math.min(100, res.weight / C.MAX_WEIGHT * 100).toFixed(0) + '%"></i></div>' +
      '<div class="dws"><span>重さ1: ' + w[1] + '枚</span><span>重さ2: ' + w[2] + '枚</span><span>重さ3: ' + w[3] + '枚</span></div><div class="drows">';
    sortIds(DK.ids).forEach(function (id) {
      var cd = E.CARDS[id];
      h += '<button type="button" class="drow land-' + cd.land + (DK.focus === id ? ' focus' : '') + '" data-id="' + id + '" title="押すとデッキから外す">' +
        '<span class="d-w">' + feetIcons(cd.w) + '</span><span class="d-name">' + esc(cd.name) + '</span><span class="d-size">' + cd.size + '</span></button>';
    });
    for (k = DK.ids.length; k < C.DECK_SIZE; k++) h += '<div class="drow empty">あき</div>';
    h += '</div><ul class="derr' + (res.ok ? ' ok' : '') + '">' +
      (res.ok ? '<li>決まりに合っています(保存しました)。</li>'
        : res.errors.map(function (e) { return '<li>' + esc(e) + '</li>'; }).join('') + '<li>このままでは保存されません。</li>') +
      (DK.msg ? '<li>' + esc(DK.msg) + '</li>' : '') + '</ul>' +
      '<div class="dbtns"><button type="button" class="btn small" data-act="auto">おまかせ</button>' +
      '<button type="button" class="btn small" data-act="revert">元に戻す</button></div>';
    setHtml($('deck-list'), h);

    // スマホの縦画面では、「カードを選ぶ」と「いまのデッキ」を切り替えて見せる(CSS が data-pane で出し分ける)
    $('scr-deck').setAttribute('data-pane', DK.pane);
    setText($('btn-deck-pane'), DK.pane === 'list' ? 'カードを選ぶ' : 'デッキ ' + res.count + '/' + C.DECK_SIZE);
  }

  /* ---------- 確認の窓、遊び方 ---------- */

  function askConfirm(text, yes, cb) {
    setText($('confirm-text'), text);
    setText($('confirm-yes'), yes || 'はい');
    confirmCb = cb;
    openOv('ov-confirm');
    $('confirm-no').focus();
  }
  function answerConfirm(yes) {
    var cb = confirmCb;
    confirmCb = null;
    closeOv('ov-confirm');
    if (yes && cb) cb();
  }

  /* ---------- 操作をつなぐ ---------- */

  function bind() {
    $('setup-form').addEventListener('submit', function (ev) {
      ev.preventDefault();
      sound('select');
      start(readForm());
    });
    $('btn-help-setup').addEventListener('click', function () { openOv('ov-help'); });
    $('btn-help').addEventListener('click', function () { openOv('ov-help'); });
    $('btn-help-close').addEventListener('click', function () { closeOv('ov-help'); });
    $('ov-help').addEventListener('click', function (ev) { if (ev.target === this) closeOv('ov-help'); });

    $('mull-hand').addEventListener('click', function (ev) {
      var el = ev.target.closest ? ev.target.closest('.card') : null;
      if (!el) return;
      var k = +el.getAttribute('data-h');
      G.mullSel[k] = !G.mullSel[k];
      sound('select');
      renderMull();
    });
    $('btn-mull-redo').addEventListener('click', function () {
      var list = [];
      G.mullSel.forEach(function (v, k) { if (v) list.push(k); });
      doMulligan(list);
    });
    $('btn-mull-keep').addEventListener('click', function () { doMulligan([]); });
    $('btn-mull-back').addEventListener('click', leaveMatch);

    $('hand').addEventListener('click', function (ev) {
      var el = ev.target.closest ? ev.target.closest('.card') : null;
      if (el) selectCard(+el.getAttribute('data-h'));
    });
    $('btn-pass').addEventListener('click', onPassButton);
    $('btn-undo').addEventListener('click', undo);
    $('btn-result').addEventListener('click', function () { openResult(false); });
    $('btn-sound').addEventListener('click', function () { setSound(!G.sound); sound('select'); });
    $('btn-fx').addEventListener('click', function () { setFxOn(!G.fxOn); sound('select'); });
    $('btn-quit').addEventListener('click', function () {
      // 途中でやめると、ごほうびは出ない
      if (G.s && !G.s.over) {
        askConfirm(G.match.rival ? '対戦をやめて、地図に戻りますか? 途中でやめると、ごほうびは出ません。'
          : '対戦をやめて、設定に戻りますか? 途中でやめると、化石はもらえません。', G.match.rival ? '地図に戻る' : '設定に戻る', leaveMatch);
      } else leaveMatch();
    });

    $('confirm-yes').addEventListener('click', function () { answerConfirm(true); });
    $('confirm-no').addEventListener('click', function () { answerConfirm(false); });
    $('ov-confirm').addEventListener('click', function (ev) { if (ev.target === this) answerConfirm(false); });

    $('ov-result').addEventListener('click', function (ev) {
      var el = ev.target.closest ? ev.target.closest('[data-act]') : null;
      if (!el) return;
      var act = el.getAttribute('data-act');
      if (act === 'again') start({ again: true });
      else if (act === 'map') toMap();
      else if (act === 'deck') openDeck();
      else if (act === 'board') closeResult();
      else if (act === 'retry') retryTurning();
    });

    bindCollection();

    // 見せ場は、クリックかキーで飛ばせる
    $('stage').addEventListener('click', function () { stageSkip(); });
    document.addEventListener('keydown', function (ev) {
      if (stageSkip()) { ev.preventDefault(); return; }
      if (ev.key !== 'Escape' && ev.key !== 'Esc') return;
      var k, wins = ['ov-help', 'ov-rival', 'ov-dig', 'ov-tasks', 'ov-save'];
      if (ovOpen('ov-confirm')) { answerConfirm(false); return; }
      if (ovOpen('ov-intro')) { closeIntro(); return; }
      for (k = 0; k < wins.length; k++) if (ovOpen(wins[k])) { closeOv(wins[k]); return; }
      if (ovOpen('ov-result')) closeResult();
      else if (G.screen === 'play' && G.sel >= 0) { G.sel = -1; refreshSel(); }
    });
    window.addEventListener('resize', function () { if (G.screen === 'play') fitHand(); });
  }

  // 対戦から出る: ライバル戦は地図へ、じゆう対戦は設定へ
  function leaveMatch() { if (G.match.rival) toMap(); else toSetup(); }

  // カード集めの画面の操作
  function bindCollection() {
    var by = function (ev, sel) { return ev.target.closest ? ev.target.closest(sel) : null; };

    // 地図
    $('btn-map-deck').addEventListener('click', openDeck);
    $('btn-map-tasks').addEventListener('click', openTasks);
    $('btn-map-free').addEventListener('click', toSetup);
    $('btn-map-help').addEventListener('click', function () { openOv('ov-help'); });
    $('btn-map-save').addEventListener('click', openSave);
    $('btn-setup-map').addEventListener('click', toMap);
    $('map-body').addEventListener('click', function (ev) {
      var el = by(ev, '[data-rival]');
      if (el) { if (openRival(el.getAttribute('data-rival'))) sound('select'); return; }
      el = by(ev, '[data-dig]');
      if (el && openDig(+el.getAttribute('data-dig'))) sound('select');
    });

    // ライバルの窓
    $('ov-rival').addEventListener('click', function (ev) {
      var el = by(ev, '[data-act]');
      if (ev.target === this || (el && el.getAttribute('data-act') === 'close')) { closeOv('ov-rival'); return; }
      if (el && el.getAttribute('data-act') === 'fight' && RV) { sound('select'); start({ rivalId: RV.id }); }
    });

    // 発掘の窓
    $('ov-dig').addEventListener('click', function (ev) {
      var el = by(ev, '[data-act]'), act = el ? el.getAttribute('data-act') : '';
      if (DG && DG.reveal) { DG.reveal(); return; }           // 岩をたたいている途中のクリックは、飛ばす
      if (ev.target === this || act === 'close') { closeOv('ov-dig'); renderMap(); return; }
      if (act === 'go') { digGo(); return; }
      if (act === 'more') { openDig(DG.land); return; }
      if (act === 'deck') { openDeck(); return; }
      el = by(ev, '.dig-offer .card');
      if (el && DG && DG.phase === 'offer') digPick(el.getAttribute('data-id'));
    });

    // 課題、保存、はじめての案内
    $('btn-tasks-close').addEventListener('click', function () { closeOv('ov-tasks'); });
    $('ov-tasks').addEventListener('click', function (ev) { if (ev.target === this) closeOv('ov-tasks'); });
    $('btn-save-copy').addEventListener('click', saveCopy);
    $('btn-save-load').addEventListener('click', saveLoad);
    $('btn-save-reset').addEventListener('click', saveReset);
    $('btn-save-close').addEventListener('click', function () { closeOv('ov-save'); });
    $('ov-save').addEventListener('click', function (ev) { if (ev.target === this) closeOv('ov-save'); });
    $('btn-intro-ok').addEventListener('click', closeIntro);

    // デッキ編成
    $('btn-deck-back').addEventListener('click', leaveDeck);
    $('btn-deck-help').addEventListener('click', function () { openOv('ov-help'); });
    $('btn-deck-pane').addEventListener('click', function () {
      if (!DK) return;
      DK.pane = DK.pane === 'list' ? 'coll' : 'list';
      renderDeck();
      window.scrollTo(0, 0);
    });
    var coll = $('deck-coll'), list = $('deck-list');
    var focus = function (ev) { var el = by(ev, '[data-id]'); if (el) deckFocus(el.getAttribute('data-id')); };
    coll.addEventListener('mouseover', focus);
    coll.addEventListener('focusin', focus);
    list.addEventListener('mouseover', focus);
    coll.addEventListener('click', function (ev) { var el = by(ev, '.tile'); if (el) deckAdd(el.getAttribute('data-id')); });
    list.addEventListener('click', function (ev) {
      var el = by(ev, '[data-slot]');
      if (el) { deckSwitch(+el.getAttribute('data-slot')); return; }
      el = by(ev, '[data-act]');
      if (el) { if (el.getAttribute('data-act') === 'auto') deckAuto(); else deckRevert(); return; }
      el = by(ev, '.drow[data-id]');
      if (el) deckRemove(el.getAttribute('data-id'));
    });
    list.addEventListener('change', function (ev) {
      if (ev.target && ev.target.id === 'deck-name' && DK) { K.setDeck(DK.slot, DK.ids, ev.target.value); renderDeck(); }
    });
  }

  function init() {
    K.load();
    loadStored();
    if (FX) FX.init();
    if (SPK) SPK.init();
    buildBoard();
    bind();
    setSound(G.sound);
    setFxOn(G.fxOn);
    syncForm();
    renderHero();
    setText($('help-dig-cost'), K.DIG_COST);
    show('map');
    renderMap();
    probeArt();
    // 起動の演出(題名が打ち込まれる)の後に、はじめての案内
    if (fxActive()) bootShow(maybeIntro); else maybeIntro();
  }

  /* ---------- 確認用の入口 ---------- */

  window.DinoUI = {
    // いまの局面(DinoEngine の state)。対戦を始める前は null
    getState: function () { return G.s; },
    // 画面側の様子
    getView: function () {
      var s = G.s, res = G.result;
      return {
        // screen: 'map'(探検の地図) 'deck'(デッキ編成) 'setup'(じゆう対戦の設定) 'mull'(引き直し) 'play'(対戦)
        screen: G.screen, seed: G.seed, cfg: JSON.parse(JSON.stringify(G.cfg)),
        // window: 開いている窓('rival' 'dig' 'tasks' 'save' 'intro' 'help' 'confirm' 'result' か '')
        window: ['confirm', 'intro', 'help', 'rival', 'dig', 'tasks', 'save', 'result'].filter(function (n) { return ovOpen('ov-' + n); })[0] || '',
        match: { rivalId: G.match.rival ? G.match.rival.id : null, level: G.match.level, name: G.match.name },
        // stage: 出ている見せ場('vs' 'cut' 'end' 'get' 'boot' か '')
        stage: STAGE.kind,
        selected: G.sel, busy: G.busy, canAct: canAct(), over: !!(s && s.over),
        fx: fxActive(), fxOn: G.fxOn,
        resultOpen: ovOpen('ov-result'),
        result: res ? { winner: res.sc.winner, pts: res.sc.pts.slice(), turning: res.turning ? res.turning.text : null,
          reward: res.reward, practice: res.practice } : null,
        dig: DG ? { land: DG.land, phase: DG.phase, offer: DG.offer.slice() } : null,
        deck: DK ? { slot: DK.slot, ids: DK.ids.slice(), ok: K.checkDeck(DK.ids).ok } : null,
        log: G.log.map(function (e) { return (e.n ? e.n + ' ' : '') + (e.p >= 0 ? who(e.p) + ': ' : '') + e.text + (e.extra ? '(' + e.extra + ')' : ''); })
      };
    },
    // opts: { rivalId(ライバル戦。無ければ、じゆう対戦), again(同じ相手ともう一度),
    //         scoring, level, land, herdHunt, first('lot'|'me'|'cpu' または 0/1), opp('starter'|'random'), seed,
    //         cpuDelay(ミリ秒。0 なら待たずに打ち、演出も出さない), mulligan(戻す位置の配列。渡すと引き直しまで済ませる) }
    //   じゆう対戦の設定(level など)は、ライバル戦では使わない。まだ挑めない相手を渡すと null を返す
    start: start,
    // カード集め
    toMap: toMap,
    openRival: openRival,
    openDig: openDig,        // 発掘の窓を開く(選ぶ途中の候補があれば、続きから)
    digGo: digGo,            // 「掘る」を押す
    digPick: digPick,        // 候補から選ぶ(id か、何番目か)
    openDeck: openDeck,
    deckAdd: deckAdd, deckRemove: deckRemove, deckSwitch: deckSwitch, deckAuto: deckAuto, deckRevert: deckRevert,
    leaveDeck: leaveDeck,
    openTasks: openTasks,
    openSave: openSave,
    mulligan: function (idxs) { return doMulligan(idxs || []); },
    selectCard: selectCard,
    clickCell: clickCell,
    pass: doPass,            // 確認の窓を出さずにパスする
    undo: undo,
    retryTurning: retryTurning,
    showResult: function () { openResult(false); },
    refresh: renderScreen,   // 局面を外から書き換えた後に、描き直す
    skip: function () { return stageEnd(); },   // 見せ場(VS、カードを手に入れる演出、起動の演出など)を、いま終わらせる
    toSetup: toSetup,
    setSound: setSound,
    setFx: setFxOn           // 演出の入り切り
  };

  init();
})();
