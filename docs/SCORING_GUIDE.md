# Scorer and officials guide

## Before the first game

1. Sign in as an administrator on Laptop A.
2. Create the tournament, add a division and venue, register teams, then add players with
   jersey numbers.
3. Generate the schedule (per division). Review it for conflicts before publishing.
4. Publish the tournament so public and projector pages work.
5. Lock the roster once lineups are final. Changes after locking are still possible but
   recorded in the audit log.
6. Open the game → **Score**. The console is the only screen that writes game data.

## Roles needed

- **Scorer** — records actions and clock.
- **Approving Official** — approves or rejects the final result, voids/corrects events.
- Administrator can do both.

## The scoring console

**Select a player**, then use the action buttons. Player actions apply to the selected
player; team actions (timeout) appear on the team panel header.

| Button | Records |
| --- | --- |
| `+2` / `+3` / `+1 FT` | Made field goal / three / free throw (adds points) |
| `Miss 2` / `Miss 3` / `Miss FT` | Attempt only — never adds points |
| `Foul` | Personal foul (team + player + period) |
| `OREB` / `DREB` | Offensive / defensive rebound |
| `AST` / `STL` / `BLK` / `TOV` | Assist, steal, block, turnover |
| `Timeout` (team header) | Team timeout, limited by the tournament rules |
| `Record substitution` | Player out → player in, same team |

Attempts are recorded on a miss, so field-goal percentages stay correct:
`FG% = made / attempted`.

### Clock

- **Start / Pause** — the only way to run the clock.
- **Next period** — advances the period and loads the next period length (overtime uses the
  ruleset's overtime length).
- **Reset clock** — asks for confirmation; resets the current period and stops the clock.
  Recorded in the audit log.
- **End period** — stops the clock and stamps the period.
- **End game** — stops the clock and moves the game to review. It does **not** finalize.

The clock is stored on the server as `remaining + anchor timestamp`. Reloading the page,
closing the browser or restarting the laptop recovers the same time.

A browser clock is a timing aid, not a certified timer. For a match that matters, run a
physical backup timer and use the app clock for the record.

### Corrections

- **Void** (officials only): marks an event as void with a required reason. The original
  stays in the event history and the audit log; totals are recalculated.
- **Correction** via the API/UI replaces an event with a new one that points at the voided
  original, so "who fixed what, when and why" is preserved.

Impossible records are rejected: a player not on the roster, a jersey/team mismatch, a
sixth personal foul (default limit 5), a timeout beyond the limit, or a substitution of a
player into the wrong team.

### If the network drops

Keep scoring. Actions are committed on Laptop A. If an officials' phone loses the hotspot,
the console shows an error and offers **Retry** using the same action id, so a retry cannot
double-count. The phone reconnects automatically.

## Ending a game

1. **End game** on the scorer console → status `Awaiting review`.
2. Open **Review**: check the score and both box scores.
3. **Submit result for approval** (scorer).
4. The **approving official** presses **Approve result** (or rejects with a reason, which
   returns the game to the scorer).
5. Approval sets the game to `Final`, updates standings and advances the bracket.

A tied score cannot be submitted. If events change after submission, approval is blocked
until the result is submitted again — this prevents approving a score that no longer
matches the event log.

## Correcting an approved result

On the review screen, **Correct final result** requires new scores and a reason. The
previous result is kept as `superseded`, the new one records who approved it and when, and
the audit log keeps both. Standings and the bracket are recalculated from approved results.

## Reading the box score

Points, 2PT/3PT/FT made-attempted with percentages, total rebounds, assists, steals,
blocks, turnovers and personal fouls, plus team totals. Playing time is not shown because
it would require complete substitution and on-court tracking; the app does not guess.
