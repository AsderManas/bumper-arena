// Peer-to-peer networking via PeerJS (WebRTC). PeerJS's free public server is only
// used to introduce players to each other; game traffic then flows browser-to-browser.

const PREFIX = 'bumperarena-v1-';
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

const makeCode = () =>
  Array.from({ length: 5 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join('');

function newPeer(id) {
  if (!window.Peer) throw new Error('PeerJS failed to load');
  return id ? new window.Peer(id, { debug: 0 }) : new window.Peer({ debug: 0 });
}

export function hostRoom(handlers, tries = 0) {
  const code = makeCode();
  let peer;
  try { peer = newPeer(PREFIX + code); } catch (err) { handlers.onError(err); return; }
  let opened = false;

  peer.on('open', () => { opened = true; handlers.onOpen(code, peer); });
  peer.on('error', (err) => {
    if (err.type === 'unavailable-id' && tries < 5) {
      peer.destroy();
      hostRoom(handlers, tries + 1);
    } else if (!opened) {
      handlers.onError(err);
    }
  });
  // Losing the signaling server doesn't drop existing players, but new ones couldn't join.
  peer.on('disconnected', () => { if (!peer.destroyed) peer.reconnect(); });
  peer.on('connection', (conn) => {
    conn.on('data', (d) => handlers.onData(conn, d));
    conn.on('close', () => handlers.onLeave(conn));
    conn.on('error', () => handlers.onLeave(conn));
  });
}

export function joinRoom(code, handlers) {
  let peer;
  try { peer = newPeer(); } catch (err) { handlers.onError(err); return; }
  let opened = false;
  const timeout = setTimeout(() => {
    if (opened) return;
    handlers.onError({ type: 'timeout' });
    peer.destroy();
  }, 15000);

  peer.on('open', () => {
    const conn = peer.connect(PREFIX + code, { reliable: true, serialization: 'json' });
    conn.on('open', () => { opened = true; clearTimeout(timeout); handlers.onOpen(conn, peer); });
    conn.on('data', handlers.onData);
    conn.on('close', handlers.onClose);
  });
  peer.on('error', (err) => {
    if (opened) return;
    clearTimeout(timeout);
    handlers.onError(err);
  });
}

export function describeError(err, code) {
  switch (err && err.type) {
    case 'peer-unavailable': return `Room ${code} not found. Check the code, and make sure the host's tab is still open.`;
    case 'timeout': return 'Connection timed out. One of you may be on a network that blocks peer-to-peer games.';
    case 'network':
    case 'server-error':
    case 'socket-error':
    case 'socket-closed': return "Can't reach the matchmaking server. Check your internet connection.";
    case 'browser-incompatible': return "This browser doesn't support WebRTC.";
    default: return (err && err.message) || 'Something went wrong connecting.';
  }
}
