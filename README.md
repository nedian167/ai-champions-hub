# AI Champions Hub (Code)

A Power Apps **Code App** (Vite + React + TypeScript) that recreates the "AI Champions Hub"
program-management app on top of the existing Dataverse data model. It runs locally with
`pac code run` and deploys to Power Platform with `pac code push`.

The app helps a Copilot/AI enablement program run: onboarding champions, running learning
campaigns, tracking activities and point-based claims, scheduling events, ranking a leaderboard,
triaging license/connector requests, and configuring the program.

---

## Screenshots

| | |
|---|---|
| **Home** — KPI cards (colored accent borders), pending work, completion donut, top champions | ![Home](docs/screenshots/01-home.png) |
| **Champions** — filters + admin edit / disable / remove actions per card | ![Champions](docs/screenshots/02-champions.png) |
| **Campaigns** — banner-image cards grouped by status | ![Campaigns](docs/screenshots/03-campaigns.png) |
| **Campaign detail** — banner header, overview, audience & activity tabs | ![Campaign detail](docs/screenshots/10-campaign-detail.png) |
| **Activities** — activity catalog + claims with evidence & approve/reject | ![Activities](docs/screenshots/04-activities.png) |
| **Events** — month calendar + upcoming list | ![Events](docs/screenshots/05-events.png) |
| **Leaderboard** — champions / departments / campaigns ranking | ![Leaderboard](docs/screenshots/06-leaderboard.png) |
| **Requests** — KPIs, filters, submit + triage | ![Requests](docs/screenshots/07-requests.png) |
| **Customize** — per-user Light/Dark, font family & size with live preview | ![Customize](docs/screenshots/08-customize.png) |
| **Settings** — program config, app admins & departments CRUD | ![Settings](docs/screenshots/09-settings.png) |

---

## Tech stack

- **Vite 7** + **React 19** + **TypeScript** (strict)
- **React Router** for the 10 client routes
- **Power Apps Code SDK** (`@pa-client/power-code-sdk`) — auth + Dataverse data access
- **Dataverse** — 13 existing tables (solution `AIChampionsHub`), never modified by this app

## Data model (existing tables — read/write, not created here)

| Area | Table (logical) | Notes |
|------|------------------|-------|
| People | `abs_champion` | display name, user id, role, status, department lookup, total points, theme prefs |
| Org | `abs_department` | name, description |
| Programs | `abs_campaign` | name, theme, dates, status, owner, audience via join |
| Join | `abs_campaigndepartment` | campaign ↔ department audience |
| Join | `abs_campaignactivity` | campaign ↔ activity |
| Join | `abs_campaignparticipation` | campaign ↔ champion participation |
| Learning | `abs_activity` | title, type, points, validation mode, LMS link |
| Claims | `abs_activityclaim` | champion's claim of an activity, status, points |
| Evidence | `abs_claimevidence` | uploaded evidence URL/file for a claim |
| Events | `abs_event` | event date, format, location/link, campaign lookup |
| Requests | `abs_request` | license/connector/other requests, status, response |
| Config | `abs_programsettings` | single settings row (URLs, toggles) |
| Admin | `abs_appadmin` | app admin allow-list |

> Choice (option-set) columns are integers with base `839560000`. All values and their labels are
> centralized in [`src/lib/enums.ts`](./src/lib/enums.ts).

## Routes / screens

| Route | Screen | Highlights |
|-------|--------|------------|
| `/` | Home | KPI cards with colored accent borders + month-over-month deltas, pending claims, open requests, completion donut, top champions, recent activity |
| `/champions` | Champions | KPIs, status/department/search filters, add-champion, and per-card admin actions: **edit**, **disable/enable** (disable revokes app access), **remove** |
| `/campaigns` | Campaigns | banner-image cards in active/draft/completed tabs, audience + participant counts, new campaign (admin) |
| `/campaigns/:id` | Campaign detail | banner header, overview, audience, activities/participants/events tabs, edit (admin) |
| `/activities` | Activities | activity catalog + claims tabs, new activity (admin), claim w/ evidence upload, approve/reject |
| `/events` | Events | month calendar + upcoming list, new event (admin) |
| `/leaderboard` | Leaderboard | champions / departments / campaigns ranking, department filter |
| `/requests` | Requests | KPIs, filters, submit request, triage (admin) |
| `/customize` | Customize | per-user Light/Dark, font family, font size — live preview + save |
| `/settings` | Settings | program config, app admins CRUD, departments CRUD (admin) |

