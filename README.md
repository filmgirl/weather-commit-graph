# weather-commit-graph

Renders your git history as a weather forecast.

A local-first dashboard that reads a repository's commit log and reports it as
weather: sunny for healthy, steady shipping; storms where churn, fixes, and
concentrated ownership pile up. The metaphor is the interface, but the numbers
underneath are real — velocity, churn, fix ratio, ownership concentration, and
per-file hotspot scoring, all computed from `git log`.

Nothing leaves your machine. There is no account and no telemetry; the server only
ever runs `git` against repositories you explicitly add.

## Quick start

Requires Node 20+ and git.

```bash
npm install
npm run seed:demo   # optional: generates five demo repos to look at
npm run dev
```

Then open http://localhost:5173 and add the absolute path to a local git
repository. If you seeded the demo repos they are in `.demo-repos/`, and each one
is built to produce a different forecast:

| Repo           | Forecast | Shape                                           |
| -------------- | -------- | ----------------------------------------------- |
| `demo-sunny`   | Sunny    | Steady commits, four authors, small changes     |
| `demo-rainy`   | Rain     | Elevated churn with a real share of fix commits |
| `demo-stormy`  | Storm    | One author hammering one file, half of it fixes |
| `demo-foggy`   | Fog      | Nine commits scattered over a month             |
| `demo-dormant` | Snow     | Nothing landed for months                       |

`npm run dev` starts the API on port 3001 and the web app on 5173. Both are
configurable via `PORT`, `VITE_PORT`, and `VITE_API_PORT` so nothing collides with
whatever else you have running.

## How the weather is decided

Two states are checked before anything else, because they describe an *absence* of
signal rather than a degree of trouble:

- **Snow** — no commits in the window, or nothing for 21+ days. A repo nobody has
  touched is not "sunny" just because it has no churn.
- **Fog** — under 0.45 commits/day across fewer than half the window's days. Too
  little signal to read a direction from, which is different from reading a bad one.

Everything else lands on a ramp cut from a blended 0..1 *trouble* score. Each input
is normalized so a small repo and a monorepo are scored on the same scale:

| Signal                  | Weight | What it measures                                |
| ----------------------- | -----: | ----------------------------------------------- |
| Fix pressure            |   0.34 | Share of commits that read as fixes or reverts  |
| Churn pressure          |   0.28 | Average commit size against a calm baseline     |
| Ownership concentration |   0.13 | Gini over per-author commit counts (bus factor) |
| Hotspot concentration   |   0.13 | How much churn is trapped in a single file      |
| Commit-size variance    |   0.12 | Erratic, lurching change sizes                  |
| Velocity drag           |   0.08 | Cooling commit rate, as a light modifier        |

| Trouble score | Condition     |
| ------------- | ------------- |
| `< 0.18`      | Sunny         |
| `0.18–0.33`   | Partly cloudy |
| `0.33–0.47`   | Overcast      |
| `0.47–0.62`   | Rain          |
| `≥ 0.62`      | Storm         |

Recent work counts for more: churn decays with a 10-day half-life, and a file's
churn is scaled up each time it is rewritten, so one file churned across twenty
commits outranks twenty files churned once.

### The instruments

| Gauge       | Git signal              | Reading                                        |
| ----------- | ----------------------- | ---------------------------------------------- |
| Temperature | Commits per day         | Warmer means more is shipping                  |
| Wind        | Lines changed per day   | Gusty means a lot of code is moving            |
| Pressure    | Fix ratio               | Falling barometer means corrective work rising |
| Humidity    | Ownership concentration | Muggy means knowledge is trapped               |

Temperature and wind are logarithmic: 0 to 1 commit/day is a real warm-up, while
20 versus 30 commits/day both just read "hot", which is closer to how differently
sized repos actually feel.

### What is excluded

Merge commits (they repeat their parents' changes and would double-count churn),
binary files, and vendored paths like `node_modules`, lockfiles, and build output.

## The three views

- **Forecast** — the headline condition, an animated scene, the four gauges, and
  advisories naming the specific signal that drove the weather.
- **Storm map** — every file as its own weather cell, sized by hotspot score.
  Trouble is usually concentrated in a handful of files, and a uniform grid would
  hide exactly that.
- **Forecast strip** — the last seven days plus a short projection. Projected days
  are drawn dashed and hollow with a confidence figure, because a guess should not
  look like a measurement.

The dashboard updates itself: the server watches each repo's git directory and
streams a new forecast over SSE whenever HEAD moves. Commit in a watched repo and
the forecast changes without a reload.

All animation is CSS on hand-authored SVG, and every scene holds a still frame
under `prefers-reduced-motion`.

## Layout

```
shared/    Contract types and condition metadata shared by both sides
server/    Express API — git adapter, metrics, weather model, registry, SSE
web/       Vite + React dashboard
scripts/   Demo repo generator and a terminal report tool
```

The server is the only place that decides weather. The client renders what it is
given and never re-derives a score, so the model has one source of truth.

## Commands

| Command                                    | What it does                                |
| ------------------------------------------ | ------------------------------------------- |
| `npm run dev`                              | API and web app together, with hot reload   |
| `npm run build`                            | Production build                            |
| `npm start`                                | Serve the built app and API on one port     |
| `npm test`                                 | Full suite (seeds demo fixtures if missing) |
| `npm run typecheck`                        | Typecheck all three workspaces              |
| `npm run lint`                             | oxlint                                      |
| `npm run seed:demo`                        | Generate the demo repos                     |
| `npm run seed:demo -- --append demo-sunny` | Add a commit to watch live updates          |
| `npm run report -- <path>`                 | Print a repo's forecast in the terminal     |
| `npm run report -- --demos`                | Check all demo repos against expectations   |

For a persistent local install, `npm run build && npm start` serves the dashboard
and the API together from http://localhost:3001 — no Vite process needed.

`npm run report` prints the full score breakdown, which is how the weather model
was calibrated and how model drift gets caught:

```
$ npm run report -- --demos
PASS demo-sunny     sunny    trouble=0.067 expected=sunny
PASS demo-stormy    storm    trouble=0.913 expected=storm
PASS demo-rainy     rain     trouble=0.491 expected=rain
PASS demo-dormant   snow     trouble=0.000 expected=snow
PASS demo-foggy     fog      trouble=0.081 expected=fog
```

## Notes

- **The demo repos are the model's calibration fixtures.** Each is generated to
  produce one specific condition and the tests assert that it does, so if one
  drifts, the model changed meaning rather than just its numbers. Their schedules
  are relative to today, so exact scores shift a little between seedings.
- **Repos are an allow-list.** Paths are resolved through symlinks and validated by
  git when added, re-validated on every request, and referenced by an opaque id
  thereafter. Registered paths live in `~/.wcg/repos.json` (override with
  `WCG_CONFIG_DIR`).
- **git is always invoked with an argument array**, never a shell string, so a
  repository path can never be interpreted as shell syntax.
- **Large repos** are handled with a bounded window, a commit ceiling, and streamed
  log parsing, so a monorepo will not exhaust memory.
- Forecasts are cached per repo, window, and HEAD sha, so a new commit invalidates
  the cache on its own.
