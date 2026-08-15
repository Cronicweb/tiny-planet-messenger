# 🕸 Web Slinger 2

A browser web-swinging sandbox inspired by modern web-head games — built with **Three.js**.
No build step, no dependencies. One HTML file + a zero-dependency Node static server.

**Play:** https://tiny-planet-messenger.onrender.com

## Controls
| Input | Action |
|---|---|
| Hold `SPACE` / LMB | Swing (auto web-anchor) — release to launch |
| `E` | Zip to point (aim at the white ring) |
| `SHIFT` | Dive (trade height for speed) |
| `W A S D` | Steer / run / reel |
| `Q` | Air trick |
| `R` | Respawn |
| Mouse | Camera |

## Run locally
```
node server.js
# open http://localhost:8080
```

## Tech
- Three.js r160 (multi-CDN dynamic import fallback: unpkg → jsDelivr → esm.sh)
- Custom pendulum rope physics (position-based constraint, 3× substep)
- Procedural tiered-setback city, seeded mulberry32 RNG, AABB collision
- Auto anchor selection (SM-style), point-launch zip, dive, wall-run, tricks
