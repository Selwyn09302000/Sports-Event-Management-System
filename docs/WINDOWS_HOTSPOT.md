# Windows 11: local server, hotspot and firewall

Goal: Laptop A runs the app; Laptop B (projector) and officials' phones reach it with no
router and no internet.

## 1. Start the server

```powershell
cd C:\path\to\Sports-Events-Management-System
npm run build
npm run start
```

The server binds `0.0.0.0:3000`. Do not use `localhost` on other devices — that points at
the device itself.

## 2. Find the real address (never hardcode it)

```powershell
ipconfig
```

Look under the adapter that is actually serving the hotspot (often "Local Area Connection*"
or "Wireless LAN adapter Local Area Connection* 12"). Record the `IPv4 Address`, e.g.
`192.168.137.1` (the usual Windows hotspot gateway) or `172.20.80.1`.

Sanity check from Laptop A:

```powershell
curl http://192.168.137.1:3000/api/health
```

Then on Laptop B: `http://192.168.137.1:3000`

## 3. Enable Mobile Hotspot

Settings → Network & internet → Mobile hotspot:

- Turn on **Mobile hotspot**.
- **Share my internet connection from**: choose the adapter that has internet (Wi-Fi or
  Ethernet). Sharing is optional; scoring works without internet.
- **Power saving**: turn it off, or the hotspot may sleep mid-game.
- Set a strong password; officials' phones will join this network.

If the adapter cannot host a hotspot (some Wi-Fi drivers refuse when connected to Wi-Fi),
Windows will say the hotspot cannot be turned on. Use the fallback in section 6.

## 4. Allow the app through the firewall (narrow rule)

Run in an **administrator** PowerShell, once:

```powershell
New-NetFirewallRule -DisplayName "CourtSide local server" `
  -Direction Inbound -Protocol TCP -LocalPort 3000 `
  -Action Allow -Profile Private
```

Keep the profile `Private` so the port is not exposed on public networks. Do not open the
whole firewall or disable it.

## 5. Checklist to run before the first game

Do this with the actual hardware, at the actual venue:

1. Laptop A: start the server, open `http://<LAN-IP>:3000` — should load.
2. Laptop B: join the hotspot, open the scoreboard URL. It must load.
3. Record a basket on Laptop A → the projector number changes within ~1 second.
4. Phone: join the hotspot, sign in as an official, open the scorer console, record a foul.
   It must appear on Laptop A.
5. Turn off mobile data on Laptop A → confirm scoring still works and the projector still
   updates (it must).
6. Turn the hotspot off and on again → devices reconnect; the scoreboard reconnects by
   itself (the page shows "Reconnecting…" then "Connected").
7. Put the laptops to sleep, wake them, reload → the clock and score recover.

Record the results. If any step fails, do not run the tournament on that arrangement.

## 6. Known Windows pitfalls

- **Client isolation**: some hotspots and guest networks block device-to-device traffic.
  Symptom: the page loads on Laptop A but times out on Laptop B.
- **Public network profile**: Windows may classify the hotspot as Public, so the Private
  firewall rule does not apply. Set the network profile to Private or add a rule for the
  hotspot profile explicitly.
- **VPN or third-party firewall**: can block inbound 3000 even when Windows allows it.
- **Power management**: disable "Allow the computer to turn off this device to save power"
  on the Wi-Fi adapter.
- **Dynamic address**: the hotspot IP can change after a reboot. Re-check `ipconfig` and
  tell the operator the current URL; a projector bookmark may need updating.

## 7. Fallbacks if the laptop cannot host a network

In order of preference:

1. **Portable travel router / access point** — most reliable; connect both laptops and
   phones to it. The app still runs on Laptop A; only the network provider changes.
2. **Phone hotspot** — the phone provides the network, Laptop A and B join it. Find
   Laptop A's address on that network; phones may isolate clients, so test first.
3. **Ethernet cable between laptops** — works for the projector, not for phones.
4. **HDMI from Laptop A to the projector** — removes the second laptop entirely and is the
   most robust fallback. See [PROJECTOR.md](PROJECTOR.md).

## 8. Using mobile data for sync

When Laptop A has internet (its own data or the hotspot's shared connection), open
**Dashboard → Sync** and press **Sync now**, or let the operator do it after the game.
Sync is admin-only. If there is no internet, nothing is lost: the queue stays pending and
is retried later.