## Architecture

```
src/
  App.tsx                # Router + provider tree (data → theme → toast) with loading/error gates
  main.tsx               # Entry, imports index.css
  index.css              # Theme tokens (light/dark) + all component styles
  lib/
    enums.ts             # Option-set integer values + label maps + font stacks + optionsOf()
    format.ts            # Date/number helpers
  data/
    entities.ts          # Single import point: aliased services, model types, EntitySet + bind()
  generated/             # AUTOGENERATED by `pac code add-data-source` — do not edit
    models/*Model.ts
    services/*Service.ts
  context/
    AppDataContext.tsx   # Loads all tables once; exposes arrays, lookup maps, current user,
                         # role flags (isAdmin/isProgramManager/isAppAdmin), points roll-up, reload()
  theme/
    ThemeProvider.tsx    # Applies champion theme prefs to :root; applyTheme()/resetToSaved()
  components/            # Layout (sidebar/topbar), Modal, Toast, ui.tsx (Avatar/Pill/KpiCard/…)
  screens/               # One file per route
```

**Role gating.** `AppDataContext` resolves the signed-in user to an `abs_champion` and/or
`abs_appadmin` record. `isAdmin = isProgramManager || isAppAdmin`. Admin-only actions (add champion,
create/edit campaign, create activity, approve/reject claims, create event, triage requests, all of
Settings) are hidden for regular champions.

**Champion management & access control.** Admins can edit a champion, **disable** them
(sets status to Inactive), or remove them. A disabled champion is blocked at app startup by an
access gate — admins are never locked out. Re-enabling restores access.

**Points & leaderboard.** Points come from **Approved** claims joined to `activity.crd49_points`
(`pointsByChampion` / `pointsFor` in the context), falling back to the stored
`champion.crd49_totalpoints`. On approval the app also increments the stored total for fidelity with
the original app. The leaderboard ranks champions, departments (summed), and campaigns.

**Theme.** Each champion stores `crd49_appmode` (Light/Dark), `crd49_fontfamily`, `crd49_fontsize`.
`ThemeProvider` writes these to `document.documentElement` as `data-theme` + CSS variables. The
Customize screen previews changes live and reverts on unmount unless saved.

---

## Prerequisites

- Node.js 24+ and npm 11+
- Power Platform CLI (`pac`) 2.9+
- Access to the target environment with the AI Champions Hub tables

Verify auth (an auth profile pointing at the target environment must be selected):

```powershell
pac auth list
pac org who
```

## Local development

```powershell
npm install
pac code run
```

`pac code run` starts the Vite dev server (port 3000) and the Code Apps host so the Power Apps SDK
can authenticate and reach Dataverse. Open the URL it prints.

## Build

```powershell
npm run build   # tsc -b && vite build  → dist/
```

## Deploy

```powershell
npm run build
pac code push
```

`power.config.json` holds the target `appId` / `environmentId` and the 13 Dataverse data-source
references. `pac code push` uploads `dist/` to that existing Code App — it does **not** create a new
app on each push.

## Working with data

Always go through the generated services (never raw fetch/axios), and read `result.data`:

```typescript
import { ChampionsSvc } from "./data/entities";

const res = await ChampionsSvc.getAll({
  select: ["crd49_displayname", "crd49_totalpoints"],
  filter: "statecode eq 0",
  orderBy: ["crd49_totalpoints desc"],
  top: 50,
});
const champions = res.data ?? [];
```

- Lookups are set with an `@odata.bind` payload key (see `bind()` in `data/entities.ts`) and read
  from the `_<lookup>_value` field.
- Choice fields take integer values from `src/lib/enums.ts`.
- The `generated/` folder is regenerated by `pac code add-data-source`; don't hand-edit it.

## Notes

- This app **connects to existing tables** and never creates or alters schema.
- A harmless libuv `Assertion failed` line can print at the end of some `pac` commands on Windows;
  it does not affect the operation.
