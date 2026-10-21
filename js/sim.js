// Authoritative game simulation. Runs only on the host's browser.

export const CFG = {
  arenaStart: 22,
  arenaMin: 8,
  shrinkDelay: 8,    // seconds into a round before the arena starts shrinking
  shrinkTime: 50,    // seconds to shrink from start to min
  r: 1.1,            // ball radius
  accel: 42,
  drag: 2.4,
  dashSpeed: 24,
  dashCd: 1.5,
  dashTime: 0.3,
  dashMass: 3,       // a dashing ball hits like it's this many times heavier
  restitution: 0.8,
  knockback: 1.15,   // arcade extra push on every collision
  gravity: 35,
  maxPlayers: 8,
  maxPowerups: 4,
  pickupR: 0.9,
  shockRadius: 9,
  shockPush: 24,
  freezeRadius: 10,
  freezeTime: 2.5,
  turboCd: 0.35,
  megaScale: 1.55,
  bumperR: 1.5,
  bumperKick: 17,
  hubR: 1.4,
  armWidth: 0.8,
};

export const PHASE = { WAITING: 0, COUNTDOWN: 1, PLAYING: 2, ROUNDOVER: 3 };

export const MAPS = [
  { id: 'classic', name: 'Classic', desc: 'The original. Watch the edge.' },
  { id: 'ice', name: 'Ice Rink', desc: 'Slippery! Hard to stop.', accel: 0.55, drag: 0.9 },
  { id: 'donut', name: 'Donut', desc: "Don't fall through the hole.", hole: 0.32 },
  { id: 'pinball', name: 'Pinball', desc: 'Bumpers launch you flying.', bumpers: true },
  { id: 'sweeper', name: 'Sweeper', desc: 'Dodge the spinning arm, or dash right through it!', sweeper: true },
];

export const POWERS = [
  { id: 'speed', name: 'Speed', color: '#ffd23f', dur: 6 },
  { id: 'mega', name: 'Mega', color: '#ff4d6d', dur: 7 },
  { id: 'heavy', name: 'Heavy', color: '#4dabff', dur: 5 },
  { id: 'shock', name: 'Shockwave', color: '#b388ff', dur: 0 },
  { id: 'ghost', name: 'Ghost', color: '#e8e4ff', dur: 5 },
  { id: 'hover', name: 'Hover', color: '#3ddc97', dur: 5 },
  { id: 'turbo', name: 'Turbo Dash', color: '#ff8c42', dur: 6 },
  { id: 'freeze', name: 'Freeze', color: '#00e5ff', dur: 0 },
];

// Snapshot flag bits for a player.
export const F = {
  ALIVE: 1, DASH: 2, FALL: 4, SPEED: 8, MEGA: 16, HEAVY: 32,
  GHOST: 64, HOVER: 128, TURBO: 256, FROZEN: 512,
};

export const COLORS = ['#ff4d6d', '#4dabff', '#ffd23f', '#3ddc97', '#b388ff', '#ff8c42', '#00e5ff', '#ff6ec7'];
const BOT_NAMES = ['Bolt', 'Nova', 'Pixel', 'Turbo', 'Zippy', 'Rumble', 'Comet', 'Blip'];

const r2 = (v) => Math.round(v * 100) / 100;

export function bumperSpots(map, radius) {
  if (!map.bumpers) return [];
  const spots = [[0, 0]];
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + (i * Math.PI) / 2;
    spots.push([Math.cos(a) * radius * 0.5, Math.sin(a) * radius * 0.5]);
  }
  return spots;
}

const radiusOf = (p) => CFG.r * (p.megaT > 0 ? CFG.megaScale : 1);
const massOf = (p) => (p.dashT > 0 ? CFG.dashMass : 1) * (p.megaT > 0 ? 2.5 : 1) * (p.heavyT > 0 ? 2 : 1);

export class Sim {
  constructor() {
    this.players = new Map();
    this.nextId = 1;
    this.phase = PHASE.WAITING;
    this.timer = 0;
    this.roundTime = 0;
    this.radius = CFG.arenaStart;
    this.elapsed = 0;
    this.winner = 0;
    this.events = [];
    this.rosterDirty = true;
    this.mapIdx = 0;
    this.mapMode = -1;       // -1 = rotate every round, otherwise a fixed map index
    this.powerupsOn = true;
    this.powerups = [];
    this.nextPowerId = 1;
    this.powerT = 3;
    this.armAngle = 0;
    this.armSpeed = 0;
  }

