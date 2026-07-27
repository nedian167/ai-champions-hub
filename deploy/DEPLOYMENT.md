# Deploy AI Champions Hub to another tenant / environment

This guide takes the app from zero to running in a **brand-new Power Platform environment**
(a different tenant is fully supported). It has two parts:

1. **Import the Dataverse schema** — the 13 `abs_` tables, their columns, option sets and
   relationships — from the solution package in [`solutions/`](./solutions).
2. **Deploy the Code App** from this repository's source with `pac code push`.

> **What's in the package (and what isn't).** The solution contains **only the AI Champions
> Hub data model** — no other/previous app is referenced. The React Code App itself is **not**
> shipped inside the solution; it is deployed from this repo's source in Part 2. This keeps the
> package clean and the app versioned in git.

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

## Part 1 — Import the Dataverse schema

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

### Grant table access (security role)

The package ships the **schema only**, not a security role. App users need Dataverse privileges
on the 13 tables. Either:

- **Simplest:** assign users a role that already grants org-wide read/write (e.g. a custom role,
  or `Basic User` extended with these tables), **or**
- **Recommended:** create a custom security role (e.g. *AI Champions Hub Users*) granting
  **Create / Read / Write / Append / Append To** on all 13 tables (add **Delete** for admins),
  then assign it to your champions and program managers.

> A user who signs in without table read access will see an empty/error state — this is a
> permissions issue, not an app bug.

---

## Part 2 — Deploy the Code App from source

From a clone of this repository, pointed at the **target** environment:

```powershell
npm install

# 1. Create a NEW Code App in the target environment.
#    This rewrites power.config.json with the new appId + environmentId.
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
| App loads but lists are empty | Assign the user a security role with read access to the `abs_` tables (Part 1). |
| People picker returns nothing | The Office 365 Users connection is missing/expired — recreate it and re-run step 2. |
| Evidence links won't save | Set a valid **SharePoint document library URL** in Settings, and ensure the champion role has Create/Read on `abs_claimevidence`. |
| `pac code push` says app not found | Run `pac code init` first (Part 2, step 1) to create the app in the target env. |
