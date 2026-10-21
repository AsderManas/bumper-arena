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
};

export const PHASE = { WAITING: 0, COUNTDOWN: 1, PLAYING: 2, ROUNDOVER: 3 };

export const COLORS = ['#ff4d6d', '#4dabff', '#ffd23f', '#3ddc97', '#b388ff', '#ff8c42', '#00e5ff', '#ff6ec7'];
const BOT_NAMES = ['Bolt', 'Nova', 'Pixel', 'Turbo', 'Zippy', 'Rumble', 'Comet', 'Blip'];

const r2 = (v) => Math.round(v * 100) / 100;

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
  }

  addPlayer(name, color, bot = false) {
    const id = this.nextId++;
    const p = {
      id, name, color, bot, score: 0,
      x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, faceX: 0, faceZ: 1,
      alive: true, falling: false, dashCd: 0, dashT: 0, respawnT: 0,
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

  resetBody(p) {
    p.y = 0; p.vx = p.vy = p.vz = 0;
    p.alive = true; p.falling = false;
    p.dashCd = 0; p.dashT = 0; p.lastHit = 0; p.lastHitT = -99;
  }

  respawnSolo(p) {
    const a = Math.random() * Math.PI * 2;
    const d = Math.random() * this.radius * 0.4;
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
    this.phase = PHASE.COUNTDOWN;
    this.timer = 3;
    this.radius = CFG.arenaStart;
    this.winner = 0;
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
          if (n >= 2) this.startCountdown();
          else this.toWaiting();
        }
        break;
    }
  }

  botThink(p, list, dt) {
    if (!p.alive || p.falling) { p.input.x = p.input.z = 0; return; }
    const b = p.brain || (p.brain = { t: 0, x: 0, z: 0, skill: 0.55 + Math.random() * 0.35, wob: Math.random() * 10 });
    b.t -= dt;
    if (b.t > 0) return;
    b.t = 0.12 + Math.random() * 0.15 * (1.2 - b.skill);

    let best = null, bd = Infinity;
    for (const o of list) {
      if (o === p || !o.alive || o.falling) continue;
      const d = Math.hypot(o.x - p.x, o.z - p.z);
      if (d < bd) { bd = d; best = o; }
    }
    let dx, dz;
    if (best) { dx = best.x + best.vx * 0.3 - p.x; dz = best.z + best.vz * 0.3 - p.z; }
    else { dx = -p.x; dz = -p.z; }
    let l = Math.hypot(dx, dz) || 1;
    dx /= l; dz /= l;

    // Steer away from the edge, looking ahead along current velocity.
    const fx = p.x + p.vx * 0.45, fz = p.z + p.vz * 0.45;
    const fd = Math.hypot(fx, fz) || 1;
    const danger = fd / this.radius;
    if (danger > 0.62) {
      const w = (danger - 0.62) * 7 * b.skill;
      dx -= (fx / fd) * w; dz -= (fz / fd) * w;
    }
    b.wob += 0.7;
    dx += Math.sin(b.wob) * 0.25 * (1.1 - b.skill);
    dz += Math.cos(b.wob * 1.3) * 0.25 * (1.1 - b.skill);
    l = Math.hypot(dx, dz) || 1;
    b.x = dx / l; b.z = dz / l;
    p.input.x = b.x; p.input.z = b.z;

    if (best && bd < 5.5 && danger < 0.75 && p.dashCd <= 0 && Math.random() < b.skill * 0.6) {
      const tx = (best.x - p.x) / bd, tz = (best.z - p.z) / bd;
      if (tx * b.x + tz * b.z > 0.7) p.input.dash = true;
    }
  }

  step(dt) {
    this.elapsed += dt;
    this.updatePhase(dt);
    const list = [...this.players.values()];
    for (const p of list) if (p.bot) this.botThink(p, list, dt);
    const frozen = this.phase === PHASE.COUNTDOWN;

    for (const p of list) {
      const wantDash = p.input.dash;
      p.input.dash = false;
      if (!p.alive) {
        if (this.phase === PHASE.WAITING && (p.respawnT -= dt) <= 0) this.respawnSolo(p);
        continue;
      }
      p.dashCd = Math.max(0, p.dashCd - dt);
      p.dashT = Math.max(0, p.dashT - dt);
      if (frozen) { p.vx = p.vz = 0; continue; }

      let ix = p.input.x, iz = p.input.z;
      const il = Math.hypot(ix, iz);
      if (il > 1) { ix /= il; iz /= il; }

      if (!p.falling) {
        p.vx += ix * CFG.accel * dt;
        p.vz += iz * CFG.accel * dt;
        if (wantDash && p.dashCd <= 0) {
          let dx = ix, dz = iz;
          if (Math.hypot(dx, dz) < 0.1) { dx = p.faceX; dz = p.faceZ; }
          const dl = Math.hypot(dx, dz) || 1;
          p.vx += (dx / dl) * CFG.dashSpeed;
          p.vz += (dz / dl) * CFG.dashSpeed;
          p.dashCd = CFG.dashCd;
          p.dashT = CFG.dashTime;
          this.events.push(['d', p.id]);
        }
        const damp = Math.exp(-CFG.drag * dt);
        p.vx *= damp; p.vz *= damp;
      }
      p.x += p.vx * dt;
      p.z += p.vz * dt;
      const sp = Math.hypot(p.vx, p.vz);
      if (sp > 0.5) { p.faceX = p.vx / sp; p.faceZ = p.vz / sp; }

      if (!p.falling && Math.hypot(p.x, p.z) > this.radius + 0.2) p.falling = true;
      if (p.falling) { p.vy -= CFG.gravity * dt; p.y += p.vy * dt; }
      if (p.y < -30) this.eliminate(p);
    }

    // Ball-vs-ball collisions.
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (!a.alive) continue;
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        if (!b.alive || Math.abs(a.y - b.y) > CFG.r * 2) continue;
        let dx = b.x - a.x, dz = b.z - a.z;
        let d = Math.hypot(dx, dz);
        const min = CFG.r * 2;
        if (d >= min) continue;
        if (d < 1e-4) { dx = 1; dz = 0; d = 1; }
        const nx = dx / d, nz = dz / d;
        const ma = a.dashT > 0 ? CFG.dashMass : 1;
        const mb = b.dashT > 0 ? CFG.dashMass : 1;
        const overlap = min - Math.min(d, min);
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
  }

  snapshot() {
    const p = [];
    for (const q of this.players.values()) {
      const flags = (q.alive ? 1 : 0) | (q.dashT > 0 ? 2 : 0) | (q.falling ? 4 : 0);
      p.push([q.id, r2(q.x), r2(q.y), r2(q.z), r2(q.vx), r2(q.vz), flags]);
    }
    return { t: 's', p, r: r2(this.radius), ph: this.phase, tm: r2(this.timer), w: this.winner };
  }

  roster() {
    return { t: 'r', l: [...this.players.values()].map((q) => [q.id, q.name, q.color, q.score, q.bot ? 1 : 0]) };
  }

  takeEvents() {
    const e = this.events;
    this.events = [];
    return e;
  }
}