  get map() { return MAPS[this.mapIdx]; }

  setMapMode(mode) {
    this.mapMode = mode;
    if (mode >= 0 && this.phase === PHASE.WAITING) {
      this.mapIdx = mode;
      this.powerups = [];
      for (const p of this.players.values()) this.respawnSolo(p);
    }
  }

  setPowerups(on) {
    this.powerupsOn = on;
    if (!on) this.powerups = [];
  }

  addPlayer(name, color, bot = false) {
    const id = this.nextId++;
    const p = {
      id, name, color, bot, auto: false, score: 0,
      x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, faceX: 0, faceZ: 1,
      alive: true, falling: false, dashCd: 0, dashT: 0, respawnT: 0,
      speedT: 0, megaT: 0, heavyT: 0, ghostT: 0, hoverT: 0, turboT: 0, frozenT: 0, sweepT: 0,
      lastHit: 0, lastHitT: -99,
      input: { x: 0, z: 0, dash: false },
    };
    this.players.set(id, p);
    this.rosterDirty = true;
    if (this.phase === PHASE.WAITING) this.respawnSolo(p);
    else if (this.phase === PHASE.COUNTDOWN) this.startCountdown();
    else p.alive = false; // joined mid-round: spectate until the next one
    return p;
  }

  addBot() {
    const used = new Set([...this.players.values()].map((p) => p.name));
    const usedColors = new Set([...this.players.values()].map((p) => p.color));
    const base = BOT_NAMES.find((n) => !used.has('Bot ' + n)) || 'Bot';
    const color = COLORS.find((c) => !usedColors.has(c)) || COLORS[Math.floor(Math.random() * COLORS.length)];
    return this.addPlayer('Bot ' + base, color, true);
  }

  removeBot() {
    const bots = [...this.players.values()].filter((p) => p.bot);
    if (bots.length) this.removePlayer(bots[bots.length - 1].id);
  }

  removePlayer(id) {
    this.players.delete(id);
    this.rosterDirty = true;
  }

  setAuto(p, on) {
    if (p.auto === on) return;
    p.auto = on;
    p.brain = null;
    this.rosterDirty = true;
  }

  resetBody(p) {
    p.y = 0; p.vx = p.vy = p.vz = 0;
    p.alive = true; p.falling = false;
    p.dashCd = 0; p.dashT = 0; p.lastHit = 0; p.lastHitT = -99;
    p.speedT = p.megaT = p.heavyT = p.ghostT = p.hoverT = p.turboT = p.frozenT = 0;
  }

  // Ring of safe floor to drop players onto: [min, max] distance from center.
  spawnBand() {
    const h = this.map.hole;
    return h ? [(h + 0.12) * this.radius, (h + 0.32) * this.radius] : [0, 0.4 * this.radius];
  }

  respawnSolo(p) {
    const [lo, hi] = this.spawnBand();
    const a = Math.random() * Math.PI * 2;
    const d = lo + Math.random() * (hi - lo);
    this.resetBody(p);
    p.x = Math.cos(a) * d; p.z = Math.sin(a) * d;
  }

  spawnAll() {
    const list = [...this.players.values()];
    list.forEach((p, i) => {
      const a = (i / list.length) * Math.PI * 2 + 0.3;
      const d = this.radius * 0.6;
      this.resetBody(p);
      p.x = Math.cos(a) * d; p.z = Math.sin(a) * d;
      p.faceX = -Math.cos(a); p.faceZ = -Math.sin(a);
    });
  }

  startCountdown() {
    if (this.mapMode >= 0) this.mapIdx = this.mapMode;
    this.phase = PHASE.COUNTDOWN;
    this.timer = 3;
    this.radius = CFG.arenaStart;
    this.winner = 0;
    this.powerups = [];
    this.powerT = 4;
    this.armAngle = 0;
    this.spawnAll();
  }

  toWaiting() {
    this.phase = PHASE.WAITING;
    this.winner = 0;
    for (const p of this.players.values()) if (!p.alive) this.respawnSolo(p);
  }

