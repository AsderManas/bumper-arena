# Bumper Arena

A 3D multiplayer browser game. Roll your glowing bumper ball around a floating arena and knock everyone else off the edge. The arena shrinks as the round goes on. The last one standing wins the round.

- Up to 8 players, plus bots to fill empty slots
- 5 arenas, 8 power-ups, and an autopilot that plays for you
- Works on desktop (keyboard) and phones (touch joystick)
- Runs on GitHub Pages without a game server or build step

## Controls

| Action | Keyboard | Touch |
|---|---|---|
| Roll | WASD / arrow keys | Left joystick |
| Dash (hits much harder) | Space / Shift | DASH button |
| Autopilot (the bot AI plays as you) | P | Autopilot button |
| Mute | M | Sound button |

## Arenas

By default the arena changes every round. The host can lock one in from the map menu.

| Arena | What's different |
|---|---|
| **Classic** | The original neon platform |
| **Ice Rink** | Almost no friction. Hard to get going and harder to stop |
| **Donut** | A frosted ring with a hole in the middle you can fall through |
| **Pinball** | Five bumpers that launch you when you touch them |
| **Sweeper** | A spinning arm sweeps the floor. Dodge it, or **dash straight through it** |

## Power-ups

One appears every 4 to 7 seconds, with up to 4 on the floor. Roll over one to grab it. The host can turn them off.

| Power-up | Effect |
|---|---|
| ⚡ **Speed** (yellow) | 70% faster rolling for 6 s |
| 🔴 **Mega** (red) | 55% bigger and 2.5× heavier for 7 s |
| 🛡 **Heavy** (blue) | 2× mass for 5 s. Harder to push, but a bit slower |
| 💥 **Shockwave** (purple) | Instantly blasts everyone nearby away from you |
| 👻 **Ghost** (white) | Pass through other players, the sweeper arm and blasts for 5 s |
| 🚀 **Hover** (green) | Float for 5 s. You can't fall, even off the edge, but get back before it runs out |
| 🔥 **Turbo Dash** (orange) | Dash cooldown drops from 1.5 s to 0.35 s for 6 s |
| ❄ **Freeze** (cyan) | Freezes everyone nearby for 2.5 s: no steering, no dashing |

The player with the most round wins wears a crown.

## Publish it on GitHub Pages

1. Create a new **public** repository on GitHub, for example `bumper-arena`.
2. Upload the files in this folder (`index.html`, `style.css`, `js/`, `README.md`) to it. Use the "uploading an existing file" link on the empty repo page, or run:
   ```bash
   git init
   git add .
   git commit -m "Bumper Arena"
   git branch -M main
   git remote add origin https://github.com/<your-username>/bumper-arena.git
   git push -u origin main
   ```
3. In the repo, go to **Settings → Pages**. Under "Build and deployment", pick **Deploy from a branch**, branch **main**, folder **/ (root)**, then **Save**.
4. After about a minute the game is live at `https://<your-username>.github.io/bumper-arena/`.

## Playing with friends

1. One person opens the game and clicks **Host a game**. They get a 5-letter room code.
2. They click **Copy invite link** and send it to friends. Friends can also type the code and click **Join**.
3. A round starts automatically once 2 or more players are in. Use **+ Bot** to fill out the arena.
4. The host's panel also has the arena picker and the power-ups switch.

## How multiplayer works without a server

GitHub Pages can only serve static files, so the game uses **WebRTC** (through [PeerJS](https://peerjs.com/)) to connect players' browsers directly:

- The **host's browser runs the game**: physics, rounds and bots. It sends the game state to everyone 30 times a second.
- Other players send only their controls to the host.
- PeerJS's free public server is used only for the first handshake that introduces players to each other. Game traffic goes player to player, with PeerJS's public relay as a fallback.

Things to know:

- **The host's tab has to stay open.** If the host leaves, the room ends. The host can switch to another tab, and the game keeps running.
- The host needs a decent connection, since everyone's game runs on their machine.
- Some very strict networks, like certain school or office networks, block peer-to-peer connections. If joining keeps timing out, try another network or a phone hotspot.
- The free PeerJS server is a community service with no uptime guarantee. For something bigger, you can [run your own PeerJS server](https://github.com/peers/peerjs-server) and pass its address in `js/net.js`.

## Running it locally

ES modules don't load from `file://`, so serve the folder:

```bash
python -m http.server 8000
```

Then open http://localhost:8000. To test multiplayer by yourself, host in one tab and join from a second tab.

## Project layout

| File | What it does |
|---|---|
| `index.html` | Page, menu and HUD markup. Loads Three.js and PeerJS from CDNs |
| `style.css` | Menu and HUD styling |
| `js/sim.js` | Game rules, physics, arenas, power-ups and bot AI (runs on the host only). Tuning values are in `CFG`, `MAPS` and `POWERS` at the top |
| `js/net.js` | PeerJS room hosting and joining |
| `js/view.js` | Three.js scene: arena, players, particles, camera |
| `js/audio.js` | Synthesized sound effects |
| `js/main.js` | Glue code: menu, input, HUD, host/client message handling |
