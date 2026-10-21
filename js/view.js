// Three.js rendering. Reads the shared client state; never touches game rules.

import * as THREE from 'three';
import { CFG, PHASE } from './sim.js';

const lerpAngle = (a, b, t) => a + ((((b - a + Math.PI * 3) % (Math.PI * 2)) - Math.PI) * t);

function floorTexture() {
  const s = 1024;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grd.addColorStop(0, '#2a1f63');
  grd.addColorStop(1, '#140f33');
  g.fillStyle = grd;
  g.fillRect(0, 0, s, s);
  g.translate(s / 2, s / 2);
  g.strokeStyle = 'rgba(140,110,255,0.35)';
  g.lineWidth = 3;
  for (let r = 64; r < s / 2; r += 64) { g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.stroke(); }
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    g.beginPath();
    g.moveTo(Math.cos(a) * 64, Math.sin(a) * 64);
    g.lineTo(Math.cos(a) * s / 2, Math.sin(a) * s / 2);
    g.stroke();
  }
  g.strokeStyle = 'rgba(77,216,255,0.85)';
  g.lineWidth = 8;
  g.beginPath(); g.arc(0, 0, 40, 0, Math.PI * 2); g.stroke();
  // Hazard stripes around the rim.
  for (let i = 0; i < 72; i++) {
    const a0 = (i / 72) * Math.PI * 2, a1 = a0 + Math.PI / 36;
    g.beginPath();
    g.arc(0, 0, s / 2 - 4, a0, a1);
    g.arc(0, 0, s / 2 - 36, a1, a0, true);
    g.closePath();
    g.fillStyle = i % 2 ? 'rgba(255,61,154,0.9)' : 'rgba(255,184,77,0.9)';
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
  sp.position.y = CFG.r + 1.3;
  sp.renderOrder = 10;
  return sp;
}

