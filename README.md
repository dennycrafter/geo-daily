# Geo Daily

A leaderboard for our GeoGuessr daily challenge. Nobody posts scores: a GitHub robot logs in as Denis, reads the friends scoreboard for the daily challenge, saves it to `data/scores.json`, and posts to Slack. The page (`index.html`) shows the full scoreboard.

Schedule: every 5 minutes from 9am to 5pm Austin time, every hour the rest of the day (GitHub can run scheduled jobs a few minutes late).

## How it works

- `scripts/fetch.mjs` asks GeoGuessr for today's daily plus the last 6 days, then pulls the friends scoreboard for each one. New results get added to `data/scores.json`, and old days are never deleted, so history keeps growing.
- `.github/workflows/fetch.yml` runs that script on the schedule above and saves any changes.
- `scripts/slack.mjs` posts to Slack: a ping when someone finishes (no score, so nobody gets spoiled) and one results post per day at 5pm Austin time. Settings live in `data/config.json` under `slack` (`scoresInPings: true` puts scores in the pings). Needs the `SLACK_WEBHOOK_URL` secret.
- The page asks "Who are you?" and hides today's scores until that person has finished today's challenge.
- `index.html` is the dashboard. If there are no real scores yet it shows made-up demo data (`data/demo.json`). Add `?demo` to the link to force demo mode.
- `data/names.json` (optional) swaps GeoGuessr names for real names, for example `{ "driplessbeing": "Jack" }`.

## Rules from GeoGuessr

- Only people who are **GeoGuessr friends with Denis's account** show up.
- The friends scoreboard for a day only opens **after Denis has played that day's challenge**.
- Only finished games (all 5 rounds) count.
- GeoGuessr only lists the last ~6 days, so anything older than that before setup is gone.

## Setup (one time)

1. Make a GitHub repo and upload this folder.
2. Get the `_ncfa` cookie from geoguessr.com while logged in (browser dev tools, Application, Cookies).
3. In the repo: Settings, Secrets and variables, Actions, New repository secret. Name `GEO_NCFA`, value the cookie.
4. Actions tab, "Pull GeoGuessr scores", Run workflow, to test it.
5. Host the page: import the repo on Vercel (no settings needed), or turn on GitHub Pages.

The cookie lasts about a year. If the robot starts failing with "Cookie rejected", repeat steps 2 and 3.

## Run locally

```
GEO_NCFA=xxxx node scripts/fetch.mjs     # pull scores
node scripts/make-demo.mjs               # rebuild demo data
node test/mock-server.mjs                # fake GeoGuessr for testing (then GEO_BASE_URL=http://localhost:4789 GEO_NCFA=good)
```
