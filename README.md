# 🌍 Tiny Planet Messenger

A cozy 3D browser-based **multiplayer social exploration game**. Walk around a tiny
spherical planet as a messenger, deliver letters & packages to NPCs, collect gems,
discover secrets, emote with other players, and explore six handcrafted regions.

Built with **Three.js** (WebGL) on the front-end and a **zero-dependency Node.js
WebSocket server** for real-time multiplayer. No build step, no `npm install`.

---

## ▶️ How to run

### Option A — Full experience (real multiplayer + everything)
```bash
node server.js
```
Then open **http://localhost:8080** in your browser.
Open it in **two or more tabs / devices on the same network** to see real
players moving, emoting, and delivering together.

> The server serves the game files *and* hosts the multiplayer WebSocket on the
> same port (8080). Change the port with `PORT=3000 node server.js`.

### Option B — Single player (no server)
Just open `index.html` directly in a browser. The game runs fully offline with
**simulated players** (friendly bots) standing in for multiplayer presence.
(Three.js loads from a CDN, so an internet connection is needed the first time.)

---

## 🎮 Controls
| Action | Keyboard / Mouse | Mobile |
|---|---|---|
| Move | `W A S D` / Arrow keys | Left joystick |
| Look around | Drag mouse | Swipe (right side) |
| Zoom | Mouse wheel | — |
| Interact / talk | `E` | ✋ button |
| Emote | `1`–`6` or emoji bar | Emoji bar |
| Journal | `J` or 📖 | 📖 button |
| Mute sound | 🔊 button | 🔊 button |

---

## ✨ Features
- **Spherical world** with true walk-around-the-globe movement & gravity
- **Third-person camera** controller
- **6 themed regions**: Town, Beach, Forest, Industrial, Temple, Cemetery
- **NPC dialogue + chained delivery quests** (pick up → carry → deliver → reward)
- **Real-time multiplayer** — see others move, emote, and deliver live
- **Emoji-only communication** (safe, moderation-free social design)
- **Character customization** (body color, hat color, name) with live 3D preview
- **Collectible gems** + a **secrets system** (6 hidden discoveries)
- **Collectibles Journal** tracking deliveries, gems, regions & secrets
- **Dynamic weather** (clear / cloudy / rain / snow) with lightning
- **Synthesized ambient audio + SFX** (WebAudio — no audio files needed)
- **Cel-shaded art direction** (modeled on Abeto's technical breakdown):
  toon/stepped lighting, custom **outline pass** on characters (inverted-hull),
  film grain, watercolor color-grade and vignette
- **Randomized avatars** — hair styles/colors, hats & cosmetic accessories
- **Mobile + desktop** support

---

## 📁 Files
| File | Purpose |
|---|---|
| `server.js` | Zero-dependency static + WebSocket multiplayer server |
| `index.html` | Page structure & HUD |
| `style.css` | Styling |
| `game.js` | Core engine: world, controller, quests, NPCs, gems |
| `modules.js` | Networking, weather, audio, secrets & journal systems |

---

## 🛠️ Tech notes
- The WebSocket server implements RFC 6455 by hand (handshake + frame codec)
  using only Node built-ins (`http`, `crypto`) — so it runs on a plain Node
  install with **no packages to download**.
- The client gracefully falls back to single-player bots if no server is found,
  so the same files work both online and offline.
