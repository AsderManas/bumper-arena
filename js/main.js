// Glue: menu, input, HUD, and the host/client network roles.
//
// One player hosts: their browser runs the Sim and streams snapshots to everyone.
// Everyone else is a client: they send their stick input and draw what the host says.

import { Sim, CFG, PHASE, COLORS } from './sim.js';
import { hostRoom, joinRoom, describeError } from './net.js';
import { View } from './view.js';
import { sfx, unlockAudio, toggleMute, isMuted } from './audio.js';

const $ = (id) => document.getElementById(id);
const now = () => performance.now() / 1000;
const clamp1 = (v) => Math.max(-1, Math.min(1, v));

const view = new View($('c'));

// Everything the HUD and renderer draw from. Same shape on host and clients.
const S = {
  mode: null,           // 'host' | 'client' | 'solo'
  myId: 0,
  code: null,
  roster: new Map(),    // id -> { name, color, score, bot }
  players: new Map(),   // id -> latest snapshot fields + smoothed render position
  phase: PHASE.WAITING,
  timer: 0,
  radius: CFG.arenaStart,
  winner: 0,
  dashReadyAt: 0,
};

let sim = null;            // host/solo only
let peer = null;
const conns = new Map();   // host: connection -> player id
let link = null;           // client: connection to the host
let pendingEvents = [];

// ---------- menu ----------

