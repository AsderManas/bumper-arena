// Three.js rendering. Reads the shared client state; never touches game rules.

import * as THREE from 'three';
import { CFG, PHASE, MAPS, POWERS, F, bumperSpots } from './sim.js';

const lerpAngle = (a, b, t) => a + ((((b - a + Math.PI * 3) % (Math.PI * 2)) - Math.PI) * t);

// Look of each arena, keyed by map id.
const THEMES = {
  classic: {
    bg: '#0b0820', base: ['#2a1f63', '#140f33'], line: 'rgba(140,110,255,0.35)', accent: 'rgba(77,216,255,0.85)',
    stripes: ['rgba(255,61,154,0.9)', 'rgba(255,184,77,0.9)'], side: '#241b4d', sideGlow: '#3a1d7a',
    ring: '#ff3d9a', grid: ['#6a3df0', '#3a1f8a'], glow: 0.3,
  },
  ice: {
    bg: '#06182a', base: ['#e4f7ff', '#8fd0f2'], line: 'rgba(255,255,255,0.7)', accent: 'rgba(40,120,200,0.7)',
    stripes: ['rgba(255,255,255,0.95)', 'rgba(77,171,255,0.95)'], side: '#5a9ccc', sideGlow: '#1d4e7a',
    ring: '#9fe8ff', grid: ['#3da0ff', '#1b4f80'], glow: 0.06, cracks: true,
  },
  donut: {
    bg: '#1c0b1f', base: ['#ffb0da', '#ef6fae'], line: null, accent: null,
    stripes: ['rgba(255,240,170,0.95)', 'rgba(255,255,255,0.95)'], side: '#c4874a', sideGlow: '#5a3010',
    ring: '#fff1a8', grid: ['#ff6ec7', '#7a2a5a'], glow: 0.12, sprinkles: true,
  },
  pinball: {
    bg: '#03140c', base: ['#124430', '#06170f'], line: 'rgba(61,220,151,0.35)', accent: 'rgba(255,210,63,0.9)',
    stripes: ['rgba(61,220,151,0.9)', 'rgba(10,40,28,0.9)'], side: '#0f3325', sideGlow: '#0a5a3a',
    ring: '#3ddc97', grid: ['#1fa86d', '#0d4a30'], glow: 0.3,
  },
  sweeper: {
    bg: '#120e06', base: ['#40392b', '#1d1a12'], line: 'rgba(255,200,80,0.22)', accent: 'rgba(255,140,40,0.9)',
    stripes: ['rgba(255,210,63,0.95)', 'rgba(25,22,15,0.95)'], side: '#2c271c', sideGlow: '#4a3a10',
    ring: '#ffb84d', grid: ['#c08a2a', '#5a4010'], glow: 0.25,
  },
};

