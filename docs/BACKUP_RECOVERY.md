# Backup and recovery

The official record is `data/local.sqlite` on the scoring laptop. Treat it as the scorebook.

## Back up

While the server is running (safe — uses `VACUUM INTO`):

```bash
npm run db:backup
```

Writes `backups/local-<timestamp>.sqlite`. Do this:

- before the first game of the day,
- after the last game,
- before changing laptops, reinstalling, or updating the app,
- before running a migration.

Copy the file to a USB drive or another machine. A backup on the same laptop does not
survive a lost laptop.

## Restore

1. Stop the server (close the terminal / Ctrl+C).
2. Move the damaged database aside — never delete it:
   ```bash
   mv data/local.sqlite data/local.sqlite.broken
   mv data/local.sqlite-wal data/local.sqlite-wal.broken 2>/dev/null || true
   ```
3. Copy the backup into place:
   ```bash
   cp backups/local-2026-11-14T09-00-00-000Z.sqlite data/local.sqlite
   ```
4. Start the server. The app checks and applies migrations on connect.
5. Sign in and open the affected game to confirm the score and clock.

The SQLite file is self-contained (no separate user database), so a restored file includes
accounts, events, results and the sync queue.

## Mid-game incident playbook

| Incident | What to do |
| --- | --- |
| Browser refreshed / closed | Reopen the game. Clock and score recover from the server. |
| Scorer laptop restarted | Restart the server, reopen the game. Same recovery path. |
| Wrong score recorded | Void the event with a reason (official), or correct it. Do not edit the database by hand. |
| Clock drifted or was started early | **Reset clock** with confirmation, or correct remaining time in the console; both are audited. |
| Projector laptop disconnected | It reconnects automatically; the game is unaffected. |
| Phone disconnected | Scoring on the phone failed safely; retry uses the same action id. |
| Internet lost | Nothing changes locally. Sync stays pending. |
| Cloud sync failed | The queue shows `pending` with the error. Retry later; never delete the queue. |
| Cloud reports a conflict | An approved result already exists in the cloud with a different score. Decide the correct result, record it through the review screen, then retry. |
| Duplicate points suspected | Check the event history; duplicate client actions are impossible, so look for two distinct events and void the wrong one. |
| Database file corrupted | Restore the most recent backup. Events recorded after that backup are lost; re-enter them from the paper scorebook. |

## Export before changing devices

1. Run `npm run db:backup`.
2. Copy the file to the new laptop's `data/local.sqlite`.
3. If you keep the old laptop, do not run both against the same cloud project expecting a
   merge — pick one as the authority.
4. Open **Dashboard → Sync** and confirm the queue state before recording new games.

## Sync queue after restore

Restoring an older file can re-queue operations that the cloud already has. That is safe:
every operation carries a unique idempotency key and event ids are primary keys, so a
re-push cannot duplicate points. Conflicts are surfaced rather than merged silently.