  eliminate(p) {
    p.alive = false; p.falling = false;
    p.vx = p.vy = p.vz = 0;
    const killer = this.elapsed - p.lastHitT < 4 && this.players.has(p.lastHit) ? p.lastHit : 0;
    this.events.push(['k', p.id, killer]);
    p.respawnT = 1.5;
  }

  updatePhase(dt) {
    const n = this.players.size;
    switch (this.phase) {
      case PHASE.WAITING:
        this.radius += (CFG.arenaStart - this.radius) * Math.min(1, dt * 2);
        if (n >= 2) this.startCountdown();
        break;
      case PHASE.COUNTDOWN:
        this.timer -= dt;
        if (n < 2) this.toWaiting();
        else if (this.timer <= 0) {
          this.phase = PHASE.PLAYING;
          this.timer = 0;
          this.roundTime = 0;
          this.events.push(['g']);
        }
        break;
      case PHASE.PLAYING: {
        this.roundTime += dt;
        const t = Math.max(0, this.roundTime - CFG.shrinkDelay) / CFG.shrinkTime;
        this.radius = CFG.arenaStart - (CFG.arenaStart - CFG.arenaMin) * Math.min(1, t);
        if (n < 2) { this.toWaiting(); break; }
        const alive = [...this.players.values()].filter((p) => p.alive);
        if (alive.length <= 1) {
          const w = alive[0];
          if (w) { w.score++; this.rosterDirty = true; }
          this.winner = w ? w.id : 0;
          this.events.push(['w', this.winner]);
          this.phase = PHASE.ROUNDOVER;
          this.timer = 4;
        }
        break;
      }
      case PHASE.ROUNDOVER:
        this.timer -= dt;
        if (this.timer <= 0) {
          if (this.mapMode < 0) this.mapIdx = (this.mapIdx + 1) % MAPS.length;
          if (n >= 2) this.startCountdown();
          else this.toWaiting();
        }
        break;
    }
  }

  botThink(p, list, dt) {
    if (!p.alive || p.falling) { p.input.x = p.input.z = 0; return; }
    const b = p.brain || (p.brain = {
      t: 0, x: 0, z: 0, wob: Math.random() * 10,
      skill: p.auto ? 0.9 : 0.55 + Math.random() * 0.35,
    });
    b.t -= dt;
    if (b.t > 0) return;
    b.t = 0.12 + Math.random() * 0.15 * (1.2 - b.skill);

    let best = null, bd = Infinity;
    for (const o of list) {
      if (o === p || !o.alive || o.falling) continue;
      const d = Math.hypot(o.x - p.x, o.z - p.z);
      if (d < bd) { bd = d; best = o; }
    }
    let pu = null, pd = Infinity;
    for (const u of this.powerups) {
      const d = Math.hypot(u.x - p.x, u.z - p.z);
      if (d < pd) { pd = d; pu = u; }
    }
    // A nearby power-up beats a far-away opponent.
    let gx = 0, gz = 0, chasing = false;
    if (pu && (!best || (pd < 10 && pd < bd * 0.9))) { gx = pu.x - p.x; gz = pu.z - p.z; }
    else if (best) { gx = best.x + best.vx * 0.3 - p.x; gz = best.z + best.vz * 0.3 - p.z; chasing = true; }
    let l = Math.hypot(gx, gz) || 1;
    let dx = gx / l, dz = gz / l;

    // Steer away from the edge (and the donut hole), looking ahead along current velocity.
    const fx = p.x + p.vx * 0.45, fz = p.z + p.vz * 0.45;
    const fd = Math.hypot(fx, fz) || 1;
    const danger = fd / this.radius;
    if (danger > 0.62) {
      const w = (danger - 0.62) * 7 * b.skill;
      dx -= (fx / fd) * w; dz -= (fz / fd) * w;
    }
    if (this.map.hole) {
      const inner = this.map.hole * this.radius + 3;
      if (fd < inner) {
        const w = ((inner - fd) / 3) * 2.5 * b.skill;
        dx += (fx / fd) * w; dz += (fz / fd) * w;
      }
    }
    b.wob += 0.7;
    dx += Math.sin(b.wob) * 0.25 * (1.1 - b.skill);
    dz += Math.cos(b.wob * 1.3) * 0.25 * (1.1 - b.skill);
    l = Math.hypot(dx, dz) || 1;
    b.x = dx / l; b.z = dz / l;
    p.input.x = b.x; p.input.z = b.z;

    if (chasing && bd < 5.5 && danger < 0.75 && p.dashCd <= 0 && Math.random() < b.skill * 0.6) {
      const tx = (best.x - p.x) / bd, tz = (best.z - p.z) / bd;
      if (tx * b.x + tz * b.z > 0.7) p.input.dash = true;
    }
  }

