# TickLocal v4.0

Tasks, calendar, habits, Pomodoro and an Eisenhower matrix in one web app that runs entirely on your device. No account, no server, no AI.

## Run locally (Windows, PowerShell)

```powershell
npm install
npm run dev        # opens http://localhost:5173
npm test           # 23 unit tests for the core, always run in GMT+7
npm run build      # creates the dist/ folder for deployment
npm run preview    # preview the build (the service worker is only enabled in builds)
```

## Deploy and install on iPhone

**GitHub Pages (free, the repo must be public):** push to the `main` branch, then go to Settings → Pages → Source and choose **GitHub Actions**. The `.github/workflows/deploy.yml` workflow runs the tests, builds and publishes the app to `https://<github-user>.github.io/<repo-name>/`. The sub-path is passed through the `BASE_PATH` variable, so `vite.config.js` needs no changes.

**Netlify:** create a site from the repo; `netlify.toml` already declares the build command and the `dist` folder.

Each address has its own data store. If you move the app to a new address, export JSON at the old address and import it at the new one.

1. On iPhone, open the app address in Safari → Share → **Add to Home Screen**.
2. From then on, only open it from the icon. The icon and the Safari tab keep separate data stores.
3. Go to the Data tab → **Import JSON** → choose a starter file (for example `TickLocal_KhoiDau_v4.json`) to get ready-made lists, tags, filters and habits.

For every new release, bump the `CACHE` number in `public/sw.js` so users' devices pick up the new version.

## Quick-add syntax

Type a task in plain English; the parser pulls out the details and leaves the rest as the title.

| You type | Result |
| --- | --- |
| `Team meeting tomorrow 9:30am !high #urgent` | Due tomorrow 09:30, high priority, tag `urgent` |
| `today`, `tonight`, `tomorrow`, `day after tomorrow` | Relative dates |
| `friday`, `on sunday`, `next fri` | Next occurrence of that weekday (short names need `on` / `next`) |
| `20/11`, `on 1/2`, `5/3/2027` | Dates are **day/month**; `1/2`, `1/3`, `2/3`, `1/4`, `3/4` alone are fractions |
| `14:30`, `9:30`, `3pm`, `9 pm`, `at 7` | Times; a bare `2h` or `20` is a duration and stays in the title |
| `daily`, `every day`, `weekly`, `monthly`, `weekdays`, `mon-fri`, `every 2 weeks` | Repeat rules |
| `!high`, `!med`, `!low`, `!none` (or `!3`…`!0`) | Priority |

## Structure

| File | Role |
| --- | --- |
| `src/core.js` | Pure core: dates, quick-add parser, recurrence, normalize, reducer, stats, .ics export. No DOM or storage access. |
| `src/storage.js` | IndexedDB: one row per record, each save writes only what changed. Migrates v3/v2 data from localStorage automatically. |
| `src/App.jsx` | React UI. |
| `public/` | Manifest, service worker, icons. |
| `tests/core.test.mjs` | Unit tests for the core (`node --test`, no libraries needed). |

## Changes since v3

Each item matches a bug found in the review after a simulated 3 years of use.

| Problem in v3 | v4 |
| --- | --- |
| A monthly repeat on the 31st drifted to the 28th forever | Keeps the anchor day: Jan 31 → Feb 28 → Mar 31. Temporarily moving a task ("Move to tomorrow") does not change the anchor day. |
| "Backtest 2h" became due at 02:00 today | A bare "2h" is a duration; it is a time only with minutes (9:30, 14:30), with "at", or with am/pm. |
| "1/2 pill" became the date 1/2 | 1/2, 1/3, 2/3, 1/4, 3/4 are fractions, unless written "on 1/2" or with a year. |
| Note titles lost words like "tomorrow" or "9h" | Notes do not run the parser. |
| A forgotten stopwatch → a 568-minute session | Sessions over 3 hours must be confirmed, with the real minutes entered; each session can be deleted. |
| No idea when the last backup was | The export date is recorded; a banner appears after 7 days. |
| Safari may delete data after 7 days | Manifest and service worker for installing to the Home Screen; works offline; asks for persistent storage. |
| localStorage cap of ~5 MB, 356 ms freeze on every save in year 3 | IndexedDB with per-record writes; no save task takes longer than 50 ms. |
| Data grows forever | "Archive old tasks" button: exports completed tasks and focus sessions older than 12 months to a separate file and removes them from the app; totals are kept. |
| A "daily" checklist was overdue every weekend | "Weekdays (Mon–Fri)" and "Every N days/weeks/months" repeat rules. You can type `weekdays`, `mon-fri`, `every 2 weeks`. |
| Typos created junk tags (55 tags after 3 years) | Asks before creating a new tag and suggests similar existing tags (accents ignored, ≤ 2 typos). Tags can be merged from the tag edit screen. |
| No quick rescheduling, no duplicate | Today / Move to tomorrow / +7 days buttons, Duplicate, Convert task ↔ note. |
| Weekday habits broke their streak every weekend | Pick the weekdays for each habit; streaks and rates follow that schedule. |
| Search only covered the current view | Searches everything by default, notes included; a button narrows it down. |
| No idea where focus time went | Weekly/monthly review with focus time by list. |
| No reminders | Reminder banner + beep + system notification while the app is open; export tasks to Calendar (.ics) so the iPhone reminds you even when the app is closed. |
| The Undo button disappeared on a new toast; undo also wiped later work | The button lives 8 seconds independently of toasts and reverts only that one action. |
| Typing a title lagged with large data | Title and description are typed into a draft and saved after 300 ms. |
| Clearing a number in settings jumped to 1 | Number fields clamp only on blur. |
| "Reset" wiped everything and loaded sample data | Split into "Wipe all" and "Sample data". |

## Measurements (simulated 3 years, same sample user)

Chromium emulating a 390×844 screen, 4× CPU slowdown, production build. Not a real iPhone.

| Year 3 | v3 | v4 | v4 with monthly archiving |
| --- | --- | --- | --- |
| App startup (ms) | 528 | 750 | 625 |
| UI freeze per save (ms) | 356 | under 50 | under 50 |
| Add a task (ms) | 48 | 48 | 32 |
| Typing a title, per keystroke (ms) | 64 | 40 | 48 |
| Typing a search, per keystroke (ms) | 40 | 96 | — |
| Data size (million characters) | 4.19 | 4.64 | 2.42 |
| Quota used | 80% of ~5 MB | 5 MB / 2 GB (Chromium) | 2.6 MB / 2 GB |
| Tasks given a wrong time because of "2h" | 402 | 0 | 0 |
| Number of tags (user created 7) | 62 | 7 | 7 |
| Integrity check | 0 errors | 0 errors | 0 errors |

Startup is slower than v3 because IndexedDB reads record by record instead of one JSON string. Search is slower because it now also searches note content; results are computed after typing, so the input does not lag.

## Known limitations

- Not yet tested on a real iPhone: IndexedDB quotas, system notifications and background audio with the screen locked may behave differently on iOS.
- Reminders while the app is closed only work through the Calendar app (.ics). Real push notifications need a server, which goes against the app's principles.
- In year 3, each save still scans the whole task array to find changed records (a few ms). Monthly archiving keeps this small.
- `npm run build` could not run in the original development environment (no network to install Vite); the test build was made with esbuild from the same source.