const store = {
  get(k, d) { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
};

let myColor = store.get('ba-color', COLORS[Math.floor(Math.random() * COLORS.length)]);
if (!COLORS.includes(myColor)) myColor = COLORS[0];
$('name').value = store.get('ba-name', 'Player' + Math.floor(100 + Math.random() * 900));

for (const c of COLORS) {
  const b = document.createElement('button');
  b.className = 'swatch';
  b.style.background = c;
  b.dataset.c = c;
  b.setAttribute('aria-label', 'Color ' + c);
  b.onclick = () => { myColor = c; markColor(); };
  $('colors').append(b);
}
function markColor() {
  for (const b of $('colors').children) b.classList.toggle('on', b.dataset.c === myColor);
}
markColor();

const urlRoom = new URLSearchParams(location.search).get('room');
if (urlRoom) {
  $('code').value = urlRoom.toUpperCase().slice(0, 5);
  $('btnJoin').classList.add('primary');
  $('btnHost').classList.remove('primary');
}

const myName = () => ($('name').value.trim() || 'Player').slice(0, 12);
const menuMsg = (t) => { $('menuMsg').textContent = t; };
const setNet = (t) => { $('netStatus').textContent = t; };
const nameOf = (id) => S.roster.get(id)?.name ?? '???';

function setMenuBusy(busy) {
  for (const id of ['btnHost', 'btnJoin', 'btnSolo']) $(id).disabled = busy;
}

function enterGame(mode) {
  unlockAudio();
  S.mode = mode;
  store.set('ba-name', myName());
  store.set('ba-color', myColor);
  $('menu').hidden = true;
  $('hud').hidden = false;
  $('hostTools').hidden = mode === 'client';
  if (matchMedia('(pointer: coarse)').matches) $('touch').hidden = false;
}

function setRoom(code, online) {
  $('roomCode').textContent = code;
  $('btnCopy').hidden = !online;
}

function showGone(msg) {
  $('goneMsg').textContent = msg;
  $('gone').hidden = false;
}

$('btnHost').onclick = () => startHost(false);
$('btnSolo').onclick = () => startHost(true);
$('btnJoin').onclick = () => startClient($('code').value);
$('code').addEventListener('keydown', (e) => { if (e.key === 'Enter') startClient($('code').value); });
$('btnBack').onclick = $('btnLeave').onclick = () => { location.href = location.pathname; };
$('btnAddBot').onclick = () => { if (sim && sim.players.size < CFG.maxPlayers) sim.addBot(); };
$('btnRemBot').onclick = () => { if (sim) sim.removeBot(); };
$('btnMute').onclick = () => updateMuteLabel(toggleMute());
function updateMuteLabel(m) { $('btnMute').textContent = m ? 'Sound off' : 'Sound on'; }
updateMuteLabel(isMuted());

$('btnCopy').onclick = async () => {
  const url = location.origin + location.pathname + '?room=' + S.code;
  try {
    await navigator.clipboard.writeText(url);
    $('btnCopy').textContent = 'Copied!';
    setTimeout(() => { $('btnCopy').textContent = 'Copy invite link'; }, 1500);
  } catch {
    window.prompt('Send this link to your friends:', url);
  }
};

// ---------- host ----------

function startHost(offline) {
  enterGame(offline ? 'solo' : 'host');
  sim = new Sim();
  S.myId = sim.addPlayer(myName(), myColor).id;
  if (offline) {
    for (let i = 0; i < 3; i++) sim.addBot();
    setRoom('SOLO', false);
    setNet('Offline practice. Bots are fair game.');
    return;
  }
  setRoom('·····', false);
  setNet('Creating room…');
  hostRoom({
    onOpen(code, p) {
      peer = p;
      S.code = code;
      setRoom(code, true);
      setNet('Online. Send friends the invite link — or add bots while you wait.');
    },
    onData: hostReceive,
    onLeave(conn) {
      const id = conns.get(conn);
      if (id == null) return;
      conns.delete(conn);
      const p = sim.players.get(id);
      if (p) {
        sim.events.push(['l', p.name]);
        sim.removePlayer(id);
      }
    },
    onError(err) {
      setNet('Online play unavailable: ' + describeError(err) + ' You can still play against bots.');
    },
  });
}

function hostReceive(conn, d) {
  if (!d || typeof d !== 'object') return;
  if (d.t === 'hello') {
    if (conns.has(conn)) return;
    if (sim.players.size >= CFG.maxPlayers) {
      const bot = [...sim.players.values()].find((p) => p.bot);
      if (bot) sim.removePlayer(bot.id);
      else { conn.send({ t: 'full' }); setTimeout(() => conn.close(), 300); return; }
    }
    const name = String(d.name || 'Player').slice(0, 12);
    const color = COLORS.includes(d.color) ? d.color : COLORS[0];
    const p = sim.addPlayer(name, color);
    conns.set(conn, p.id);
    conn.send({ t: 'welcome', id: p.id });
    sim.events.push(['j', name]);
  } else if (d.t === 'i') {
    const p = sim.players.get(conns.get(conn));
    if (!p) return;
    p.input.x = clamp1(+d.x || 0);
    p.input.z = clamp1(+d.z || 0);
    if (d.d) p.input.dash = true;
  }
}

function broadcast(msg) {
  for (const c of conns.keys()) if (c.open) c.send(msg);
}

// ---------- client ----------

function startClient(raw) {
  const code = raw.trim().toUpperCase();
  if (code.length !== 5) { menuMsg('Enter the 5-character room code.'); return; }
  unlockAudio();
  menuMsg('Connecting…');
  setMenuBusy(true);
  joinRoom(code, {
    onOpen(conn, p) {
      link = conn;
      peer = p;
      S.code = code;
      enterGame('client');
      setRoom(code, true);
      setNet('Connected to host.');
      conn.send({ t: 'hello', name: myName(), color: myColor });
    },
    onData: clientReceive,
    onClose() { showGone('The host left the game.'); },
    onError(err) {
      setMenuBusy(false);
      menuMsg(describeError(err, code));
    },
  });
}

function clientReceive(d) {
  if (!d || typeof d !== 'object') return;
  switch (d.t) {
    case 'welcome': S.myId = d.id; break;
    case 'r': applyRoster(d); break;
    case 's': applySnapshot(d); handleEvents(d.ev || []); break;
    case 'full': showGone('That room is full (8 players max).'); break;
  }
}

addEventListener('pagehide', () => {
  for (const c of conns.keys()) c.close();
  if (link) link.close();
  if (peer) peer.destroy();
});

// ---------- shared state ----------

let scoresDirty = true;

function applyRoster(d) {
  S.roster = new Map(d.l.map(([id, name, color, score, bot]) => [id, { name, color, score, bot: !!bot }]));
  scoresDirty = true;
}

function applySnapshot(s) {
  const t = now();
  const seen = new Set();
  for (const [id, x, y, z, vx, vz, f] of s.p) {
    seen.add(id);
    let p = S.players.get(id);
    if (!p) { p = { rx: x, ry: y, rz: z }; S.players.set(id, p); }
    if ((p.f & 1) !== (f & 1)) scoresDirty = true;
    Object.assign(p, { x, y, z, vx, vz, f, t });
  }
  for (const id of S.players.keys()) if (!seen.has(id)) S.players.delete(id);
  S.radius = s.r;
  S.phase = s.ph;
  S.timer = s.tm;
  S.winner = s.w;
}

function smoothPlayers(dt) {
  const t = now();
  const k = 1 - Math.exp(-dt * 20);
  for (const p of S.players.values()) {
    if (S.mode !== 'client') { p.rx = p.x; p.ry = p.y; p.rz = p.z; continue; }
    // Extrapolate a little past the last snapshot, then ease toward it.
    const age = Math.min(0.1, t - p.t);
    const tx = p.x + p.vx * age, tz = p.z + p.vz * age;
    if (Math.hypot(tx - p.rx, tz - p.rz) > 6 || Math.abs(p.y - p.ry) > 6) {
      p.rx = tx; p.ry = p.y; p.rz = tz;
    } else {
      p.rx += (tx - p.rx) * k;
      p.rz += (tz - p.rz) * k;
      p.ry += (p.y - p.ry) * k;
    }
  }
}

// ---------- events, feed, HUD ----------

function feed(...parts) {
  const el = document.createElement('div');
  el.className = 'feed-item';
  for (const part of parts) {
    if (typeof part === 'string') { el.append(part); continue; }
    const b = document.createElement('b');
    b.textContent = part.t;
    if (part.c) b.style.color = part.c;
    el.append(b);
  }
  $('feed').append(el);
  while ($('feed').children.length > 5) $('feed').firstChild.remove();
  setTimeout(() => el.remove(), 5000);
}

const who = (id) => ({ t: id === S.myId ? 'You' : nameOf(id), c: S.roster.get(id)?.color });

let flashText = '', flashUntil = 0;
const flash = (text, dur = 0.9) => { flashText = text; flashUntil = now() + dur; };

function handleEvents(evs) {
  for (const e of evs) {
    switch (e[0]) {
      case 'h': {
        view.burst(e[1], e[2], e[3]);
        const me = S.players.get(S.myId);
        const near = !!me && (me.f & 1) && Math.hypot(me.rx - e[1], me.rz - e[2]) < 4;
        sfx.hit(e[3], near);
        if (near) view.shake = Math.min(1, e[3] / 18);
        break;
      }
      case 'd':
        if (e[1] === S.myId) { S.dashReadyAt = now() + CFG.dashCd; sfx.dash(); }
        view.dashFx(e[1]);
        break;
      case 'k':
        if (e[2] && e[2] !== e[1]) feed(who(e[2]), ' bumped ', who(e[1]), ' off');
        else feed(who(e[1]), ' fell off');
        if (e[1] === S.myId) sfx.ko(); else sfx.fall();
        break;
      case 'w':
        if (e[1] === S.myId) sfx.win(); else sfx.end();
        break;
      case 'g': flash('GO!'); sfx.go(); break;
      case 'j': feed({ t: e[1] }, ' joined'); sfx.join(); break;
      case 'l': feed({ t: e[1] }, ' left'); break;
    }
  }
}

function setText(id, text) {
  const el = $(id);
  if (el.textContent !== text) el.textContent = text;
}

let lastCount = -1, scoresT = 0;

function updateHud(dt) {
  if (!S.mode) return;
  const t = now();
  const cd = Math.max(0, S.dashReadyAt - t);
  $('dashFill').style.width = (100 * (1 - cd / CFG.dashCd)).toFixed(1) + '%';

  const me = S.players.get(S.myId);
  const meAlive = !!me && (me.f & 1);
  const alive = [...S.players.values()].filter((p) => p.f & 1).length;
  let banner = '', sub = '';
  switch (S.phase) {
    case PHASE.WAITING:
      lastCount = -1;
      if (S.players.size < 2) {
        sub = S.mode === 'client' ? 'Waiting for more players…' : 'Waiting for players. Share the invite link, or add a bot.';
      }
      break;
    case PHASE.COUNTDOWN: {
      const n = Math.max(1, Math.ceil(S.timer));
      banner = String(n);
      sub = 'Get ready!';
      if (n !== lastCount) { lastCount = n; sfx.beep(); }
      break;
    }
    case PHASE.PLAYING:
      lastCount = -1;
      if (!meAlive) sub = 'Spectating until the next round';
      else {
        sub = `${alive} left standing`;
        if (S.radius < CFG.arenaStart - 0.3) sub += ' · the arena is shrinking!';
      }
      break;
    case PHASE.ROUNDOVER:
      banner = !S.winner ? 'Draw!' : S.winner === S.myId ? 'You win!' : `${nameOf(S.winner)} wins!`;
      sub = 'Next round starting soon…';
      break;
  }
  if (t < flashUntil) banner = flashText;
  setText('banner', banner);
  setText('sub', sub);

  scoresT -= dt;
  if (scoresDirty || scoresT <= 0) {
    scoresDirty = false;
    scoresT = 0.5;
    renderScores();
  }
}

function renderScores() {
  const box = $('scores');
  const rows = [...S.roster.entries()].sort((a, b) => b[1].score - a[1].score);
  const frag = document.createDocumentFragment();
  const head = document.createElement('div');
  head.className = 'lbl';
  head.textContent = `PLAYERS ${rows.length}/${CFG.maxPlayers}`;
  frag.append(head);
  for (const [id, info] of rows) {
    const p = S.players.get(id);
    const row = document.createElement('div');
    row.className = 'score-row' + (id === S.myId ? ' me' : '') + (p && !(p.f & 1) ? ' out' : '');
    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.style.background = info.color;
    const nm = document.createElement('span');
    nm.className = 'nm';
    nm.textContent = info.name + (id === S.myId ? ' (you)' : '');
    const pts = document.createElement('span');
    pts.className = 'pts';
    pts.textContent = info.score;
    row.append(dot, nm, pts);
    frag.append(row);
  }
  box.replaceChildren(frag);
}

// ---------- input ----------

const keys = new Set();
let dashPressed = false;
const touch = { x: 0, y: 0, id: null };

addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  keys.add(e.code);
  if (e.code === 'Space' || e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
    if (!e.repeat) dashPressed = true;
    e.preventDefault();
  }
  if (e.code === 'KeyM' && S.mode) updateMuteLabel(toggleMute());
  if (e.code.startsWith('Arrow')) e.preventDefault();
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => keys.clear());

