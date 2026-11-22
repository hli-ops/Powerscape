# Powerscape (multiplayer)

A 3D wave-survival game where you type any power and fight with it. This repo includes a small
Node.js WebSocket server so you and your friends play together: you see each other with name tags,
arrows and distance, and your attacks help each other.

```
server.js          Node server: serves the game and relays players over WebSocket (/ws)
public/index.html  The game
public/net.js      Multiplayer client (connects the game to the server)
render.yaml        One-click Render config
```

## Run it on your computer

```
npm install
npm start
```

Open http://localhost:3000 in two browser tabs. Each tab is a separate player.

## Put it on GitHub, then Render

1. Create a new empty repo on GitHub and upload everything in this folder (not `node_modules`).
2. On https://render.com choose **New > Blueprint** (or **New > Web Service**) and pick your repo.
   - Blueprint: Render reads `render.yaml` and fills everything in.
   - Web Service by hand: Runtime **Node**, Build Command `npm install`, Start Command `npm start`, Health Check Path `/health`.
3. Wait for the deploy, then open your `https://something.onrender.com` link.

## Playing with friends

Opening the site makes a private room and adds it to the address bar, like `?room=k3f9a`.
Click the online status line in the menu to copy the invite link, or send the address bar link.
Anyone who opens the same link is in your room. Use `?room=lobby` for a room anyone can find.

## Notes

- The free Render plan puts the server to sleep after about 15 minutes with no visitors. The first
  visit after that takes up to a minute to wake up. Paid plans do not sleep.
- Limits (change with environment variables on Render): `MAX_ROOM` players per room (default 24),
  `MAX_TOTAL` players on the server (default 400). Set `ALLOWED_ORIGINS` (comma separated, for example
  `https://powerscape.onrender.com`) to stop other websites from using your server.
- Each player runs their own world. Others show up as allies and their attacks land in your world,
  but enemies are not shared.
- Progress is saved in each player's browser (and the progress code in the menu), not on the server.
- Three.js and the fonts load from public CDNs, so players need internet access.