class Particles {
  constructor(scene, n = 900) {
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

    this.scene.add(new THREE.HemisphereLight('#a9b8ff', '#2a1040', 1.1));
    const sun = new THREE.DirectionalLight('#ffffff', 2.4);
    sun.position.set(18, 40, 14);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -27, right: 27, top: 27, bottom: -27, near: 1, far: 100 });
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.02;
    this.scene.add(sun);

    this.buildArena();
    this.buildBackdrop();
    this.particles = new Particles(this.scene);

    this.marker = new THREE.Mesh(
      new THREE.RingGeometry(1.45, 1.75, 48),
      new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.85, depthWrite: false }),
    );
    this.marker.rotation.x = -Math.PI / 2;
    this.marker.position.y = 0.03;
    this.marker.visible = false;
    this.scene.add(this.marker);

    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  buildArena() {
    const tex = floorTexture();
    const top = new THREE.MeshStandardMaterial({
      map: tex, emissive: '#ffffff', emissiveMap: tex, emissiveIntensity: 0.3, roughness: 0.55, metalness: 0.2,
    });
    const side = new THREE.MeshStandardMaterial({ color: '#241b4d', emissive: '#3a1d7a', emissiveIntensity: 0.45, roughness: 0.6, metalness: 0.4 });
    this.platform = new THREE.Mesh(new THREE.CylinderGeometry(1, 0.8, 1.5, 96), [side, top, side]);
    this.platform.position.y = -0.75;
    this.platform.receiveShadow = true;
    this.scene.add(this.platform);

    this.ringMat = new THREE.MeshBasicMaterial({ color: '#ff3d9a' });
    this.ring = new THREE.Mesh(new THREE.BufferGeometry(), this.ringMat);
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.02;
    this.ringR = -1;
    this.scene.add(this.ring);
  }

  rebuildRing(r) {
    this.ring.geometry.dispose();
    this.ring.geometry = new THREE.TorusGeometry(r, 0.16, 8, 160);
    this.ringR = r;
  }

  buildBackdrop() {
    // Stars.
    const n = 1500, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const v = new THREE.Vector3().randomDirection().multiplyScalar(180 + Math.random() * 120);
      pos.set([v.x, v.y, v.z], i * 3);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.scene.add(new THREE.Points(sg, new THREE.PointsMaterial({ color: '#c9c2ff', size: 1.1, fog: false })));

    // Glowing grid far below — the void you fall into.
    const grid = new THREE.GridHelper(400, 80, '#6a3df0', '#3a1f8a');
    grid.position.y = -45;
    this.scene.add(grid);

    // Floating rocks for depth.
    this.rocks = [];
    const rockMat = new THREE.MeshStandardMaterial({ color: '#3b2f70', roughness: 0.9, flatShading: true });
    for (let i = 0; i < 16; i++) {
      const m = new THREE.Mesh(new THREE.IcosahedronGeometry(1 + Math.random() * 3, 0), rockMat);
      const a = Math.random() * Math.PI * 2, d = 42 + Math.random() * 45;
      m.userData = { a, d, y: -14 + Math.random() * 22, spin: (Math.random() - 0.5) * 0.6, orbit: (Math.random() - 0.5) * 0.03 };
      this.scene.add(m);
      this.rocks.push(m);
    }
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.fov = w < h ? 70 : 55;
    this.camera.updateProjectionMatrix();
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
    const label = labelSprite(name, color);
    group.add(label);
    return { group, pivot, mat, label, color, name, yaw: 0, stretch: 1, threeColor: c };
  }

  disposePlayer(m) {
    this.scene.remove(m.group);
    m.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); }
    });
  }

  burst(x, z, strength) {
    const count = Math.min(60, 10 + strength * 2);
    const c1 = new THREE.Color('#fff2a8'), c2 = new THREE.Color('#ff5fb0');
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2, s = 3 + Math.random() * strength * 0.6;
      this.particles.spawn(x, CFG.r, z, Math.cos(a) * s, 2 + Math.random() * 6, Math.sin(a) * s,
        Math.random() < 0.5 ? c1 : c2, 0.4 + Math.random() * 0.5);
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

  update(S, dt) {
    this.time += dt;

    // Arena.
    const r = S.radius;
    this.platform.scale.set(r, 1, r);
    if (Math.abs(r - this.ringR) > 0.02) this.rebuildRing(r);
    const shrinking = S.phase === PHASE.PLAYING && r < CFG.arenaStart - 0.01 && r > CFG.arenaMin + 0.01;
    this.ringMat.color.set(shrinking ? (Math.sin(this.time * 10) > 0 ? '#ff2a4d' : '#ff9a3d') : '#ff3d9a');

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
      const alive = p.f & 1;
      m.group.visible = !!alive;
      if (!alive) continue;
      m.group.position.set(p.rx, p.ry + CFG.r, p.rz);
      if (Math.hypot(p.vx, p.vz) > 0.6) m.yaw = lerpAngle(m.yaw, Math.atan2(p.vx, p.vz), 1 - Math.exp(-dt * 12));
      m.pivot.rotation.y = m.yaw;
      const dashing = p.f & 2;
      const k = 1 - Math.exp(-dt * 15);
      m.mat.emissiveIntensity += ((dashing ? 1.1 : 0.18) - m.mat.emissiveIntensity) * k;
      m.stretch += ((dashing ? 1.22 : 1) - m.stretch) * k;
      const sq = 1 / Math.sqrt(m.stretch);
      m.pivot.scale.set(sq, sq, m.stretch);
      if (dashing && Math.random() < 0.7) {
        const g = m.group.position;
        this.particles.spawn(g.x, g.y, g.z, (Math.random() - 0.5) * 2, Math.random() * 2, (Math.random() - 0.5) * 2, m.threeColor, 0.35);
      }
    }
    for (const [id, m] of this.meshes) {
      if (!S.players.has(id)) { this.disposePlayer(m); this.meshes.delete(id); }
    }

    // "This is you" ring.
    const me = S.players.get(S.myId);
    const meAlive = !!(me && (me.f & 1));
    this.marker.visible = meAlive && !(me.f & 4);
    if (this.marker.visible) {
      this.marker.position.x = me.rx;
      this.marker.position.z = me.rz;
      this.marker.material.color.set(S.roster.get(S.myId)?.color || '#ffffff');
      const s = 1 + Math.sin(this.time * 5) * 0.06;
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