function floorTexture(t) {
  const s = 1024;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grd.addColorStop(0, t.base[0]);
  grd.addColorStop(1, t.base[1]);
  g.fillStyle = grd;
  g.fillRect(0, 0, s, s);
  g.translate(s / 2, s / 2);
  if (t.line) {
    g.strokeStyle = t.line;
    g.lineWidth = 3;
    for (let r = 64; r < s / 2; r += 64) { g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.stroke(); }
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      g.beginPath();
      g.moveTo(Math.cos(a) * 64, Math.sin(a) * 64);
      g.lineTo(Math.cos(a) * s / 2, Math.sin(a) * s / 2);
      g.stroke();
    }
  }
  if (t.cracks) {
    g.strokeStyle = 'rgba(255,255,255,0.55)';
    g.lineWidth = 2;
    for (let i = 0; i < 40; i++) {
      let x = (Math.random() - 0.5) * s * 0.9, y = (Math.random() - 0.5) * s * 0.9;
      g.beginPath();
      g.moveTo(x, y);
      for (let k = 0; k < 4; k++) { x += (Math.random() - 0.5) * 90; y += (Math.random() - 0.5) * 90; g.lineTo(x, y); }
      g.stroke();
    }
  }
  if (t.sprinkles) {
    const cols = ['#ffffff', '#4dd8ff', '#ffd23f', '#3ddc97', '#b388ff', '#ff4d6d'];
    for (let i = 0; i < 700; i++) {
      const a = Math.random() * Math.PI * 2, d = Math.random() * s * 0.47;
      g.save();
      g.translate(Math.cos(a) * d, Math.sin(a) * d);
      g.rotate(Math.random() * Math.PI);
      g.fillStyle = cols[i % cols.length];
      g.fillRect(-9, -3, 18, 6);
      g.restore();
    }
  }
  if (t.accent) {
    g.strokeStyle = t.accent;
    g.lineWidth = 8;
    g.beginPath(); g.arc(0, 0, 40, 0, Math.PI * 2); g.stroke();
  }
  // Hazard stripes around the rim.
  for (let i = 0; i < 72; i++) {
    const a0 = (i / 72) * Math.PI * 2, a1 = a0 + Math.PI / 36;
    g.beginPath();
    g.arc(0, 0, s / 2 - 4, a0, a1);
    g.arc(0, 0, s / 2 - 36, a1, a0, true);
    g.closePath();
    g.fillStyle = t.stripes[i % 2];
    g.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function dotTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.4, 'rgba(255,255,255,0.6)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

function labelSprite(name, color) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  g.font = 'bold 34px Inter, system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 6;
  g.strokeStyle = 'rgba(0,0,0,0.75)';
  g.strokeText(name, 128, 28);
  g.fillStyle = '#fff';
  g.fillText(name, 128, 28);
  g.fillStyle = color;
  g.fillRect(98, 54, 60, 5);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  sp.scale.set(3.6, 0.9, 1);
  sp.renderOrder = 10;
  return sp;
}

function disposeTree(obj) {
  obj.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of mats) { if (m.map) m.map.dispose(); m.dispose(); }
  });
}

class Particles {
  constructor(scene, n = 1200) {
    this.n = n;
    this.i = 0;
    this.pos = new Float32Array(n * 3);
    this.col = new Float32Array(n * 3);
    this.base = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    this.life = new Float32Array(n);
    this.max = new Float32Array(n).fill(1);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.points = new THREE.Points(geo, new THREE.PointsMaterial({
      size: 0.5, map: dotTexture(), vertexColors: true, transparent: true,
      depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  spawn(x, y, z, vx, vy, vz, color, life) {
    const i = this.i;
    this.i = (i + 1) % this.n;
    const k = i * 3;
    this.pos[k] = x; this.pos[k + 1] = y; this.pos[k + 2] = z;
    this.vel[k] = vx; this.vel[k + 1] = vy; this.vel[k + 2] = vz;
    this.base[k] = color.r; this.base[k + 1] = color.g; this.base[k + 2] = color.b;
    this.life[i] = this.max[i] = life;
  }

  update(dt) {
    const damp = Math.exp(-2.5 * dt);
    for (let i = 0; i < this.n; i++) {
      const k = i * 3;
      if (this.life[i] <= 0) { this.col[k] = this.col[k + 1] = this.col[k + 2] = 0; continue; }
      this.life[i] -= dt;
      this.vel[k + 1] -= 14 * dt;
      this.vel[k] *= damp; this.vel[k + 1] *= damp; this.vel[k + 2] *= damp;
      this.pos[k] += this.vel[k] * dt;
      this.pos[k + 1] += this.vel[k + 1] * dt;
      this.pos[k + 2] += this.vel[k + 2] * dt;
      const a = Math.max(0, this.life[i] / this.max[i]);
      this.col[k] = this.base[k] * a; this.col[k + 1] = this.base[k + 1] * a; this.col[k + 2] = this.base[k + 2] * a;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;
  }
}

const POWER_GEOS = [
  () => new THREE.OctahedronGeometry(0.6),          // speed
  () => new THREE.IcosahedronGeometry(0.62, 0),     // mega
  () => new THREE.BoxGeometry(0.85, 0.85, 0.85),    // heavy
  () => new THREE.TorusKnotGeometry(0.38, 0.13, 64, 8), // shockwave
];

export class View {
  constructor(canvas) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#0b0820');
    this.scene.fog = new THREE.Fog('#0b0820', 45, 120);
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.1, 500);
    this.camera.position.set(0, 30, 40);
    this.camLook = new THREE.Vector3();
    this.time = 0;
    this.shake = 0;
    this.meshes = new Map();
    this.powerMeshes = new Map();
    this.waves = [];
    this.mapIdx = -1;
    this.arena = null;

    this.scene.add(new THREE.HemisphereLight('#a9b8ff', '#2a1040', 1.1));
    const sun = new THREE.DirectionalLight('#ffffff', 2.4);
    sun.position.set(18, 40, 14);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -27, right: 27, top: 27, bottom: -27, near: 1, far: 100 });
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.02;
    this.scene.add(sun);

    this.buildBackdrop();
    this.buildMap(0);
    this.particles = new Particles(this.scene);

    this.marker = new THREE.Mesh(
      new THREE.RingGeometry(1.45, 1.75, 48),
      new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.85, depthWrite: false }),
    );
    this.marker.rotation.x = -Math.PI / 2;
    this.marker.position.y = 0.03;
    this.marker.visible = false;
    this.scene.add(this.marker);