  // Bounce a ball off a fixed round obstacle. Returns true on a real impact.
  bounceOff(p, bx, bz, br, kick) {
    const rad = radiusOf(p);
    let dx = p.x - bx, dz = p.z - bz;
    let d = Math.hypot(dx, dz);
    const min = br + rad;
    if (d >= min) return false;
    if (d < 1e-4) { dx = 1; dz = 0; d = 1; }
    const nx = dx / d, nz = dz / d;
    p.x = bx + nx * min; p.z = bz + nz * min;
    const vn = p.vx * nx + p.vz * nz;
    if (vn < 0) { p.vx -= 2 * vn * nx; p.vz -= 2 * vn * nz; }
    const out = p.vx * nx + p.vz * nz;
    if (kick && out < kick) { p.vx += (kick - out) * nx; p.vz += (kick - out) * nz; }
    return vn < -2;
  }

  // The sweeper is a single arm from the hub to the rim. Dashing (or Ghost) phases through it.
  sweep(p) {
    if (p.dashT > 0 || p.ghostT > 0) return;
    const a = this.armAngle;
    const dx = Math.cos(a), dz = Math.sin(a), nx = -dz, nz = dx;
    const along = p.x * dx + p.z * dz, perp = p.x * nx + p.z * nz;
    const half = CFG.armWidth / 2 + radiusOf(p);
    if (along < 0 || along > this.radius || Math.abs(perp) >= half) return;
    const s = perp >= 0 ? 1 : -1;
    const fix = s * half - perp;
    p.x += nx * fix; p.z += nz * fix;
    const barV = this.armSpeed * along;   // bar surface speed at this point, along n
    const hitting = s * barV > 0;         // bar is moving toward this side
    const want = barV + s * (hitting ? 7 : 1);
    const vn = p.vx * nx + p.vz * nz;
    if (s * (vn - want) < 0) {
      p.vx += (want - vn) * nx; p.vz += (want - vn) * nz;
      if (hitting && Math.abs(want - vn) > 5 && p.sweepT <= 0) {
        p.sweepT = 0.4;
        this.events.push(['h', r2(p.x), r2(p.z), r2(Math.abs(want - vn))]);
      }
    }
  }

  updatePowerups(dt, list) {
    const hole = this.map.hole ? this.map.hole * this.radius : 0;
    for (let i = this.powerups.length - 1; i >= 0; i--) {
      const u = this.powerups[i];
      const d = Math.hypot(u.x, u.z);
      if (d > this.radius - 1.5 || (hole && d < hole + 1.5)) this.powerups.splice(i, 1);
    }
    if (!this.powerupsOn || this.phase === PHASE.COUNTDOWN) return;

    this.powerT -= dt;
    if (this.powerT <= 0 && this.powerups.length < CFG.maxPowerups) {
      this.powerT = 4 + Math.random() * 3;
      // Keep spawns well inside reachable floor: off the hub, away from the hole and the rim.
      const lo = hole ? hole + 2.5 : this.map.sweeper ? CFG.hubR + 3 : 2;
      const hi = Math.max(lo + 1, this.radius * 0.65);
      const bumpers = bumperSpots(this.map, this.radius);
      for (let tries = 0; tries < 12; tries++) {
        const a = Math.random() * Math.PI * 2, d = lo + Math.random() * (hi - lo);
        const x = Math.cos(a) * d, z = Math.sin(a) * d;
        if (bumpers.some(([bx, bz]) => Math.hypot(x - bx, z - bz) < 3.5)) continue;
        this.powerups.push({ id: this.nextPowerId++, type: Math.floor(Math.random() * POWERS.length), x, z });
        break;
      }
    }

    for (const p of list) {
      if (!p.alive || p.falling) continue;
      for (let i = this.powerups.length - 1; i >= 0; i--) {
        const u = this.powerups[i];
        if (Math.hypot(u.x - p.x, u.z - p.z) > radiusOf(p) + CFG.pickupR) continue;
        this.powerups.splice(i, 1);
        this.applyPower(p, u.type, list);
      }
    }
  }

