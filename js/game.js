/* 偉哲跑酷 — 地鐵跑酷風格的 3D 無盡跑酷（Three.js）
 * 座標：玩家沿著 -z 前進。程式內用 d（前進距離）表示位置，世界座標 z = -d。
 */
(() => {
  'use strict';

  // ---------- 常數 ----------
  const LANE_X = [-2.5, 0, 2.5];
  const TRAIN_W = 2.3;
  const TRAIN_H = 3.0;
  const RAMP_LEN = 9;
  const GRAVITY = -42;
  const JUMP_V = 13.5;
  const SUPER_JUMP_V = 20;
  const HALF_D = 0.35;
  const HALF_W = 0.4;
  const STAND_H = 1.9;
  const ROLL_H = 0.9;
  const BASE_SPEED = 15;
  const MAX_SPEED = 34;
  const VIEW_AHEAD = 230;
  const LOW_H = 1.05;
  const HIGH_BOTTOM = 1.3;
  const HIGH_TOP = 3.0;

  const SKINS = [
    { id: 'original', name: '原味偉哲', desc: '最純粹的偉哲', mode: 'head', h: 1.3, bottom: 1.1, offX: 0.03,
      shirt: 0xf4f4f4, pants: 0x1f2a4a, skin: 0xe2ab8c, shoe: 0x222222 },
    { id: 'mushroom', name: '毒菇偉哲', desc: '吸一口跑更快？', mode: 'head', h: 1.8, bottom: 1.15, offX: -0.23,
      shirt: 0xeadfc4, pants: 0x5a3d2b, skin: 0xe2ab8c, shoe: 0x3b2a1e },
    { id: 'cow', name: '黃牛偉哲', desc: '哞～黃牛票一張', mode: 'full', h: 2.1, bottom: 0, offX: 0 },
    { id: 'muscle', name: '猛男偉哲', desc: '蛋白質滿滿', mode: 'bust', h: 1.75, bottom: 0.62, offX: 0,
      pants: 0x2b6cff, skin: 0xf0a46a, shoe: 0xffffff },
  ];

  const POWER_INFO = {
    magnet:   { icon: '🧲', name: '磁鐵', dur: 12, color: '#ff4d4d' },
    sneakers: { icon: '👟', name: '超級跳鞋', dur: 12, color: '#3ddc84' },
    jetpack:  { icon: '🚀', name: '噴射背包', dur: 8,  color: '#ffa53d' },
    double:   { icon: '✖️2', name: '雙倍分數', dur: 15, color: '#c86bff' },
  };

  // ---------- 小工具 ----------
  const rand = (a, b) => a + Math.random() * (b - a);
  const randInt = (n) => Math.floor(Math.random() * n);
  const pick = (arr) => arr[randInt(arr.length)];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const $ = (id) => document.getElementById(id);

  function storeGet(key, def) {
    try { const v = localStorage.getItem(key); return v == null ? def : v; } catch (e) { return def; }
  }
  function storeSet(key, val) {
    try { localStorage.setItem(key, val); } catch (e) { /* 無痕模式等情況 */ }
  }

  function makeCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return [c, c.getContext('2d')];
  }
  function canvasTex(c, rx = 1, ry = 1) {
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(rx, ry);
    t.anisotropy = 4;
    return t;
  }
  const lam = (color, extra) => new THREE.MeshLambertMaterial(Object.assign({ color }, extra || {}));

  // ---------- 音效（WebAudio 合成，不用外部檔案） ----------
  let actx = null;
  let muted = storeGet('wz_muted', '0') === '1';
  function audio() {
    if (muted) return null;
    try {
      if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
      if (actx.state === 'suspended') actx.resume();
      return actx;
    } catch (e) { return null; }
  }
  function tone(type, f0, f1, dur, vol, delay = 0) {
    const a = audio(); if (!a) return;
    const t = a.currentTime + delay;
    const o = a.createOscillator(), g = a.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(a.destination);
    o.start(t); o.stop(t + dur + 0.02);
  }
  function noise(dur, vol) {
    const a = audio(); if (!a) return;
    const buf = a.createBuffer(1, Math.floor(a.sampleRate * dur), a.sampleRate);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < ch.length; i++) ch[i] = (Math.random() * 2 - 1) * (1 - i / ch.length);
    const s = a.createBufferSource(), g = a.createGain();
    s.buffer = buf; g.gain.value = vol;
    s.connect(g).connect(a.destination); s.start();
  }
  const sfx = {
    coin() { tone('square', 1320, 1980, 0.07, 0.04); },
    jump() { tone('sine', 280, 720, 0.16, 0.12); },
    roll() { tone('triangle', 420, 140, 0.18, 0.12); },
    lane() { tone('sine', 520, 380, 0.06, 0.05); },
    bump() { tone('square', 140, 80, 0.12, 0.08); },
    stumble() { tone('sawtooth', 200, 60, 0.25, 0.12); noise(0.15, 0.15); },
    crash() { noise(0.5, 0.35); tone('sawtooth', 300, 40, 0.6, 0.15); },
    power() { [660, 880, 1100, 1320].forEach((f, i) => tone('square', f, f * 1.02, 0.09, 0.05, i * 0.07)); },
  };

  // ---------- Three.js 基本設定 ----------
  const canvas = $('game');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  const scene = new THREE.Scene();
  const FOG_COLOR = 0xcde9ff;
  scene.fog = new THREE.Fog(FOG_COLOR, 70, 200);
  {
    const [c, g] = makeCanvas(2, 256);
    const grd = g.createLinearGradient(0, 0, 0, 256);
    grd.addColorStop(0, '#3d9bff'); grd.addColorStop(0.55, '#9fd3ff'); grd.addColorStop(1, '#cde9ff');
    g.fillStyle = grd; g.fillRect(0, 0, 2, 256);
    scene.background = new THREE.CanvasTexture(c);
  }
  const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 260);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a7a66, 0.85));
  const sun = new THREE.DirectionalLight(0xffffff, 0.75);
  sun.position.set(6, 12, 4);
  scene.add(sun);

  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // 直式螢幕把視角拉寬一點，三條軌道才看得到
    camera.fov = w < h ? 78 : 62;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();

  // ---------- 貼圖產生 ----------
  const texLoader = new THREE.TextureLoader();
  const skinTex = {};
  for (const s of SKINS) {
    const info = window.SKIN_IMAGES[s.id];
    s.aspect = info.w / info.h;
    skinTex[s.id] = texLoader.load(info.src);
  }

  function gravelTexture(base, dots) {
    const [c, g] = makeCanvas(256, 256);
    g.fillStyle = base; g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 2600; i++) {
      g.fillStyle = pick(dots);
      g.fillRect(Math.random() * 256, Math.random() * 256, 1 + Math.random() * 3, 1 + Math.random() * 3);
    }
    return c;
  }

  const groundTex = canvasTex(gravelTexture('#8d7b67', ['#7a6957', '#a08d78', '#6b5c4c', '#b3a08a']), 30, 100);
  const trackTex = (() => {
    const c = gravelTexture('#5b5048', ['#4a413a', '#6e625a', '#3f3833', '#7d7068']);
    const g = c.getContext('2d');
    for (let y = 0; y < 256; y += 64) {
      g.fillStyle = '#5a3a22'; g.fillRect(10, y + 18, 236, 26);
      g.fillStyle = '#6e4a2e'; g.fillRect(10, y + 18, 236, 6);
      g.fillStyle = '#2f1f12'; g.fillRect(10, y + 40, 236, 4);
    }
    return canvasTex(c, 1, 100);
  })();

  // 塗鴉牆
  const GRAFFITI_WORDS = ['偉哲', 'WEIZHE', '偉哲到此一遊', '哞～', '肌肉!', '跑啊!', '小偉哲', 'WZ', '蘑菇', '偉哲最帥'];
  const GRAFFITI_COLORS = ['#ff3d7f', '#ffd23f', '#2bb3ff', '#3ddc84', '#c86bff', '#ff8a3d', '#ffffff'];
  function graffitiTexture(base) {
    const [c, g] = makeCanvas(512, 128);
    g.fillStyle = base; g.fillRect(0, 0, 512, 128);
    g.strokeStyle = 'rgba(0,0,0,.12)'; g.lineWidth = 2;
    for (let y = 0; y < 128; y += 16) {
      g.beginPath(); g.moveTo(0, y); g.lineTo(512, y); g.stroke();
      for (let x = (y / 16) % 2 ? 0 : 16; x < 512; x += 32) { g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + 16); g.stroke(); }
    }
    const n = 1 + randInt(2);
    for (let i = 0; i < n; i++) {
      const word = pick(GRAFFITI_WORDS);
      const size = word.length > 4 ? 40 : 58;
      g.save();
      g.translate(60 + i * 230 + rand(0, 40), 70 + rand(-10, 10));
      g.rotate(rand(-0.15, 0.1));
      g.font = `900 ${size}px "Arial Black", "Noto Sans TC", "Microsoft JhengHei", sans-serif`;
      g.lineJoin = 'round';
      g.lineWidth = 12; g.strokeStyle = '#111'; g.strokeText(word, 0, 0);
      const c1 = pick(GRAFFITI_COLORS), c2 = pick(GRAFFITI_COLORS);
      const grd = g.createLinearGradient(0, -size, 0, 0);
      grd.addColorStop(0, c1); grd.addColorStop(1, c2);
      g.fillStyle = grd; g.fillText(word, 0, 0);
      g.fillStyle = c2;
      for (let k = 0; k < 4; k++) g.fillRect(rand(0, size * 2), rand(0, 6), 3, rand(8, 28));
      g.restore();
    }
    return canvasTex(c, 3, 1);
  }
  const WALL_BASES = ['#8c8c96', '#a9846a', '#6f7f8f', '#9a9a7a', '#7a6a8a', '#8a7060'];
  const wallMats = [];
  for (let i = 0; i < 8; i++) wallMats.push(lam(0xffffff, { map: graffitiTexture(pick(WALL_BASES)) }));

  function windowsTexture(base) {
    const [c, g] = makeCanvas(128, 256);
    g.fillStyle = base; g.fillRect(0, 0, 128, 256);
    for (let y = 10; y < 256; y += 28) {
      for (let x = 10; x < 128; x += 28) {
        g.fillStyle = Math.random() < 0.25 ? '#ffe9a8' : '#3a4a66';
        g.fillRect(x, y, 16, 18);
      }
    }
    return canvasTex(c, 2, 3);
  }
  const bldgMats = ['#d98b6a', '#e8c37a', '#8fb3c9', '#c9a0c9', '#a3c98f', '#e0e0e0', '#b58f7a']
    .map((col) => lam(0xffffff, { map: windowsTexture(col) }));

  function stripeTexture(c1, c2, text) {
    const [c, g] = makeCanvas(256, 64);
    g.fillStyle = c1; g.fillRect(0, 0, 256, 64);
    g.fillStyle = c2;
    for (let x = -64; x < 256; x += 48) {
      g.beginPath(); g.moveTo(x, 64); g.lineTo(x + 24, 64); g.lineTo(x + 64, 0); g.lineTo(x + 40, 0); g.fill();
    }
    if (text) {
      g.fillStyle = 'rgba(255,255,255,.9)'; g.fillRect(78, 12, 100, 40);
      g.fillStyle = '#d01818'; g.font = '900 30px "Noto Sans TC", sans-serif';
      g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 128, 33);
    }
    return canvasTex(c);
  }
  const lowBarrierMat = lam(0xffffff, { map: stripeTexture('#ffffff', '#e02828') });
  const highBarrierMat = lam(0xffffff, { map: stripeTexture('#ffd23f', '#222222', '滾！') });
  const rampMat = lam(0xffffff, { map: stripeTexture('#ffd23f', '#333333') });
  const postMat = lam(0x555a60);
  const darkMat = lam(0x2a2a30);
  const roofMat = lam(0x9aa0a8);
  const railMat = lam(0xb8c0c8);

  const TRAIN_COLORS = ['#e8b400', '#c0c4cc', '#d8433a', '#2f7fd8', '#3aa86b', '#e86a2a'];
  function trainSideTexture(col) {
    const [c, g] = makeCanvas(512, 128);
    g.fillStyle = col; g.fillRect(0, 0, 512, 128);
    g.fillStyle = 'rgba(0,0,0,.2)'; g.fillRect(0, 92, 512, 10);
    g.fillStyle = 'rgba(255,255,255,.35)'; g.fillRect(0, 86, 512, 5);
    for (let x = 20; x < 512; x += 80) {
      g.fillStyle = '#1d2a3a'; g.fillRect(x, 22, 52, 46);
      g.fillStyle = 'rgba(255,255,255,.25)'; g.fillRect(x + 4, 26, 14, 38);
    }
    g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = 3;
    g.strokeRect(232, 14, 48, 104);
    if (Math.random() < 0.6) {
      g.save(); g.translate(rand(40, 300), 115); g.rotate(-0.05);
      g.font = '900 34px "Arial Black", sans-serif'; g.lineWidth = 7; g.strokeStyle = '#111';
      const w = pick(GRAFFITI_WORDS);
      g.strokeText(w, 0, 0); g.fillStyle = pick(GRAFFITI_COLORS); g.fillText(w, 0, 0);
      g.restore();
    }
    return canvasTex(c);
  }
  function trainFrontTexture(col, lit) {
    const [c, g] = makeCanvas(128, 128);
    g.fillStyle = col; g.fillRect(0, 0, 128, 128);
    g.fillStyle = '#1d2a3a'; g.fillRect(14, 16, 100, 44);
    g.fillStyle = 'rgba(255,255,255,.3)'; g.fillRect(20, 20, 26, 36);
    g.fillStyle = lit ? '#fff7b0' : '#d8d8c0';
    g.beginPath(); g.arc(28, 90, 10, 0, 7); g.arc(100, 90, 10, 0, 7); g.fill();
    if (lit) {
      g.fillStyle = 'rgba(255,240,150,.5)';
      g.beginPath(); g.arc(28, 90, 18, 0, 7); g.arc(100, 90, 18, 0, 7); g.fill();
    }
    g.fillStyle = '#222'; g.fillRect(50, 100, 28, 14);
    return canvasTex(c);
  }
  const trainMats = TRAIN_COLORS.map((col) => ({
    side: lam(0xffffff, { map: trainSideTexture(col) }),
    front: lam(0xffffff, { map: trainFrontTexture(col, false) }),
    frontLit: new THREE.MeshBasicMaterial({ map: trainFrontTexture(col, true) }),
    plain: lam(new THREE.Color(col)),
  }));

  function iconTexture(text, color) {
    const [c, g] = makeCanvas(128, 128);
    g.fillStyle = color; g.beginPath(); g.arc(64, 64, 58, 0, 7); g.fill();
    g.lineWidth = 8; g.strokeStyle = '#fff'; g.stroke();
    g.font = '64px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#fff';
    g.fillText(text, 64, 70);
    return new THREE.CanvasTexture(c);
  }
  const powerMats = {};
  for (const k in POWER_INFO) powerMats[k] = new THREE.SpriteMaterial({ map: iconTexture(POWER_INFO[k].icon, POWER_INFO[k].color) });

  // ---------- 共用幾何 ----------
  const unitBox = new THREE.BoxGeometry(1, 1, 1);
  const coinGeo = new THREE.CylinderGeometry(0.38, 0.38, 0.09, 20);
  coinGeo.rotateX(Math.PI / 2);
  const coinMat = lam(0xffc400, { emissive: 0x6a4a00 });

  function boxMesh(mat, w, h, d, x, y, z) {
    const m = new THREE.Mesh(unitBox, mat);
    m.scale.set(w, h, d);
    m.position.set(x, y, z);
    return m;
  }

  // ---------- 固定場景：地面、軌道 ----------
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(120, 400), lam(0xffffff, { map: groundTex }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.02;
  scene.add(ground);

  const trackMeshes = [];
  const trackMat = lam(0xffffff, { map: trackTex });
  for (const x of LANE_X) {
    const t = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 400), trackMat);
    t.rotation.x = -Math.PI / 2;
    t.position.set(x, 0, 0);
    scene.add(t); trackMeshes.push(t);
    for (const s of [-0.6, 0.6]) {
      const r = boxMesh(railMat, 0.1, 0.12, 400, x + s, 0.06, 0);
      scene.add(r); trackMeshes.push(r);
    }
  }

  // ---------- 兩側景物（循環使用） ----------
  const CHUNK_LEN = 40;
  const CHUNK_COUNT = 7;
  const chunks = [];
  function decorateChunk(ch) {
    for (const [side, parts] of [[-1, ch.left], [1, ch.right]]) {
      const wallH = rand(2.6, 4.2);
      parts.wall.material = pick(wallMats);
      parts.wall.scale.set(0.6, wallH, CHUNK_LEN);
      parts.wall.position.set(side * 5.2, wallH / 2, -CHUNK_LEN / 2);
      parts.bldgs.forEach((b, i) => {
        const w = rand(6, 10), h = rand(8, 22), d = CHUNK_LEN / 2 - rand(0, 3);
        b.material = pick(bldgMats);
        b.scale.set(w, h, d);
        b.position.set(side * (6.5 + w / 2 + rand(0, 3)), h / 2, -(i + 0.5) * (CHUNK_LEN / 2));
      });
      parts.lamp.visible = Math.random() < 0.6;
      parts.lamp.position.set(side * 4.6, 0, -rand(5, CHUNK_LEN - 5));
      parts.lamp.children[1].position.x = -side * 0.4;
    }
  }
  function makeLamp() {
    const g = new THREE.Group();
    g.add(boxMesh(postMat, 0.15, 5, 0.15, 0, 2.5, 0));
    g.add(boxMesh(lam(0xfff3b0, { emissive: 0x8a7a30 }), 0.9, 0.2, 0.35, -0.4, 5, 0));
    return g;
  }
  for (let i = 0; i < CHUNK_COUNT; i++) {
    const g = new THREE.Group();
    const ch = { group: g, d: i * CHUNK_LEN, left: {}, right: {} };
    for (const parts of [ch.left, ch.right]) {
      parts.wall = new THREE.Mesh(unitBox, wallMats[0]);
      parts.bldgs = [new THREE.Mesh(unitBox, bldgMats[0]), new THREE.Mesh(unitBox, bldgMats[0])];
      parts.lamp = makeLamp();
      g.add(parts.wall, ...parts.bldgs, parts.lamp);
    }
    decorateChunk(ch);
    g.position.z = -ch.d;
    scene.add(g);
    chunks.push(ch);
  }
  function resetChunks() {
    chunks.forEach((ch, i) => { ch.d = (i - 1) * CHUNK_LEN; ch.group.position.z = -ch.d; decorateChunk(ch); });
  }

  // ---------- 人物模型 ----------
  function buildCharacter(skin) {
    const root = new THREE.Group();
    root.scale.setScalar(1.15);
    const rig = new THREE.Group();      // 用來滾動、傾斜（中心點在身體中間）
    const inner = new THREE.Group();
    rig.add(inner); root.add(rig);
    inner.position.y = -1.0;
    rig.position.y = 1.0;
    const parts = { root, rig, inner, legs: [], arms: [] };

    if (skin.mode !== 'full') {
      const skinMat = lam(skin.skin), pantsMat = lam(skin.pants), shoeMat = lam(skin.shoe);
      for (const s of [-1, 1]) {
        const leg = new THREE.Group();
        leg.position.set(s * 0.16, 0.85, 0);
        leg.add(boxMesh(pantsMat, 0.25, 0.48, 0.27, 0, -0.22, 0));
        leg.add(boxMesh(skinMat, 0.19, 0.36, 0.2, 0, -0.6, 0));
        leg.add(boxMesh(shoeMat, 0.26, 0.14, 0.38, 0, -0.8, -0.05));
        inner.add(leg); parts.legs.push(leg);
      }
      if (skin.mode === 'head') {
        const shirtMat = lam(skin.shirt);
        inner.add(boxMesh(shirtMat, 0.64, 0.72, 0.36, 0, 1.2, 0));
        for (const s of [-1, 1]) {
          const arm = new THREE.Group();
          arm.position.set(s * 0.41, 1.5, 0);
          arm.add(boxMesh(shirtMat, 0.19, 0.34, 0.21, 0, -0.16, 0));
          arm.add(boxMesh(skinMat, 0.15, 0.34, 0.17, 0, -0.48, 0));
          inner.add(arm); parts.arms.push(arm);
        }
      } else {
        inner.add(boxMesh(pantsMat, 0.6, 0.26, 0.34, 0, 0.88, 0));
      }
    }

    const w = skin.h * skin.aspect;
    const sprite = new THREE.Mesh(
      new THREE.PlaneGeometry(w, skin.h),
      new THREE.MeshBasicMaterial({ map: skinTex[skin.id], transparent: true, alphaTest: 0.08, side: THREE.DoubleSide })
    );
    sprite.position.set(skin.offX, skin.bottom + skin.h / 2, 0.22);
    inner.add(sprite);
    parts.sprite = sprite;

    // 噴射背包（只有吃到時才顯示）
    const jet = new THREE.Group();
    const flameMat = new THREE.MeshBasicMaterial({ color: 0xffa020, transparent: true, opacity: 0.85 });
    for (const s of [-1, 1]) {
      const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.7, 12), lam(0xd0d4dc));
      tank.position.set(s * 0.62, 1.35, -0.05);
      const flame = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.6, 10), flameMat);
      flame.rotation.x = Math.PI;
      flame.position.set(s * 0.62, 0.7, -0.05);
      jet.add(tank, flame);
    }
    jet.visible = false;
    inner.add(jet);
    parts.jet = jet;

    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.6, 20),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false })
    );
    shadow.rotation.x = -Math.PI / 2;
    parts.shadow = shadow;
    return parts;
  }

  function animateCharacter(c, skin, t, s) {
    // s: { running, airborne, rolling, lean, dead }
    const { rig, legs, arms } = c;
    if (s.rolling) {
      rig.position.y = 0.45;
      rig.scale.setScalar(0.5);
      rig.rotation.z -= 0.35;
      return;
    }
    rig.scale.setScalar(1);
    rig.position.y = 1.0;
    if (s.dead) { rig.rotation.z = 0; return; }
    rig.rotation.z = s.lean;
    const ph = t * 11;
    if (skin.mode === 'full') {
      rig.rotation.z += s.airborne ? 0 : Math.sin(ph) * 0.13;
      rig.position.y += s.airborne ? 0 : Math.abs(Math.sin(ph)) * 0.18;
      const sq = s.airborne ? 1.08 : 1 - Math.abs(Math.cos(ph)) * 0.06;
      rig.scale.set(1 / Math.sqrt(sq), sq, 1);
      return;
    }
    if (s.airborne) {
      legs[0].rotation.x = 0.9; legs[1].rotation.x = -0.4;
      arms.forEach((a, i) => { a.rotation.x = 0; a.rotation.z = (i ? 1 : -1) * 2.3; });
    } else if (s.running) {
      legs[0].rotation.x = Math.sin(ph) * 0.9;
      legs[1].rotation.x = -Math.sin(ph) * 0.9;
      arms.forEach((a, i) => { a.rotation.x = (i ? 1 : -1) * Math.sin(ph) * 0.9; a.rotation.z = 0; });
      rig.position.y += Math.abs(Math.sin(ph)) * 0.08;
    } else {
      legs.forEach((l) => (l.rotation.x = 0));
      arms.forEach((a, i) => { a.rotation.x = 0; a.rotation.z = (i ? -1 : 1) * 0.1; });
      rig.position.y += Math.sin(t * 3) * 0.03;
    }
  }

  // 追人的站務員 + 狗
  function buildChaser() {
    const g = new THREE.Group();
    const uniform = lam(0x24407a), skinM = lam(0xe8b896), capM = lam(0x1a2a50), dogM = lam(0x9a6a3a);
    const guy = new THREE.Group();
    const legs = [], arms = [];
    for (const s of [-1, 1]) {
      const leg = new THREE.Group(); leg.position.set(s * 0.17, 0.9, 0);
      leg.add(boxMesh(uniform, 0.26, 0.85, 0.28, 0, -0.42, 0));
      leg.add(boxMesh(darkMat, 0.28, 0.14, 0.4, 0, -0.85, -0.05));
      guy.add(leg); legs.push(leg);
      const arm = new THREE.Group(); arm.position.set(s * 0.45, 1.6, 0);
      arm.add(boxMesh(uniform, 0.2, 0.7, 0.22, 0, -0.33, 0));
      guy.add(arm); arms.push(arm);
    }
    guy.add(boxMesh(uniform, 0.72, 0.8, 0.4, 0, 1.3, 0));
    guy.add(boxMesh(skinM, 0.42, 0.42, 0.4, 0, 1.95, 0));
    guy.add(boxMesh(capM, 0.48, 0.14, 0.5, 0, 2.2, -0.05));
    guy.add(boxMesh(capM, 0.4, 0.05, 0.25, 0, 2.14, -0.3));
    guy.add(boxMesh(lam(0x5a3a2a), 0.4, 0.08, 0.05, 0, 1.9, -0.21));
    guy.position.x = 1.1;   // 站在偉哲斜後方，才不會擋住鏡頭
    g.add(guy);
    const dog = new THREE.Group();
    dog.position.set(-1.1, 0, 0.6);
    dog.add(boxMesh(dogM, 0.35, 0.35, 0.8, 0, 0.5, 0));
    dog.add(boxMesh(dogM, 0.3, 0.3, 0.32, 0, 0.75, -0.48));
    dog.add(boxMesh(darkMat, 0.12, 0.1, 0.1, 0, 0.72, -0.68));
    const dlegs = [];
    for (const [x, z] of [[-0.12, -0.3], [0.12, -0.3], [-0.12, 0.3], [0.12, 0.3]]) {
      const l = boxMesh(dogM, 0.1, 0.35, 0.1, x, 0.17, z); dog.add(l); dlegs.push(l);
    }
    g.add(dog);
    g.scale.setScalar(0.9);
    return { group: g, legs, arms, dlegs, dog };
  }

  // ---------- 遊戲狀態 ----------
  let state = 'menu';
  let skinIndex = clamp(parseInt(storeGet('wz_skin', '0'), 10) || 0, 0, SKINS.length - 1);
  let best = parseInt(storeGet('wz_best', '0'), 10) || 0;
  let character = null;
  const chaser = buildChaser();
  scene.add(chaser.group);

  const p = {};
  let obstacles = [], coins = [], powerups = [];
  let genD = 0, segHistory = [], laneLastEnd = [0, 0, 0];
  let score = 0, coinCount = 0, time = 0, speed = BASE_SPEED;
  let powers = {};
  let stumbleTimer = 0, introTimer = 0, invincible = 0, deathTimer = 0;
  let jumpBuffer = 0;
  let camY = 3.5, camX = 0;

  function setCharacter(i) {
    skinIndex = i;
    storeSet('wz_skin', String(i));
    if (character) { scene.remove(character.root); scene.remove(character.shadow); }
    character = buildCharacter(SKINS[i]);
    scene.add(character.root);
    scene.add(character.shadow);
  }

  function clearWorld() {
    for (const o of obstacles) scene.remove(o.mesh);
    for (const c of coins) scene.remove(c.mesh);
    for (const pu of powerups) scene.remove(pu.mesh);
    obstacles = []; coins = []; powerups = [];
  }

  function resetGame() {
    clearWorld();
    Object.assign(p, { d: 0, prevD: 0, x: 0, y: 0, vy: 0, lane: 1, prevLane: 1, rollTimer: 0, grounded: true, dead: false });
    genD = 40; segHistory = []; laneLastEnd = [0, 0, 0];
    score = 0; coinCount = 0; time = 0; speed = BASE_SPEED;
    powers = {}; stumbleTimer = 0; introTimer = 2.6; invincible = 0; deathTimer = 0; jumpBuffer = 0;
    camY = 3.5; camX = 0;
    resetChunks();
    if (character) { character.rig.rotation.set(0, 0, 0); }
    // 起跑區撒一排金幣
    coinLine(1, 14, 38, () => 0.9);
    generate();
  }

  // ---------- 物件產生 ----------
  function addTrain(lane, d0, d1, moveSpeed) {
    const len = d1 - d0;
    const g = new THREE.Group();
    const mats = pick(trainMats);
    const nCars = Math.max(1, Math.round(len / 13));
    const carLen = len / nCars;
    for (let i = 0; i < nCars; i++) {
      const cl = carLen - (nCars > 1 ? 0.5 : 0);
      const zc = -(i * carLen + cl / 2);
      const front = i === 0 ? (moveSpeed ? mats.frontLit : mats.front) : mats.plain;
      const body = new THREE.Mesh(unitBox, [mats.side, mats.side, roofMat, darkMat, front, mats.plain]);
      body.scale.set(TRAIN_W, TRAIN_H - 0.4, cl);
      body.position.set(0, 0.4 + (TRAIN_H - 0.4) / 2, zc);
      g.add(body);
      g.add(boxMesh(darkMat, TRAIN_W * 0.8, 0.42, cl * 0.9, 0, 0.21, zc));
      g.add(boxMesh(roofMat, TRAIN_W * 0.6, 0.12, cl * 0.6, 0, TRAIN_H + 0.06, zc));
    }
    g.position.set(LANE_X[lane], 0, -d0);
    scene.add(g);
    const o = { type: 'train', lane, x: LANE_X[lane], d0, d1, h: TRAIN_H, mesh: g, speed: moveSpeed || 0 };
    obstacles.push(o);
    laneLastEnd[lane] = Math.max(laneLastEnd[lane], d1);
    return o;
  }

  function addRamp(lane, d0) {
    const d1 = d0 + RAMP_LEN;
    const g = new THREE.Group();
    const slope = Math.hypot(RAMP_LEN, TRAIN_H);
    const plank = new THREE.Mesh(unitBox, rampMat);
    plank.scale.set(TRAIN_W * 0.95, 0.18, slope);
    plank.rotation.x = Math.atan2(TRAIN_H, RAMP_LEN);
    plank.position.set(0, TRAIN_H / 2 - 0.08, -RAMP_LEN / 2);
    g.add(plank);
    for (const s of [-1, 1]) {
      g.add(boxMesh(postMat, 0.12, TRAIN_H * 0.5, 0.12, s * 0.9, TRAIN_H * 0.25, -RAMP_LEN * 0.5));
      g.add(boxMesh(postMat, 0.12, TRAIN_H, 0.12, s * 0.9, TRAIN_H * 0.5, -RAMP_LEN + 0.2));
    }
    g.position.set(LANE_X[lane], 0, -d0);
    scene.add(g);
    obstacles.push({ type: 'ramp', lane, x: LANE_X[lane], d0, d1, h: TRAIN_H, mesh: g, speed: 0 });
    laneLastEnd[lane] = Math.max(laneLastEnd[lane], d1);
  }

  function addBarrier(lane, d, kind) {
    const g = new THREE.Group();
    if (kind === 'low') {
      for (const s of [-1, 1]) g.add(boxMesh(postMat, 0.12, LOW_H, 0.12, s * 1.0, LOW_H / 2, 0));
      g.add(boxMesh(lowBarrierMat, 2.2, 0.5, 0.14, 0, LOW_H - 0.25, 0));
      g.add(boxMesh(lowBarrierMat, 2.2, 0.16, 0.12, 0, 0.3, 0));
    } else {
      for (const s of [-1, 1]) g.add(boxMesh(postMat, 0.14, HIGH_TOP, 0.14, s * 1.05, HIGH_TOP / 2, 0));
      g.add(boxMesh(highBarrierMat, 2.25, HIGH_TOP - HIGH_BOTTOM - 0.2, 0.16, 0, (HIGH_TOP + HIGH_BOTTOM) / 2 + 0.1, 0));
      for (const s of [-1, 1]) g.add(boxMesh(lam(0xff3030, { emissive: 0xaa0000 }), 0.22, 0.22, 0.22, s * 1.05, HIGH_TOP + 0.1, 0));
    }
    g.position.set(LANE_X[lane], 0, -d);
    scene.add(g);
    obstacles.push({ type: kind, lane, x: LANE_X[lane], d0: d - 0.2, d1: d + 0.2, mesh: g, speed: 0 });
    laneLastEnd[lane] = Math.max(laneLastEnd[lane], d + 0.2);
  }

  function addCoin(x, d, y) {
    const m = new THREE.Mesh(coinGeo, coinMat);
    m.position.set(x, y, -d);
    scene.add(m);
    coins.push({ x, d, y, mesh: m, magnet: false });
  }

  function coinLine(lane, a, b, yFn) {
    for (let d = a; d <= b; d += 2.4) addCoin(LANE_X[lane], d, yFn(d));
  }

  function addPowerup(kind, lane, d, y) {
    const s = new THREE.Sprite(powerMats[kind]);
    s.scale.set(1.2, 1.2, 1);
    s.position.set(LANE_X[lane], y, -d);
    scene.add(s);
    powerups.push({ kind, x: LANE_X[lane], d, y, mesh: s });
  }

  // 依照這條軌道上的障礙物算出金幣高度（跳過低柵欄、沿著斜坡爬上火車）
  function laneCoinY(laneObs, d) {
    let y = 0.9;
    for (const o of laneObs) {
      if (o.type === 'ramp' && d >= o.d0 && d <= o.d1) y = Math.max(y, (d - o.d0) / (o.d1 - o.d0) * o.h + 0.9);
      else if (o.type === 'train' && d >= o.d0 && d <= o.d1) y = Math.max(y, o.h + 0.9);
      else if (o.type === 'low' && Math.abs(d - (o.d0 + 0.2)) < 4) {
        const k = (d - (o.d0 + 0.2)) / 4;
        y = Math.max(y, 0.9 + 1.5 * (1 - k * k));
      } else if (o.type === 'high' && Math.abs(d - (o.d0 + 0.2)) < 1.3) y = 0.5;
    }
    return y;
  }

  function difficulty() { return clamp(genD / 4500, 0, 1); }

  function maybePowerup(lane, d, y) {
    if (genD < 150 || Math.random() > 0.13) return false;
    const r = Math.random();
    const kind = r < 0.35 ? 'magnet' : r < 0.6 ? 'sneakers' : r < 0.8 ? 'jetpack' : 'double';
    addPowerup(kind, lane, d, y);
    return true;
  }

  function placeCoinsAndPower(lane, a, b, laneObs) {
    let powerAt = -1;
    if (Math.random() < 0.13 && genD > 150) powerAt = a + (b - a) * rand(0.3, 0.7);
    for (let d = a; d <= b; d += 2.4) {
      const y = laneCoinY(laneObs, d);
      if (powerAt > 0 && Math.abs(d - powerAt) < 1.2) {
        maybePowerup(lane, d, y + 0.1) || addCoin(LANE_X[lane], d, y);
        powerAt = -1;
      } else {
        addCoin(LANE_X[lane], d, y);
      }
    }
  }

  function genTrainSegment() {
    const diff = difficulty();
    const L = rand(20, 32) + diff * 16;
    const d0 = genD;
    const kinds = [0, 1, 2].map(() => {
      const r = Math.random();
      if (r < 0.38 + diff * 0.14) return Math.random() < 0.33 ? 'ramp' : 'train';
      if (r < 0.64 + diff * 0.1) return 'barrier';
      return 'empty';
    });
    // 不能三條都被擋死
    if (kinds.filter((k) => k === 'train').length === 3) kinds[randInt(3)] = Math.random() < 0.5 ? 'ramp' : 'empty';
    const staticTrains = kinds.filter((k) => k === 'train').length;
    const recent = segHistory.slice(-2).reduce((a, b) => Math.max(a, b), 0);
    for (let i = 0; i < 3; i++) {
      if (kinds[i] === 'empty' && diff > 0.08 && d0 - laneLastEnd[i] >= 75 && staticTrains <= 1 && recent <= 1 &&
          Math.random() < 0.3 + diff * 0.25) {
        kinds[i] = 'moving';
        break;
      }
    }

    const laneObs = [[], [], []];
    const before = obstacles.length;
    for (let i = 0; i < 3; i++) {
      const start = d0 + rand(0, 5);
      const end = d0 + L;
      if (kinds[i] === 'train') {
        addTrain(i, start, end);
      } else if (kinds[i] === 'ramp') {
        addRamp(i, start);
        addTrain(i, start + RAMP_LEN, Math.max(end, start + RAMP_LEN + 12));
      } else if (kinds[i] === 'barrier') {
        const n = L > 30 ? 2 : 1;
        for (let k = 0; k < n; k++) addBarrier(i, d0 + 8 + (L - 8) * (k + 0.4) / n, Math.random() < 0.5 ? 'low' : 'high');
      } else if (kinds[i] === 'moving') {
        const len = rand(14, 24);
        addTrain(i, end - len, end, rand(6, 10) + diff * 5);
      }
    }
    for (let k = before; k < obstacles.length; k++) laneObs[obstacles[k].lane].push(obstacles[k]);

    // 金幣：優先放斜坡（帶你上車頂）、空軌、柵欄軌，偶爾放車頂
    const pref = ['ramp', 'empty', 'barrier', 'train'];
    let coinLane = -1;
    for (const want of pref) {
      const cands = [0, 1, 2].filter((i) => kinds[i] === want);
      if (cands.length && (want !== 'train' || Math.random() < 0.5)) { coinLane = pick(cands); break; }
    }
    if (coinLane >= 0) {
      const a = d0 + 2, b = kinds[coinLane] === 'train' || kinds[coinLane] === 'ramp'
        ? Math.max(...laneObs[coinLane].map((o) => o.d1)) - 1 : d0 + L;
      placeCoinsAndPower(coinLane, a, b, laneObs[coinLane]);
    }

    segHistory.push(staticTrains);
    const segEnd = Math.max(d0 + L, ...obstacles.slice(before).map((o) => o.d1));
    genD = segEnd + rand(10, 15) + speed * 0.2;
  }

  function genBarrierRow() {
    const d0 = genD + 8;
    const rows = Math.random() < 0.5 ? 1 : 2;
    const laneObs = [[], [], []];
    for (let r = 0; r < rows; r++) {
      const d = d0 + r * 15;
      const lanes = [0, 1, 2].filter(() => Math.random() < 0.8);
      if (lanes.length === 0) lanes.push(randInt(3));
      const kind = Math.random() < 0.5 ? 'low' : 'high';
      for (const i of lanes) {
        addBarrier(i, d, Math.random() < 0.75 ? kind : (kind === 'low' ? 'high' : 'low'));
        laneObs[i].push(obstacles[obstacles.length - 1]);
      }
    }
    const lane = randInt(3);
    placeCoinsAndPower(lane, d0 - 6, d0 + (rows - 1) * 15 + 6, laneObs[lane]);
    segHistory.push(0);
    genD = d0 + (rows - 1) * 15 + rand(12, 18) + speed * 0.2;
  }

  function generate() {
    while (genD < p.d + VIEW_AHEAD) {
      if (genD > 90 && Math.random() < 0.22) genBarrierRow();
      else genTrainSegment();
    }
  }

  function cleanup() {
    const limit = p.d - 15;
    obstacles = obstacles.filter((o) => { if (o.d1 < limit) { scene.remove(o.mesh); return false; } return true; });
    coins = coins.filter((c) => { if (c.d < p.d - 1.5 || c.taken) { scene.remove(c.mesh); return false; } return true; });
    powerups = powerups.filter((u) => { if (u.d < limit || u.taken) { scene.remove(u.mesh); return false; } return true; });
  }

  // ---------- 物理 / 碰撞 ----------
  function surfaceAt(x, d, y) {
    let g = 0;
    for (const o of obstacles) {
      if (o.type !== 'train' && o.type !== 'ramp') continue;
      if (Math.abs(x - o.x) > TRAIN_W / 2 + 0.05) continue;
      if (d < o.d0 || d > o.d1) continue;
      const h = o.type === 'ramp' ? (d - o.d0) / (o.d1 - o.d0) * o.h : o.h;
      if (h <= y + (o.type === 'ramp' ? 1.2 : 0.35) && h > g) g = h;
    }
    return g;
  }

  // 被側面撞到時退回的軌道（障礙物的另一側）
  function nearestLaneAwayFrom(o) {
    return clamp(o.lane + (o.x > p.x ? -1 : 1), 0, 2);
  }

  function checkCollisions() {
    const height = p.rollTimer > 0 ? ROLL_H : STAND_H;
    for (const o of obstacles) {
      if (p.d + HALF_D < o.d0 || p.d - HALF_D > o.d1) continue;
      const dx = Math.abs(p.x - o.x);
      if (o.type === 'train' || o.type === 'ramp') {
        if (dx > TRAIN_W / 2 + HALF_W - 0.15) continue;
        const top = o.type === 'ramp' ? clamp((p.d - o.d0) / (o.d1 - o.d0), 0, 1) * o.h : o.h;
        if (p.y >= top - 0.4) continue;
        if (invincible > 0) continue;
        const pen = p.d + HALF_D - o.d0;
        if (o.type === 'train' && dx < TRAIN_W / 2 && pen < 1.0 + o.speed * 0.06 + speed * 0.03) return crash();
        // 從側邊撞到：彈回原本軌道並絆倒
        const back = nearestLaneAwayFrom(o);
        if (back === o.lane) return crash();
        p.lane = back;
        p.x += (p.x < o.x ? -1 : 1) * 0.3;
        stumble();
        return;
      } else {
        if (dx > 1.1 + HALF_W - 0.1) continue;
        if (invincible > 0) continue;
        if (o.type === 'low' && p.y < LOW_H - 0.1) return crash();
        if (o.type === 'high' && p.y < HIGH_TOP && p.y + height > HIGH_BOTTOM) return crash();
      }
    }
  }

  function stumble() {
    if (stumbleTimer > 0) return crash(true);
    stumbleTimer = 5;
    sfx.stumble();
    showToast('差點被抓！');
  }

  function crash(caught) {
    if (p.dead) return;
    p.dead = true;
    state = 'dying';
    deathTimer = 0;
    sfx.crash();
    $('overTitle').textContent = caught ? '被抓到了！' : pick(['撞爛了！', '偉哲倒下了…', '哎呀！', '偉哲陣亡']);
  }

  function activatePower(kind) {
    sfx.power();
    powers[kind] = POWER_INFO[kind].dur;
    showToast(POWER_INFO[kind].icon + ' ' + POWER_INFO[kind].name + '！');
    if (kind === 'jetpack') {
      p.rollTimer = 0;
      invincible = POWER_INFO.jetpack.dur + 1.5;
      // 空中金幣
      let lane = p.lane;
      const end = p.d + speed * POWER_INFO.jetpack.dur;
      for (let d = p.d + 18; d < end - 10; d += 2.4) {
        if (Math.random() < 0.04) lane = clamp(lane + (Math.random() < 0.5 ? -1 : 1), 0, 2);
        addCoin(LANE_X[lane], d, 7.9);
      }
    }
  }

  // ---------- 輸入 ----------
  function moveLane(dir) {
    if (state !== 'playing') return;
    const nl = p.lane + dir;
    if (nl < 0 || nl > 2) { sfx.bump(); return; }
    p.prevLane = p.lane;
    p.lane = nl;
    sfx.lane();
  }
  function jump() {
    if (state !== 'playing') return;
    jumpBuffer = 0.18;
  }
  function roll() {
    if (state !== 'playing' || powers.jetpack) return;
    if (!p.grounded) p.vy = Math.min(p.vy, -30);
    if (p.rollTimer <= 0) sfx.roll();
    p.rollTimer = 0.75;
    jumpBuffer = 0;
  }

  window.addEventListener('keydown', (e) => {
    const k = e.key;
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' '].includes(k)) e.preventDefault();
    if (state === 'menu' && (k === 'Enter' || k === ' ')) return startGame();
    if (state === 'over' && (k === 'Enter' || k === ' ')) return startGame();
    if (k === 'p' || k === 'P' || k === 'Escape') return togglePause();
    if (e.repeat) return;
    if (k === 'ArrowLeft' || k === 'a' || k === 'A') moveLane(-1);
    else if (k === 'ArrowRight' || k === 'd' || k === 'D') moveLane(1);
    else if (k === 'ArrowUp' || k === 'w' || k === 'W' || k === ' ') jump();
    else if (k === 'ArrowDown' || k === 's' || k === 'S') roll();
  });

  let touchStart = null;
  canvas.addEventListener('touchstart', (e) => {
    const t = e.changedTouches[0];
    touchStart = { x: t.clientX, y: t.clientY, done: false };
  }, { passive: true });
  canvas.addEventListener('touchmove', (e) => {
    if (!touchStart || touchStart.done) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - touchStart.x, dy = t.clientY - touchStart.y;
    if (Math.hypot(dx, dy) < 28) return;
    touchStart.done = true;
    if (Math.abs(dx) > Math.abs(dy)) moveLane(dx > 0 ? 1 : -1);
    else if (dy < 0) jump();
    else roll();
  }, { passive: true });
  canvas.addEventListener('touchend', () => { touchStart = null; }, { passive: true });
  // 滑鼠拖曳也能玩（方便電腦測試）
  let mouseStart = null;
  canvas.addEventListener('mousedown', (e) => { mouseStart = { x: e.clientX, y: e.clientY, done: false }; });
  window.addEventListener('mousemove', (e) => {
    if (!mouseStart || mouseStart.done) return;
    const dx = e.clientX - mouseStart.x, dy = e.clientY - mouseStart.y;
    if (Math.hypot(dx, dy) < 30) return;
    mouseStart.done = true;
    if (Math.abs(dx) > Math.abs(dy)) moveLane(dx > 0 ? 1 : -1);
    else if (dy < 0) jump(); else roll();
  });
  window.addEventListener('mouseup', () => { mouseStart = null; });

  // ---------- UI ----------
  const hud = $('hud');
  let toastTimer = 0;
  function showToast(text) {
    const t = $('toast');
    t.textContent = text;
    t.classList.add('show');
    toastTimer = 1.4;
  }
  function showScreen(id) {
    for (const s of ['menu', 'pauseScreen', 'overScreen']) $(s).classList.toggle('show', s === id);
    hud.classList.toggle('show', id === null || id === 'pauseScreen');
  }

  function buildCards() {
    const wrap = $('cards');
    wrap.innerHTML = '';
    SKINS.forEach((s, i) => {
      const b = document.createElement('button');
      b.className = 'card' + (i === skinIndex ? ' sel' : '');
      b.innerHTML = `<img src="${window.SKIN_IMAGES[s.id].src}" alt=""><b>${s.name}</b><small>${s.desc}</small>`;
      b.addEventListener('click', () => {
        setCharacter(i);
        [...wrap.children].forEach((c, j) => c.classList.toggle('sel', j === i));
        sfx.coin();
      });
      wrap.appendChild(b);
    });
  }

  let lastPowerHtml = '';
  function updateHud() {
    $('scoreTxt').textContent = Math.floor(score).toLocaleString();
    $('coinTxt').textContent = coinCount;
    $('multTxt').textContent = 'x' + (powers.double ? 2 : 1);
    let html = '';
    for (const k in powers) {
      const pct = (powers[k] / POWER_INFO[k].dur) * 100;
      html += `<div class="power"><span class="ic">${POWER_INFO[k].icon}</span><span class="bar"><i style="width:${pct.toFixed(0)}%"></i></span></div>`;
    }
    if (html !== lastPowerHtml) { $('powers').innerHTML = html; lastPowerHtml = html; }
  }

  function startGame() {
    audio();
    resetGame();
    state = 'playing';
    showScreen(null);
  }
  function togglePause() {
    if (state === 'playing') { state = 'paused'; showScreen('pauseScreen'); }
    else if (state === 'paused') { state = 'playing'; showScreen(null); }
  }
  function toMenu() {
    state = 'menu';
    resetGame();
    $('bestTxt').textContent = best.toLocaleString();
    buildCards();
    showScreen('menu');
  }
  function gameOver() {
    state = 'over';
    const s = Math.floor(score);
    if (s > best) { best = s; storeSet('wz_best', String(best)); }
    $('overScore').textContent = s.toLocaleString();
    $('overCoins').textContent = coinCount;
    $('overBest').textContent = best.toLocaleString();
    $('overImg').src = window.SKIN_IMAGES[SKINS[skinIndex].id].src;
    showScreen('overScreen');
  }

  $('startBtn').addEventListener('click', startGame);
  $('againBtn').addEventListener('click', startGame);
  $('menuBtn').addEventListener('click', toMenu);
  $('pauseBtn').addEventListener('click', togglePause);
  $('resumeBtn').addEventListener('click', togglePause);
  $('quitBtn').addEventListener('click', toMenu);
  const muteBtn = $('muteBtn');
  muteBtn.textContent = muted ? '🔇' : '🔊';
  muteBtn.addEventListener('click', () => {
    muted = !muted;
    storeSet('wz_muted', muted ? '1' : '0');
    muteBtn.textContent = muted ? '🔇' : '🔊';
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden && state === 'playing') togglePause(); });

  // ---------- 主更新 ----------
  function updatePlaying(dt) {
    time += dt;
    speed = BASE_SPEED + (MAX_SPEED - BASE_SPEED) * clamp(p.d / 6000, 0, 1);
    p.prevD = p.d;
    p.d += speed * dt;

    // 左右移動
    const tx = LANE_X[p.lane];
    const diffX = tx - p.x;
    const stepX = Math.max(14 * dt, Math.abs(diffX) * 14 * dt);
    p.x = Math.abs(diffX) <= stepX ? tx : p.x + Math.sign(diffX) * stepX;

    // 計時器
    for (const k in powers) { powers[k] -= dt; if (powers[k] <= 0) delete powers[k]; }
    if (stumbleTimer > 0) stumbleTimer -= dt;
    if (introTimer > 0) introTimer -= dt;
    if (invincible > 0) invincible -= dt;
    if (p.rollTimer > 0) p.rollTimer -= dt;
    if (jumpBuffer > 0) jumpBuffer -= dt;

    // 上下
    if (powers.jetpack) {
      p.y += (7.5 - p.y) * Math.min(1, dt * 3);
      p.vy = 0;
      p.grounded = false;
    } else {
      p.vy += GRAVITY * dt;
      p.y += p.vy * dt;
      const g = surfaceAt(p.x, p.d, p.y);
      if (p.y <= g) { p.y = g; p.vy = 0; p.grounded = true; }
      else p.grounded = p.y - g < 0.05 && p.vy <= 0;
      if (jumpBuffer > 0 && p.grounded) {
        p.vy = powers.sneakers ? SUPER_JUMP_V : JUMP_V;
        p.grounded = false;
        p.rollTimer = 0;
        jumpBuffer = 0;
        sfx.jump();
      }
    }

    // 會動的火車
    for (const o of obstacles) {
      if (!o.speed) continue;
      o.d0 -= o.speed * dt; o.d1 -= o.speed * dt;
      o.mesh.position.z = -o.d0;
    }

    checkCollisions();
    if (p.dead) return;

    // 金幣
    const height = p.rollTimer > 0 ? ROLL_H : STAND_H;
    for (const c of coins) {
      if (c.taken) continue;
      const dd = c.d - p.d;
      if (powers.magnet && !c.magnet && dd < 16 && dd > -2 && Math.abs(c.x - p.x) < 7) c.magnet = true;
      if (c.magnet) {
        const tx2 = p.x, ty = p.y + 1, td = p.d;
        const vx = tx2 - c.x, vy = ty - c.y, vd = td - c.d;
        const len = Math.hypot(vx, vy, vd) || 1;
        const step = Math.min(len, (30 + speed) * dt);
        c.x += vx / len * step; c.y += vy / len * step; c.d += vd / len * step;
        if (len < 0.8) { c.taken = true; coinCount++; sfx.coin(); }
        continue;
      }
      if (Math.abs(dd) < 0.8 && Math.abs(c.x - p.x) < 0.9 && c.y > p.y - 0.4 && c.y < p.y + height + 0.4) {
        c.taken = true; coinCount++; sfx.coin();
      }
    }
    for (const u of powerups) {
      if (u.taken) continue;
      if (Math.abs(u.d - p.d) < 1 && Math.abs(u.x - p.x) < 1 && u.y > p.y - 0.6 && u.y < p.y + height + 0.6) {
        u.taken = true;
        activatePower(u.kind);
      }
    }

    score += (p.d - p.prevD) * (powers.double ? 2 : 1);
    generate();
    cleanup();
  }

  function updateWorldVisuals(dt) {
    const pz = -p.d;
    // 地面、軌道對齊到貼圖重複的倍數，看起來就像固定在世界上
    ground.position.z = Math.round(pz / 8) * 8 - 120;
    for (const t of trackMeshes) t.position.z = Math.round(pz / 4) * 4 - 120;
    // 兩側景物循環
    for (const ch of chunks) {
      if (ch.d + CHUNK_LEN < p.d - 12) {
        ch.d += CHUNK_COUNT * CHUNK_LEN;
        ch.group.position.z = -ch.d;
        decorateChunk(ch);
      }
    }
    for (const c of coins) {
      c.mesh.position.set(c.x, c.y, -c.d);
      c.mesh.rotation.y = time * 4 + c.d * 0.3;
    }
    for (const u of powerups) u.mesh.position.y = u.y + Math.sin(time * 4 + u.d) * 0.15;

    // 角色
    const skin = SKINS[skinIndex];
    const c = character;
    c.root.position.set(p.x, p.y, pz);
    c.jet.visible = !!powers.jetpack;
    if (c.jet.visible) c.jet.children.forEach((m, i) => { if (i % 2) m.scale.y = 0.8 + Math.random() * 0.6; });
    const blink = invincible > 0 && invincible < 1.5 && !powers.jetpack && Math.floor(time * 12) % 2 === 0;
    c.root.visible = !blink;
    if (state === 'dying') {
      c.rig.rotation.x = Math.max(c.rig.rotation.x - dt * 6, -1.4);
    } else {
      c.rig.rotation.x = 0;
    }
    animateCharacter(c, skin, time, {
      running: state === 'playing',
      airborne: state === 'playing' && !p.grounded,
      rolling: state === 'playing' && p.rollTimer > 0,
      lean: -(LANE_X[p.lane] - p.x) * 0.12,
      dead: state === 'dying',
    });
    const g = powers.jetpack ? surfaceAt(p.x, p.d, 99) : surfaceAt(p.x, p.d, p.y);
    c.shadow.position.set(p.x, g + 0.03, pz);
    const sc = clamp(1 - (p.y - g) * 0.15, 0.4, 1);
    c.shadow.scale.setScalar(sc);

    // 追兵
    const near = state === 'dying' ? 1.8 : (stumbleTimer > 0 || introTimer > 0) ? 3.4 : 16;
    chaser.gap = chaser.gap == null ? 3 : chaser.gap + (near - chaser.gap) * Math.min(1, dt * (near < 5 ? 3 : 0.8));
    chaser.group.visible = chaser.gap < 12;
    chaser.x = chaser.x == null ? p.x : chaser.x + (p.x - chaser.x) * Math.min(1, dt * 5);
    chaser.group.position.set(chaser.x, 0, pz + chaser.gap);
    const ph = time * 11;
    const run = state === 'playing' || state === 'dying' ? 1 : 0.1;
    chaser.legs[0].rotation.x = Math.sin(ph) * 0.8 * run;
    chaser.legs[1].rotation.x = -Math.sin(ph) * 0.8 * run;
    chaser.arms[0].rotation.x = -Math.sin(ph) * 0.8 * run;
    chaser.arms[1].rotation.x = Math.sin(ph) * 0.8 * run;
    chaser.dlegs.forEach((l, i) => (l.rotation.x = Math.sin(ph * 1.3 + (i % 2) * Math.PI) * 0.7 * run));
    chaser.dog.position.y = Math.abs(Math.sin(ph * 1.3)) * 0.1 * run;

    // 相機
    camX += (p.x * 0.85 - camX) * Math.min(1, dt * 6);
    const targetY = 3.2 + p.y * 0.75;
    camY += (targetY - camY) * Math.min(1, dt * 4);
    let shake = 0;
    if (state === 'dying' && deathTimer < 0.4) shake = (0.4 - deathTimer) * 0.6;
    camera.position.set(camX + rand(-shake, shake), camY + rand(-shake, shake), pz + 5.8);
    camera.lookAt(camX * 0.9, camY - 2.0, pz - 9);
  }

  // ---------- 主迴圈 ----------
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (state === 'playing') {
      updatePlaying(dt);
      updateHud();
    } else if (state === 'dying') {
      deathTimer += dt;
      time += dt;
      if (deathTimer > 1.3) gameOver();
    } else if (state === 'menu') {
      time += dt;
    }
    if (toastTimer > 0) { toastTimer -= dt; if (toastTimer <= 0) $('toast').classList.remove('show'); }
    updateWorldVisuals(state === 'paused' ? 0 : dt);
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }

  // 測試用：網址加上 ?debug 可以從 console 操作
  if (/[?&]debug/.test(location.search)) {
    window.__wz = {
      get p() { return p; }, get obstacles() { return obstacles; }, get state() { return state; },
      get coins() { return coinCount; }, get score() { return score; },
      power: activatePower, god() { invincible = 1e9; },
    };
  }

  setCharacter(skinIndex);
  toMenu();
  requestAnimationFrame(frame);
})();