    this.crown = this.makeCrown();
    this.crown.visible = false;
    this.scene.add(this.crown);

    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  buildBackdrop() {
    const n = 1500, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const v = new THREE.Vector3().randomDirection().multiplyScalar(180 + Math.random() * 120);
      pos.set([v.x, v.y, v.z], i * 3);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.scene.add(new THREE.Points(sg, new THREE.PointsMaterial({ color: '#c9c2ff', size: 1.1, fog: false })));

    this.rocks = [];
    this.rockMat = new THREE.MeshStandardMaterial({ color: '#3b2f70', roughness: 0.9, flatShading: true });
    for (let i = 0; i < 16; i++) {
      const m = new THREE.Mesh(new THREE.IcosahedronGeometry(1 + Math.random() * 3, 0), this.rockMat);
      const a = Math.random() * Math.PI * 2, d = 42 + Math.random() * 45;
      m.userData = { a, d, y: -14 + Math.random() * 22, spin: (Math.random() - 0.5) * 0.6, orbit: (Math.random() - 0.5) * 0.03 };
      this.scene.add(m);
      this.rocks.push(m);
    }
  }

  // Rebuild the arena (floor, rim, hazards, background tint) for a map.
  buildMap(idx) {
    if (this.arena) { this.scene.remove(this.arena); disposeTree(this.arena); }
    if (this.grid) { this.scene.remove(this.grid); disposeTree(this.grid); }
    this.mapIdx = idx;
    const map = MAPS[idx];
    const t = THEMES[map.id];
    this.theme = t;
    this.scene.background.set(t.bg);
    this.scene.fog.color.set(t.bg);
    this.rockMat.color.set(t.side);

    this.grid = new THREE.GridHelper(400, 80, t.grid[0], t.grid[1]);
    this.grid.position.y = -45;
    this.scene.add(this.grid);

    const arena = new THREE.Group();
    const tex = floorTexture(t);
    const top = new THREE.MeshStandardMaterial({
      map: tex, emissive: '#ffffff', emissiveMap: tex, emissiveIntensity: t.glow, roughness: map.id === 'ice' ? 0.15 : 0.55, metalness: 0.2,
    });
    const side = new THREE.MeshStandardMaterial({ color: t.side, emissive: t.sideGlow, emissiveIntensity: 0.45, roughness: 0.6, metalness: 0.4 });

    let geo, mats;
    if (map.hole) {
      const shape = new THREE.Shape().absarc(0, 0, 1, 0, Math.PI * 2, false);
      shape.holes.push(new THREE.Path().absarc(0, 0, map.hole, 0, Math.PI * 2, true));
      geo = new THREE.ExtrudeGeometry(shape, { depth: 1.5, bevelEnabled: false, curveSegments: 96 });
      geo.rotateX(-Math.PI / 2);
      geo.translate(0, -1.5, 0);
      tex.repeat.set(0.5, 0.5);
      tex.offset.set(0.5, 0.5);
      mats = [top, side];
    } else {
      geo = new THREE.CylinderGeometry(1, 0.8, 1.5, 96);
      geo.translate(0, -0.75, 0);
      mats = [side, top, side];
    }
    this.platform = new THREE.Mesh(geo, mats);
    this.platform.receiveShadow = true;
    arena.add(this.platform);

    this.ringMat = new THREE.MeshBasicMaterial({ color: t.ring });
    this.ring = new THREE.Mesh(new THREE.BufferGeometry(), this.ringMat);
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.02;
    arena.add(this.ring);
    this.innerRing = null;
    if (map.hole) {
      this.innerRing = new THREE.Mesh(new THREE.BufferGeometry(), this.ringMat);
      this.innerRing.rotation.x = -Math.PI / 2;
      this.innerRing.position.y = 0.02;
      arena.add(this.innerRing);
    }
    this.ringR = -1;

    this.bumpers = [];
    if (map.bumpers) {
      for (let i = 0; i < 5; i++) {
        const mat = new THREE.MeshStandardMaterial({ color: '#1a1a1a', emissive: i ? '#3ddc97' : '#ffd23f', emissiveIntensity: 0.6, metalness: 0.5, roughness: 0.3 });
        const b = new THREE.Group();
        const post = new THREE.Mesh(new THREE.CylinderGeometry(CFG.bumperR, CFG.bumperR, 1.4, 32), mat);
        post.position.y = 0.7;
        post.castShadow = true;
        const cap = new THREE.Mesh(new THREE.TorusGeometry(CFG.bumperR, 0.18, 8, 32), new THREE.MeshBasicMaterial({ color: '#ffffff' }));
        cap.rotation.x = Math.PI / 2;
        cap.position.y = 1.4;
        b.add(post, cap);
        b.userData = { mat, flash: 0 };
        arena.add(b);
        this.bumpers.push(b);
      }
    }

    this.arm = null;
    if (map.sweeper) {
      this.arm = new THREE.Group();
      const barMat = new THREE.MeshStandardMaterial({ color: '#ffb84d', emissive: '#ff7a00', emissiveIntensity: 0.5, metalness: 0.4, roughness: 0.4 });
      this.bar = new THREE.Mesh(new THREE.BoxGeometry(2, 0.7, CFG.armWidth), barMat);
      this.bar.position.y = 0.55;
      this.bar.castShadow = true;
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(CFG.hubR, CFG.hubR * 1.15, 1.6, 32),
        new THREE.MeshStandardMaterial({ color: '#2a2418', emissive: '#ff4d1a', emissiveIntensity: 0.4, metalness: 0.6 }));
      hub.position.y = 0.8;
      hub.castShadow = true;
      this.arm.add(this.bar, hub);
      arena.add(this.arm);
    }