function readInput() {
  let x = touch.x, z = touch.y;
  if (keys.has('KeyA') || keys.has('ArrowLeft')) x -= 1;
  if (keys.has('KeyD') || keys.has('ArrowRight')) x += 1;
  if (keys.has('KeyW') || keys.has('ArrowUp')) z -= 1;
  if (keys.has('KeyS') || keys.has('ArrowDown')) z += 1;
  const l = Math.hypot(x, z);
  if (l > 1) { x /= l; z /= l; }
  return { x, z };
}

const stick = $('stick'), knob = $('knob');
function moveStick(e) {
  const r = stick.getBoundingClientRect();
  let dx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
  let dy = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
  const l = Math.hypot(dx, dy);
  if (l > 1) { dx /= l; dy /= l; }
  touch.x = dx; touch.y = dy;
  knob.style.transform = `translate(${dx * 37}px, ${dy * 37}px)`;
}
stick.addEventListener('pointerdown', (e) => { touch.id = e.pointerId; stick.setPointerCapture(e.pointerId); moveStick(e); });
stick.addEventListener('pointermove', (e) => { if (e.pointerId === touch.id) moveStick(e); });
const endStick = (e) => {
  if (e.pointerId !== touch.id) return;
  touch.id = null; touch.x = touch.y = 0;
  knob.style.transform = '';
};
stick.addEventListener('pointerup', endStick);
stick.addEventListener('pointercancel', endStick);
$('touchDash').addEventListener('pointerdown', (e) => { e.preventDefault(); dashPressed = true; });

