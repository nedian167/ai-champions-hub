# Deploy AI Champions Hub to another tenant / environment

This guide takes the app from zero to running in a **brand-new Power Platform environment**
(a different tenant is fully supported).

The solution package now ships the **complete solution in a single `.zip`** — the 17 `abs_`
tables (columns, option sets, relationships), **two security roles**, the notification
plug-in/API and two native flows, **and the React Code App itself**
(bundled as a Canvas/Code App component, preview ALM feature). So a single
**solution import** provisions the data model, the roles, *and* the app.

You then need to wire up app **connections** (Dataverse + Office 365 Users + personal
Office 365 Outlook), bind the separate Dataverse/Teams/Outlook automation connection
references, assign roles, and verify/enable notification flows in the target.
Deploying the app from source with `pac code push` is still available as an alternative /
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
| Notification automation | Approved, licensed sender with target-environment Dataverse, Microsoft Teams and Office 365 Outlook connections; Teams Workflows app and DLP/consent policies must allow delivery. |

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
`abs_claimevidence`, `abs_event`, `abs_request`, `abs_requestcategory`,
`abs_programsettings`, `abs_appadmin`, `abs_notificationpreference`,
`abs_notificationevent`, `abs_notificationdelivery`.

### Grant table access (security roles ship in the package)

The solution **ships two custom security roles**, so importing it in a new tenant **auto-creates
them** — you do **not** create roles by hand. Existing business-table privileges
remain at **Organization** depth on the 14 business tables:

| Role | Business-table privileges | Assign to |
| --- | --- | --- |
| **AI Champions Hub Users** | Create · Read · Write · Append · Append To | Champions |
| **AI Champions Hub Admins** | Create · Read · Write · Append · Append To · **Delete** | Program managers / app admins |

Notification access is deliberately narrower: both roles grant preference
Create/Read/Write and delivery Read at **Basic/user depth only**. They do not grant
outbox writes or the trusted worker API privilege. Do not copy the business-table
Organization-depth grants to notification tables.

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
  imported, these bind as-is. The v1.0.6 packages include the additional event end
  column described below.
- If you ever need to regenerate a model (e.g. after a schema tweak), run
  `pac code add-data-source -a dataverse -t <logical_name>` for that table.
- The only tenant-specific values are `appId`, `environmentId` (set by `pac code init`) and the
  **Office 365 Users and Office 365 Outlook connection IDs** (set in step 2).

### Event schedule schema

The v1.0.6 solution packages include this column in
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
archives are version 1.0.7.0 and include this column, the notification backend/flows,
and the updated Code App.

### Outlook connection and rollout

The Outlook module is included in the v1.0.7 app and v1.0.7.0 solution packages.
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
be replaced by the regression suite. The v1.0.6 native connector was verified in
Contoso Dev using the connected administrator's mailbox: one authorized temporary
appointment was created, read back with exact start/end and no attendees, found
on a duplicate add, and deleted. Repeat the check for other users and environments.

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
| Outlook reports **Empty Payload. JSON content expected.** | Deploy v1.0.6 or later. Its typed SDK request passes the appointment object directly, avoiding double-encoded JSON from the generated binary-string argument. Do not edit the generated connector schema or service. |
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
pac solution online-version --solution-name AIChampionsHubApp --solution-version 1.0.7.0
pac code push --solutionName AIChampionsHubApp

