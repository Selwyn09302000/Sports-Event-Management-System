# Projector setup

The projector view is **read-only** and public-safe: team names, scores, clock, period,
team fouls, timeouts and status. No player personal data, no controls.

URL: `http://<LAPTOP-A-IP>:3000/scoreboard/<game-id>`

Find the game id on the tournament page — the **Board** button opens the right URL.

## Arrangement A — second laptop on the local network (preferred)

1. Laptop A: `npm run start`, note its LAN IP (`ipconfig`).
2. Laptop B: join Laptop A's hotspot, open the scoreboard URL, press **Fullscreen**.
3. Turn off screen sleep on Laptop B and set the display to extend to the projector.
4. Leave the page open. It reconnects automatically after a network blip.

If the tournament is published, the scoreboard opens without signing in. For an unpublished
tournament you must sign in on Laptop B first.

## Arrangement B — HDMI from the main laptop

1. Connect HDMI, choose **Extend** (Windows + P).
2. Open the scoreboard URL in a second browser window and drag it to the projector display.
3. Press **Fullscreen** (or F11) in that window.

This is the most robust option: it removes the network and the second laptop from the
critical path.

## What the display shows

| Element | Meaning |
| --- | --- |
| Team name and score | Live score derived from recorded events |
| Clock | Green while running, amber when stopped, red at 0.0 |
| `Q1..Q4`, `OT1…` | Period indicator |
| Team fouls | Personal fouls recorded for that team |
| Timeouts | Used so far (not remaining) |
| `LIVE` / `PAUSED` / `FINAL` … | Game status; a stopped clock during play reads `LIVE · CLOCK STOPPED` |
| Footer | Venue and sync state, e.g. "3 change(s) awaiting cloud sync" |

## Buzzer

Sound is off by default. Press **Sound on** in the header (browsers require a user gesture
before audio). The board beeps once when the clock reaches zero.

## Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| "Reconnecting…" never clears | Wrong IP, firewall, or client isolation — see the hotspot guide |
| Score updates but clock stutters | Expected: the clock is derived from the server anchor, not animated locally; it corrects every second |
| Page requires sign-in | Tournament is not published; publish it or sign in on that device |
| Blank after laptop wakes | Reload the page; the clock and score are recovered from the database |
| 404 | Wrong game id, or the tournament is not published and you are signed out |

## Do not

- Do not use the projector page to score. It has no write endpoints.
- Do not rely on the projector laptop having internet; it never needs it.
