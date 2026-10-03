/* 偉哲跑酷 — 地鐵跑酷風格的 3D 無盡跑酷（Three.js）
 * 座標：玩家沿著 -z 前進。程式內用 d（前進距離）表示位置，世界座標 z = -d。
 * 畫面上的「彎曲地平線」是在 vertex shader 裡把遠處往下、往旁邊彎，碰撞判定仍然是直線。
 */
(() => {
  'use strict';

  THREE.ColorManagement.legacyMode = false;

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
  const FEET_Y = 0.14;          // 角色腳底高度（站在枕木上）
  const BOARDS_PER_RUN = 3;
  const BOARD_TIME = 30;

  const SKINS = [
    { id: 'original', name: '原味偉哲', desc: '最純粹的偉哲', mode: 'head', h: 1.3, bottom: 1.12, offX: 0.03,
      shirt: 0xf6f6f6, pants: 0x223055, skin: 0xe2ab8c, shoe: 0xff4d5e },
    { id: 'mushroom', name: '毒菇偉哲', desc: '吸一口跑更快？', mode: 'head', h: 1.85, bottom: 1.15, offX: -0.23,
      shirt: 0xeadfc4, pants: 0x5a3d2b, skin: 0xe2ab8c, shoe: 0xd83a2a },
    { id: 'cow', name: '黃牛偉哲', desc: '哞～黃牛票一張', mode: 'full', h: 2.15, bottom: 0, offX: 0 },
    { id: 'muscle', name: '猛男偉哲', desc: '蛋白質滿滿', mode: 'bust', h: 1.8, bottom: 0.6, offX: 0,
      pants: 0x2b6cff, skin: 0xf0a46a, shoe: 0xffffff },
  ];

  const ADS = {
    original: ['原味偉哲', '純天然・無添加', '#2bb3ff'],
    mushroom: ['毒菇偉哲', '森林限定 一口升天', '#3ddc84'],
    cow: ['黃牛偉哲', '演唱會門票 加價收', '#ff9a1f'],
    muscle: ['猛男偉哲', '高蛋白鮮奶 每天一桶', '#ff3d7f'],
  };

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
    t.encoding = THREE.sRGBEncoding;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(rx, ry);
    t.anisotropy = 4;
    return t;
  }
  function roundRect(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
  }
  function loadImage(src) {
    return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
  }

  // ---------- 彎曲世界 ----------
  const curveU = { uBend: { value: 0.0011 }, uSway: { value: 0 } };
  const CURVE_VS = `
    vec4 cwPos = vec4( transformed, 1.0 );
    #ifdef USE_INSTANCING
      cwPos = instanceMatrix * cwPos;
    #endif
    cwPos = modelMatrix * cwPos;
    float cwDz = min( cwPos.z - cameraPosition.z, 0.0 );
    cwPos.y -= cwDz * cwDz * uBend;
    cwPos.x += cwDz * cwDz * uSway;
    vec4 mvPosition = viewMatrix * cwPos;
    gl_Position = projectionMatrix * mvPosition;
  `;
  function curved(mat) {
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uBend = curveU.uBend;
      sh.uniforms.uSway = curveU.uSway;
      sh.vertexShader = 'uniform float uBend;\nuniform float uSway;\n' + sh.vertexShader.replace('#include <project_vertex>', CURVE_VS);
    };
    return mat;
  }
  const lam = (color, extra) => curved(new THREE.MeshLambertMaterial(Object.assign({ color }, extra || {})));
  const basic = (opts) => curved(new THREE.MeshBasicMaterial(opts));

  // ---------- 音效與音樂（WebAudio 合成，不用外部檔案） ----------
  let actx = null, noiseBuf = null, musicGain = null;
  let muted = storeGet('wz_muted', '0') === '1';
  let musicOn = storeGet('wz_music', '1') === '1';
  function audio() {
    if (muted) return null;
    try {
      if (!actx) {
        actx = new (window.AudioContext || window.webkitAudioContext)();
        noiseBuf = actx.createBuffer(1, actx.sampleRate, actx.sampleRate);
        const ch = noiseBuf.getChannelData(0);
        for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1;
        musicGain = actx.createGain();
        musicGain.gain.value = 0.22;
        musicGain.connect(actx.destination);
      }
      if (actx.state === 'suspended') actx.resume();
      return actx;
    } catch (e) { return null; }
  }
  function tone(type, f0, f1, dur, vol, delay = 0, dest) {
    const a = audio(); if (!a) return;
    const t = a.currentTime + delay;
    const o = a.createOscillator(), g = a.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest || a.destination);
    o.start(t); o.stop(t + dur + 0.02);
  }
  function noise(dur, vol, freq = 0, at = 0, dest) {
    const a = audio(); if (!a) return;
    const t = at || a.currentTime;
    const s = a.createBufferSource(), g = a.createGain();
    s.buffer = noiseBuf;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let node = s;
    if (freq) { const f = a.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = freq; s.connect(f); node = f; }
    node.connect(g).connect(dest || a.destination);
    s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.02);
  }
  let coinCombo = 0, coinComboTimer = 0;
  const sfx = {
    coin() {
      const f = 1250 * Math.pow(1.03, Math.min(coinCombo, 16));
      tone('square', f, f * 1.5, 0.07, 0.035);
      coinCombo++; coinComboTimer = 0.45;
    },
    jump() { tone('sine', 260, 760, 0.17, 0.12); },
    land() { noise(0.06, 0.05, 800); },
    roll() { noise(0.18, 0.08, 1500); tone('triangle', 420, 140, 0.18, 0.08); },
    lane() { noise(0.07, 0.04, 2500); },
    bump() { tone('square', 140, 80, 0.12, 0.08); },
    stumble() { tone('sawtooth', 200, 60, 0.25, 0.12); noise(0.15, 0.15); },
    crash() { noise(0.6, 0.35); tone('sawtooth', 300, 40, 0.6, 0.15); },
    board() { [523, 659, 784].forEach((f, i) => tone('triangle', f, f, 0.12, 0.08, i * 0.06)); },
    boardBreak() { noise(0.35, 0.3, 300); tone('square', 600, 120, 0.3, 0.08); },
    power() { [660, 880, 1100, 1320].forEach((f, i) => tone('square', f, f * 1.02, 0.09, 0.05, i * 0.07)); },
  };

  // 簡單的背景節奏：大鼓、小鼓、鈸、貝斯、和弦
  const music = { timer: null, next: 0, step: 0 };
  const BPM = 132;
  const BASS = [45, 45, 57, 45, 41, 41, 53, 41, 48, 48, 60, 48, 43, 43, 55, 47];
  const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
  function musicStep(s, t) {
    const a = actx;
    if (s % 4 === 0) {
      const o = a.createOscillator(), g = a.createGain();
      o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.12);
      g.gain.setValueAtTime(0.9, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
      o.connect(g).connect(musicGain); o.start(t); o.stop(t + 0.2);
    }
    if (s % 8 === 4) noise(0.14, 0.35, 1200, t, musicGain);
    if (s % 2 === 1) noise(0.04, 0.12, 7000, t, musicGain);
    if (s % 2 === 0) {
      const note = BASS[(s >> 1) % 16 + 0] ;
      const o = a.createOscillator(), g = a.createGain();
      o.type = 'sawtooth'; o.frequency.value = mtof(note);
      const f = a.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 600;
      g.gain.setValueAtTime(0.18, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
      o.connect(f).connect(g).connect(musicGain); o.start(t); o.stop(t + 0.22);
    }
    if (s % 16 === 6 || s % 16 === 14) {
      const root = BASS[((s >> 1) % 16)] + 24;
      for (const iv of [0, 3, 7]) {
        const o = a.createOscillator(), g = a.createGain();
        o.type = 'square'; o.frequency.value = mtof(root + iv);
        g.gain.setValueAtTime(0.035, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
        o.connect(g).connect(musicGain); o.start(t); o.stop(t + 0.16);
      }
    }
  }
  function musicStart() {
    musicStop();
    if (!musicOn || muted) return;
    const a = audio(); if (!a) return;
    music.next = a.currentTime + 0.08; music.step = 0;
    music.timer = setInterval(() => {
      if (!actx) return;
      while (music.next < actx.currentTime + 0.12) {
        musicStep(music.step, music.next);
        music.step = (music.step + 1) % 128;
        music.next += 60 / BPM / 4;
      }
    }, 25);
  }
  function musicStop() { if (music.timer) { clearInterval(music.timer); music.timer = null; } }

  // ---------- Three.js 基本設定 ----------
  const canvas = $('game');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene();
  const FOG_COLOR = 0xbfe6ff;
  scene.fog = new THREE.Fog(FOG_COLOR, 60, 175);
  {
    const [c, g] = makeCanvas(2, 512);
    const grd = g.createLinearGradient(0, 0, 0, 512);
    grd.addColorStop(0, '#1f8cff'); grd.addColorStop(0.5, '#7cc6ff'); grd.addColorStop(0.78, '#bfe6ff'); grd.addColorStop(1, '#e6f6ff');
    g.fillStyle = grd; g.fillRect(0, 0, 2, 512);
    const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding;
    scene.background = t;
  }
  const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 260);
  scene.add(camera);
  scene.add(new THREE.HemisphereLight(0xe8f4ff, 0x6a5a48, 0.6));
  const sun = new THREE.DirectionalLight(0xfff2dd, 0.8);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -13, right: 13, top: 26, bottom: -14, near: 1, far: 60 });
  sun.shadow.bias = -0.0008;
  scene.add(sun, sun.target);

  let baseFov = 62;
  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    baseFov = w < h ? 76 : 60;   // 直式螢幕視角拉寬，三條軌道才看得到
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();

  // 天空：太陽、雲
  const skyGroup = new THREE.Group();
  camera.add(skyGroup);
  {
    const [c, g] = makeCanvas(256, 256);
    const grd = g.createRadialGradient(128, 128, 10, 128, 128, 128);
    grd.addColorStop(0, 'rgba(255,255,240,1)'); grd.addColorStop(0.22, 'rgba(255,250,210,1)');
    grd.addColorStop(0.3, 'rgba(255,240,180,.5)'); grd.addColorStop(1, 'rgba(255,240,180,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 256, 256);
    const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding;
    const s = new THREE.Mesh(new THREE.PlaneGeometry(60, 60),
      new THREE.MeshBasicMaterial({ map: t, transparent: true, fog: false, depthWrite: false }));
    s.position.set(55, 70, -230);
    s.renderOrder = -2;
    skyGroup.add(s);
  }
  const cloudMat = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0xbcd4e6, fog: false });
  const cloudGeo = new THREE.IcosahedronGeometry(1, 1);
  const clouds = [];
  for (let i = 0; i < 9; i++) {
    const g = new THREE.Group();
    const n = 4 + randInt(4);
    for (let k = 0; k < n; k++) {
      const m = new THREE.Mesh(cloudGeo, cloudMat);
      const r = rand(5, 10);
      m.scale.set(r * 1.3, r * 0.8, r);
      m.position.set((k - n / 2) * rand(5, 8), rand(-2, 3), rand(-3, 3));
      g.add(m);
    }
    g.userData.speed = rand(0.6, 1.4);
    g.position.set(rand(-160, 160), rand(45, 85), rand(-240, -170));
    skyGroup.add(g);
    clouds.push(g);
  }

  // ---------- 貼圖產生 ----------
  function noiseCanvas(w, h, base, dots, count) {
    const [c, g] = makeCanvas(w, h);
    g.fillStyle = base; g.fillRect(0, 0, w, h);
    for (let i = 0; i < count; i++) {
      g.fillStyle = pick(dots);
      const s = 1 + Math.random() * 3;
      g.fillRect(Math.random() * w, Math.random() * h, s, s);
    }
    return [c, g];
  }

  const groundTex = canvasTex(noiseCanvas(256, 256, '#8a7a64', ['#786852', '#9b8c76', '#6c5c48', '#ac9e88', '#7f8a5a'], 3200)[0], 30, 100);
  const ballastTex = canvasTex(noiseCanvas(128, 256, '#6d655e', ['#5a534d', '#80776f', '#4a443f', '#958c84', '#6a5a4c'], 2600)[0], 1, 75);

  // 牆面：混凝土＋塗鴉
  const GRAFFITI_WORDS = ['偉哲', 'WEIZHE', '偉哲到此一遊', '哞～', '肌肉!', '跑啊!', '小偉哲', 'WZ', '蘑菇', '偉哲最帥', 'RUN!', '抓不到'];
  const GRAFFITI_COLORS = ['#ff3d7f', '#ffd23f', '#2bb3ff', '#3ddc84', '#c86bff', '#ff8a3d', '#ffffff', '#00e0c6'];
  function sprayWord(g, word, x, y, size, rot) {
    g.save();
    g.translate(x, y); g.rotate(rot);
    g.font = `900 ${size}px "Titan One", "Arial Black", "Noto Sans TC", "Microsoft JhengHei", sans-serif`;
    g.lineJoin = 'round';
    g.lineWidth = size * 0.36; g.strokeStyle = '#fff'; g.strokeText(word, 0, 0);
    g.lineWidth = size * 0.2; g.strokeStyle = '#141420'; g.strokeText(word, 0, 0);
    const c1 = pick(GRAFFITI_COLORS), c2 = pick(GRAFFITI_COLORS);
    const grd = g.createLinearGradient(0, -size, 0, 0);
    grd.addColorStop(0, c1); grd.addColorStop(1, c2);
    g.fillStyle = grd; g.fillText(word, 0, 0);
    g.fillStyle = 'rgba(255,255,255,.55)';
    g.fillRect(size * 0.1, -size * 0.75, size * 0.25, size * 0.08);
    g.fillStyle = c2;
    const w = g.measureText(word).width;
    for (let k = 0; k < 5; k++) g.fillRect(rand(0, w), rand(0, 4), 3, rand(8, 26));
    g.restore();
  }
  function graffitiTexture(base) {
    const [c, g] = noiseCanvas(1024, 256, base, ['rgba(0,0,0,.06)', 'rgba(255,255,255,.06)'], 4000);
    g.strokeStyle = 'rgba(0,0,0,.18)'; g.lineWidth = 3;
    for (let x = 0; x < 1024; x += 128) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 256); g.stroke(); }
    const grd = g.createLinearGradient(0, 180, 0, 256);
    grd.addColorStop(0, 'rgba(0,0,0,0)'); grd.addColorStop(1, 'rgba(40,30,20,.35)');
    g.fillStyle = grd; g.fillRect(0, 180, 1024, 76);
    const n = 2 + randInt(2);
    for (let i = 0; i < n; i++) {
      const word = pick(GRAFFITI_WORDS);
      sprayWord(g, word, 40 + i * (960 / n) + rand(0, 40), 165 + rand(-15, 15), word.length > 4 ? 64 : 92, rand(-0.12, 0.08));
    }
    return canvasTex(c, 1, 1);
  }
  const WALL_BASES = ['#a3a39e', '#b8957a', '#8c99a6', '#a8a78a', '#9a8aa8', '#a88a78', '#b0b0b0'];
  const wallMats = [];
  const capMat = lam(0xd8d4cc);

  function windowsTexture(base, trim) {
    const [c, g] = makeCanvas(256, 512);
    g.fillStyle = base; g.fillRect(0, 0, 256, 512);
    for (let y = 0; y < 512; y += 64) { g.fillStyle = trim; g.fillRect(0, y + 56, 256, 8); }
    for (let y = 12; y < 512; y += 64) {
      for (let x = 14; x < 256; x += 60) {
        g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(x - 3, y - 3, 40, 46);
        const lit = Math.random() < 0.18;
        const grd = g.createLinearGradient(x, y, x + 34, y + 40);
        grd.addColorStop(0, lit ? '#fff2b0' : '#9fc8ef'); grd.addColorStop(1, lit ? '#ffd27a' : '#3b5f8a');
        g.fillStyle = grd; g.fillRect(x, y, 34, 40);
        g.fillStyle = trim; g.fillRect(x + 15, y, 4, 40);
        if (Math.random() < 0.3) { g.fillStyle = pick(['#ff7a7a', '#7affb0', '#ffe07a', '#7ab8ff']); g.fillRect(x, y, 34, 10); }
      }
    }
    return canvasTex(c, 1, 1);
  }
  const bldgMats = [['#e8946f', '#c46d4b'], ['#f2cd7f', '#c99f4a'], ['#93bcd6', '#5f88a3'], ['#d3a6d3', '#a072a0'],
    ['#a9d394', '#73a05f'], ['#efefe6', '#b9b9ac'], ['#c49a83', '#8f6a55'], ['#f5a3a3', '#c46d6d']]
    .map(([b, t]) => lam(0xffffff, { map: windowsTexture(b, t) }));
  const roofMats = [lam(0x8a8f96), lam(0x6f747a), lam(0xa09a90)];

  function stripeTexture(c1, c2, text) {
    const [c, g] = makeCanvas(256, 64);
    g.fillStyle = c1; g.fillRect(0, 0, 256, 64);
    g.fillStyle = c2;
    for (let x = -64; x < 256; x += 48) {
      g.beginPath(); g.moveTo(x, 64); g.lineTo(x + 24, 64); g.lineTo(x + 64, 0); g.lineTo(x + 40, 0); g.fill();
    }
    if (text) {
      roundRect(g, 64, 8, 128, 48, 10);
      g.fillStyle = '#fff'; g.fill(); g.lineWidth = 4; g.strokeStyle = '#d01818'; g.stroke();
      g.fillStyle = '#d01818'; g.font = '900 30px "Noto Sans TC", "Microsoft JhengHei", sans-serif';
      g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 128, 33);
    }
    return canvasTex(c);
  }
  const lowBarrierMat = lam(0xffffff, { map: stripeTexture('#ffffff', '#e02828') });
  const highBarrierMat = lam(0xffffff, { map: stripeTexture('#ffd23f', '#222222', '滾過去') });
  const rampMat = lam(0xffffff, { map: stripeTexture('#ffd23f', '#333333') });
  const postMat = lam(0x5d646c);
  const darkMat = lam(0x2a2a30);
  const metalMat = lam(0xb8c0c8);
  const railMat = lam(0xc8d0d8, { emissive: 0x222428 });
  const woodMat = lam(0x6e4a2e);
  const blinkMat = lam(0xff3030, { emissive: 0xaa0000 });

  // 火車
  const TRAIN_COLORS = ['#f2b705', '#c9ced6', '#e04a3a', '#2f80e0', '#36b072', '#ef7a2c', '#8a5ad8'];
  function trainDecalTexture(col) {
    const [c, g] = makeCanvas(1024, 256);
    // 腰帶條紋
    g.fillStyle = 'rgba(255,255,255,.85)'; g.fillRect(0, 168, 1024, 12);
    g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(0, 182, 1024, 6);
    // 車窗
    const win = (x, w) => {
      roundRect(g, x, 40, w, 92, 12);
      g.fillStyle = '#16202e'; g.fill();
      g.lineWidth = 6; g.strokeStyle = 'rgba(30,30,40,.9)'; g.stroke();
      g.fillStyle = 'rgba(160,210,255,.35)';
      g.beginPath(); g.moveTo(x + 10, 128); g.lineTo(x + 30, 46); g.lineTo(x + 50, 46); g.lineTo(x + 30, 128); g.fill();
    };
    for (const x of [40, 160, 600, 720, 860]) win(x, 96);
    // 車門
    for (const x of [300, 450]) {
      roundRect(g, x, 30, 110, 210, 8);
      g.fillStyle = 'rgba(0,0,0,.15)'; g.fill(); g.lineWidth = 5; g.strokeStyle = 'rgba(20,20,30,.7)'; g.stroke();
      g.beginPath(); g.moveTo(x + 55, 30); g.lineTo(x + 55, 240); g.stroke();
      roundRect(g, x + 12, 46, 34, 80, 6); g.fillStyle = '#16202e'; g.fill();
      roundRect(g, x + 64, 46, 34, 80, 6); g.fill();
    }
    if (Math.random() < 0.7) sprayWord(g, pick(GRAFFITI_WORDS), rand(560, 760), 236, 54, rand(-0.08, 0.04));
    return canvasTex(c);
  }
  function trainFrontTexture(col, lit) {
    const [c, g] = makeCanvas(256, 256);
    g.clearRect(0, 0, 256, 256);
    roundRect(g, 26, 22, 204, 96, 22);
    g.fillStyle = '#16202e'; g.fill(); g.lineWidth = 8; g.strokeStyle = '#222'; g.stroke();
    g.fillStyle = 'rgba(160,210,255,.35)';
    g.beginPath(); g.moveTo(44, 110); g.lineTo(80, 30); g.lineTo(110, 30); g.lineTo(74, 110); g.fill();
    g.fillStyle = '#222'; roundRect(g, 92, 128, 72, 30, 6); g.fill();
    g.fillStyle = '#ffd23f'; g.font = '900 22px "Titan One", sans-serif'; g.textAlign = 'center'; g.fillText('WZ', 128, 151);
    for (const x of [52, 204]) {
      if (lit) {
        const grd = g.createRadialGradient(x, 196, 2, x, 196, 34);
        grd.addColorStop(0, 'rgba(255,255,220,1)'); grd.addColorStop(1, 'rgba(255,240,150,0)');
        g.fillStyle = grd; g.fillRect(x - 34, 162, 68, 68);
      }
      g.fillStyle = lit ? '#ffffe0' : '#e8e8d0';
      g.beginPath(); g.arc(x, 196, 15, 0, 7); g.fill();
      g.lineWidth = 5; g.strokeStyle = '#333'; g.stroke();
    }
    g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(40, 236, 176, 10);
    return canvasTex(c);
  }
  function bogieTexture() {
    const [c, g] = makeCanvas(256, 64);
    g.fillStyle = '#2a2a30'; g.fillRect(0, 0, 256, 64);
    for (const x of [52, 204]) {
      g.fillStyle = '#4a4a52'; g.beginPath(); g.arc(x, 40, 26, 0, 7); g.fill();
      g.fillStyle = '#8a8a94'; g.beginPath(); g.arc(x, 40, 10, 0, 7); g.fill();
    }
    g.fillStyle = '#5a5a62'; g.fillRect(40, 14, 176, 10);
    return canvasTex(c);
  }
  const bogieMat = lam(0xffffff, { map: bogieTexture() });
  const trainMats = TRAIN_COLORS.map((col) => ({
    body: lam(new THREE.Color(col)),
    decal: lam(0xffffff, { map: trainDecalTexture(col), transparent: true, alphaTest: 0.05 }),
    front: lam(0xffffff, { map: trainFrontTexture(col, false), transparent: true, alphaTest: 0.05 }),
    frontLit: basic({ map: trainFrontTexture(col, true), transparent: true, alphaTest: 0.05 }),
  }));
  const trainRoofMat = lam(0xa8aeb6);

  // 金幣（正面有「偉」字）
  function coinFaceTexture() {
    const [c, g] = makeCanvas(128, 128);
    const grd = g.createRadialGradient(48, 44, 8, 64, 64, 64);
    grd.addColorStop(0, '#fff6b0'); grd.addColorStop(0.5, '#ffcc1a'); grd.addColorStop(1, '#d99500');
    g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
    g.lineWidth = 8; g.strokeStyle = '#c47f00'; g.beginPath(); g.arc(64, 64, 50, 0, 7); g.stroke();
    g.font = '900 62px "Noto Sans TC", "Microsoft JhengHei", sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = '#b06e00'; g.fillText('偉', 66, 70);
    g.fillStyle = '#ffe680'; g.fillText('偉', 63, 66);
    return canvasTex(c);
  }

  function iconTexture(text, color) {
    const [c, g] = makeCanvas(128, 128);
    const grd = g.createRadialGradient(50, 44, 6, 64, 64, 60);
    grd.addColorStop(0, '#ffffff'); grd.addColorStop(0.25, color); grd.addColorStop(1, color);
    g.fillStyle = grd; g.beginPath(); g.arc(64, 64, 56, 0, 7); g.fill();
    g.lineWidth = 8; g.strokeStyle = '#fff'; g.stroke();
    g.font = '60px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#fff';
    g.fillText(text, 64, 70);
    return canvasTex(c);
  }
  const powerMats = {};

  function signTexture(text, sub, bg) {
    const [c, g] = makeCanvas(512, 128);
    g.fillStyle = bg; g.fillRect(0, 0, 512, 128);
    g.fillStyle = '#fff'; g.fillRect(0, 0, 512, 8); g.fillRect(0, 120, 512, 8);
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#fff';
    g.font = '900 54px "Noto Sans TC", "Microsoft JhengHei", sans-serif'; g.fillText(text, 256, 52);
    g.font = '24px "Titan One", sans-serif'; g.fillText(sub, 256, 100);
    return canvasTex(c);
  }

  // ---------- 共用幾何 ----------
  const unitBox = new THREE.BoxGeometry(1, 1, 1);
  const unitCyl = new THREE.CylinderGeometry(1, 1, 1, 12);
  const unitPrism = new THREE.CylinderGeometry(1, 1, 1, 3);
  const unitIco = new THREE.IcosahedronGeometry(1, 0);
  const unitPlane = new THREE.PlaneGeometry(1, 1);
  const coinGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.1, 24);
  coinGeo.rotateX(Math.PI / 2);
  let coinMats = null;

  function mesh(geo, mat, sx, sy, sz, x, y, z, shadow) {
    const m = new THREE.Mesh(geo, mat);
    m.scale.set(sx, sy, sz);
    m.position.set(x, y, z);
    if (shadow) m.castShadow = true;
    return m;
  }
  const boxMesh = (mat, w, h, d, x, y, z, shadow) => mesh(unitBox, mat, w, h, d, x, y, z, shadow);

  // ---------- 地面與軌道 ----------
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(140, 400), lam(0xffffff, { map: groundTex }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.02;
  ground.receiveShadow = true;
  scene.add(ground);

  const trackGroup = new THREE.Group();   // 會對齊到枕木間距
  scene.add(trackGroup);
  const railGroup = new THREE.Group();    // 均勻的長條，跟著相機走就好
  scene.add(railGroup);
  const SLEEPER_GAP = 1.25;
  const TRACK_LEN = 300;
  {
    const ballastMat = lam(0xffffff, { map: ballastTex });
    for (const x of LANE_X) {
      const b = boxMesh(ballastMat, 2.7, 0.1, TRACK_LEN, x, 0.02, -TRACK_LEN / 2 + 40);
      b.receiveShadow = true;
      trackGroup.add(b);
    }
    const n = Math.floor(TRACK_LEN / SLEEPER_GAP);
    const inst = new THREE.InstancedMesh(unitBox, woodMat, n * 3);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(2.15, 0.1, 0.34), v = new THREE.Vector3();
    let k = 0;
    for (const x of LANE_X) {
      for (let i = 0; i < n; i++) {
        v.set(x, 0.11, 40 - i * SLEEPER_GAP);
        m4.compose(v, q, s);
        inst.setMatrixAt(k++, m4);
      }
    }
    inst.receiveShadow = true;
    trackGroup.add(inst);
    for (const x of LANE_X) {
      for (const sx of [-0.62, 0.62]) {
        const r = boxMesh(railMat, 0.11, 0.14, TRACK_LEN, x + sx, 0.23, -TRACK_LEN / 2 + 40);
        r.receiveShadow = true;
        railGroup.add(r);
      }
    }
    // 兩側電線
    for (const sx of [-4.3, 4.3]) {
      railGroup.add(boxMesh(darkMat, 0.04, 0.04, TRACK_LEN, sx - Math.sign(sx) * 0.5, 6.55, -TRACK_LEN / 2 + 40));
      railGroup.add(boxMesh(darkMat, 0.04, 0.04, TRACK_LEN, sx + Math.sign(sx) * 0.5, 6.55, -TRACK_LEN / 2 + 40));
    }
  }

  // ---------- 兩側景物 ----------
  const CHUNK_LEN = 40;
  const CHUNK_COUNT = 6;
  const chunks = [];
  let adMats = [];
  const grassMat = lam(0x7fbf5a);
  const leafMats = [lam(0x4fa84a, { flatShading: true }), lam(0x6cc24a, { flatShading: true }), lam(0x3d8f45, { flatShading: true })];
  const trunkMat = lam(0x7a5236);
  const houseMats = [lam(0xf6e7c8), lam(0xd6ecf5), lam(0xf5d6d6), lam(0xe0f0d0)];
  const houseRoofMats = [lam(0xc0503a, { flatShading: true }), lam(0x3a6ac0, { flatShading: true }), lam(0x5a4a3a, { flatShading: true })];
  const fenceMat = lam(0xf4f0e6);
  const platformMat = lam(0xc9c2b6);
  const yellowLineMat = lam(0xffd23f);
  const canopyMat = lam(0x2f6fb5);
  const benchMat = lam(0xd06a2a);
  const stationSignMat = lam(0xffffff, { map: signTexture('偉哲站', 'WEIZHE STATION', '#1f5fae') });

  function addTree(g, x, z) {
    const h = rand(1.6, 2.6);
    g.add(mesh(unitCyl, trunkMat, 0.18, h, 0.18, x, h / 2, z));
    const r = rand(1.1, 1.7);
    g.add(mesh(unitIco, pick(leafMats), r, r * 1.1, r, x, h + r * 0.6, z));
    if (Math.random() < 0.6) g.add(mesh(unitIco, pick(leafMats), r * 0.7, r * 0.7, r * 0.7, x + rand(-0.6, 0.6), h + r * 1.4, z + rand(-0.4, 0.4)));
  }
  function addPole(g, side, z) {
    g.add(mesh(unitCyl, postMat, 0.12, 7, 0.12, side * 4.3, 3.5, z));
    g.add(boxMesh(postMat, 1.4, 0.12, 0.12, side * 4.3, 6.5, z));
  }
  function addBillboard(g, side, z) {
    const rot = side * (-Math.PI / 2 + 0.55);
    const b = new THREE.Group();
    b.add(boxMesh(postMat, 0.25, 6, 0.25, -2, 3, 0), boxMesh(postMat, 0.25, 6, 0.25, 2, 3, 0));
    b.add(boxMesh(darkMat, 6.4, 3.4, 0.25, 0, 7.2, -0.1));
    const face = new THREE.Mesh(unitPlane, pick(adMats));
    face.scale.set(6, 3, 1);
    face.position.set(0, 7.2, 0.04);
    b.add(face);
    b.position.set(side * 8.5, 0, z);
    b.rotation.y = rot;
    g.add(b);
  }

  function buildCity(g, side) {
    const wallH = rand(2.4, 3.6);
    if (!wallMats.length) for (let i = 0; i < 8; i++) wallMats.push(lam(0xffffff, { map: graffitiTexture(pick(WALL_BASES)) }));
    for (let i = 0; i < 2; i++) {
      const w = boxMesh(pick(wallMats), 0.5, wallH, CHUNK_LEN / 2, side * 5.3, wallH / 2, -(i + 0.5) * CHUNK_LEN / 2);
      w.receiveShadow = true;
      g.add(w);
    }
    g.add(boxMesh(capMat, 0.75, 0.16, CHUNK_LEN, side * 5.3, wallH + 0.08, -CHUNK_LEN / 2));
    const n = 2 + randInt(2);
    let z = 0;
    for (let i = 0; i < n; i++) {
      const depth = CHUNK_LEN / n - rand(0.5, 2);
      const w = rand(6, 11), h = rand(8, 26);
      const x = side * (7 + w / 2 + rand(0, 4));
      const zc = -(z + depth / 2);
      g.add(boxMesh(pick(bldgMats), w, h, depth, x, h / 2, zc));
      const rm = pick(roofMats);
      g.add(boxMesh(rm, w + 0.4, 0.5, depth + 0.4, x, h + 0.25, zc));
      if (Math.random() < 0.5) {
        g.add(mesh(unitCyl, metalMat, 1.1, 1.8, 1.1, x + rand(-1, 1), h + 1.4, zc + rand(-1, 1)));
        g.add(mesh(unitPrism, rm, 1.2, 0.6, 1.2, x, h + 2.6, zc));
      } else {
        g.add(boxMesh(metalMat, 1.6, 1, 1.2, x + rand(-2, 2), h + 1, zc + rand(-2, 2)));
      }
      z += CHUNK_LEN / n;
    }
    if (adMats.length && Math.random() < 0.4) addBillboard(g, side, -rand(8, 32));
    addPole(g, side, -10); addPole(g, side, -30);
  }

  function buildSuburb(g, side) {
    const grass = new THREE.Mesh(unitPlane, grassMat);
    grass.rotation.x = -Math.PI / 2;
    grass.scale.set(40, CHUNK_LEN, 1);
    grass.position.set(side * 24.6, 0.01, -CHUNK_LEN / 2);
    grass.receiveShadow = true;
    g.add(grass);
    for (const y of [0.55, 1.1]) g.add(boxMesh(fenceMat, 0.08, 0.12, CHUNK_LEN, side * 5.0, y, -CHUNK_LEN / 2));
    for (let z = 0; z < CHUNK_LEN; z += 2.5) g.add(boxMesh(fenceMat, 0.12, 1.4, 0.12, side * 5.0, 0.7, -z));
    for (let i = 0; i < 4; i++) if (Math.random() < 0.75) addTree(g, side * rand(6.5, 12), -rand(2, CHUNK_LEN - 2));
    for (let i = 0; i < 2; i++) {
      if (Math.random() < 0.3) continue;
      const w = rand(5, 7), h = rand(3, 4.5), d = rand(6, 9);
      const x = side * rand(15, 20), zc = -(i * 20 + 10);
      g.add(boxMesh(pick(houseMats), w, h, d, x, h / 2, zc));
      const roof = mesh(unitPrism, pick(houseRoofMats), w * 0.6, d + 0.6, w * 0.4, x, h + w * 0.2, zc);
      roof.rotation.x = -Math.PI / 2;
      g.add(roof);
      g.add(boxMesh(darkMat, 1, 1.8, 0.1, x, 0.9, zc + d / 2 + 0.02));
    }
    for (let i = 0; i < 3; i++) {
      const r = rand(0.5, 0.9);
      g.add(mesh(unitIco, pick(leafMats), r * 1.3, r, r * 1.3, side * rand(5.8, 6.5), r * 0.6, -rand(2, CHUNK_LEN - 2)));
    }
    addPole(g, side, -10); addPole(g, side, -30);
  }

  function buildStation(g, side) {
    const p = boxMesh(platformMat, 5.5, 1.1, CHUNK_LEN, side * 6.85, 0.55, -CHUNK_LEN / 2);
    p.receiveShadow = true;
    g.add(p);
    g.add(boxMesh(yellowLineMat, 0.35, 0.02, CHUNK_LEN, side * 4.55, 1.111, -CHUNK_LEN / 2));
    g.add(boxMesh(capMat, 0.2, 1.12, CHUNK_LEN, side * 4.15, 0.56, -CHUNK_LEN / 2));
    for (let z = 4; z < CHUNK_LEN; z += 9) {
      g.add(mesh(unitCyl, postMat, 0.12, 3.6, 0.12, side * 8.4, 2.9, -z));
      g.add(mesh(unitCyl, postMat, 0.12, 3.6, 0.12, side * 5.6, 2.9, -z));
    }
    const roof = boxMesh(canopyMat, 4.4, 0.2, CHUNK_LEN, side * 7.0, 4.8, -CHUNK_LEN / 2);
    roof.rotation.z = side * 0.06;
    g.add(roof);
    for (let i = 0; i < 2; i++) {
      const z = -rand(5, 35);
      g.add(boxMesh(benchMat, 0.6, 0.12, 2.2, side * 8, 1.6, z), boxMesh(benchMat, 0.12, 0.6, 2.2, side * 8.3, 1.9, z));
      g.add(boxMesh(darkMat, 0.5, 0.5, 0.1, side * 8, 1.35, z - 0.9), boxMesh(darkMat, 0.5, 0.5, 0.1, side * 8, 1.35, z + 0.9));
    }
    const sign = new THREE.Mesh(unitPlane, stationSignMat);
    sign.scale.set(4, 1, 1);
    sign.position.set(side * 5.7, 3.9, -20);
    sign.rotation.y = -side * Math.PI / 2;
    g.add(sign);
    g.add(boxMesh(platformMat, 0.5, 6, CHUNK_LEN, side * 9.8, 3, -CHUNK_LEN / 2));
    const w = rand(8, 12), h = rand(10, 20);
    g.add(boxMesh(pick(bldgMats), w, h, CHUNK_LEN - 4, side * (11 + w / 2), h / 2, -CHUNK_LEN / 2));
  }

  function buildBridge(g) {
    const deckY = 10.8;
    for (const s of [-1, 1]) g.add(boxMesh(platformMat, 1.2, deckY, 1.2, s * 6.8, deckY / 2, -20, true));
    const deck = boxMesh(canopyMat, 16, 0.8, 3.2, 0, deckY, -20, true);
    g.add(deck);
    g.add(boxMesh(capMat, 16, 1, 0.15, 0, deckY + 0.9, -18.5), boxMesh(capMat, 16, 1, 0.15, 0, deckY + 0.9, -21.5));
  }

  let chunkSeq = 0;
  function buildChunk(ch) {
    ch.group.clear();
    const types = ['city', 'city', 'suburb', 'station'];
    const kind = ch.d < 30 ? 'city' : pick(types);
    for (const side of [-1, 1]) {
      const k = kind === 'station' ? 'station' : (Math.random() < 0.7 ? kind : pick(['city', 'suburb']));
      if (k === 'city') buildCity(ch.group, side);
      else if (k === 'suburb') buildSuburb(ch.group, side);
      else buildStation(ch.group, side);
    }
    if (chunkSeq++ % 5 === 3 && ch.d > 60) buildBridge(ch.group);
  }
  for (let i = 0; i < CHUNK_COUNT; i++) {
    const ch = { group: new THREE.Group(), d: 0 };
    scene.add(ch.group);
    chunks.push(ch);
  }
  function resetChunks() {
    chunkSeq = 0;
    chunks.forEach((ch, i) => { ch.d = (i - 1) * CHUNK_LEN; ch.group.position.z = -ch.d; buildChunk(ch); });
  }

  // ---------- 角色（貼紙臉 + 3D 身體） ----------
  const skinTex = {};
  const skinAspect = {};
  async function prepareSkins() {
    for (const s of SKINS) {
      const img = await loadImage(window.SKIN_IMAGES[s.id].src);
      const c = stickerize(img);
      const t = new THREE.CanvasTexture(c);
      t.encoding = THREE.sRGBEncoding;
      t.anisotropy = 4;
      skinTex[s.id] = t;
      skinAspect[s.id] = c.width / c.height;
      s.sticker = c;
    }
  }
  // 白色貼紙邊框 + 深色外框
  function stickerize(img) {
    const pad = 18;
    const W = img.width + pad * 2, H = img.height + pad * 2;
    const [c, g] = makeCanvas(W, H);
    const sil = (color) => {
      const [mc, mg] = makeCanvas(W, H);
      mg.drawImage(img, pad, pad);
      mg.globalCompositeOperation = 'source-in';
      mg.fillStyle = color; mg.fillRect(0, 0, W, H);
      return mc;
    };
    const dark = sil('#1b1b2f'), white = sil('#ffffff');
    for (let a = 0; a < 24; a++) {
      const an = (a / 24) * Math.PI * 2;
      g.drawImage(dark, Math.cos(an) * 13, Math.sin(an) * 13);
    }
    for (let a = 0; a < 24; a++) {
      const an = (a / 24) * Math.PI * 2;
      g.drawImage(white, Math.cos(an) * 9, Math.sin(an) * 9);
    }
    g.drawImage(img, pad, pad);
    return c;
  }

  function adTexture(skin) {
    const [title, slogan, color] = ADS[skin.id];
    const [c, g] = makeCanvas(1024, 512);
    const grd = g.createLinearGradient(0, 0, 1024, 512);
    grd.addColorStop(0, color); grd.addColorStop(1, '#1b1b2f');
    g.fillStyle = grd; g.fillRect(0, 0, 1024, 512);
    g.save(); g.globalAlpha = 0.15; g.fillStyle = '#fff';
    for (let i = 0; i < 12; i++) { g.beginPath(); g.moveTo(300, 256); g.arc(300, 256, 900, i * 0.52, i * 0.52 + 0.26); g.fill(); }
    g.restore();
    const img = skin.sticker, s = Math.min(460 / img.height, 470 / img.width);
    g.drawImage(img, 60, 256 - (img.height * s) / 2, img.width * s, img.height * s);
    g.textAlign = 'center';
    g.font = '900 104px "Noto Sans TC", "Microsoft JhengHei", sans-serif';
    g.lineWidth = 18; g.lineJoin = 'round'; g.strokeStyle = '#1b1b2f'; g.strokeText(title, 760, 220);
    g.fillStyle = '#ffd23f'; g.fillText(title, 760, 220);
    g.font = '900 48px "Noto Sans TC", "Microsoft JhengHei", sans-serif';
    g.fillStyle = '#fff'; g.fillText(slogan, 760, 320);
    roundRect(g, 620, 360, 280, 70, 35); g.fillStyle = '#fff'; g.fill();
    g.fillStyle = color; g.font = '40px "Titan One", sans-serif'; g.fillText('NOW!', 760, 410);
    return canvasTex(c);
  }

  const capsuleCache = new Map();
  function capsule(r, len) {
    const k = r + ':' + len;
    if (!capsuleCache.has(k)) capsuleCache.set(k, new THREE.CapsuleGeometry(r, len, 4, 10));
    return capsuleCache.get(k);
  }
  function limb(mat, r, len, y) {
    const m = new THREE.Mesh(capsule(r, len), mat);
    m.position.y = y;
    m.castShadow = true;
    return m;
  }

  function buildCharacter(skin) {
    const root = new THREE.Group();
    root.scale.setScalar(1.1);
    const rig = new THREE.Group();
    const inner = new THREE.Group();
    rig.add(inner); root.add(rig);
    inner.position.y = -1.0;
    rig.position.y = 1.0;
    const parts = { root, rig, inner, legs: [], arms: [], shoeMats: [] };

    if (skin.mode !== 'full') {
      const skinMat = lam(skin.skin), pantsMat = lam(skin.pants), shoeMat = lam(skin.shoe), soleMat = lam(0xffffff);
      parts.shoeMats.push(shoeMat);
      for (const s of [-1, 1]) {
        const hip = new THREE.Group();
        hip.position.set(s * 0.15, 0.9, 0);
        hip.add(limb(pantsMat, 0.12, 0.22, -0.2));
        const knee = new THREE.Group();
        knee.position.y = -0.42;
        knee.add(limb(skin.mode === 'bust' ? skinMat : pantsMat, 0.1, 0.22, -0.18));
        const shoe = new THREE.Group();
        shoe.position.y = -0.38;
        const toe = new THREE.Mesh(capsule(0.11, 0.18), shoeMat);
        toe.rotation.x = Math.PI / 2;
        toe.position.set(0, 0, -0.06);
        toe.castShadow = true;
        shoe.add(toe, boxMesh(soleMat, 0.22, 0.06, 0.42, 0, -0.09, -0.06));
        knee.add(shoe);
        hip.add(knee);
        hip.userData.knee = knee;
        inner.add(hip); parts.legs.push(hip);
      }
      inner.add(limb(pantsMat, 0.24, 0.12, 0.95));
      if (skin.mode === 'head') {
        const shirtMat = lam(skin.shirt);
        const torso = limb(shirtMat, 0.28, 0.32, 1.25);
        torso.scale.set(1.05, 1, 0.72);
        inner.add(torso);
        for (const s of [-1, 1]) {
          const sh = new THREE.Group();
          sh.position.set(s * 0.36, 1.5, 0);
          sh.add(limb(shirtMat, 0.09, 0.18, -0.13));
          const elbow = new THREE.Group();
          elbow.position.y = -0.3;
          elbow.add(limb(skinMat, 0.075, 0.18, -0.12));
          const hand = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), skinMat);
          hand.position.y = -0.28;
          elbow.add(hand);
          sh.add(elbow);
          sh.userData.elbow = elbow;
          inner.add(sh); parts.arms.push(sh);
        }
      }
    }

    const h = skin.h, w = h * skinAspect[skin.id];
    const sprite = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      basic({ map: skinTex[skin.id], transparent: true, alphaTest: 0.08, side: THREE.DoubleSide })
    );
    sprite.position.set(skin.offX, skin.bottom + h / 2, 0.24);
    inner.add(sprite);
    parts.sprite = sprite;

    // 噴射背包
    const jet = new THREE.Group();
    const flameMat = basic({ color: 0xffa020, transparent: true, opacity: 0.85 });
    for (const s of [-1, 1]) {
      const tank = mesh(unitCyl, lam(0xd0d4dc), 0.17, 0.75, 0.17, s * 0.6, 1.35, -0.05);
      const flame = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.7, 10), flameMat);
      flame.rotation.x = Math.PI;
      flame.position.set(s * 0.6, 0.62, -0.05);
      jet.add(tank, flame);
    }
    jet.visible = false;
    inner.add(jet);
    parts.jet = jet;

    // 滑板（掛在 root，不跟著滾動）
    const board = new THREE.Group();
    const deck = boxMesh(lam(0x2bb3ff), 0.75, 0.08, 1.6, 0, 0.1, 0, true);
    board.add(deck, boxMesh(lam(0xffd23f), 0.5, 0.01, 1.2, 0, 0.145, 0));
    const glow = new THREE.Mesh(unitPlane, basic({ color: 0x7ef0ff, transparent: true, opacity: 0.5, depthWrite: false }));
    glow.rotation.x = -Math.PI / 2;
    glow.scale.set(1.1, 2, 1);
    glow.position.y = 0.02;
    board.add(glow);
    board.visible = false;
    root.add(board);
    parts.board = board;

    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.6, 20),
      basic({ color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false })
    );
    shadow.rotation.x = -Math.PI / 2;
    parts.shadow = shadow;
    return parts;
  }

  function animateCharacter(c, skin, t, s) {
    const { rig, legs, arms } = c;
    rig.rotation.x = 0;
    if (s.rolling) {
      rig.position.y = 0.48;
      rig.scale.setScalar(0.52);
      rig.rotation.z -= 0.38;
      return;
    }
    rig.scale.setScalar(1);
    rig.position.y = 1.0;
    if (s.dead) return;
    rig.rotation.z = s.lean;
    if (s.squash > 0) rig.scale.set(1 + 0.18 * s.squash, 1 - 0.22 * s.squash, 1 + 0.18 * s.squash);
    const ph = t * 12;
    if (skin.mode === 'full') {
      if (!s.airborne && !s.board) {
        rig.rotation.z += Math.sin(ph) * 0.13;
        rig.position.y += Math.abs(Math.sin(ph)) * 0.18;
        const sq = 1 - Math.abs(Math.cos(ph)) * 0.06;
        rig.scale.y *= sq; rig.scale.x /= Math.sqrt(sq);
      } else if (s.airborne) {
        rig.scale.y *= 1.08;
      }
      return;
    }
    const setLeg = (l, hip, knee) => { l.rotation.x = hip; l.userData.knee.rotation.x = knee; };
    const setArm = (a, sx, sz, elbow) => { a.rotation.x = sx; a.rotation.z = sz; if (a.userData.elbow) a.userData.elbow.rotation.x = elbow; };
    if (s.board && !s.airborne) {
      setLeg(legs[0], 0.35, -0.5); setLeg(legs[1], -0.25, -0.35);
      arms.forEach((a, i) => setArm(a, 0.2, (i ? 1 : -1) * 0.9, 0.4));
      rig.position.y += Math.sin(t * 5) * 0.03;
      return;
    }
    if (s.airborne) {
      setLeg(legs[0], 0.9, -1.3); setLeg(legs[1], -0.2, -0.5);
      arms.forEach((a, i) => setArm(a, 0, (i ? 1 : -1) * 2.3, 0.3));
    } else if (s.running) {
      rig.rotation.x = -0.1;
      legs.forEach((l, i) => {
        const p = ph + i * Math.PI;
        setLeg(l, Math.sin(p) * 0.85, -(0.15 + Math.max(0, Math.cos(p)) * 1.3));
      });
      arms.forEach((a, i) => setArm(a, -Math.sin(ph + i * Math.PI) * 0.9, (i ? 1 : -1) * 0.08, 1.3));
      rig.position.y += Math.abs(Math.sin(ph)) * 0.08;
    } else {
      legs.forEach((l) => setLeg(l, 0, 0));
      arms.forEach((a, i) => setArm(a, 0, (i ? 1 : -1) * 0.12, 0.15));
      rig.position.y += Math.sin(t * 3) * 0.03;
    }
  }

  // 追人的站務員 + 狗
  function buildChaser() {
    const g = new THREE.Group();
    const uniform = lam(0x24407a), skinM = lam(0xe8b896), capM = lam(0x1a2a50), dogM = lam(0x9a6a3a), shoeM = lam(0x1a1a1a);
    const guy = new THREE.Group();
    const legs = [], arms = [];
    for (const s of [-1, 1]) {
      const leg = new THREE.Group(); leg.position.set(s * 0.17, 0.92, 0);
      leg.add(limb(uniform, 0.13, 0.62, -0.42));
      const shoe = new THREE.Mesh(capsule(0.12, 0.2), shoeM); shoe.rotation.x = Math.PI / 2; shoe.position.set(0, -0.86, -0.06);
      leg.add(shoe);
      guy.add(leg); legs.push(leg);
      const arm = new THREE.Group(); arm.position.set(s * 0.46, 1.62, 0);
      arm.add(limb(uniform, 0.1, 0.5, -0.32));
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), skinM); hand.position.y = -0.66; arm.add(hand);
      guy.add(arm); arms.push(arm);
    }
    const body = limb(uniform, 0.36, 0.4, 1.32); body.scale.z = 0.7; guy.add(body);
    guy.add(boxMesh(lam(0xffd23f), 0.2, 0.2, 0.05, 0.15, 1.5, 0.27));
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.27, 14, 10), skinM); head.position.y = 2.0; head.castShadow = true; guy.add(head);
    const cap = mesh(unitCyl, capM, 0.29, 0.16, 0.29, 0, 2.2, 0); guy.add(cap);
    guy.add(boxMesh(capM, 0.4, 0.04, 0.25, 0, 2.13, -0.3));
    guy.add(boxMesh(lam(0x5a3a2a), 0.34, 0.07, 0.05, 0, 1.92, -0.26));
    guy.position.x = 1.1;   // 站在偉哲斜後方，才不會擋住鏡頭
    g.add(guy);
    const dog = new THREE.Group();
    dog.position.set(-1.1, 0, 0.6);
    const dbody = limb(dogM, 0.2, 0.5, 0.52); dbody.rotation.x = Math.PI / 2; dog.add(dbody);
    const dhead = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), dogM); dhead.position.set(0, 0.78, -0.48); dog.add(dhead);
    dog.add(boxMesh(darkMat, 0.1, 0.08, 0.12, 0, 0.75, -0.7));
    for (const s of [-1, 1]) dog.add(boxMesh(lam(0x6a4a2a), 0.06, 0.18, 0.12, s * 0.13, 0.95, -0.42));
    const dlegs = [];
    for (const [x, z] of [[-0.12, -0.3], [0.12, -0.3], [-0.12, 0.3], [0.12, 0.3]]) {
      const l = boxMesh(dogM, 0.1, 0.36, 0.1, x, 0.18, z, true); dog.add(l); dlegs.push(l);
    }
    g.add(dog);
    g.scale.setScalar(0.9);
    return { group: g, legs, arms, dlegs, dog };
  }

  // ---------- 粒子 ----------
  const particles = [];
  const puffTex = (() => {
    const [c, g] = makeCanvas(64, 64);
    const grd = g.createRadialGradient(32, 32, 2, 32, 32, 31);
    grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.6, 'rgba(255,255,255,.6)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
    return canvasTex(c);
  })();
  const dustMat = basic({ map: puffTex, color: 0xe0d2bc, transparent: true, opacity: 0.6, depthWrite: false });
  const sparkTex = (() => {
    const [c, g] = makeCanvas(64, 64);
    g.translate(32, 32); g.fillStyle = '#fff';
    g.beginPath();
    for (let i = 0; i < 8; i++) { const r = i % 2 ? 7 : 30, a = i * Math.PI / 4; g.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
    g.fill();
    return canvasTex(c);
  })();
  const sparkMat = basic({ map: sparkTex, color: 0xffe066, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const smokeMat = basic({ map: puffTex, color: 0xffffff, transparent: true, opacity: 0.8, depthWrite: false });
  const debrisMat = basic({ color: 0x2bb3ff });
  for (let i = 0; i < 110; i++) {
    const m = new THREE.Mesh(unitPlane, dustMat);
    m.visible = false;
    scene.add(m);
    particles.push({ m, life: 0, max: 1, v: new THREE.Vector3(), g: 0, s0: 1, s1: 1 });
  }
  let pIdx = 0;
  function emit(mat, x, y, z, n, opts) {
    for (let i = 0; i < n; i++) {
      const p = particles[pIdx]; pIdx = (pIdx + 1) % particles.length;
      p.m.material = mat;
      p.m.visible = true;
      p.m.position.set(x + rand(-opts.spread, opts.spread), y + rand(-opts.spread, opts.spread) * 0.5, z + rand(-opts.spread, opts.spread));
      p.v.set(rand(-1, 1) * opts.vx, rand(opts.vy0, opts.vy1), rand(-1, 1) * opts.vz + (opts.vzBias || 0));
      p.life = p.max = rand(opts.life * 0.7, opts.life);
      p.g = opts.g || 0;
      p.s0 = opts.s0; p.s1 = opts.s1;
      p.m.rotation.z = rand(0, 6);
    }
  }
  function updateParticles(dt) {
    for (const p of particles) {
      if (!p.m.visible) continue;
      p.life -= dt;
      if (p.life <= 0) { p.m.visible = false; continue; }
      p.v.y += p.g * dt;
      p.m.position.addScaledVector(p.v, dt);
      const k = 1 - p.life / p.max;
      const s = p.s0 + (p.s1 - p.s0) * k;
      p.m.quaternion.copy(camera.quaternion);
      p.m.scale.set(s, s, s);
    }
  }

  // ---------- 遊戲狀態 ----------
  let state = 'loading';
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
  let stumbleTimer = 0, introTimer = 0, invincible = 0, deathTimer = 0, countdown = 0;
  let jumpBuffer = 0, squash = 0, dustTimer = 0, boards = BOARDS_PER_RUN, boardTimer = 0;
  let camY = 3.5, camX = 0, shakeT = 0;

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
    for (const pt of particles) pt.m.visible = false;
  }

  function resetGame() {
    clearWorld();
    Object.assign(p, { d: 0, prevD: 0, x: 0, y: 0, vy: 0, lane: 1, prevLane: 1, rollTimer: 0, grounded: true, dead: false });
    genD = 40; segHistory = []; laneLastEnd = [0, 0, 0];
    score = 0; coinCount = 0; time = 0; speed = BASE_SPEED;
    powers = {}; stumbleTimer = 0; introTimer = 2.6; invincible = 0; deathTimer = 0; jumpBuffer = 0; squash = 0;
    boards = BOARDS_PER_RUN; boardTimer = 0;
    camY = 3.5; camX = 0; shakeT = 0;
    chaser.gap = 3.4; chaser.x = 0;
    resetChunks();
    coinLine(1, 14, 38, () => 0.9);
    generate();
  }

  // ---------- 物件產生 ----------
  const trainShapeCache = new Map();
  function trainBodyGeo(len) {
    const key = Math.round(len * 4) / 4;
    if (trainShapeCache.has(key)) return trainShapeCache.get(key);
    const w = TRAIN_W / 2, y0 = 0.55, y1 = TRAIN_H, r = 0.5, rb = 0.12;
    const s = new THREE.Shape();
    s.moveTo(-w + rb, y0);
    s.lineTo(w - rb, y0); s.quadraticCurveTo(w, y0, w, y0 + rb);
    s.lineTo(w, y1 - r); s.quadraticCurveTo(w, y1, w - r, y1);
    s.lineTo(-w + r, y1); s.quadraticCurveTo(-w, y1, -w, y1 - r);
    s.lineTo(-w, y0 + rb); s.quadraticCurveTo(-w, y0, -w + rb, y0);
    const geo = new THREE.ExtrudeGeometry(s, { depth: key, bevelEnabled: false, curveSegments: 5 });
    geo.translate(0, 0, -key);
    trainShapeCache.set(key, geo);
    return geo;
  }

  function addTrain(lane, d0, d1, moveSpeed) {
    const len = d1 - d0;
    const g = new THREE.Group();
    const mats = pick(trainMats);
    const nCars = Math.max(1, Math.round(len / 13));
    const carLen = len / nCars;
    for (let i = 0; i < nCars; i++) {
      const gap = nCars > 1 ? 0.6 : 0;
      const cl = carLen - gap;
      const z0 = -i * carLen;
      const body = new THREE.Mesh(trainBodyGeo(cl), mats.body);
      body.position.z = z0;
      body.castShadow = true; body.receiveShadow = true;
      g.add(body);
      for (const s of [-1, 1]) {
        const dec = new THREE.Mesh(unitPlane, mats.decal);
        dec.scale.set(cl - 0.6, 2.1, 1);
        dec.position.set(s * (TRAIN_W / 2 + 0.01), 1.8, z0 - cl / 2);
        dec.rotation.y = s * Math.PI / 2;
        g.add(dec);
      }
      g.add(boxMesh(trainRoofMat, TRAIN_W * 0.55, 0.22, cl * 0.5, 0, TRAIN_H + 0.1, z0 - cl / 2, true));
      g.add(boxMesh(darkMat, TRAIN_W * 0.85, 0.25, cl - 1, 0, 0.5, z0 - cl / 2));
      for (const bz of [1.6, cl - 1.6]) g.add(boxMesh(bogieMat, TRAIN_W * 0.9, 0.42, 2.4, 0, 0.36, z0 - bz));
      if (i === 0) {
        const f = new THREE.Mesh(unitPlane, moveSpeed ? mats.frontLit : mats.front);
        f.scale.set(TRAIN_W * 0.95, 2.35, 1);
        f.position.set(0, 1.78, z0 + 0.01);
        g.add(f);
      }
      if (i > 0) g.add(boxMesh(darkMat, 1.2, 2, gap + 0.1, 0, 1.6, z0 + gap / 2));
    }
    g.position.set(LANE_X[lane], 0, -d0);
    scene.add(g);
    const o = { type: 'train', lane, x: LANE_X[lane], d0, d1, h: TRAIN_H, mesh: g, speed: moveSpeed || 0 };
    obstacles.push(o);
    laneLastEnd[lane] = Math.max(laneLastEnd[lane], d1);
    return o;
  }

  const rampSideGeo = (() => {
    const s = new THREE.Shape();
    s.moveTo(0, 0); s.lineTo(RAMP_LEN, 0); s.lineTo(RAMP_LEN, TRAIN_H); s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.1, bevelEnabled: false });
    g.rotateY(Math.PI / 2);   // shape 的 x 變成 -z
    return g;
  })();
  function addRamp(lane, d0) {
    const d1 = d0 + RAMP_LEN;
    const g = new THREE.Group();
    const slope = Math.hypot(RAMP_LEN, TRAIN_H);
    const plank = new THREE.Mesh(unitBox, rampMat);
    plank.scale.set(TRAIN_W * 0.95, 0.16, slope);
    plank.rotation.x = Math.atan2(TRAIN_H, RAMP_LEN);
    plank.position.set(0, TRAIN_H / 2 - 0.07, -RAMP_LEN / 2);
    plank.castShadow = true; plank.receiveShadow = true;
    g.add(plank);
    for (const s of [-1, 1]) {
      const side = new THREE.Mesh(rampSideGeo, postMat);
      side.position.set(s * (TRAIN_W * 0.47) - 0.05, 0, 0);
      side.castShadow = true;
      g.add(side);
    }
    g.position.set(LANE_X[lane], 0, -d0);
    scene.add(g);
    obstacles.push({ type: 'ramp', lane, x: LANE_X[lane], d0, d1, h: TRAIN_H, mesh: g, speed: 0 });
    laneLastEnd[lane] = Math.max(laneLastEnd[lane], d1);
  }

  function addBarrier(lane, d, kind) {
    const g = new THREE.Group();
    if (kind === 'low') {
      for (const s of [-1, 1]) {
        g.add(mesh(unitCyl, postMat, 0.07, LOW_H, 0.07, s * 1.0, LOW_H / 2, 0, true));
        g.add(boxMesh(postMat, 0.16, 0.06, 0.6, s * 1.0, 0.03, 0));
      }
      g.add(boxMesh(lowBarrierMat, 2.2, 0.42, 0.12, 0, LOW_H - 0.22, 0, true));
      g.add(boxMesh(lowBarrierMat, 2.2, 0.16, 0.1, 0, 0.35, 0, true));
      g.add(boxMesh(blinkMat, 0.16, 0.16, 0.16, -1.0, LOW_H + 0.08, 0));
    } else {
      for (const s of [-1, 1]) g.add(boxMesh(postMat, 0.16, HIGH_TOP, 0.16, s * 1.08, HIGH_TOP / 2, 0, true));
      g.add(boxMesh(highBarrierMat, 2.3, HIGH_TOP - HIGH_BOTTOM - 0.25, 0.16, 0, (HIGH_TOP + HIGH_BOTTOM) / 2 + 0.12, 0, true));
      g.add(boxMesh(postMat, 2.45, 0.12, 0.2, 0, HIGH_TOP, 0));
      for (const s of [-1, 1]) g.add(boxMesh(blinkMat, 0.24, 0.24, 0.24, s * 1.08, HIGH_TOP + 0.15, 0));
    }
    g.position.set(LANE_X[lane], 0, -d);
    scene.add(g);
    obstacles.push({ type: kind, lane, x: LANE_X[lane], d0: d - 0.2, d1: d + 0.2, mesh: g, speed: 0 });
    laneLastEnd[lane] = Math.max(laneLastEnd[lane], d + 0.2);
  }

  function addCoin(x, d, y) {
    if (!coinMats) {
      const face = lam(0xffffff, { map: coinFaceTexture(), emissive: 0x3a2a00 });
      coinMats = [lam(0xe0a000, { emissive: 0x4a3000 }), face, face];
    }
    const m = new THREE.Mesh(coinGeo, coinMats);
    m.position.set(x, y, -d);
    m.castShadow = true;
    scene.add(m);
    coins.push({ x, d, y, mesh: m, magnet: false });
  }

  function coinLine(lane, a, b, yFn) {
    for (let d = a; d <= b; d += 2.4) addCoin(LANE_X[lane], d, yFn(d));
  }

  const ringMat = basic({ color: 0xffffff, transparent: true, opacity: 0.7 });
  const ringGeo = new THREE.TorusGeometry(0.75, 0.05, 6, 32);
  function addPowerup(kind, lane, d, y) {
    if (!powerMats[kind]) powerMats[kind] = basic({ map: iconTexture(POWER_INFO[kind].icon, POWER_INFO[kind].color), transparent: true, alphaTest: 0.05 });
    const g = new THREE.Group();
    const icon = new THREE.Mesh(unitPlane, powerMats[kind]);
    icon.scale.set(1.25, 1.25, 1);
    const ring = new THREE.Mesh(ringGeo, ringMat);
    g.add(icon, ring);
    g.position.set(LANE_X[lane], y, -d);
    scene.add(g);
    powerups.push({ kind, x: LANE_X[lane], d, y, mesh: g, icon, ring });
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
        maybePowerup(lane, d, y + 0.1);
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
        const pen = p.d + HALF_D - o.d0;
        if (o.type === 'train' && dx < TRAIN_W / 2 && pen < 1.0 + o.speed * 0.06 + speed * 0.03) {
          if (invincible > 0) continue;
          return crash(false, o);
        }
        // 從側邊撞到：彈回原本軌道並絆倒（無敵時只彈回，不會穿進車廂）
        const back = nearestLaneAwayFrom(o);
        if (back === o.lane) {
          if (invincible > 0) continue;
          return crash(false, o);
        }
        p.lane = back;
        p.x += (p.x < o.x ? -1 : 1) * 0.3;
        if (invincible <= 0) stumble();
        return;
      } else {
        if (dx > 1.1 + HALF_W - 0.1) continue;
        if (invincible > 0) continue;
        if (o.type === 'low' && p.y < LOW_H - 0.1) return crash(false, o);
        if (o.type === 'high' && p.y < HIGH_TOP && p.y + height > HIGH_BOTTOM) return crash(false, o);
      }
    }
  }

  function stumble() {
    shakeT = 0.25;
    if (stumbleTimer > 0) return crash(true);
    stumbleTimer = 5;
    sfx.stumble();
    emit(dustMat, p.x, p.y + 0.5, -p.d, 8, { spread: 0.4, vx: 3, vy0: 1, vy1: 3, vz: 2, life: 0.5, s0: 0.4, s1: 1.2 });
    showToast('差點被抓！');
  }

  function crash(caught, obstacle) {
    if (p.dead) return;
    // 有滑板：滑板替你擋一次
    if (!caught && boardTimer > 0) {
      boardTimer = 0;
      invincible = 1.6;
      shakeT = 0.3;
      sfx.boardBreak();
      emit(debrisMat, p.x, p.y + 0.3, -p.d, 14, { spread: 0.4, vx: 5, vy0: 3, vy1: 8, vz: 4, g: -25, life: 0.9, s0: 0.25, s1: 0.15 });
      showToast('滑板爆了！');
      if (obstacle && obstacle.type === 'train' && p.y < obstacle.h - 0.4) {
        // 正面撞火車時把你推到旁邊安全的軌道
        p.lane = p.lane === 1 ? (Math.random() < 0.5 ? 0 : 2) : 1;
      }
      return;
    }
    p.dead = true;
    state = 'dying';
    deathTimer = 0;
    shakeT = 0.45;
    sfx.crash();
    musicStop();
    flash();
    emit(smokeMat, p.x, p.y + 1, -p.d - 0.5, 12, { spread: 0.6, vx: 3, vy0: 1, vy1: 4, vz: 2, life: 0.8, s0: 0.5, s1: 1.8 });
    $('overTitle').textContent = caught ? '被抓到了！' : pick(['撞爛了！', '偉哲倒下了…', '哎呀！', '偉哲陣亡']);
  }

  function activatePower(kind) {
    sfx.power();
    flash();
    powers[kind] = POWER_INFO[kind].dur;
    showToast(POWER_INFO[kind].icon + ' ' + POWER_INFO[kind].name + '！');
    if (kind === 'jetpack') {
      p.rollTimer = 0;
      invincible = POWER_INFO.jetpack.dur + 1.5;
      let lane = p.lane;
      const end = p.d + speed * POWER_INFO.jetpack.dur;
      for (let d = p.d + 18; d < end - 10; d += 2.4) {
        if (Math.random() < 0.04) lane = clamp(lane + (Math.random() < 0.5 ? -1 : 1), 0, 2);
        addCoin(LANE_X[lane], d, 7.9);
      }
    }
  }

  function useBoard() {
    if (state !== 'playing' || boardTimer > 0 || boards <= 0) return;
    boards--;
    boardTimer = BOARD_TIME;
    sfx.board();
    showToast('🛹 滑板出動！');
  }

  // ---------- 輸入 ----------
  function moveLane(dir) {
    if (state !== 'playing') return;
    const nl = p.lane + dir;
    if (nl < 0 || nl > 2) { sfx.bump(); shakeT = 0.12; return; }
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
    if ((state === 'menu' || state === 'over') && (k === 'Enter' || k === ' ')) return startGame();
    if (k === 'p' || k === 'P' || k === 'Escape') return togglePause();
    if (e.repeat) return;
    if (k === 'ArrowLeft' || k === 'a' || k === 'A') moveLane(-1);
    else if (k === 'ArrowRight' || k === 'd' || k === 'D') moveLane(1);
    else if (k === 'ArrowUp' || k === 'w' || k === 'W' || k === ' ') jump();
    else if (k === 'ArrowDown' || k === 's' || k === 'S') roll();
    else if (k === 'Shift' || k === 'b' || k === 'B') useBoard();
  });

  let touchStart = null, lastTap = 0;
  canvas.addEventListener('touchstart', (e) => {
    const t = e.changedTouches[0];
    touchStart = { x: t.clientX, y: t.clientY, done: false, t: performance.now() };
  }, { passive: true });
  canvas.addEventListener('touchmove', (e) => {
    if (!touchStart || touchStart.done) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - touchStart.x, dy = t.clientY - touchStart.y;
    if (Math.hypot(dx, dy) < 26) return;
    touchStart.done = true;
    if (Math.abs(dx) > Math.abs(dy)) moveLane(dx > 0 ? 1 : -1);
    else if (dy < 0) jump();
    else roll();
  }, { passive: true });
  canvas.addEventListener('touchend', () => {
    if (touchStart && !touchStart.done && performance.now() - touchStart.t < 250) {
      const now = performance.now();
      if (now - lastTap < 320) { useBoard(); lastTap = 0; } else lastTap = now;
    }
    touchStart = null;
  }, { passive: true });
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
  canvas.addEventListener('dblclick', useBoard);

  // ---------- UI ----------
  const hud = $('hud');
  let toastTimer = 0;
  function showToast(text) {
    const t = $('toast');
    t.textContent = text;
    t.classList.remove('show');
    void t.offsetWidth;
    t.classList.add('show');
    toastTimer = 1.4;
  }
  function flash() {
    const f = $('flash');
    f.classList.add('on');
    requestAnimationFrame(() => requestAnimationFrame(() => f.classList.remove('on')));
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
        if (state === 'loading') return;
        setCharacter(i);
        [...wrap.children].forEach((c, j) => c.classList.toggle('sel', j === i));
        sfx.coin();
      });
      wrap.appendChild(b);
    });
  }

  let lastPowerHtml = '', lastScoreTxt = '', lastCoinTxt = '', lastMult = '', lastBoard = '';
  function multiplier() { return (1 + Math.min(4, Math.floor(p.d / 1500))) * (powers.double ? 2 : 1); }
  function updateHud() {
    const st = Math.floor(score).toLocaleString();
    if (st !== lastScoreTxt) { $('scoreTxt').textContent = st; lastScoreTxt = st; }
    const ct = String(coinCount);
    if (ct !== lastCoinTxt) { $('coinTxt').textContent = ct; lastCoinTxt = ct; }
    const m = 'x' + multiplier();
    if (m !== lastMult) { const el = $('multTxt'); el.textContent = m; el.classList.toggle('x2', !!powers.double); lastMult = m; }
    const bt = boardTimer > 0 ? Math.ceil(boardTimer) + 's' : 'x' + boards;
    if (bt !== lastBoard) {
      $('boardTxt').textContent = bt;
      $('boardBtn').disabled = boards <= 0 && boardTimer <= 0;
      $('boardBtn').classList.toggle('on', boardTimer > 0);
      lastBoard = bt;
    }
    let html = '';
    for (const k in powers) {
      const pct = (powers[k] / POWER_INFO[k].dur) * 100;
      html += `<div class="power"><span class="ic">${POWER_INFO[k].icon}</span><span class="bar"><i style="width:${pct.toFixed(0)}%"></i></span></div>`;
    }
    if (html !== lastPowerHtml) { $('powers').innerHTML = html; lastPowerHtml = html; }
    $('speedlines').style.opacity = powers.jetpack ? 0.9 : clamp((speed - 24) / 10, 0, 0.7);
  }

  function startGame() {
    if (state === 'loading') return;
    audio();
    resetGame();
    state = 'playing';
    showScreen(null);
    musicStart();
  }
  function togglePause() {
    if (state === 'playing') { state = 'paused'; showScreen('pauseScreen'); musicStop(); }
    else if (state === 'paused') { state = 'countdown'; countdown = 1.5; showScreen(null); }
  }
  function toMenu() {
    state = 'menu';
    musicStop();
    resetGame();
    $('bestTxt').textContent = best.toLocaleString();
    buildCards();
    showScreen('menu');
    $('speedlines').style.opacity = 0;
  }
  function gameOver() {
    state = 'over';
    const s = Math.floor(score);
    const isBest = s > best;
    if (isBest) { best = s; storeSet('wz_best', String(best)); }
    $('overScore').textContent = s.toLocaleString();
    $('overCoins').textContent = coinCount;
    $('overDist').textContent = Math.floor(p.d) + 'm';
    $('overBest').textContent = best.toLocaleString();
    $('newBest').classList.toggle('show', isBest);
    $('overImg').src = window.SKIN_IMAGES[SKINS[skinIndex].id].src;
    $('speedlines').style.opacity = 0;
    showScreen('overScreen');
  }

  $('startBtn').addEventListener('click', startGame);
  $('againBtn').addEventListener('click', startGame);
  $('menuBtn').addEventListener('click', toMenu);
  $('pauseBtn').addEventListener('click', togglePause);
  $('resumeBtn').addEventListener('click', togglePause);
  $('quitBtn').addEventListener('click', toMenu);
  $('boardBtn').addEventListener('click', useBoard);
  const muteBtn = $('muteBtn'), musicBtn = $('musicBtn');
  const syncAudioBtns = () => {
    muteBtn.textContent = muted ? '🔇' : '🔊';
    musicBtn.style.opacity = musicOn && !muted ? 1 : 0.4;
  };
  syncAudioBtns();
  muteBtn.addEventListener('click', () => { muted = !muted; storeSet('wz_muted', muted ? '1' : '0'); syncAudioBtns(); });
  musicBtn.addEventListener('click', () => { musicOn = !musicOn; storeSet('wz_music', musicOn ? '1' : '0'); syncAudioBtns(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && state === 'playing') togglePause(); });

  // ---------- 主更新 ----------
  function updatePlaying(dt) {
    time += dt;
    speed = BASE_SPEED + (MAX_SPEED - BASE_SPEED) * clamp(p.d / 6000, 0, 1);
    p.prevD = p.d;
    p.d += speed * dt;

    const tx = LANE_X[p.lane];
    const diffX = tx - p.x;
    const stepX = Math.max(15 * dt, Math.abs(diffX) * 15 * dt);
    p.x = Math.abs(diffX) <= stepX ? tx : p.x + Math.sign(diffX) * stepX;

    for (const k in powers) { powers[k] -= dt; if (powers[k] <= 0) delete powers[k]; }
    if (stumbleTimer > 0) stumbleTimer -= dt;
    if (introTimer > 0) introTimer -= dt;
    if (invincible > 0) invincible -= dt;
    if (p.rollTimer > 0) p.rollTimer -= dt;
    if (jumpBuffer > 0) jumpBuffer -= dt;
    if (boardTimer > 0) boardTimer -= dt;
    if (squash > 0) squash = Math.max(0, squash - dt * 6);
    if (coinComboTimer > 0) { coinComboTimer -= dt; if (coinComboTimer <= 0) coinCombo = 0; }

    const wasGrounded = p.grounded;
    if (powers.jetpack) {
      p.y += (7.5 - p.y) * Math.min(1, dt * 3);
      p.vy = 0;
      p.grounded = false;
      if (Math.random() < 0.6) emit(smokeMat, p.x, p.y + 0.4, -p.d + 0.3, 1, { spread: 0.2, vx: 0.5, vy0: -3, vy1: -1, vz: 0.5, vzBias: speed * 0.6, life: 0.5, s0: 0.3, s1: 1 });
    } else {
      p.vy += GRAVITY * dt;
      p.y += p.vy * dt;
      const g = surfaceAt(p.x, p.d, p.y);
      if (p.y <= g) { p.y = g; p.vy = 0; p.grounded = true; }
      else p.grounded = p.y - g < 0.05 && p.vy <= 0;
      if (p.grounded && !wasGrounded) {
        squash = 1;
        sfx.land();
        emit(dustMat, p.x, p.y + 0.2, -p.d, 5, { spread: 0.3, vx: 2, vy0: 0.5, vy1: 1.5, vz: 1, life: 0.45, s0: 0.3, s1: 0.9 });
      }
      if (jumpBuffer > 0 && p.grounded) {
        p.vy = powers.sneakers ? SUPER_JUMP_V : JUMP_V;
        p.grounded = false;
        p.rollTimer = 0;
        jumpBuffer = 0;
        sfx.jump();
      }
    }
    if (p.grounded && boardTimer <= 0) {
      dustTimer -= dt;
      if (dustTimer <= 0) {
        dustTimer = 0.09;
        emit(dustMat, p.x + rand(-0.2, 0.2), p.y + 0.15 + FEET_Y, -p.d + 0.2, 1, { spread: 0.1, vx: 0.6, vy0: 0.3, vy1: 1, vz: 0.3, vzBias: 2, life: 0.4, s0: 0.2, s1: 0.6 });
      }
    }

    for (const o of obstacles) {
      if (!o.speed) continue;
      o.d0 -= o.speed * dt; o.d1 -= o.speed * dt;
      o.mesh.position.z = -o.d0;
    }

    checkCollisions();
    if (p.dead) return;

    const height = p.rollTimer > 0 ? ROLL_H : STAND_H;
    const collect = (c) => {
      c.taken = true; coinCount++; sfx.coin();
      emit(sparkMat, c.x, c.y, -c.d, 3, { spread: 0.2, vx: 2, vy0: 1, vy1: 3, vz: 1, vzBias: -speed * 0.5, life: 0.35, s0: 0.5, s1: 0.1 });
    };
    for (const c of coins) {
      if (c.taken) continue;
      const dd = c.d - p.d;
      if (powers.magnet && !c.magnet && dd < 16 && dd > -2 && Math.abs(c.x - p.x) < 7) c.magnet = true;
      if (c.magnet) {
        const vx = p.x - c.x, vy = p.y + 1 - c.y, vd = p.d - c.d;
        const len = Math.hypot(vx, vy, vd) || 1;
        const step = Math.min(len, (30 + speed) * dt);
        c.x += vx / len * step; c.y += vy / len * step; c.d += vd / len * step;
        if (len < 0.8) collect(c);
        continue;
      }
      if (Math.abs(dd) < 0.8 && Math.abs(c.x - p.x) < 0.9 && c.y > p.y - 0.4 && c.y < p.y + height + 0.4) collect(c);
    }
    for (const u of powerups) {
      if (u.taken) continue;
      if (Math.abs(u.d - p.d) < 1 && Math.abs(u.x - p.x) < 1 && u.y > p.y - 0.6 && u.y < p.y + height + 0.6) {
        u.taken = true;
        emit(sparkMat, u.x, u.y, -u.d, 10, { spread: 0.3, vx: 4, vy0: 1, vy1: 5, vz: 3, life: 0.5, s0: 0.7, s1: 0.1 });
        activatePower(u.kind);
      }
    }

    score += (p.d - p.prevD) * multiplier();
    generate();
    cleanup();
  }

  function updateWorldVisuals(dt) {
    const pz = -p.d;
    ground.position.z = Math.round(pz / 8) * 8 - 120;
    trackGroup.position.z = Math.round(pz / SLEEPER_GAP) * SLEEPER_GAP;
    railGroup.position.z = pz;
    for (const ch of chunks) {
      if (ch.d + CHUNK_LEN < p.d - 12) {
        ch.d += CHUNK_COUNT * CHUNK_LEN;
        ch.group.position.z = -ch.d;
        buildChunk(ch);
      }
    }
    // 地平線慢慢左右擺動
    curveU.uSway.value = Math.sin(p.d * 0.004) * 0.0009;
    blinkMat.emissive.setHex(Math.floor(time * 3) % 2 ? 0xff2020 : 0x400000);

    for (const c of coins) {
      c.mesh.position.set(c.x, c.y, -c.d);
      c.mesh.rotation.y = time * 4 + c.d * 0.3;
    }
    for (const u of powerups) {
      u.mesh.position.y = u.y + Math.sin(time * 4 + u.d) * 0.15;
      u.icon.quaternion.copy(camera.quaternion);
      u.ring.rotation.set(time * 2, time * 3, 0);
    }
    for (const cl of clouds) {
      cl.position.x += cl.userData.speed * dt;
      if (cl.position.x > 180) cl.position.x = -180;
    }
    updateParticles(dt);

    // 角色
    const skin = SKINS[skinIndex];
    const c = character;
    const onBoard = boardTimer > 0 && state !== 'dying';
    const lift = onBoard ? 0.18 : 0;
    c.root.position.set(p.x, p.y + FEET_Y + lift, pz);
    c.board.visible = onBoard;
    c.board.position.y = -lift / 1.1;
    c.board.rotation.z = -(LANE_X[p.lane] - p.x) * 0.15;
    c.jet.visible = !!powers.jetpack;
    if (c.jet.visible) c.jet.children.forEach((m, i) => { if (i % 2) m.scale.y = 0.8 + Math.random() * 0.6; });
    for (const m of c.shoeMats) m.emissive.setHex(powers.sneakers ? 0x22aa55 : 0x000000);
    const blink = invincible > 0 && invincible < 1.5 && !powers.jetpack && Math.floor(time * 12) % 2 === 0;
    c.root.visible = !blink;
    animateCharacter(c, skin, time, {
      running: state === 'playing' || state === 'countdown',
      airborne: state === 'playing' && !p.grounded,
      rolling: state === 'playing' && p.rollTimer > 0,
      lean: -(LANE_X[p.lane] - p.x) * 0.14,
      dead: state === 'dying',
      board: onBoard,
      squash,
    });
    if (state === 'dying') {
      c.rig.rotation.z = 0;
      c.rig.rotation.x = Math.max(-1.45, -deathTimer * 7);
      c.rig.position.y = 1.0 - Math.min(0.55, deathTimer * 2.5);
    }
    const g = powers.jetpack ? surfaceAt(p.x, p.d, 99) : surfaceAt(p.x, p.d, p.y);
    c.shadow.position.set(p.x, g + FEET_Y + 0.03, pz);
    c.shadow.scale.setScalar(clamp(1 - (p.y - g) * 0.15, 0.4, 1));

    // 追兵
    const near = state === 'dying' ? 1.8 : (stumbleTimer > 0 || introTimer > 0) ? 3.4 : 16;
    chaser.gap += (near - chaser.gap) * Math.min(1, dt * (near < 5 ? 3 : 0.8));
    chaser.group.visible = chaser.gap < 12;
    chaser.x += (p.x - chaser.x) * Math.min(1, dt * 5);
    chaser.group.position.set(chaser.x, FEET_Y, pz + chaser.gap);
    const ph = time * 11;
    const run = state === 'playing' || state === 'dying' || state === 'countdown' ? 1 : 0.1;
    chaser.legs[0].rotation.x = Math.sin(ph) * 0.8 * run;
    chaser.legs[1].rotation.x = -Math.sin(ph) * 0.8 * run;
    chaser.arms[0].rotation.x = -Math.sin(ph) * 0.8 * run;
    chaser.arms[1].rotation.x = Math.sin(ph) * 0.8 * run;
    chaser.dlegs.forEach((l, i) => (l.rotation.x = Math.sin(ph * 1.3 + (i % 2) * Math.PI) * 0.7 * run));
    chaser.dog.position.y = Math.abs(Math.sin(ph * 1.3)) * 0.1 * run;

    // 相機
    camX += (p.x * 0.85 - camX) * Math.min(1, dt * 6);
    const targetY = powers.jetpack ? p.y + 2.4 : 3.3 + p.y * 0.75;
    camY += (targetY - camY) * Math.min(1, dt * (powers.jetpack ? 5 : 4));
    if (shakeT > 0) shakeT -= dt;
    const shake = Math.max(0, shakeT) * 0.8;
    camera.position.set(camX + rand(-shake, shake), camY + rand(-shake, shake), pz + 5.9);
    const portrait = window.innerWidth < window.innerHeight;
    camera.lookAt(camX * 0.9, camY - (portrait ? 2.9 : 2.0) - (powers.jetpack ? 0.8 : 0), pz - 9);
    const fov = baseFov + (speed - BASE_SPEED) * 0.3 + (powers.jetpack ? 6 : 0);
    if (Math.abs(camera.fov - fov) > 0.05) { camera.fov += (fov - camera.fov) * Math.min(1, dt * 3); camera.updateProjectionMatrix(); }

    sun.position.set(p.x + 7, 16, pz + 8);
    sun.target.position.set(p.x, 0, pz - 6);
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
      if (deathTimer > 1.4) gameOver();
    } else if (state === 'countdown') {
      countdown -= dt;
      time += dt * 0.3;
      $('count').textContent = countdown > 0 ? Math.ceil(countdown / 0.5) : '';
      if (countdown <= 0) { state = 'playing'; musicStart(); }
    } else if (state === 'menu' || state === 'loading') {
      time += dt;
    }
    if (toastTimer > 0) { toastTimer -= dt; if (toastTimer <= 0) $('toast').classList.remove('show'); }
    if (character) updateWorldVisuals(state === 'paused' ? 0 : dt);
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }

  // 測試用：網址加上 ?debug 可以從 console 操作
  if (/[?&]debug/.test(location.search)) {
    window.__wz = {
      get p() { return p; }, get obstacles() { return obstacles; }, get state() { return state; }, camera, get character() { return character; },
      get coins() { return coinCount; }, get score() { return score; },
      power: activatePower, board: useBoard, god() { invincible = 1e9; },
    };
  }

  async function init() {
    buildCards();
    $('bestTxt').textContent = best.toLocaleString();
    requestAnimationFrame(frame);
    try { await document.fonts.load('40px "Titan One"'); } catch (e) { /* 沒字型也能玩 */ }
    await prepareSkins();
    adMats = SKINS.map((s) => lam(0xffffff, { map: adTexture(s) }));
    setCharacter(skinIndex);
    state = 'menu';
    resetGame();
    const btn = $('startBtn');
    btn.disabled = false;
    btn.textContent = '開始跑！';
  }
  init();
})();