  applyPower(p, type, list) {
    const pw = POWERS[type];
    if (pw.id === 'speed') p.speedT = pw.dur;
    else if (pw.id === 'mega') p.megaT = pw.dur;
    else if (pw.id === 'heavy') p.heavyT = pw.dur;
    else if (pw.id === 'ghost') p.ghostT = pw.dur;
    else if (pw.id === 'hover') p.hoverT = pw.dur;
    else if (pw.id === 'turbo') { p.turboT = pw.dur; p.dashCd = 0; }
    else if (pw.id === 'shock') {
      for (const o of list) {
        if (o === p || !o.alive || o.ghostT > 0) continue;
        const dx = o.x - p.x, dz = o.z - p.z, d = Math.hypot(dx, dz) || 0.01;
        if (d > CFG.shockRadius) continue;
        const push = (CFG.shockPush * (1 - d / CFG.shockRadius) + 8) / (o.heavyT > 0 ? 1.5 : 1);
        o.vx += (dx / d) * push; o.vz += (dz / d) * push;
        o.lastHit = p.id; o.lastHitT = this.elapsed;
      }
      this.events.push(['x', r2(p.x), r2(p.z)]);
    } else if (pw.id === 'freeze') {
      for (const o of list) {
        if (o === p || !o.alive || o.ghostT > 0) continue;
        if (Math.hypot(o.x - p.x, o.z - p.z) > CFG.freezeRadius) continue;
        o.frozenT = CFG.freezeTime;
        o.lastHit = p.id; o.lastHitT = this.elapsed;
      }
      this.events.push(['z', r2(p.x), r2(p.z)]);
    }
    this.events.push(['p', p.id, type]);
  }