// ---------- main loop ----------
//
// Game logic and networking tick on a Web Worker clock, because browsers pause
// requestAnimationFrame in background tabs — a host alt-tabbing to send the invite
// link would otherwise freeze the game for everyone. Rendering stays on rAF.

const STEP = 1 / 60;
let lastTick = performance.now(), simAcc = 0, sendAcc = 0, inputAcc = 0;

function tick() {
  const t = performance.now();
  const dt = Math.min(0.1, (t - lastTick) / 1000);
  lastTick = t;
  const inp = readInput();

  if (sim) {
    const me = sim.players.get(S.myId);
    if (me) {
      me.input.x = inp.x;
      me.input.z = inp.z;
      if (dashPressed) me.input.dash = true;
    }
    dashPressed = false;
    simAcc += dt;
    let steps = 0;
    while (simAcc >= STEP && steps < 6) { sim.step(STEP); simAcc -= STEP; steps++; }
    if (steps === 6) simAcc = 0;

    const ev = sim.takeEvents();
    if (sim.rosterDirty) {
      sim.rosterDirty = false;
      const r = sim.roster();
      applyRoster(r);
      broadcast(r);
    }
    const snap = sim.snapshot();
    applySnapshot(snap);
    handleEvents(ev);
    pendingEvents.push(...ev);
    sendAcc += dt;
    if (sendAcc >= 1 / 30) {
      sendAcc = 0;
      snap.ev = pendingEvents;
      pendingEvents = [];
      broadcast(snap);
    }
  } else if (link && link.open) {
    inputAcc += dt;
    if (inputAcc >= 1 / 30 || dashPressed) {
      inputAcc = 0;
      link.send({ t: 'i', x: +inp.x.toFixed(2), z: +inp.z.toFixed(2), d: dashPressed ? 1 : 0 });
      dashPressed = false;
    }
  } else {
    dashPressed = false;
  }
}

try {
  const src = 'setInterval(() => postMessage(0), 1000 / 60);';
  const worker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
  worker.onmessage = tick;
} catch {
  setInterval(tick, 1000 / 60);
}

let lastFrame = performance.now();
function frame(ms) {
  const dt = Math.min(0.1, (ms - lastFrame) / 1000);
  lastFrame = ms;
  smoothPlayers(dt);
  view.update(S, dt);
  updateHud(dt);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