    this.arena = arena;
    this.scene.add(arena);
    for (const m of this.powerMeshes.values()) { this.scene.remove(m); disposeTree(m); }
    this.powerMeshes.clear();
  }

  rebuildRings(r) {
    this.ring.geometry.dispose();
    this.ring.geometry = new THREE.TorusGeometry(r, 0.16, 8, 160);
    if (this.innerRing) {
      this.innerRing.geometry.dispose();
      this.innerRing.geometry = new THREE.TorusGeometry(r * MAPS[this.mapIdx].hole, 0.16, 8, 96);
    }
    this.ringR = r;
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.fov = w < h ? 70 : 55;
    this.camera.updateProjectionMatrix();
  }

  makeCrown() {
    const g = new THREE.Group();
    const gold = new THREE.MeshStandardMaterial({ color: '#ffd23f', emissive: '#ff9a00', emissiveIntensity: 0.5, metalness: 0.8, roughness: 0.25 });
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.45, 0.3, 20, 1, true), gold);
    g.add(band);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.36, 8), gold);
      spike.position.set(Math.cos(a) * 0.46, 0.3, Math.sin(a) * 0.46);
      g.add(spike);
    }
    return g;
  }

  makePlayer(color, name) {
    const c = new THREE.Color(color);
    const group = new THREE.Group();
    const pivot = new THREE.Group();
    group.add(pivot);
    const mat = new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.18, roughness: 0.3, metalness: 0.25 });
    const body = new THREE.Mesh(new THREE.SphereGeometry(CFG.r, 32, 24), mat);
    body.castShadow = true;
    pivot.add(body);
    const band = new THREE.Mesh(
      new THREE.TorusGeometry(CFG.r * 1.02, 0.09, 8, 48),
      new THREE.MeshBasicMaterial({ color: c.clone().lerp(new THREE.Color('#ffffff'), 0.45) }),
    );
    band.rotation.x = Math.PI / 2;
    pivot.add(band);
    const white = new THREE.MeshBasicMaterial({ color: '#ffffff' });
    const black = new THREE.MeshBasicMaterial({ color: '#111111' });
    for (const s of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.27, 16, 12), white);
      eye.position.set(s * 0.42, 0.32, CFG.r * 0.8);
      const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.14, 12, 8), black);
      pupil.position.set(s * 0.42, 0.32, CFG.r * 0.8 + 0.2);
      pivot.add(eye, pupil);
    }
    // Translucent armor shell shown while the Heavy power-up is active.
    const shell = new THREE.Mesh(
      new THREE.IcosahedronGeometry(CFG.r * 1.28, 1),
      new THREE.MeshStandardMaterial({ color: '#4dabff', emissive: '#1d6fff', emissiveIntensity: 0.6, metalness: 0.9, roughness: 0.2, transparent: true, opacity: 0.4, flatShading: true }),
    );
    shell.visible = false;
    group.add(shell);
    const label = labelSprite(name, color);
    group.add(label);
    return { group, pivot, mat, label, shell, color, name, yaw: 0, stretch: 1, size: 1, threeColor: c };
  }

  makePowerup(type) {
    const pw = POWERS[type];
    const c = new THREE.Color(pw.color);
    const g = new THREE.Group();
    const core = new THREE.Mesh(POWER_GEOS[type](), new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.9, metalness: 0.3, roughness: 0.3 }));
    core.castShadow = true;
    const halo = new THREE.Mesh(new THREE.TorusGeometry(0.9, 0.06, 8, 40), new THREE.MeshBasicMaterial({ color: c }));
    halo.rotation.x = Math.PI / 2;
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.35, 0.35, 8, 16, 1, true),
      new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
    );
    beam.position.y = 4;
    g.add(core, halo, beam);
    g.userData = { core, halo, type, color: c, born: this.time };
    return g;
  }

  disposePlayer(m) {
    this.scene.remove(m.group);
    disposeTree(m.group);
  }

  burst(x, z, strength, colors = ['#fff2a8', '#ff5fb0'], y = CFG.r) {
    const count = Math.min(60, 10 + strength * 2);
    const cs = colors.map((c) => new THREE.Color(c));
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2, s = 3 + Math.random() * strength * 0.6;
      this.particles.spawn(x, y, z, Math.cos(a) * s, 2 + Math.random() * 6, Math.sin(a) * s,
        cs[i % cs.length], 0.4 + Math.random() * 0.5);
    }
  }

  dashFx(id) {
    const m = this.meshes.get(id);
    if (!m) return;
    const p = m.group.position;
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * Math.PI * 2;
      this.particles.spawn(p.x, 0.2, p.z, Math.cos(a) * 4, 1 + Math.random() * 2, Math.sin(a) * 4, m.threeColor, 0.5);
    }
  }

  pickupFx(id, type) {
    const m = this.meshes.get(id);
    if (!m) return;
    const p = m.group.position;
    this.burst(p.x, p.z, 14, [POWERS[type].color, '#ffffff'], p.y);
  }

  shockwave(x, z) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.8, 1, 64),
      new THREE.MeshBasicMaterial({ color: '#d4b8ff', transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, 0.3, z);
    this.scene.add(ring);
    this.waves.push({ ring, t: 0 });
    this.burst(x, z, 25, ['#b388ff', '#ffffff']);
  }

  bumperHit(i) {
    const b = this.bumpers[i];
    if (b) b.userData.flash = 1;
  }

  update(S, dt) {
    this.time += dt;
    if (S.map !== this.mapIdx) this.buildMap(S.map);
    const map = MAPS[this.mapIdx];

    // Arena.
    const r = S.radius;
    this.platform.scale.set(r, 1, r);
    if (Math.abs(r - this.ringR) > 0.02) this.rebuildRings(r);
    const shrinking = S.phase === PHASE.PLAYING && r < CFG.arenaStart - 0.01 && r > CFG.arenaMin + 0.01;
    this.ringMat.color.set(shrinking ? (Math.sin(this.time * 10) > 0 ? '#ff2a4d' : '#ff9a3d') : this.theme.ring);

    bumperSpots(map, r).forEach(([x, z], i) => {
      const b = this.bumpers[i];
      if (!b) return;
      b.position.set(x, 0, z);
      const u = b.userData;
      u.flash = Math.max(0, u.flash - dt * 4);
      u.mat.emissiveIntensity = 0.6 + u.flash * 2.5;
      const s = 1 + u.flash * 0.15;
      b.scale.set(s, 1, s);
    });
    if (this.arm) {
      this.arm.rotation.y = -S.armRender;
      this.bar.scale.x = r;
    }

    // Power-ups.
    const seenPw = new Set();
    for (const [id, type, x, z] of S.powerups) {
      seenPw.add(id);
      let m = this.powerMeshes.get(id);
      if (!m) { m = this.makePowerup(type); this.powerMeshes.set(id, m); this.scene.add(m); }
      const u = m.userData;
      const grow = Math.min(1, (this.time - u.born) * 3);
      m.position.set(x, 1 + Math.sin(this.time * 3 + id) * 0.25, z);
      m.scale.setScalar(grow);
      u.core.rotation.y += dt * 2;
      u.core.rotation.x += dt * 1.3;
      u.halo.scale.setScalar(1 + Math.sin(this.time * 5) * 0.08);
    }
    for (const [id, m] of this.powerMeshes) {
      if (seenPw.has(id)) continue;
      this.scene.remove(m);
      disposeTree(m);
      this.powerMeshes.delete(id);
    }

    // Leader gets a crown (only when there's a clear single leader).
    let leader = 0, top = 0, tie = false;
    for (const [id, info] of S.roster) {
      if (info.score > top) { top = info.score; leader = id; tie = false; }
      else if (info.score === top && top > 0) tie = true;
    }
    if (tie) leader = 0;
    this.crown.visible = false;

    // Players.
    for (const [id, p] of S.players) {
      const info = S.roster.get(id);
      let m = this.meshes.get(id);
      if (m && info && (info.name !== m.name || info.color !== m.color)) {
        this.disposePlayer(m);
        this.meshes.delete(id);
        m = null;
      }
      if (!m) {
        if (!info) continue;
        m = this.makePlayer(info.color, info.name);
        this.meshes.set(id, m);
        this.scene.add(m.group);
      }
      const alive = p.f & F.ALIVE;
      m.group.visible = !!alive;
      if (!alive) continue;
      const k = 1 - Math.exp(-dt * 15);
      m.size += ((p.f & F.MEGA ? CFG.megaScale : 1) - m.size) * (1 - Math.exp(-dt * 8));
      m.group.position.set(p.rx, p.ry + CFG.r * m.size, p.rz);
      m.pivot.scale.setScalar(1);
      if (Math.hypot(p.vx, p.vz) > 0.6) m.yaw = lerpAngle(m.yaw, Math.atan2(p.vx, p.vz), 1 - Math.exp(-dt * 12));
      m.pivot.rotation.y = m.yaw;
      const dashing = p.f & F.DASH;
      m.mat.emissiveIntensity += ((dashing ? 1.1 : p.f & F.SPEED ? 0.55 : 0.18) - m.mat.emissiveIntensity) * k;
      m.stretch += ((dashing ? 1.22 : 1) - m.stretch) * k;
      const sq = 1 / Math.sqrt(m.stretch);
      m.pivot.scale.set(sq * m.size, sq * m.size, m.stretch * m.size);
      m.shell.visible = !!(p.f & F.HEAVY);
      m.shell.scale.setScalar(m.size);
      m.shell.rotation.y += dt * 0.8;
      m.label.position.y = CFG.r * m.size + (id === leader ? 1.75 : 1.3);
      if (id === leader) {
        this.crown.visible = true;
        this.crown.position.set(p.rx, m.group.position.y + CFG.r * m.size + 0.45, p.rz);
        this.crown.rotation.y += dt * 1.5;
      }
      const g = m.group.position;
      if (dashing && Math.random() < 0.7) {
        this.particles.spawn(g.x, g.y, g.z, (Math.random() - 0.5) * 2, Math.random() * 2, (Math.random() - 0.5) * 2, m.threeColor, 0.35);
      }
      if (p.f & F.SPEED && Math.random() < 0.8) {
        this.particles.spawn(g.x, 0.3, g.z, (Math.random() - 0.5) * 1.5, Math.random() * 1.5, (Math.random() - 0.5) * 1.5, SPEED_COLOR, 0.45);
      }
    }
    for (const [id, m] of this.meshes) {
      if (!S.players.has(id)) { this.disposePlayer(m); this.meshes.delete(id); }
    }

    // Shockwave rings.
    for (let i = this.waves.length - 1; i >= 0; i--) {
      const w = this.waves[i];
      w.t += dt;
      const f = w.t / 0.45;
      w.ring.scale.setScalar(1 + f * CFG.shockRadius);
      w.ring.material.opacity = Math.max(0, 0.9 * (1 - f));
      if (f >= 1) { this.scene.remove(w.ring); disposeTree(w.ring); this.waves.splice(i, 1); }
    }

    // "This is you" ring.
    const me = S.players.get(S.myId);
    const meAlive = !!(me && (me.f & F.ALIVE));
    this.marker.visible = meAlive && !(me.f & F.FALL);
    if (this.marker.visible) {
      this.marker.position.x = me.rx;
      this.marker.position.z = me.rz;
      this.marker.material.color.set(S.roster.get(S.myId)?.color || '#ffffff');
      const s = (1 + Math.sin(this.time * 5) * 0.06) * (this.meshes.get(S.myId)?.size || 1);
      this.marker.scale.set(s, s, s);
    }

    // Camera.
    if (!S.mode) {
      const a = this.time * 0.08;
      this.camera.position.set(Math.sin(a) * 42, 26, Math.cos(a) * 42);
      this.camLook.set(0, 0, 0);
    } else {
      const follow = meAlive && me.ry > -6;
      const far = this.camera.aspect < 1 ? 1.45 : 1;
      const tx = follow ? me.rx * 0.6 : 0, tz = follow ? me.rz * 0.6 : 0;
      const k = 1 - Math.exp(-dt * 4);
      this.camLook.x += (tx - this.camLook.x) * k;
      this.camLook.z += (tz - this.camLook.z) * k;
      this.camLook.y = 0;
      const want = new THREE.Vector3(this.camLook.x, (follow ? 27 : 34) * far, this.camLook.z + (follow ? 23 : 30) * far);
      this.camera.position.lerp(want, k);
    }
    this.shake = Math.max(0, this.shake - dt * 2.5);
    const sh = this.shake * this.shake * 0.8;
    this.camera.lookAt(this.camLook);
    const shx = (Math.random() - 0.5) * sh, shy = (Math.random() - 0.5) * sh;
    this.camera.position.x += shx;
    this.camera.position.y += shy;

    for (const m of this.rocks) {
      const u = m.userData;
      u.a += u.orbit * dt;
      m.position.set(Math.cos(u.a) * u.d, u.y + Math.sin(this.time * 0.5 + u.d) * 0.8, Math.sin(u.a) * u.d);
      m.rotation.x += u.spin * dt;
      m.rotation.y += u.spin * 0.7 * dt;
    }

    this.particles.update(dt);
    this.renderer.render(this.scene, this.camera);
    // Undo the shake so it doesn't leak into next frame's smoothing.
    this.camera.position.x -= shx;
    this.camera.position.y -= shy;
  }
}

const SPEED_COLOR = new THREE.Color('#ffd23f');
