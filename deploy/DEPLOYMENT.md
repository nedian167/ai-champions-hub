# Deploy AI Champions Hub to another tenant / environment

This guide takes the app from zero to running in a **brand-new Power Platform environment**
(a different tenant is fully supported).

The solution package now ships the **complete solution in a single `.zip`** — the 13 `abs_`
tables (columns, option sets, relationships), **two security roles**, **and the React Code App
itself** (bundled as a Canvas/Code App component, preview ALM feature). So a single
**solution import** provisions the data model, the roles, *and* the app.

You then only need to wire up **connections** (Dataverse + Office 365 Users + Office 365 Outlook) in the target and
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
| Power Platform CLI | `pac` **2.14+** — <https://aka.ms/PowerPlatformCLI> |
| Node.js / npm | Node **24+**, npm **11+** |
| Connections | **Office 365 Users** (people picker) and per-user **Office 365 Outlook** (personal calendar) connections in the target env. |

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
environment. Code Apps store their connector binding client-side, so after import you wire the
connections the app uses:

1. In <https://make.powerapps.com> (target env) → **Connections → + New connection**, create:
   - a **Microsoft Dataverse** connection, and
   - an **Office 365 Users** connection (the people picker), and
   - an **Office 365 Outlook** connection for each user adding personal appointments.
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

# 2a. Create an Office 365 Outlook connection
#     in the target environment and generate its native binding.
pac code add-data-source -a office365 -c <OUTLOOK_CONNECTION_ID>

# 2b. Ensure the event end column exists (see Event schedule schema below),
#     then regenerate event types from the target environment.
pac code add-data-source -a dataverse -t abs_event

# 3. Build and push.
npm run build
pac code push
```

`pac code push` prints a **play URL** — open it to launch the app.

### Notes on data sources

- The 13 Dataverse data sources are already declared in `power.config.json` and the generated
  models under `src/generated/`. Because the target uses the **same `abs_` schema** you just
  imported, these bind as-is. The v1.0.5 packages include the additional event end
  column described below.
- If you ever need to regenerate a model (e.g. after a schema tweak), run
  `pac code add-data-source -a dataverse -t <logical_name>` for that table.
- The only tenant-specific values are `appId`, `environmentId` (set by `pac code init`) and the
  **Office 365 Users and Office 365 Outlook connection IDs** (set in step 2).

### Event schedule schema

The v1.0.5 solution packages include this column in
**AIChampionsHubApp → Event (`abs_event`)**. If pushing source directly to an older
environment without importing the updated solution, add it first:

| Setting | Value |
|---------|-------|
| Display name | Event End |
| Schema / logical name | `abs_EventEnd` / `abs_eventend` |
| Type / format | Date and time / Date and time |
| Timezone behavior | User Local, matching existing start column `crd49_eventdate` |
| Dataverse required level | Optional (`None`) so existing records remain valid |

Save and publish the column. The app requires Date, Start time, and End time for
every new or edited event; Multi-day also requires an End date. Existing events
remain unchanged and cannot be copied to Outlook until an admin saves their end
time. No default duration or bulk backfill is applied.

Alternatively, an environment administrator can run the idempotent additive
`deploy\Add-EventEndColumn.ps1` script using an approved public-client application
for Dataverse OAuth (the default is Microsoft's development-tool client). Supply
the target organization URL, tenant ID, expected Dataverse organization ID, and
expected administrator's Entra object ID:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\deploy\Add-EventEndColumn.ps1 `
  -OrganizationUrl https://<organization>.crm.dynamics.com/ `
  -TenantId <TENANT_GUID> `
  -ExpectedOrganizationId <DATAVERSE_ORGANIZATION_GUID> `
  -ExpectedUserId <ADMIN_ENTRA_OBJECT_GUID>
```

The script uses device sign-in, verifies the organization and administrator before
writing, creates only the column from `deploy\schema\abs_eventend.json`, associates
it with AIChampionsHubApp, and publishes only the Event table. It retains no tokens
or credentials on disk, does not alter incompatible existing columns, and never
changes event records. Script execution policy is scoped to the child process;
organizations requiring signed scripts can use the maker UI instead.

Then run `pac code add-data-source -a dataverse -t abs_event` and build. Do not edit
generated TypeScript manually. The checked-in managed and unmanaged solution
archives are version 1.0.5.0 and include this column and the updated Code App.

### Outlook connection and rollout

The Outlook module is included in the v1.0.5 app and v1.0.5.0 solution packages.
Import the updated solution or build and push the source above to enable it.

Office 365 Outlook is a **non-shareable, per-user connection**. The developer's
connection registers the connector; it must not be used as a shared service
mailbox for app users. Each user must authorize their own connection when prompted
by Power Apps. Check the mailbox displayed in the calendar dialog before confirming.
An Exchange Online mailbox and tenant permission to use the connector are required.
The connector being Standard does not remove Code Apps licensing requirements.

Allow the native Office 365 Outlook connector alongside the app's Dataverse
connector under your tenant DLP policies. The integration uses the connector's
`HttpRequest` operation for supported Microsoft Graph calendar endpoints, including
legacy extended properties and `transactionId` for duplicate protection; it does not
use a custom connector, direct browser Graph authentication, or an MCP server.
Keep the generated model, service, `.power` schema, and `power.config.json` binding
together when regenerating for another environment.

Before rollout, sign in with a correctly licensed target-tenant account, open an
event, authorize Outlook, and verify that the displayed mailbox and owned calendars
are correct. With the mailbox owner's permission, create one test personal
appointment, reopen the dialog to check duplicate detection, and remove that test
appointment directly in Outlook. Repeat for an end user, program manager, and app
admin, including an admin without a Champion profile. This live tenant check cannot
be replaced by the mock-backed regression suite. Live appointment creation through
the native connector remains unverified for this release.

Do not silently enable synchronization: Hub edits/cancellations/deletion never
modify existing Outlook copies. In uncertain-outcome cases, inspect Outlook and use
the status check before explicitly retrying with the same duplicate-protection ID.

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
| Outlook connection or permission error | Sign in with the intended tenant account and authorize/reconnect that user's Office 365 Outlook connection; verify Exchange licensing, DLP, and calendar permissions. Other Hub data does not depend on these on-demand Outlook reads. |
| Outlook creation outcome is uncertain | Do not blindly retry. Use **Check Outlook status**, inspect the selected calendar, and confirm a retry only if no copy exists. The app reuses its stable transaction ID. |
| Evidence links won't save | Set a valid **SharePoint document library URL** in Settings; the shipped roles already grant Create/Read on `abs_claimevidence`. |
| `pac code push` says app not found | Run `pac code init` first (Part 2, Option B) to create the app in the target env. |
| Imported app won't launch / shows connector errors | Code App ALM is in preview — re-push from source (Part 2, Option B) to re-bind connectors in the target env. |

---

## Maintainer note — how the app is bundled in the solution

The Code App is added to the `AIChampionsHubApp` solution using the Power Platform CLI's solution-targeted push
(preview), so it exports/imports with the rest of the solution:

```powershell
# From the repo root, authenticated to the SOURCE env:
npm run build
pac solution online-version --solution-name AIChampionsHubApp --solution-version 1.0.5.0
pac code push --solutionName AIChampionsHubApp

# Then re-export both packages:
pac solution export --name AIChampionsHubApp --path .\deploy\solutions\AIChampionsHubApp_managed.zip   --managed true  --overwrite
pac solution export --name AIChampionsHubApp --path .\deploy\solutions\AIChampionsHubApp_unmanaged.zip --managed false --overwrite
```

Re-run this whenever the app changes so the shipped `.zip` files carry the latest build.
