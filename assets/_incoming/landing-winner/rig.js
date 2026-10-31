/* Malakor rig renderer: 2D canvas, safe from file:// (never reads pixels back).
   Layer data mirrors ../malakor-rig/layers.json and m8.spec.json (inlined because
   file:// pages cannot fetch() JSON). PNG cut-outs load by relative path.
   Usage:
     const rig = new MalakorRig({ base: '../malakor-rig/' });
     rig.ready.then(() => rig.mount(canvas));
     rig.set({ eye:'#33d9c7', glow:'#ff9e38', rim:'#a9c4ff', rimAmt:.7 });
     rig.part('monocle', false); rig.emotion('smug'); rig.gesture('nod'); rig.say('text');
*/
(function (root) {
  'use strict';
  const L = [
    { name: 'torso', z: 2, kind: 'body', file: 'torso.png', bbox: [0, 445, 1024, 579], anchor: [512, 734.5], par: .3 },
    { name: 'head', z: 3, kind: 'head', file: 'head.png', bbox: [317, 153, 389, 424], anchor: [511.5, 365], par: 1 },
    { name: 'jaw', z: 5, kind: 'jaw', file: 'jaw.png', bbox: [370, 511, 283, 118], anchor: [511.5, 570], par: 1 },
    { name: 'shard_r5', z: 6, kind: 'float', file: 'shard_r5.png', bbox: [735, 267, 49, 68], anchor: [759.5, 301], follow: .5, amp: [1.5, 4.5], freq: .2, rot: 3.5, plane: 47.89 },
    { name: 'shard_l5', z: 7, kind: 'float', file: 'shard_l5.png', bbox: [241, 268, 50, 65], anchor: [266, 300.5], follow: .5, amp: [1.5, 4.5], freq: .21, rot: 3.5, plane: 49.41 },
    { name: 'shard_r4', z: 8, kind: 'float', file: 'shard_r4.png', bbox: [687, 211, 56, 110], anchor: [715, 266], follow: .6, amp: [1.5, 4], freq: .155, rot: 2.5, plane: 69.6 },
    { name: 'shard_l4', z: 9, kind: 'float', file: 'shard_l4.png', bbox: [282, 211, 56, 110], anchor: [310, 266], follow: .6, amp: [1.5, 4], freq: .165, rot: 2.5, plane: 70.43 },
    { name: 'shard_r3', z: 10, kind: 'float', file: 'shard_r3.png', bbox: [733, 124, 58, 153], anchor: [762, 200.5], follow: .6, amp: [1.5, 4.5], freq: .18, rot: 3, plane: 51.27 },
    { name: 'shard_l3', z: 11, kind: 'float', file: 'shard_l3.png', bbox: [227, 129, 63, 148], anchor: [258.5, 203], follow: .6, amp: [1.5, 4.5], freq: .19, rot: 3, plane: 50.4 },
    { name: 'shard_r2', z: 12, kind: 'float', file: 'shard_r2.png', bbox: [651, 58, 75, 190], anchor: [688.5, 153], follow: .7, amp: [1.5, 4], freq: .15, rot: 2.5, plane: 84.74 },
    { name: 'shard_l2', z: 13, kind: 'float', file: 'shard_l2.png', bbox: [298, 59, 75, 189], anchor: [335.5, 153.5], follow: .7, amp: [1.5, 4], freq: .14, rot: 2.5, plane: 85.24 },
    { name: 'shard_r1', z: 14, kind: 'float', file: 'shard_r1.png', bbox: [579, 75, 51, 102], anchor: [604.5, 126], follow: .8, amp: [1.2, 3.5], freq: .16, rot: 2, plane: 109.71 },
    { name: 'shard_l1', z: 15, kind: 'float', file: 'shard_l1.png', bbox: [387, 75, 59, 104], anchor: [416.5, 127], follow: .8, amp: [1.2, 3.5], freq: .17, rot: 2, plane: 109.59 },
    { name: 'shard_c', z: 16, kind: 'float', file: 'shard_c.png', bbox: [456, 0, 110, 236], anchor: [511, 118], follow: 1, amp: [.6, 2.5], freq: .12, rot: .6, plane: 138 },
    { name: 'eye_l', z: 17, kind: 'eye', file: 'eye_l.png', bbox: [324, 263, 196, 170], anchor: [422, 348], gain: 1, bloom: .3, par: 1.05 },
    { name: 'eye_r', z: 18, kind: 'eye', file: 'eye_r.png', bbox: [534, 268, 181, 167], anchor: [624.5, 351.5], gain: 1, bloom: .3, par: 1.05 },
    { name: 'monocle', z: 19, kind: 'pulse', file: 'monocle.png', bbox: [519, 224, 261, 239], anchor: [649.5, 343.5], gain: 1, bloom: .25, voice: .15, pulse: { amp: .12, freq: .13 }, par: 1.15 }
  ];
  const SPEC = {
    head: { center: [511, 392], radius: [190, 235], pivot_y: 612, chin_y: 622 },
    aperture: { seam_y: 516, x0: 432, x1: 592 },
    colors: { mouth: [.2, .85, .78], line_core: [1, .62, .22], line_glow: [.85, .45, .12] }
  };
  const hex = (c) => '#' + c.map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
  const DEFAULTS = { eye: hex(SPEC.colors.mouth), glow: hex(SPEC.colors.line_core), rim: '#ffc98a', rimAmt: .55, eyeGain: 1, glowGain: 1 };

  /* ten emotions: eased targets. eye=eye light, sq=eye squint (y scale), roll=deg, pitch=px down,
     jaw=resting open 0..1, spread=crown spread, jit=shard tremor, mono=monocle gain, lean=scale, sg=shard glow */
  const EMOTIONS = {
    neutral:    { eye: 1,    sq: 1,    roll: 0,    pitch: 0,   jaw: 0,   spread: 1,    jit: 0,   mono: 1,   lean: 1,     sg: 0 },
    amused:     { eye: 1.15, sq: .86,  roll: -3,   pitch: -4,  jaw: .18, spread: 1.03, jit: 0,   mono: 1.1, lean: 1.01,  sg: .15 },
    smug:       { eye: .95,  sq: .72,  roll: 5,    pitch: -10, jaw: .04, spread: 1.05, jit: 0,   mono: 1.35, lean: .99, sg: .2 },
    delighted:  { eye: 1.55, sq: 1.08, roll: -2,   pitch: -6,  jaw: .38, spread: 1.12, jit: .3,  mono: 1.3, lean: 1.03,  sg: .55 },
    scheming:   { eye: .8,   sq: .66,  roll: 7,    pitch: 8,   jaw: .02, spread: .96,  jit: 0,   mono: 1.6, lean: 1.02,  sg: .1 },
    suspicious: { eye: .9,   sq: .58,  roll: -6,   pitch: 4,   jaw: 0,   spread: .97,  jit: 0,   mono: 1.9, lean: 1.04,  sg: 0 },
    irritated:  { eye: 1.25, sq: .78,  roll: 2,    pitch: 6,   jaw: .08, spread: 1.02, jit: .45, mono: 1.4, lean: 1.02,  sg: .3 },
    furious:    { eye: 2.1,  sq: .7,   roll: 0,    pitch: 10,  jaw: .3,  spread: 1.22, jit: 1.4, mono: 2.2, lean: 1.06,  sg: 1.2 },
    wounded:    { eye: .55,  sq: 1.1,  roll: -9,   pitch: 16,  jaw: .12, spread: .9,   jit: 0,   mono: .55, lean: .97,  sg: 0 },
    afraid:     { eye: .7,   sq: 1.22, roll: 3,    pitch: -14, jaw: .26, spread: .86,  jit: .9,  mono: .7,  lean: .95,   sg: 0 }
  };
  const GESTURES = {
    nod: 1.1, tilt: 1.5, lean_in: 1.6, recoil: 1.0, glare: 1.7, flare: 1.6
  };
  const PARTS = ['monocle'].concat(L.filter((l) => l.kind === 'float').map((l) => l.name));

  const mk = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h)); return c; };
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const ease = (x) => x * x * (3 - 2 * x);
  const env = (p) => (p <= 0 || p >= 1 ? 0 : Math.sin(Math.PI * p));          // 0→1→0
  const envHold = (p) => (p <= 0 || p >= 1 ? 0 : p < .22 ? ease(p / .22) : p > .7 ? ease((1 - p) / .3) : 1);

  function tint(img, color) {
    const c = mk(img.width, img.height), x = c.getContext('2d');
    x.drawImage(img, 0, 0);
    x.globalCompositeOperation = 'color'; x.fillStyle = color; x.fillRect(0, 0, c.width, c.height);
    x.globalCompositeOperation = 'destination-in'; x.drawImage(img, 0, 0);
    return c;
  }
  function rgbOf(h) { h = h.replace('#', ''); if (h.length === 3) h = h.split('').map((c) => c + c).join(''); const n = parseInt(h.slice(0, 6), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; }
  function desat(img) {
    const c = mk(img.width, img.height), x = c.getContext('2d');
    x.drawImage(img, 0, 0);
    x.globalCompositeOperation = 'saturation'; x.fillStyle = '#808080'; x.fillRect(0, 0, c.width, c.height);
    x.globalCompositeOperation = 'destination-in'; x.drawImage(img, 0, 0);
    return c;
  }
  /* light layer: luminance becomes alpha, hue becomes the chosen colour, hot cores stay white */
  function lightSprite(img, color, boost) {
    const c = mk(img.width, img.height), x = c.getContext('2d');
    x.drawImage(img, 0, 0);
    let d; try { d = x.getImageData(0, 0, c.width, c.height); } catch (e) { return tint(img, color); }
    const q = d.data, C = rgbOf(color);
    for (let i = 0; i < q.length; i += 4) {
      const r = q[i], g = q[i + 1], b = q[i + 2], a = q[i + 3] / 255;
      const mx = Math.max(r, g, b) / 255, mn = Math.min(r, g, b) / 255;
      let I = Math.min(1, Math.pow(mx * a, .9) * boost);
      if (I < .015) { q[i + 3] = 0; continue; }
      const w = mx > 0 ? Math.pow(mn / mx, 1.5) * Math.min(1, mx * 1.4) : 0;
      q[i] = 255 * (C[0] * (1 - w) + w); q[i + 1] = 255 * (C[1] * (1 - w) + w); q[i + 2] = 255 * (C[2] * (1 - w) + w); q[i + 3] = 255 * I;
    }
    x.putImageData(d, 0, 0); return c;
  }
  function blurred(src, px) {
    const p = px * 3, c = mk(src.width + p * 2, src.height + p * 2), x = c.getContext('2d');
    if ('filter' in x) { x.filter = 'blur(' + px + 'px)'; x.drawImage(src, p, p); }
    else { x.globalAlpha = .5; x.drawImage(src, p, p); }
    c.pad = p; return c;
  }
  function crescent(img, color, dx, dy, soft) {
    const p = Math.ceil(Math.abs(dx) + Math.abs(dy) + soft * 3) + 2;
    const c = mk(img.width + p * 2, img.height + p * 2), x = c.getContext('2d');
    x.drawImage(img, p, p);
    x.globalCompositeOperation = 'source-in'; x.fillStyle = color; x.fillRect(0, 0, c.width, c.height);
    x.globalCompositeOperation = 'destination-out'; x.drawImage(img, p + dx, p + dy);
    const o = mk(c.width, c.height), ox = o.getContext('2d');
    if ('filter' in ox) ox.filter = 'blur(' + soft + 'px)';
    ox.drawImage(c, 0, 0); o.pad = p; return o;
  }

  class MalakorRig {
    constructor(opts) {
      opts = opts || {};
      this.base = opts.base || '../malakor-rig/';
      this.layers = L.map((l) => Object.assign({}, l));
      this.by = {}; this.layers.forEach((l) => (this.by[l.name] = l));
      this.colors = Object.assign({}, DEFAULTS);
      this.parts = {}; PARTS.forEach((p) => (this.parts[p] = true));
      this.partA = {}; PARTS.forEach((p) => (this.partA[p] = 1));
      this.emo = 'neutral'; this.cur = Object.assign({}, EMOTIONS.neutral);
      this.gest = null;
      this.power = 1;          // 0 = daemon gone: lights die
      this.assemble = 1;       // 0..1 layer-by-layer reveal
      this.calm = !!opts.calm; // reduced motion
      this.lookT = [0, 0]; this.lookC = [0, 0]; this.lag = opts.lag || .12;
      this.mouth = 0; this.talkUntil = 0; this.talkSeed = Math.random() * 100;
      this.nextBlink = 1.5; this.blinkT = -1;
      this.flicker = 1;        // multiplier a host can drive
      this.t = 0; this.last = 0;
      this.listeners = [];
      this.ready = Promise.all(this.layers.map((l) => new Promise((res) => {
        const im = new Image(); im.decoding = 'async';
        im.onload = () => { l.img = im; res(); };
        im.onerror = () => { l.img = null; res(); };
        const LI = root.MALAKOR_LIGHT;
        im.src = (LI && LI[l.name]) ? LI[l.name] : this.base + l.file;
      }))).then(() => { this._bake(); return this; });
    }
    _bake() {
      const C = this.colors;
      this.layers.forEach((l) => {
        if (!l.img) return;
        if (l.kind === 'eye') { l.tinted = lightSprite(l.img, C.eye, 1.6); l.bloomS = blurred(l.tinted, 10); }
        else if (l.kind === 'pulse') { l.tinted = lightSprite(l.img, C.glow, 1.25); l.bloomS = blurred(l.tinted, 12); }
        else if (l.kind === 'float') {
          const def = C.eye.toLowerCase() === DEFAULTS.eye;
          if (!l.desat) l.desat = desat(l.img);
          l.base = def ? l.img : l.desat; l.tinted = tint(l.img, C.eye);
        }
        if (l.kind === 'head' || l.kind === 'body' || l.kind === 'jaw') l.rimS = crescent(l.img, C.rim, 7, 9, 2.2);
      });
      const g = mk(256, 64), x = g.getContext('2d');
      const r = x.createRadialGradient(128, 32, 0, 128, 32, 128);
      r.addColorStop(0, C.eye); r.addColorStop(.35, C.eye + 'aa'); r.addColorStop(1, C.eye + '00');
      x.fillStyle = r; x.fillRect(0, 0, 256, 64);
      this.mouthS = g;
      this.baked = true;
    }
    set(o) {
      let re = false;
      for (const k in o) { if (this.colors[k] !== o[k]) { this.colors[k] = o[k]; if (k === 'eye' || k === 'glow' || k === 'rim') re = true; } }
      if (re && this.baked) this._bake();
      return this;
    }
    part(name, on) {
      if (name === 'crown') { PARTS.forEach((p) => { if (p !== 'monocle') this.parts[p] = on; }); return this; }
      if (name in this.parts) this.parts[name] = on === undefined ? !this.parts[name] : !!on;
      return this;
    }
    emotion(name) { if (EMOTIONS[name]) this.emo = name; return this; }
    gesture(name) { if (GESTURES[name]) this.gest = { name, t0: this.t, dur: GESTURES[name] }; return this; }
    say(text, ms) {
      const d = ms || Math.min(9000, 600 + String(text || '').length * 62);
      this.talkUntil = Math.max(this.talkUntil, this.t + d / 1000); return this;
    }
    hush() { this.talkUntil = this.t; }
    get speaking() { return this.t < this.talkUntil; }
    look(x, y) { this.lookT[0] = clamp(x, -1, 1); this.lookT[1] = clamp(y, -1, 1); }

    update(now) {
      const t = now / 1000; let dt = this.last ? t - this.last : 0.016; this.last = t; dt = clamp(dt, 0, .1);
      this.t += dt;
      const k = 1 - Math.exp(-dt * 5);
      const tgt = EMOTIONS[this.emo];
      for (const key in tgt) this.cur[key] += (tgt[key] - this.cur[key]) * k;
      const kl = 1 - Math.exp(-dt / Math.max(.02, this.lag));
      this.lookC[0] += (this.lookT[0] - this.lookC[0]) * kl; this.lookC[1] += (this.lookT[1] - this.lookC[1]) * kl;
      for (const p in this.partA) this.partA[p] += ((this.parts[p] ? 1 : 0) - this.partA[p]) * (1 - Math.exp(-dt * 9));
      // blink
      if (this.blinkT < 0 && this.t > this.nextBlink) { this.blinkT = 0; }
      if (this.blinkT >= 0) { this.blinkT += dt; if (this.blinkT > .2) { this.blinkT = -1; this.nextBlink = this.t + 2.2 + Math.random() * 4.2 + (Math.random() < .2 ? -1.9 : 0); } }
      // mouth
      let m = 0;
      if (this.speaking) {
        const s = this.t * 9 + this.talkSeed;
        m = clamp(.45 + .35 * Math.sin(s) * Math.sin(s * .37 + 1.3) + .3 * Math.sin(s * 2.3), 0, 1);
        const left = this.talkUntil - this.t; if (left < .2) m *= left / .2;
      }
      this.mouth += (m - this.mouth) * (1 - Math.exp(-dt * 22));
    }
    _gest(name) {
      const g = this.gest; if (!g || g.name !== name) return 0;
      const p = (this.t - g.t0) / g.dur; if (p >= 1) { this.gest = null; return 0; } return p;
    }
    /* draw into ctx in rig space (1024 x 1024). Caller sets the transform. */
    render(ctx, now) {
      if (!this.baked) return;
      this.update(now == null ? performance.now() : now);
      const c = this.cur, t = this.t, calm = this.calm, P = this.power * this.flicker;
      const A = this.assemble;
      // gestures
      let roll = c.roll, pitch = c.pitch, lean = c.lean, eyeG = c.eye, sq = c.sq, spread = c.spread, sg = c.sg, mono = c.mono, dy = 0, jit = c.jit;
      let p;
      if ((p = this._gest('nod'))) { pitch += 16 * Math.sin(p * Math.PI * 2) * (1 - p) + 10 * env(p); }
      if ((p = this._gest('tilt'))) { roll += 10 * envHold(p); }
      if ((p = this._gest('lean_in'))) { lean += .085 * envHold(p); dy += 26 * envHold(p); eyeG += .3 * envHold(p); }
      if ((p = this._gest('recoil'))) { const e = p < .18 ? ease(p / .18) : ease((1 - p) / .82); lean -= .07 * e; dy -= 30 * e; spread += .22 * e; jit += 2 * e; roll -= 4 * e; }
      if ((p = this._gest('glare'))) { const e = envHold(p); eyeG += 1.5 * e; sq -= .35 * e; mono += 1.8 * e; pitch += 6 * e; }
      if ((p = this._gest('flare'))) { const e = envHold(p); spread += .4 * e; sg += 1.6 * e; mono += 1.2 * e; eyeG += .5 * e; }
      // idle drift
      const dr = calm ? .25 : 1;
      const sway = Math.sin(t * .31) * 1.3 * dr + Math.sin(t * .17 + 2) * .8 * dr;
      const hx = Math.sin(t * .23 + .5) * 4 * dr + this.lookC[0] * 16;
      const hy = Math.sin(t * .41) * 3 * dr + this.lookC[1] * 9;
      roll += sway + this.lookC[0] * 2.5;
      const breath = Math.sin(t * 1.1) * (calm ? .4 : 1);
      const blink = this.blinkT >= 0 ? Math.sin(Math.PI * clamp(this.blinkT / .2, 0, 1)) : 0;
      const jawOpen = clamp(c.jaw + this.mouth, 0, 1.15);

      const hc = SPEC.head.center, pivY = SPEC.head.pivot_y;
      const lay = this.layers, N = lay.length;
      const aOf = (i) => clamp(A * (N + 3) - i, 0, 1);

      ctx.save();
      // global lean (scale about chin)
      ctx.translate(512, 640 + dy); ctx.scale(lean, lean); ctx.translate(-512, -640);

      // torso
      const tor = this.by.torso;
      const a0 = aOf(0);
      if (tor.img && a0 > 0) {
        ctx.save(); ctx.globalAlpha = a0;
        ctx.translate(this.lookC[0] * 5 + (1 - a0) * 0, breath * 1.6 + (1 - a0) * 40);
        ctx.translate(tor.anchor[0], tor.anchor[1]); ctx.scale(1, 1 + breath * .003); ctx.translate(-tor.anchor[0], -tor.anchor[1]);
        ctx.drawImage(tor.img, tor.bbox[0], tor.bbox[1]);
        if (this.colors.rimAmt > 0 && tor.rimS) { ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = a0 * this.colors.rimAmt * .55; ctx.drawImage(tor.rimS, tor.bbox[0] - tor.rimS.pad, tor.bbox[1] - tor.rimS.pad); }
        ctx.restore();
      }
      // head frame
      const headT = (f) => {
        ctx.translate(hx * f, hy * f + breath * 1.2 * f);
        ctx.translate(hc[0], pivY); ctx.rotate(roll * f * Math.PI / 180);
        ctx.scale(1, 1 - pitch * .0016 * f); ctx.translate(-hc[0], -pivY);
        ctx.translate(0, pitch * .55 * f);
      };
      const head = this.by.head, jaw = this.by.jaw;
      const a1 = aOf(1);
      ctx.save(); headT(1);
      if (head.img && a1 > 0) {
        ctx.save(); ctx.globalAlpha = a1; ctx.translate(0, (1 - a1) * -30);
        ctx.drawImage(head.img, head.bbox[0], head.bbox[1]);
        ctx.restore();
      }
      // mouth glow (behind jaw)
      if (a1 > 0 && this.mouthS) {
        const g = clamp(.12 + jawOpen * .95, 0, 1) * P * a1;
        if (g > .01) {
          ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = g;
          const w = 170 + jawOpen * 30, h = 24 + jawOpen * 40;
          ctx.drawImage(this.mouthS, 512 - w / 2, 532 + jawOpen * 8 - h / 2, w, h);
          ctx.restore();
        }
      }
      // jaw
      const a2 = aOf(2);
      if (jaw.img && a2 > 0) {
        ctx.save(); ctx.globalAlpha = a2;
        ctx.translate(0, jawOpen * 24 + (1 - a2) * 30);
        ctx.translate(jaw.anchor[0], 511); ctx.rotate(jawOpen * .02 * Math.sin(t * 3)); ctx.translate(-jaw.anchor[0], -511);
        ctx.drawImage(jaw.img, jaw.bbox[0], jaw.bbox[1]);
        if (this.colors.rimAmt > 0 && jaw.rimS) { ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = a2 * this.colors.rimAmt * .6; ctx.drawImage(jaw.rimS, jaw.bbox[0] - jaw.rimS.pad, jaw.bbox[1] - jaw.rimS.pad); }
        ctx.restore();
      }
      if (head.img && a1 > 0 && this.colors.rimAmt > 0 && head.rimS) {
        ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = a1 * this.colors.rimAmt;
        ctx.drawImage(head.rimS, head.bbox[0] - head.rimS.pad, head.bbox[1] - head.rimS.pad); ctx.restore();
      }
      ctx.restore();

      // shards
      for (let i = 3; i < N; i++) {
        const l = lay[i]; if (l.kind !== 'float' || !l.img) continue;
        const pa = this.partA[l.name] * aOf(i); if (pa < .01) continue;
        const f = l.follow;
        ctx.save(); headT(f);
        const ph = l.freq * Math.PI * 2 * t + i * 1.7;
        const fx = Math.sin(ph * .8) * l.amp[0] * (calm ? .3 : 1), fy = Math.sin(ph) * l.amp[1] * (calm ? .3 : 1);
        const jx = jit ? (Math.sin(t * 31 + i * 7) * jit * 1.2) : 0, jy = jit ? (Math.cos(t * 27 + i * 3) * jit) : 0;
        const ox = (l.anchor[0] - hc[0]) * (spread - 1), oy = (l.anchor[1] - hc[1]) * (spread - 1) * 1.1;
        const par = (.5 + l.plane / 138 * .7);
        ctx.translate(fx + jx + ox + this.lookC[0] * 8 * par, fy + jy + oy + this.lookC[1] * 5 * par - (1 - pa) * 40);
        ctx.translate(l.anchor[0], l.anchor[1]); ctx.rotate((Math.sin(ph * .9) * l.rot * (calm ? .3 : 1)) * Math.PI / 180); ctx.translate(-l.anchor[0], -l.anchor[1]);
        ctx.globalAlpha = pa;
        ctx.drawImage(l.base || l.img, l.bbox[0], l.bbox[1]);
        const glint = (sg + (l.base === l.img ? 0 : .45)) * P;
        if (glint > .02) { ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = pa * clamp(glint * .55, 0, 1); ctx.drawImage(l.tinted, l.bbox[0], l.bbox[1]); }
        ctx.restore();
      }

      // eyes + monocle (light layers: additive)
      ctx.save(); headT(1);
      ctx.globalCompositeOperation = 'lighter';
      for (const nm of ['eye_l', 'eye_r']) {
        const l = this.by[nm]; if (!l.tinted) continue;
        const ai = aOf(lay.indexOf(l));
        const g = clamp(eyeG * this.colors.eyeGain * P * (1 - blink * .92), 0, 3.2) * ai;
        if (g < .01) continue;
        ctx.save();
        ctx.translate(this.lookC[0] * 3, this.lookC[1] * 2);
        ctx.translate(l.anchor[0], l.anchor[1]); ctx.scale(1, clamp(sq * (1 - blink * .5), .3, 1.4)); ctx.translate(-l.anchor[0], -l.anchor[1]);
        let rem = g; while (rem > 0) { ctx.globalAlpha = Math.min(1, rem); ctx.drawImage(l.tinted, l.bbox[0], l.bbox[1]); rem -= 1; }
        ctx.globalAlpha = clamp(g * l.bloom * 1.6, 0, 1);
        ctx.drawImage(l.bloomS, l.bbox[0] - l.bloomS.pad, l.bbox[1] - l.bloomS.pad);
        ctx.restore();
      }
      const mo = this.by.monocle;
      const mA = this.partA.monocle * aOf(lay.indexOf(mo));
      if (mo.tinted && mA > .01) {
        const pulse = 1 + mo.pulse.amp * Math.sin(t * mo.pulse.freq * Math.PI * 2 * 4) + this.mouth * mo.voice * 2;
        const g = clamp(mono * pulse * this.colors.glowGain * P, 0, 3.5) * mA;
        ctx.translate(this.lookC[0] * 4, this.lookC[1] * 3 - (1 - mA) * 20);
        let rem = g; while (rem > 0) { ctx.globalAlpha = Math.min(1, rem); ctx.drawImage(mo.tinted, mo.bbox[0], mo.bbox[1]); rem -= 1; }
        ctx.globalAlpha = clamp(g * mo.bloom * 1.8, 0, 1);
        ctx.drawImage(mo.bloomS, mo.bbox[0] - mo.bloomS.pad, mo.bbox[1] - mo.bloomS.pad);
      }
      ctx.restore();
      ctx.restore();
      for (const f of this.listeners) f(this);
    }

    /* convenience: own a canvas, fit the 1024 rig inside it, run a loop.
       opts: { scale: 1 (fraction of the short side), x: .5, y: .5 (centre as fraction), before(ctx,w,h,t), after(ctx,w,h,t), fps } */
    mount(canvas, opts) {
      opts = opts || {};
      const ctx = canvas.getContext('2d');
      let raf = 0, alive = true, lastFrame = 0, buf = null, bx = null;
      const minDt = opts.fps ? 1000 / opts.fps : 0;
      const frame = (now) => {
        if (!alive) return;
        raf = requestAnimationFrame(frame);
        if (document.hidden) return;
        if (minDt && now - lastFrame < minDt - 1) return; lastFrame = now;
        const dpr = Math.min(window.devicePixelRatio || 1, opts.maxDpr || 2);
        const w = canvas.clientWidth, h = canvas.clientHeight;
        if (!w || !h) return;
        const W = Math.round(w * dpr), H = Math.round(h * dpr);
        if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
        ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, W, H);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        if (opts.before) opts.before(ctx, w, h, now);
        const s = Math.min(w, h) * (opts.scale || 1) / 1024;
        const ox = w * (opts.x == null ? .5 : opts.x) - 512 * s, oy = h * (opts.y == null ? .5 : opts.y) - 512 * s;
        if (opts.fade === false) {
          ctx.save(); ctx.translate(ox, oy); ctx.scale(s, s); this.render(ctx, now); ctx.restore();
        } else {
          if (!buf || buf.width !== W || buf.height !== H) { buf = mk(W, H); bx = buf.getContext('2d'); }
          bx.setTransform(1, 0, 0, 1, 0, 0); bx.globalCompositeOperation = 'source-over'; bx.globalAlpha = 1; bx.clearRect(0, 0, W, H);
          bx.setTransform(dpr * s, 0, 0, dpr * s, dpr * ox, dpr * oy);
          this.render(bx, now);
          MalakorRig.fade(bx, opts.fade);
          ctx.drawImage(buf, 0, 0, w, h);
        }
        if (opts.after) opts.after(ctx, w, h, now);
      };
      raf = requestAnimationFrame(frame);
      return { stop: () => { alive = false; cancelAnimationFrame(raf); }, canvas };
    }
  }
  /* soften the rig's square crop (torso is cut at x=0, x=1024 and y=1024). ctx must be in rig space. */
  MalakorRig.fade = function (ctx, o) {
    o = o || {};
    ctx.save(); ctx.globalCompositeOperation = 'destination-in'; ctx.globalAlpha = 1;
    const g = ctx.createRadialGradient(512, 470, o.inner || 300, 512, 520, o.outer || 640);
    g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(.7, 'rgba(0,0,0,.85)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(-2048, -2048, 5120, 5120);
    const v = ctx.createLinearGradient(0, o.bottom || 820, 0, 1024);
    v.addColorStop(0, 'rgba(0,0,0,1)'); v.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = v; ctx.fillRect(-2048, -2048, 5120, 5120);
    ctx.restore();
  };
  MalakorRig.EMOTIONS = Object.keys(EMOTIONS);
  MalakorRig.GESTURES = Object.keys(GESTURES);
  MalakorRig.PARTS = PARTS;
  MalakorRig.DEFAULTS = DEFAULTS;
  MalakorRig.SPEC = SPEC;
  MalakorRig.LAYERS = L;
  root.MalakorRig = MalakorRig;
})(window);