  step(dt) {
    this.elapsed += dt;
    this.updatePhase(dt);
    const list = [...this.players.values()];
    for (const p of list) if (p.bot || p.auto) this.botThink(p, list, dt);
    const frozen = this.phase === PHASE.COUNTDOWN;
    const map = this.map;
    const drag = map.drag ?? CFG.drag;
    const hole = map.hole ? map.hole * this.radius : 0;

    if (map.sweeper) {
      this.armSpeed = frozen ? 0 : this.phase === PHASE.PLAYING ? 0.5 + Math.min(0.3, this.roundTime * 0.006) : 0.35;
      this.armAngle = (this.armAngle + this.armSpeed * dt) % (Math.PI * 2);
    } else {
      this.armSpeed = 0;
    }
    const bumpers = bumperSpots(map, this.radius);

    for (const p of list) {
      const wantDash = p.input.dash;
      p.input.dash = false;
      if (!p.alive) {
        if (this.phase === PHASE.WAITING && (p.respawnT -= dt) <= 0) this.respawnSolo(p);
        continue;
      }
      p.dashCd = Math.max(0, p.dashCd - dt);
      p.dashT = Math.max(0, p.dashT - dt);
      p.speedT = Math.max(0, p.speedT - dt);
      p.megaT = Math.max(0, p.megaT - dt);
      p.heavyT = Math.max(0, p.heavyT - dt);
      p.ghostT = Math.max(0, p.ghostT - dt);
      p.hoverT = Math.max(0, p.hoverT - dt);
      p.turboT = Math.max(0, p.turboT - dt);
      p.frozenT = Math.max(0, p.frozenT - dt);
      p.sweepT = Math.max(0, p.sweepT - dt);
      if (frozen) { p.vx = p.vz = 0; continue; }

      let ix = p.input.x, iz = p.input.z;
      const il = Math.hypot(ix, iz);
      if (il > 1) { ix /= il; iz /= il; }
      if (p.frozenT > 0) ix = iz = 0;

      if (!p.falling) {
        const accel = CFG.accel * (map.accel ?? 1) * (p.speedT > 0 ? 1.7 : 1) * (p.heavyT > 0 ? 0.8 : 1);
        p.vx += ix * accel * dt;
        p.vz += iz * accel * dt;
        if (wantDash && p.dashCd <= 0 && p.frozenT <= 0) {
          let dx = ix, dz = iz;
          if (Math.hypot(dx, dz) < 0.1) { dx = p.faceX; dz = p.faceZ; }
          const dl = Math.hypot(dx, dz) || 1;
          p.vx += (dx / dl) * CFG.dashSpeed;
          p.vz += (dz / dl) * CFG.dashSpeed;
          p.dashCd = p.turboT > 0 ? CFG.turboCd : CFG.dashCd;
          p.dashT = CFG.dashTime;
          this.events.push(['d', p.id]);
        }
        const damp = Math.exp(-drag * dt);
        p.vx *= damp; p.vz *= damp;
      }
      p.x += p.vx * dt;
      p.z += p.vz * dt;
      const sp = Math.hypot(p.vx, p.vz);
      if (sp > 0.5) { p.faceX = p.vx / sp; p.faceZ = p.vz / sp; }

      if (!p.falling) {
        bumpers.forEach(([bx, bz], i) => {
          if (this.bounceOff(p, bx, bz, CFG.bumperR, CFG.bumperKick)) this.events.push(['b', i]);
        });
        if (map.sweeper) {
          this.bounceOff(p, 0, 0, CFG.hubR, 0);
          this.sweep(p);
        }
        const d = Math.hypot(p.x, p.z);
        if (p.hoverT <= 0 && (d > this.radius + 0.2 || (hole && d < hole - 0.2))) p.falling = true;
      }
      if (p.falling) { p.vy -= CFG.gravity * dt; p.y += p.vy * dt; }
      if (p.y < -30) this.eliminate(p);
    }

    // Ball-vs-ball collisions.
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (!a.alive) continue;
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        if (!b.alive || Math.abs(a.y - b.y) > CFG.r * 2 || a.ghostT > 0 || b.ghostT > 0) continue;
        let dx = b.x - a.x, dz = b.z - a.z;
        let d = Math.hypot(dx, dz);
        const min = radiusOf(a) + radiusOf(b);
        if (d >= min) continue;
        if (d < 1e-4) { dx = 1; dz = 0; d = 1; }
        const nx = dx / d, nz = dz / d;
        const ma = massOf(a), mb = massOf(b);
        const overlap = min - d;
        a.x -= nx * overlap * (mb / (ma + mb)); a.z -= nz * overlap * (mb / (ma + mb));
        b.x += nx * overlap * (ma / (ma + mb)); b.z += nz * overlap * (ma / (ma + mb));

        const closing = (a.vx - b.vx) * nx + (a.vz - b.vz) * nz;
        if (closing <= 0) continue;
        const imp = ((1 + CFG.restitution) * closing / (1 / ma + 1 / mb)) * CFG.knockback;
        a.vx -= (imp / ma) * nx; a.vz -= (imp / ma) * nz;
        b.vx += (imp / mb) * nx; b.vz += (imp / mb) * nz;
        a.lastHit = b.id; a.lastHitT = this.elapsed;
        b.lastHit = a.id; b.lastHitT = this.elapsed;
        if (closing > 3) this.events.push(['h', r2((a.x + b.x) / 2), r2((a.z + b.z) / 2), r2(closing)]);
      }
    }

    this.updatePowerups(dt, list);
  }

  snapshot() {
    const p = [];
    for (const q of this.players.values()) {
      const flags = (q.alive ? F.ALIVE : 0) | (q.dashT > 0 ? F.DASH : 0) | (q.falling ? F.FALL : 0)
        | (q.speedT > 0 ? F.SPEED : 0) | (q.megaT > 0 ? F.MEGA : 0) | (q.heavyT > 0 ? F.HEAVY : 0)
        | (q.ghostT > 0 ? F.GHOST : 0) | (q.hoverT > 0 ? F.HOVER : 0) | (q.turboT > 0 ? F.TURBO : 0)
        | (q.frozenT > 0 ? F.FROZEN : 0);
      p.push([q.id, r2(q.x), r2(q.y), r2(q.z), r2(q.vx), r2(q.vz), flags]);
    }
    return {
      t: 's', p,
      r: r2(this.radius), ph: this.phase, tm: r2(this.timer), w: this.winner,
      m: this.mapIdx, a: r2(this.armAngle), as: r2(this.armSpeed),
      u: this.powerups.map((u) => [u.id, u.type, r2(u.x), r2(u.z)]),
    };
  }

  roster() {
    return { t: 'r', l: [...this.players.values()].map((q) => [q.id, q.name, q.color, q.score, q.bot ? 1 : 0, q.auto ? 1 : 0]) };
  }

  takeEvents() {
    const e = this.events;
    this.events = [];
    return e;
  }
}
