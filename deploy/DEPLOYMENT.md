# Deploy AI Champions Hub to another tenant / environment

This guide takes the app from zero to running in a **brand-new Power Platform environment**
(a different tenant is fully supported).

The solution package now ships the **complete solution in a single `.zip`** — the 13 `abs_`
tables (columns, option sets, relationships), **two security roles**, **and the React Code App
itself** (bundled as a Canvas/Code App component, preview ALM feature). So a single
**solution import** provisions the data model, the roles, *and* the app.

You then only need to wire up **connections** (Dataverse + Office 365 Users) in the target and
publish. Deploying the app from source with `pac code push` is still available as an alternative /
for pushing code updates (see Part 2, Option B).

> **What's in the package.** Only the AI Champions Hub solution — data model + roles + the
> current build of the "AI Champions Hub (Code)" app. No other/previous app is referenced.

---

## Prerequisites

| Requirement | Notes |
|-------------|-------|
| Target environment | A Power Platform environment **with Dataverse** (Production or Sandbox). |
| Rights | System Administrator (to import the solution) + Maker (to push the Code App). |
| Power Platform CLI | `pac` **2.9+** — <https://aka.ms/PowerPlatformCLI> |
| Node.js / npm | Node **24+**, npm **11+** |
| Connection | An **Office 365 Users** connection in the target env (for the people picker). |

Authenticate the CLI against the **target** environment before you start:

```powershell
pac auth create --environment <TARGET_ENVIRONMENT_ID>
pac org who          # confirm you're pointed at the target org
```

---

## Part 1 — Import the solution (tables + roles + app)

Pick **one** package:

| File | Use when |
|------|----------|
| `solutions/AIChampionsHubApp_managed.zip` | Production / final environments (locked, upgradeable). |
| `solutions/AIChampionsHubApp_unmanaged.zip` | Dev environments where you want to customize the schema. |

### Option A — CLI

```powershell
pac solution import --path .\deploy\solutions\AIChampionsHubApp_managed.zip --activate-plugins --publish-changes
```

### Option B — Maker portal

1. <https://make.powerapps.com> → select the target environment.
2. **Solutions → Import solution → Browse** → choose the `.zip` → **Next → Import**.
3. Wait for "Solution imported successfully", then **Publish all customizations**.

This creates the tables below (publisher **ABSGSA**, prefix `abs`):

`abs_champion`, `abs_department`, `abs_campaign`, `abs_campaigndepartment`,
`abs_campaignactivity`, `abs_campaignparticipation`, `abs_activity`, `abs_activityclaim`,
`abs_claimevidence`, `abs_event`, `abs_request`, `abs_programsettings`, `abs_appadmin`.

### Grant table access (security roles ship in the package)

The solution **ships two custom security roles**, so importing it in a new tenant **auto-creates
them** — you do **not** create roles by hand. Both grant privileges at **Organization** depth on
all 13 `abs_` tables:

| Role | Privileges on all 13 tables | Assign to |
| --- | --- | --- |
| **AI Champions Hub Users** | Create · Read · Write · Append · Append To | Champions |
| **AI Champions Hub Admins** | Create · Read · Write · Append · Append To · **Delete** | Program managers / app admins |

After import (and **Publish all customizations**), assign the roles in
**Power Platform admin center → Environment → Settings → Users + permissions → Users** (or the
classic *Manage Roles* dialog): give **AI Champions Hub Users** to champions and **AI Champions Hub
Admins** to program managers and app admins.

> A user who signs in without one of these roles will see an empty/error state — this is a
> permissions issue, not an app bug.

---

## Part 2 — Connect and run the app

The import (Part 1) already created the **"AI Champions Hub (Code)"** app in the target
environment. Code Apps store their connector binding client-side, so after import you wire the two
connections the app uses:

1. In <https://make.powerapps.com> (target env) → **Connections → + New connection**, create:
   - a **Microsoft Dataverse** connection, and
   - an **Office 365 Users** connection (the people picker).
2. Open **Apps → AI Champions Hub (Code) → Play**. On first launch you'll be prompted to authorize
   the connections; approve them.

> **Note (preview).** Code App ALM is in preview. If the imported app can't resolve its connections
> automatically, use **Option B** below to (re)push it from source against the target env — this
> re-binds the connectors and is also how you ship future code updates.

### Option B — Deploy / update the Code App from source

From a clone of this repository, pointed at the **target** environment:

```powershell
npm install

# 1. Create/refresh the Code App in the target environment.
#    This rewrites power.config.json with the target appId + environmentId.
pac code init --displayName "AI Champions Hub (Code)"

# 2. Re-bind the Office 365 Users connector to a connection in the target env.
#    Get <CONNECTION_ID> from make.powerapps.com → Connections (create one if needed).
pac code add-data-source -a office365users -c <CONNECTION_ID>

# 3. Build and push.
npm run build
pac code push
```

`pac code push` prints a **play URL** — open it to launch the app.

### Notes on data sources

- The 13 Dataverse data sources are already declared in `power.config.json` and the generated
  models under `src/generated/`. Because the target uses the **same `abs_` schema** you just
  imported, these bind as-is — no regeneration needed.
- If you ever need to regenerate a model (e.g. after a schema tweak), run
  `pac code add-data-source -a dataverse -t <logical_name>` for that table.
- The only tenant-specific values are `appId`, `environmentId` (set by `pac code init`) and the
  **Office 365 Users connection id** (set in step 2).

---

## Part 3 — First-run configuration

Sign in as an admin and open **Settings**:

1. **Program Configuration** — set the **AI Champions Community** name + URL, the **SharePoint
   document library URL** used for evidence uploads, and the self-nomination / approval toggles.
2. **Application Admins** — promote at least one champion to admin (the first admin is created
   automatically for the importing user in most cases; verify here).
3. **Departments** — add your organization's departments.
4. **App Theme & Branding** *(optional)* — pick a brand color and upload an app logo.

Then add champions (**Champions → Add Champion**) and create your first campaign
(**Campaigns → New Campaign**).

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Import fails on missing dependency | Use the **managed** zip on a clean env; ensure the env has Dataverse. |
| App loads but lists are empty | Assign the signed-in user one of the shipped roles — **AI Champions Hub Users** (champions) or **AI Champions Hub Admins** (admins) — see Part 1. |
| People picker returns nothing | The Office 365 Users connection is missing/expired — recreate it and re-run step 2. |
| Evidence links won't save | Set a valid **SharePoint document library URL** in Settings; the shipped roles already grant Create/Read on `abs_claimevidence`. |
| `pac code push` says app not found | Run `pac code init` first (Part 2, Option B) to create the app in the target env. |
| Imported app won't launch / shows connector errors | Code App ALM is in preview — re-push from source (Part 2, Option B) to re-bind connectors in the target env. |

---

## Maintainer note — how the app is bundled in the solution

The Code App is added to the `AIChampionsHubApp` solution using the npm CLI's solution targeting
(preview), so it exports/imports with the rest of the solution:

```powershell
# From the repo root, authenticated to the SOURCE env:
npm run build
npx power-apps push --solution-id <AIChampionsHubApp solution GUID>

# Then re-export both packages:
pac solution export --name AIChampionsHubApp --path .\deploy\solutions\AIChampionsHubApp_managed.zip   --managed true  --overwrite
pac solution export --name AIChampionsHubApp --path .\deploy\solutions\AIChampionsHubApp_unmanaged.zip --managed false --overwrite
```

Re-run this whenever the app changes so the shipped `.zip` files carry the latest build.