# Then re-export both packages:
pac solution export --name AIChampionsHubApp --path .\deploy\solutions\AIChampionsHubApp_managed.zip   --managed true  --overwrite
pac solution export --name AIChampionsHubApp --path .\deploy\solutions\AIChampionsHubApp_unmanaged.zip --managed false --overwrite
```

Re-run this whenever the app changes so the shipped `.zip` files carry the latest build.

---

## Notification module source deployment

**Release v1.0.7:** both solution ZIPs include Notifications and its backend,
connection references, and two native flows. On import, bind the target environment's
approved automation connections and verify the app URL/roles before enabling flows.
The source installer below is for building/upgrading the backend from source; it
is not an extra requirement after importing a complete package. A local build or
successful import does not verify Teams policies, mail delivery, connection
authorization, or end-user Dataverse permissions.

### Backend and connection ownership

The additive schema is in `notifications\schema.json`. It creates user-owned
`abs_notificationpreference` and `abs_notificationdelivery`, an organization-owned
`abs_notificationevent` outbox, request reply-command/lock columns, and campaign
audience-readiness. Existing business data is retained. The installer marks existing
campaigns ready before initially registering launch capture, avoiding historical
launch notifications.

The signed .NET Framework 4.6.2 plug-in captures business changes synchronously;
outbox creation participates in the original business transaction. Request replies
are authenticated append commands with a stable message GUID, not browser rewrites
of the entire thread. Concurrent replies acquire a request lock; retries with the
same ID/text do not create a second message.

Use an explicitly approved automation owner with Dataverse, Microsoft Teams and
Office 365 Outlook connections **in the target environment**. The chosen development
setup uses the existing administrator connections. Production needs a licensed,
maintained automation identity, an approved sender mailbox, and tenant-specific
least-privilege review. Do not silently substitute another account or connection.
Teams must allow the Workflows app and private Flow bot cards; the supplied poster
targets commercial tenants, not GCC/GCCH/DoD. DLP and connector consent still apply.

Both Hub roles receive only **Basic/user-depth** preference Create/Read/Write and
delivery Read. Do not copy their original business-table Organization-depth grants
to these private tables. Outbox/delivery writes remain trusted-server operations.
The global `abs_NotificationWork` API requires `prvPublishCustomization`; never grant
that privilege to ordinary Hub users. This is a trusted development worker boundary,
not a ready-made least-privilege production automation role.

### Install from the repository root

1. Import the base Hub solution and verify its two security roles first.
2. Keep a strong-name signing key outside Git, generated with `sn.exe -k` (Visual
   Studio Developer Command Prompt) or your approved signing tooling. Securely back
   up that same key for upgrades; do not generate a different key for an existing
   assembly. The project requires the private key path at build time:

   ```powershell
   dotnet build .\deploy\notifications\Hub.Notifications\Hub.Notifications.csproj --configuration Release -p:NotificationSigningKey="<PRIVATE_KEY_PATH>"
   dotnet run --project .\deploy\notifications\Hub.Notifications.Tests\Hub.Notifications.Tests.csproj
   npm run test:notifications
   ```

3. Copy `notifications\configuration.example.json` to a private deployment directory
   and replace every placeholder. `assemblyPath` resolves from the working directory.
   Use the canonical HTTPS Power Apps player URL, not a local preview. Keep
   `enableFlows` **false** during installation and verification.
4. Run `Connect-Dataverse.ps1` with the intended organization, tenant, organization
   ID, and administrator's Entra object ID. It verifies the organization and account
   before invoking a deployment action, keeps authorization in memory, and does not
   write credentials. Each invocation requires device sign-in:

   ```powershell
   $target = @{
     OrganizationUrl = 'https://<ORGANIZATION>.crm.dynamics.com/'
     TenantId = '<TENANT_ID>'
     ExpectedOrganizationId = '<DATAVERSE_ORGANIZATION_ID>'
     ExpectedUserObjectId = '<APPROVED_ADMIN_ENTRA_OBJECT_ID>'
   }
   .\deploy\notifications\Connect-Dataverse.ps1 @target `
     -ActionScript .\deploy\notifications\Install-Schema.ps1
   .\deploy\notifications\Connect-Dataverse.ps1 @target `
     -ActionScript .\deploy\notifications\Install-Backend.ps1 `
     -ActionArguments @{ ConfigurationPath = '<PRIVATE_CONFIGURATION_PATH>' }
   .\deploy\notifications\Connect-Dataverse.ps1 @target `
     -ActionScript .\deploy\notifications\Test-Backend.ps1
   ```

   Respect organizational PowerShell execution policy. If a process-only override is
   approved, use it only for that invocation; do not change machine policy.

5. In **Solutions > AIChampionsHubApp**, inspect the three tables, request/campaign
   columns, assembly and nine steps, custom API, both security roles, app URL
   environment variable, three connection references, and two flows. Confirm
   connection authorization and solution membership before exporting. Normal users
   must be unable to read another user's preferences/history or invoke the worker.
6. Regenerate native frontend bindings against the same target, then build:

   ```powershell
   pac code add-data-source --apiId dataverse --table abs_notificationpreference
   pac code add-data-source --apiId dataverse --table abs_notificationdelivery
   pac code add-data-source --apiId dataverse --table abs_request
   pac code add-data-source --apiId dataverse --table abs_campaign
   npm run build
   ```

   Keep generated services/schemas unedited. The background Teams/email connections
   belong to the flows; users' personal Outlook calendar connection is independent.

7. Verify an explicitly authorized, isolated Teams/email test before rollout.
   Never opt in users or send bulk/test messages without their permission. After
   `Test-Backend.ps1` succeeds, the following sends **one private Teams card and one
   email** to the signed-in, explicitly approved administrator:

   ```powershell
   .\deploy\notifications\Connect-Dataverse.ps1 @target `
     -ActionScript .\deploy\notifications\Test-Delivery.ps1 `
     -ActionArguments @{
       ApprovedMailbox = '<APPROVED_ADMIN_MAILBOX>'
       AllowTestNotifications = $true
     }
   ```

   This requires both main flows disabled, all preferences off, and an existing
   unique administrator Champion profile. It uses real request capture and worker
   preparation, then temporarily activates a copy of the saved dispatcher restricted
   to the temporary request, administrator, and two exact delivery IDs. It restores
   the original request/pause preferences without overwriting concurrent edits.
   Successful tests remove the temporary flow and records; unconfirmed sends retain
   the disabled flow and evidence for investigation, with no automatic resend.
   Diagnostic flows are created outside the versioned app solution and must not be
   included in release exports.
   `Channels = 'Teams'` or `Channels = 'Email'` in `ActionArguments` limits a newly
   authorized test to that channel; do not repeat a successful channel to diagnose
   another. A new test does not reset or retry an earlier uncertain delivery.
   Connector acceptance is not recipient read confirmation. Enable
   **AI Champions Hub - Deliver notifications** and **AI Champions Hub - Daily
   reminders** only after successful native flow validation. The installer can
   activate them when `enableFlows` is explicitly true. Publishing the frontend,
   versioning/re-exporting solution ZIPs, and updating GitHub are separate release
   operations; this installer does not perform them.

   After publishing the frontend, an already-installed backend can be activated
   without re-registering its assembly or capture steps:

   ```powershell
   .\deploy\notifications\Connect-Dataverse.ps1 @target `
     -ActionScript .\deploy\notifications\Publish-Notifications.ps1 `
     -ActionArguments @{
       ConfigurationPath = '<PRIVATE_CONFIGURATION_PATH>'
       ExpectedSolutionVersion = '1.0.7.0'
     }
   ```

   This checks the configured connection bindings and online solution version,
   excludes any retained disabled diagnostic flows from the versioned solution
   without deleting their evidence, and verifies both production flows are active.
   Run it before exporting the release packages. It never changes user preferences.

### Operation and recovery

Users start off and choose channels separately for requests, claims, campaigns and
reminders. Preferences are stamped from the authenticated Dataverse identity, not a
browser-supplied recipient. A Champion profile is not needed to manage preferences.
Only persistent program managers/app admins receive reviewer alerts; temporary
first-run UI administration is not a notification reviewer role.

The dispatcher runs every minute with serialized runs and deliveries. It prepares
up to five event-recipient pages per invocation and up to 100 pending deliveries.
Recipient pages contain 25 preferences. Row-version comparisons protect queue
claims. A delivery is authorized only after rechecking current consent, account,
source and audience. Campaign creation saves Draft first and publishes its chosen
status only after checked audience links are complete; retry partial setup rather
than creating another campaign.

Daily reminders run at **07:00 UTC**: Open/InReview requests and pending claims
untouched for at least 48 hours go to reviewers; live joined campaigns ending within
seven UTC days go to participants; events starting in the next 24 hours go to their
relevant participants/reviewers (or active Champions for unlinked events). Daily
source/event IDs prevent duplicate reminder events for the same UTC date.

Monitor Power Automate run history plus the event/delivery tables. Event states are
0 pending, 2 leased, 1 complete; delivery states are 0 pending, 1 sending, 2 sent,
3 failed, 4 uncertain, 5 skipped. Interrupted event leases become eligible again
after 15 minutes; stable delivery IDs prevent a second fanout. Interrupted sends
become uncertain after 15 minutes and are **not automatically resent**. Sending
actions have no automatic retry and no email/Teams fallback. Sent means connector
acceptance, not recipient read confirmation. Investigate the connector run and
destination before any manual resend; there is no exactly-once guarantee.

If flow save reports `GetUnifiedActionSchema` authorization failure for Teams,
refresh connection health with `pac connection list --environment <TARGET_ENVIRONMENT_ID>`.
A connection can move from Connected to Error during deployment. Repair it or
explicitly select another healthy connection owned by the same approved automation
account, update `teamsConnection`, and rerun the installer to rebind both the
connection reference and the flow. Do not silently use a different identity.
Dataverse device sign-in does not reauthorize a Teams connector. Confirm the
Power Automate account **and environment ID** before repairing or creating a
connection: a connection in the same tenant's Default environment is not a
connection in the target development environment.
An Outlook connection can likewise change to Error when a send exercises stale
authorization. Repair that connection separately with the approved sender account.
A successful Teams send does not prove email authorization, and repairing a
connection does not confirm the outcome of an earlier unconfirmed send.
Do not treat a saved Dataverse draft or a Connected label alone as
proof that the flow can run. Keep delivery disabled until save/activation succeeds.
Do not delete queued data or reset uncertain sends to pending as a blanket repair.
Retention of preferences/history/outbox data should follow the target tenant's
approved policy; no automatic purge is configured.

The included backend verification is a development check with outbound flows off
and recipients opted out. It creates a clearly named temporary request for the
administrator's existing, unique Champion profile, checks server-stamped idempotent
replies and outbox capture, and removes only those temporary records. It never sends
Teams cards or email. Use the same signing key when rebuilding; sandbox deployment
must remain dependency-free apart from the platform SDK/framework assemblies.
