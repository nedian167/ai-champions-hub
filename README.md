# AI Champions Hub

**A complete, end‑to‑end Power Apps solution for running an AI / Copilot enablement program.**

AI Champions Hub is delivered as a **fresh, self‑contained solution** — importing it into any
Power Platform environment provisions the entire **Dataverse data model** (17 tables, option sets
and relationships), **two ready-to-assign security roles**, **and the React Code App itself** —
all in one solution import. Nothing is assumed to
pre‑exist: you get the database, the app, and the connector wiring from scratch.

The app helps a program run day to day: onboarding champions, launching learning campaigns,
tracking point‑based activity claims with evidence, scheduling events, ranking a leaderboard,
triaging license/connector requests, reporting to leadership, and self‑branding the experience.

> **Deploying to a new tenant?** Follow **[`deploy/DEPLOYMENT.md`](./deploy/DEPLOYMENT.md)** — it
> walks through importing the schema solution and pushing the Code App, end to end.

> **v1.0.9 includes Champion duplicate prevention and customizable native notifications:** the Notifications screen, private
> preferences/history, signed Dataverse plug-in, outbox, and two Power Automate
> flows, Settings template editor, and structured Teams cards/HTML emails are
> included in both solution packages. Users start opted out.
> Configure the target environment's automation connections before enabling flows;
> see [notification deployment](./deploy/DEPLOYMENT.md#notification-module-source-deployment).

---

## What's in the box

| Layer | Delivered as | Contents |
|-------|--------------|----------|
| **Everything, one package** | `deploy/solutions/AIChampionsHubApp_managed.zip` (and `_unmanaged.zip`) | 17 Dataverse tables, option sets, relationships, **2 ready-to-assign security roles**, signed notification plug-in/custom API, two native flows, **and the bundled Code App**. Connections and flow activation require target-environment configuration. Publisher **ABSGSA**, prefix `abs` |
| **App source** | This repository (Vite + React + TypeScript) | The full Code App source; also deployable/updatable directly with `pac code push` |
| **Connectors** | `power.config.json` and solution connection references | **Office 365 Users** (people picker), **Office 365 Outlook** (personal calendar), Dataverse app sources, and separate administrator-owned Dataverse/Teams/Outlook automation connections |

The package contains **only this app's data model** — no unrelated or previous app is referenced.

---

## Screenshots

The v1.0.3 management screenshots use the React UI with a read-only
snapshot of the Contoso Dev program. Capturing them does not create, edit, or
delete tenant records.
The v1.0.4 deletion-workflow screenshots (18-21) use the same app components with
illustrative, read-only demo records, clearly labeled in the images. They do not
connect to or modify tenant data.
The v1.0.5 event details, multi-day form, and Outlook confirmation screenshots
(14, 15, and 22) show the actual React components with clearly labeled illustrative
records and a simulated mailbox. They do not create tenant events or Outlook appointments.
The v1.0.7 Notifications screenshot (23) uses the real screen with clearly labeled
illustrative settings, no tenant connection, and no outbound sends.
The v1.0.8 template editor screenshot (24) uses the real editor with clearly
labeled illustrative details; it neither saves tenant settings nor sends messages.

| | |
|---|---|
| **Home** — five KPI cards (incl. *Campaigns At Risk* & *Trending Campaign*), pending claims, open requests, completion donut, top champions | ![Home](docs/screenshots/01-home.png) |
| **Champions** — KPIs, search + status/department filters, per‑card admin **edit / disable / remove** | ![Champions](docs/screenshots/02-champions.png) |
| **Campaigns** — banner‑image cards grouped by status, health badges, and admin **edit / delete** actions | ![Campaigns](docs/screenshots/03-campaigns.png) |
| **Campaign detail** — overview, audience, activity actions, and campaign **edit / delete** controls | ![Campaign detail](docs/screenshots/10-campaign-detail.png) |
| **Activities** — catalog + claims, type/campaign filters, and admin **edit / delete** actions | ![Activities](docs/screenshots/04-activities.png) |
| **Events** — clickable calendar entries and upcoming-event lists | ![Events](docs/screenshots/05-events.png) |
| **Event details** — separate Date, Start time, End time, optional End date, Outlook action, and admin controls | ![Event details](docs/screenshots/14-event-details.png) |
| **Edit event** — Single-day / Multi-day selector, explicit dates and times, and other event fields | ![Edit event](docs/screenshots/15-event-edit.png) |
| **Personal Outlook appointment** — review the exact saved schedule, choose an owned calendar, and confirm the connected mailbox | ![Outlook calendar confirmation](docs/screenshots/22-outlook-calendar.png) |
| **Delete event** — named-record confirmation; the linked campaign is preserved | ![Delete event confirmation](docs/screenshots/16-event-delete-confirmation.png) |
| **Edit activity** — shared activity settings, with points locked once claims exist | ![Edit activity](docs/screenshots/17-activity-edit.png) |
| **Guided campaign deletion** — review linked activities individually or select all deletable activities; claims stay protected | ![Guided campaign deletion](docs/screenshots/18-campaign-delete-blocked.png) |
| **Delete an unclaimed activity** — review every affected campaign before acknowledging removal | ![Activity deletion impact](docs/screenshots/19-activity-delete-review.png) |
| **Protected activity** — inspect linked claims without removing history or earned points | ![Protected activity claims](docs/screenshots/20-activity-protected-claims.png) |
| **Delete selected activities** — separate impact review before campaign deletion can proceed | ![Selected activity deletion](docs/screenshots/21-selected-activity-delete.png) |
| **Leaderboard** — champions / departments / campaigns ranking | ![Leaderboard](docs/screenshots/06-leaderboard.png) |
| **Requests** — KPIs, filters, top-right **New Request** for every role, and threaded triage | ![Requests](docs/screenshots/07-requests.png) |
| **Notifications** — off-by-default channel preferences, pause control, and private delivery history | ![Notification preferences](docs/screenshots/23-notifications.png) |
| **Notification templates** *(admin)* — per-type wording, selected details, and illustrative Teams/email previews | ![Notification template editor](docs/screenshots/24-notification-templates.png) |
| **Reports** *(admin)* — executive KPIs, department & type breakdowns, monthly trend, campaign performance (RAG), CSV / PDF export | ![Reports](docs/screenshots/11-reports.png) |
| **Customize** — per‑user Light/Dark, font family & size with live preview | ![Customize](docs/screenshots/08-customize.png) |
| **Settings** — program config, application admins & departments | ![Settings](docs/screenshots/09-settings.png) |
| **First‑run setup** — the app owner is granted temporary admin on a fresh, unconfigured program and prompted to become the permanent admin | ![First run](docs/screenshots/13-first-run.png) |
| **App Theme & Branding** *(admin)* — brand color presets or custom hex + app logo upload, applied across the whole app | ![Branding](docs/screenshots/12-branding.png) |

---

## Solution architecture

```mermaid
flowchart TB
    user([Program Manager / Champion])

    subgraph player["Power Apps Player"]
        subgraph app["AI Champions Hub — Code App (Vite + React + TS)"]
            screens["Screens (12 routes)"]
            shared["Shared UI<br/>KPI cards · pills · avatars · charts · modals"]
            ctx["AppDataContext<br/>loads tables · role flags · points roll-up"]
            theme["ThemeProvider<br/>per-user theme + app brand color/logo"]
            svc["Generated services<br/>(typed, per table)"]
            screens --> ctx
            screens --> shared
            screens --> theme
            ctx --> svc
        end
    end

    sdk["Power Apps Code SDK<br/>(@pa-client/power-code-sdk)"]

    subgraph pp["Power Platform (target environment)"]
        dv[("Dataverse<br/>17 abs_ tables")]
        o365["Office 365 Users<br/>connector (GAL picker)"]
        outlook["Office 365 Outlook<br/>personal calendar"]
        capture["Notification plug-in<br/>transactional outbox + worker API"]
        flows["Native Power Automate flows<br/>dispatch + daily reminders"]
        channels["Private Teams cards<br/>+ notification email"]
    end

    user --> player
    svc --> sdk
    theme --> sdk
    sdk --> dv
    sdk --> o365
    sdk --> outlook
    dv --> capture
    flows --> capture
    flows --> channels
```

**How it fits together**

- **Screens** (one per route) render the UI and call into a single **`AppDataContext`** that loads
  every table once, exposes lookup maps + the signed‑in user, computes role flags
  (`isAdmin` / `isProgramManager` / `isAppAdmin`) and the points roll‑up.
- **Generated, typed services** (regenerated by `pac code add‑data‑source`) and typed notification SDK calls are the only path to
  Dataverse — no raw fetch. The **Code SDK** handles auth and transport.
- **ThemeProvider** applies each champion's personal Light/Dark + font preferences *and* the
  admin‑set application brand color + logo to CSS variables at the document root.
- The **Office 365 Users** connector powers the GAL people picker used when adding champions.
- The **Office 365 Outlook** connector supports explicit personal-calendar actions from event details, outside the global Hub data load.

---

## Champion identity

**Released in v1.0.9:** duplicate prevention includes the normalized identity
column/unique key, signed plug-in guards, regenerated Champion binding and frontend
in both solution packages. Existing environments also need the safe identity
backfill before resuming Champion writes; see
[Champion identity upgrades](./deploy/DEPLOYMENT.md#champion-identity-upgrades).

Champion identity uses the directory User ID (email/UPN), not the display name.
Add and edit check current Dataverse records, ignoring capitalization and
surrounding spaces, including pending and inactive profiles. A duplicate selection
offers **Edit existing Champion** instead of another profile. First-request profile
creation uses the same checks; ambiguous existing profiles are not chosen silently.
The backend stamps a normalized identity and an alternate key blocks simultaneous
duplicate writes. Existing duplicates are reported for explicit review, never
automatically deleted or merged.

## Notification preferences

**Released in v1.0.8:** **Settings → Notification templates**, the rich-card renderer,
and additive template fields are included in the app and both solution packages.
When upgrading from v1.0.7, deploy the frontend and backend together; see
[template upgrades](./deploy/DEPLOYMENT.md#notification-template-upgrades).

The app includes **Notifications** for every signed-in role, including people without
a Champion profile. Every category starts **Off**; users choose Teams, email, both,
or neither, and can pause delivery without losing their choices. The screen also
shows their latest 25 delivery records and explicit failure/uncertain states.

Native Dataverse plug-ins capture requests/replies/status changes, claims/decisions,
and completed campaign launches into a durable outbox. Solution-aware Power Automate
flows deliver private Teams Adaptive Cards and/or email using administrator-owned
development connections. Recipients, access and preferences are checked again before
each send. Notification links open the corresponding Hub record; approvals remain
inside the authenticated app.

Persistent Program Managers and App Admins can configure wording and selected
details for all 12 notification types in the template editor. Templates support
validated placeholders, separate email subjects, card headings, messages and
button labels, plus illustrative Teams/email previews. Teams cards use structured
TextBlocks, a FactSet, and OpenUrl actions; emails use an escaped HTML layout.
No raw HTML/card JSON or in-card approvals are accepted. Event dates are explicitly
UTC; an optional Join meeting button is included only for a valid HTTPS event URL.
Description/reply excerpts require explicit selection and are limited to 500
characters. Exact triggering reply IDs prevent a later reply being substituted.
Old queued replies without an ID omit their excerpt.

Pending requests/claims untouched for 48 hours, joined campaigns ending within seven
days, and relevant events starting in the next 24 hours are checked daily at **07:00
UTC**. Reviewer alerts go to persistent program managers/app admins; personal
decisions and replies go to the requester/claimant. Campaign launches respect the
configured department audience.

Delivery is not exactly-once: a connector timeout can leave an uncertain outcome.
Such messages are not automatically resent or redirected to another channel.
Digests, quiet hours and approvals inside cards are not included.

## Editing and deleting campaigns and activities

Program managers and application admins can use **Edit** and **Delete** on campaign
cards, campaign details, activity cards, and activities listed inside a campaign.
Campaign owners retain their existing campaign-edit access; deletion requires admin access.
Activity edits apply to all linked campaigns. Activity points cannot be changed once
claims exist, so editing does not retroactively change earned points.

Deletion requires confirmation naming the record and cannot be undone. The app reads
the current dependencies from Dataverse, including every page of linked records.
An **unclaimed activity** can be deleted individually after reviewing all linked campaigns
and explicitly acknowledging the impact. Its campaign links are removed first; the activity
is then deleted. Campaigns themselves are kept, including when an activity is shared.
Any claim (pending, approved, or rejected) protects the activity: the dialog lists those
claims with links to their details and preserves the activity, links, evidence, and points.

The **campaign deletion dialog** lists every linked activity, with individual deletion
or selection of all deletable activities. Each selection has a separate impact review and
confirmation. Activities with claims cannot be selected. Campaign deletion stays disabled
until all linked activities have been deleted, and still requires its own confirmation.
Audience departments, participants, claims, or events also protect the campaign; existing
records are not silently removed to bypass those safeguards.

Dependencies are rechecked before deleting a selection and again during each activity's
deletion. New claims, changed links, or failed reads stop the operation. These client-side
operations are not transactional: if a later write fails, earlier deletions or unlinking
may already have succeeded. The dialog reports partial progress, refreshes the remaining
records, and requires another review before retrying. Dataverse security and relationship
rules remain authoritative, including protection against concurrent writes; client checks
alone cannot make the final dependency check and deletion atomic.

## Event details and management

Select an event in the Events calendar, Upcoming Events, or a KPI event list to
open its full details, including date and time, format, location, campaign,
description, image, and meeting link. Calendar overflow opens that day's full list.
All users can view details; program managers and app admins can edit every event
field or delete the event after confirming its name. Deleting an event does not
delete its campaign.

The event form and details show **Date**, **Start time**, and **End time** separately.
Choose **Single-day event** or **Multi-day event** in the **Schedule** selector;
multi-day events also require an **End date** after the start date. An overnight
event must use Multi-day explicitly; an earlier end time never silently rolls
forward to tomorrow. Start and end are saved as UTC instants using the viewer's
local timezone, with nonexistent daylight-saving clock times rejected. Unchanged
existing instants, including repeated fall-back times, are preserved during edits.

The existing `crd49_eventdate` column remains the start timestamp; optional Dataverse
column `abs_eventend` stores the end timestamp. Both endpoints are required by the
app when creating or editing events. Existing records are not backfilled with
invented durations: they display **Not set** for End time until an admin supplies it.
Multi-day events appear on every overlapping calendar day and remain in upcoming
counts until their end (using the existing one-day grace). An event ending at
midnight does not occupy the following day. Campaign event summaries and event
reports use the same schedule helpers.

### Personal Outlook calendar

Every signed-in role, including users without a Champion profile, can select
**Add to my Outlook calendar** in event details. The dialog identifies the connected
mailbox and lists only its writable, owned calendars; shared/delegated calendars
are excluded. The saved Hub **Date**, **Start time**, **End time**, and, for multi-day
events, **End date** are shown before explicit confirmation. Outlook receives those
exact saved endpoints; there is no separate personal duration or time override.
Legacy events without an end time must be completed by a program manager or app
admin first. Times display locally, while appointments use UTC instants to preserve
the schedule across timezone and daylight-saving transitions.

The native **Office 365 Outlook** connector handles authentication. Each user
authorizes their own non-shareable connection; no MCP server, client secret, or
separate Graph OAuth application is required. The connector's supported **Send an
HTTP request** action calls only Microsoft Graph `/me/calendar` and `/me/calendars`
endpoints. Tenant DLP, consent, Exchange permissions, and Code Apps licensing
still apply. Outlook reads are on demand and do not participate in Hub startup.
Power Apps may nevertheless request connector consent when opening the app;
the host's connection/consent requirements cannot be bypassed by the dialog.

Only a personal appointment is created, with the Hub title, description, location,
and existing meeting link. No attendees, invitations, recurrence, or new Teams
meeting are added. This is a one-time copy: subsequent Hub edits, cancellations,
or deletion do not update/remove the Outlook copy, and Outlook edits do not change Hub.

An Outlook-side extended property identifies the source Hub event in the selected
calendar, independent of its title or dates and across browsers/devices. A stable
Graph `transactionId` and an in-flight guard further reduce duplicate writes.
Existing copies are shown rather than overwritten. If a response is interrupted,
the app checks the marker instead of automatically repeating the POST. Unknown
outcomes remain explicit; use **Check Outlook status** and review Outlook before
confirming a retry. Removing the marker or moving/copying an appointment to another
calendar is outside this per-calendar duplicate check.

**Release v1.0.6:** the managed and unmanaged solution packages include the native
Outlook module and the optional `abs_eventend` column. Existing event records are
preserved. Each user must authorize their own Outlook connection. Live validation
in Contoso Dev confirmed creation with exact saved endpoints, duplicate detection,
and deletion of one explicitly authorized temporary appointment with no attendees.
This check used the connected administrator's mailbox; validate other users'
connections, roles, and tenant policies during rollout.

The v1.0.6 hotfix corrects the native request body: the public SDK receives a
typed appointment object and serializes it once. Passing JSON text through the
generated binary-string signature double-encodes it and causes Graph to reject it
with **Empty Payload. JSON content expected.** Generated files remain untouched.
The regression suite exercises the actual installed SDK connector executor and
its outgoing Blob, with only the host HTTP/identity boundary simulated. Explicit
validation rejections show a concise error; timeouts and ambiguous failures still
require a status check and acknowledged retry with the same protection ID.

## Request submission

The **New Request** button is available at the top right of Requests for program
managers, app admins, and end users. Signed-in users without a Champion profile can
choose their department in the request form to create a standard, active Champion
profile for themselves before submitting. Existing profiles are reused; this setup
does not grant administrative permissions. Departments and request categories must
be configured in Settings, and Dataverse security roles must permit the relevant
profile and request creation operations.

## Data model

Importing the solution creates 17 tables: the 14 business tables shown below, plus
`abs_notificationpreference` (user-owned channel settings), `abs_notificationevent`
(trusted transactional outbox), and `abs_notificationdelivery` (private delivery history).
Publisher **ABSGSA**, prefix `abs`; several
columns carry the legacy `crd49_` prefix. Choice columns are integers with base `839560000`;
all values + labels live in [`src/lib/enums.ts`](./src/lib/enums.ts).

```mermaid
erDiagram
    abs_department  ||--o{ abs_champion              : "employs"
    abs_champion    ||--o{ abs_campaign              : "owns"
    abs_champion    ||--o{ abs_activityclaim         : "submits"
    abs_activity    ||--o{ abs_activityclaim         : "claimed as"
    abs_campaign    ||--o{ abs_activityclaim         : "context"
    abs_activityclaim ||--o{ abs_claimevidence       : "proven by"
    abs_campaign    ||--o{ abs_event                 : "schedules"
    abs_champion    ||--o{ abs_request               : "raises"
    abs_requestcategory ||--o{ abs_request           : "classifies"
    abs_campaign    ||--o{ abs_campaigndepartment    : "targets"
    abs_department  ||--o{ abs_campaigndepartment    : "targeted by"
    abs_campaign    ||--o{ abs_campaignactivity      : "includes"
    abs_activity    ||--o{ abs_campaignactivity      : "used in"
    abs_campaign    ||--o{ abs_campaignparticipation : "joined via"
    abs_champion    ||--o{ abs_campaignparticipation : "joins"

    abs_champion {
        string  abs_name PK
        string  abs_userid "signed-in user (UPN)"
        string  crd49_displayname
        choice  crd49_role "ProgramManager | Champion"
        choice  crd49_status "Active | Inactive | Pending"
        int     crd49_totalpoints
        date    crd49_joineddate
        choice  crd49_appmode "Light | Dark"
        choice  crd49_fontfamily
        choice  crd49_fontsize
        lookup  crd49_department FK
    }
    abs_department {
        string  abs_name PK
        string  crd49_description
    }
    abs_campaign {
        string  abs_name PK
        string  crd49_description
        string  crd49_theme
        string  crd49_imageurl "banner"
        date    crd49_startdate
        date    crd49_enddate
        choice  crd49_status "Draft | Active | Completed"
        lookup  crd49_campaignowner FK
    }
    abs_activity {
        string  abs_name PK
        string  crd49_description
        int     crd49_points
        choice  crd49_activitytype
        choice  crd49_validationmode "SelfClaimed | ApprovalRequired"
        string  crd49_lmslink
    }
    abs_activityclaim {
        string  abs_name PK
        choice  crd49_status "Pending | Approved | Rejected"
        date    crd49_claimeddate
        string  crd49_notes
        lookup  crd49_activity FK
        lookup  crd49_campaign FK
        lookup  crd49_champion FK
    }
    abs_claimevidence {
        string  abs_name PK
        string  abs_filename
        string  abs_notes "evidence URL / note"
        lookup  abs_activityclaim FK
    }
    abs_event {
        string  abs_name PK
        string  crd49_description
        date    crd49_eventdate
        date    abs_eventend "optional schema; required by app on create/edit"
        choice  crd49_format "Online | InPerson | Hybrid"
        string  crd49_location
        string  crd49_meetinglink
        lookup  crd49_campaign FK
    }
    abs_request {
        string  abs_name PK
        choice  crd49_category "legacy option set (optional)"
        choice  crd49_status "Open | InReview | Completed"
        string  crd49_response
        lookup  crd49_champion FK
        lookup  abs_category FK "→ abs_requestcategory"
    }
    abs_requestcategory {
        string  abs_name PK "admin-configurable category"
    }
    abs_campaigndepartment {
        string  abs_name PK
        lookup  abs_campaign FK
        lookup  abs_department FK
    }
    abs_campaignactivity {
        string  abs_name PK
        lookup  crd49_campaign FK
        lookup  crd49_activity FK
    }
    abs_campaignparticipation {
        string  abs_name PK
        lookup  crd49_campaign FK
        lookup  crd49_champion FK
    }
    abs_programsettings {
        string  abs_name PK
        string  abs_communityname
        string  abs_copilotcommunityurl
        string  crd49_sharepointurl "evidence library"
        string  abs_brandcolor "app theme hex"
        string  abs_applogo "logo (data URL)"
        choice  crd49_selfnominationenabled
        choice  crd49_activityapprovalrequired
    }
    abs_appadmin {
        string  abs_name PK
        string  abs_displayname
        string  abs_addedby
    }
```

| Area | Table | Purpose |
|------|-------|---------|
| People | `abs_champion` | Champion profile: user id, role, status, department, points, per‑user theme |
| Org | `abs_department` | Departments |
| Programs | `abs_campaign` | Learning campaigns: theme, banner, dates, status, owner |
| Learning | `abs_activity` | Activities: type, points, validation mode, LMS link |
| Claims | `abs_activityclaim` | A champion's claim of an activity (status, points context) |
| Evidence | `abs_claimevidence` | Evidence link/note attached to a claim |
| Events | `abs_event` | Events: date, format, location/link, campaign |
| Requests | `abs_request` | License/connector/support requests with threaded response |
| Join | `abs_campaigndepartment` | Campaign ↔ department audience (M:N) |
| Join | `abs_campaignactivity` | Campaign ↔ activity (M:N) |
| Join | `abs_campaignparticipation` | Campaign ↔ champion enrollment (M:N) |
| Config | `abs_programsettings` | Single settings row: community, SharePoint URL, branding, toggles |
| Admin | `abs_appadmin` | Application‑admin allow‑list |

---

## Routes & screens

| Route | Screen | Highlights |
|-------|--------|------------|
| `/` | Home | KPI cards with colored accents + deltas — Active Champions, Active Campaigns, Activities Completed, **Campaigns At Risk**, **Trending Campaign**; pending claims, open requests, completion donut, top champions |
| `/champions` | Champions | KPIs, search + status/department filters, add‑champion (GAL picker), per‑card **edit / disable / remove** (disable revokes app access) |
| `/campaigns` | Campaigns | banner‑image cards in Active/Drafts/Expired/Completed tabs, health (RAG) badges, participant counts, new campaign |
| `/campaigns/:id` | Campaign detail | banner header, health score, overview, audience, activities/participants/events tabs, join button (champions), edit (admin) |
| `/activities` | Activities | catalog + claims tabs, filter by type **and campaign**, new activity, claim with evidence, approve/reject |
| `/events` | Events | month calendar + upcoming list, new event |
| `/leaderboard` | Leaderboard | champions / departments / campaigns ranking, department filter |
| `/requests` | Requests | KPIs, filters, submit request, threaded triage |
| `/reports` | Reports *(admin)* | executive KPIs, department & activity‑type breakdowns, monthly trend, campaign performance (RAG), requests/events overview, CSV + Print/PDF |
| `/customize` | Customize | per‑user Light/Dark, font family & size — live preview + save |
| `/settings` | Settings *(admin)* | program config, application admins, departments, **request categories** (admin-configurable), **App Theme & Branding** (color + logo) |

---

## Key features

- **Role gating.** Two layers work together. **In Dataverse**, the package ships two security
  roles — **AI Champions Hub Users** and **AI Champions Hub Admins** (see Deploy) — that grant the
  table privileges; assign them on import. **In the app**, the signed‑in user resolves to an
  `abs_champion` and/or `abs_appadmin` record. `isAdmin = isProgramManager || isAppAdmin`.
  Admin‑only actions (managing champions, campaigns, activities, claim approvals, events, request
  triage, reports and all of Settings) are hidden for regular champions.
- **Champion lifecycle & access control.** Admins can edit, **disable** (sets status Inactive) or
  remove a champion. A disabled champion is blocked at app startup by an access gate; admins are
  never locked out. Re‑enabling restores access.
- **Campaign‑gated activities.** Activities always live under a campaign. Champions only see and
  claim activities for campaigns they've **joined** and that are **live**; disabled/expired
  campaigns automatically make their activities non‑claimable (derived, no schema change).
- **Points & leaderboard.** Points come from **Approved** claims × `activity.points`; the
  leaderboard ranks champions, departments (summed) and campaigns.
- **Campaign health (RAG).** Each campaign is scored 0–100 (enrollment + pace) into
  Green/Amber/Red, surfaced on cards, detail, Home ("Campaigns At Risk") and Reports.
- **Per‑user personalization.** Each champion stores Light/Dark, font family and size (Customize),
  applied via CSS variables and reverted on unmount unless saved.
- **App‑wide branding (admin).** Settings → App Theme & Branding sets a brand color (presets or
  custom hex) that recolors buttons, links, highlights, active nav **and the left panel**, plus an
  uploaded **app logo** shown top‑left — stored on `abs_programsettings` for every user.
- **Configurable request categories (admin).** Settings → Request Categories lets admins add, rename
  and remove the categories champions pick from when raising a request. Categories are stored in the
  `abs_requestcategory` table (a lookup on `abs_request`), so they are no longer limited to a fixed
  set — reports and filters follow the configured list automatically.

---

## Tech stack

- **Vite 7** + **React 19** + **TypeScript** (strict)
- **React Router** for the 12 client routes
- **Power Apps Code SDK** (`@pa-client/power-code-sdk`) — auth + Dataverse + connector access
- **Dataverse** — 17 tables provisioned by the solution package
- No charting library — Reports charts are lightweight inline SVG/CSS components

---

## Deploy to a new environment (fresh, end‑to‑end)

Full step‑by‑step (single-import + connections, incl. cross‑tenant) is in
**[`deploy/DEPLOYMENT.md`](./deploy/DEPLOYMENT.md)**. In short:

```powershell
# 1. Authenticate to the TARGET environment
pac auth create --environment <TARGET_ENVIRONMENT_ID>

# 2. Import the whole solution — tables + roles + the bundled Code App
pac solution import --path .\deploy\solutions\AIChampionsHubApp_managed.zip --publish-changes

# 3. Configure app connections, assign roles, and bind the three notification
#    automation connection references in the TARGET environment before enabling flows.
```

**A single solution import provisions everything** — no separate app deployment step:

- The 17 Dataverse tables, option sets and relationships, plus the notification plug-in/API and flows.
- **Two security roles** — **AI Champions Hub Users** (business-table access) and
  **AI Champions Hub Admins** (additional business-table delete access).
  Both grant notification preference Create/Read/Write and delivery Read at **user depth only**;
  outbox writes and worker execution remain trusted-server operations. Assign **Users** to champions and
  **Admins** to program managers / app admins; no manual role setup needed.
- The **"AI Champions Hub (Code)" app** itself — the Code App is **bundled inside the solution**
  (packaged with `power-apps push --solution-id`), so it lands in the target as an installed app.

**After import, configure the target environment:**

1. **Create the connections.** In `make.powerapps.com` → **Connections**, add a **Microsoft Dataverse**
   connection and an **Office 365 Users** connection (Code Apps bind connectors client‑side, so these
   don't travel inside the solution). Then **Apps → AI Champions Hub (Code) → Play**.
2. **Assign the two security roles** to your users (as above).
3. **Configure notifications.** Bind the Dataverse, Teams and Outlook automation
   connection references to the approved sender's target-environment connections,
   verify the app URL and permissions, then validate/enable the two flows using the
   [notification deployment guide](./deploy/DEPLOYMENT.md#notification-module-source-deployment).
   No user is opted in automatically.

> ⚠️ **Caveat — Code App ALM is in preview.** The bundled app ships in the `.zip`, but if the imported
> app can't resolve its connections automatically on first play, redeploy it from source with
> `pac code push` against the target environment (see `deploy/DEPLOYMENT.md`, **Part 2 → Option B**).
> That same `pac code push` is also how you publish code updates after the initial import.

Then sign in as an admin and complete first‑run setup in **Settings** (community name/URL,
SharePoint evidence library URL, departments, admins, branding).

### First‑run experience (who's the first admin?)

A freshly imported program has **no app admins and no champions** yet. To avoid a lock‑out — where
the person who opens the app first has no way to grant themselves access — the app applies a
**bootstrap‑admin** rule:

> While **zero app admins** exist, the **signed‑in user is treated as an admin**, so the app owner
> can open **Settings** and set the program up.

On that first visit, the **Application Admins** card shows a welcome banner with an **“Add me as an
admin”** button:

![First‑run experience](docs/screenshots/13-first-run.png)

- Clicking **Add me as an admin** writes the signed‑in user into the `abs_appadmin` table as the
  **permanent** administrator (no champion record required).
- As soon as **one** app admin exists, the bootstrap rule **switches off automatically** and normal
  role gating resumes — from then on only Program Managers / App Admins see Settings. The Manage
  Admins UI never lets the **last** admin be removed, so the program can't fall back into an
  admin‑less state.
- Best practice: click **Add me as an admin** first, then add departments, elevate other admins, and
  fill in program settings.

> **Note:** this bootstraps whoever opens the freshly deployed app first (typically the maker/owner
> who imported the solution). Add the real administrator right away so access is pinned to a known
> account.

### Versioning & upgrades (don't reset existing data)

The current version is shown at the **bottom of the left navigation panel** (e.g. `v1.0.9`) and is the
same number carried by the deployable solution (`v1.0.9` in the app → solution version `1.0.9.0`).

**To ship an update to a tenant that already has the app — without wiping its data — re-import as an
upgrade with a *higher* version number.** Dataverse only preserves existing rows when the incoming
solution version is greater than the installed one; re-importing the *same* version can fail or
overwrite, and installing a lower version is rejected.

```powershell
# Upgrade an existing install (data preserved), rather than a clean import:
pac solution import --path .\deploy\solutions\AIChampionsHubApp_managed.zip --import-as-holding --publish-changes
pac solution upgrade --solution-name AIChampionsHubApp
```

Because the version travels *inside* the exported `.zip`, every shipped change must bump the version
**before** the solution is re-exported. Keep these three in lock‑step:

| Where | File / command | Format |
| --- | --- | --- |
| App UI label | `src/version.ts` → `APP_VERSION` | `1.0.9` |
| npm package | `package.json` → `version` | `1.0.9` |
| Dataverse solution | `pac solution online-version --solution-name AIChampionsHubApp --solution-version 1.0.9.0` | `1.0.9.0` |

**Release checklist for any future change:**

1. Bump `APP_VERSION` in `src/version.ts` and the package/lockfile versions (e.g. `1.0.8` → `1.0.9`).
2. `npm run build`.
3. Set the online solution version: `pac solution online-version --solution-name AIChampionsHubApp --solution-version 1.0.9.0`.
4. Re-push + re-bundle the app: `pac code push --solutionName AIChampionsHubApp`.
5. Re-export both zips: `pac solution export --name AIChampionsHubApp --path .\deploy\solutions\AIChampionsHubApp_managed.zip --managed true --overwrite` (and again `--managed false` for the unmanaged zip).
6. Commit the bumped sources **and** the refreshed zips together.

---

## Local development

```powershell
npm install
pac code run
```

`pac code run` starts the Code Apps host, and `npm run dev` (Vite, port 3000) serves the app. Open
the **Local Play** URL that the Vite Power Apps plugin prints. (`pac code run` can also print a play
URL that points at `localhost:3000`.)

## Build

```powershell
npm run build   # tsc -b && vite build  → dist/
```

Run the protected-deletion regression checks with `npm run test:deletion`.
They use Node's test runner and Vite with in-memory service doubles; no Dataverse
connection or tenant writes are involved.
Run `npm run test:outlook` for the native-calendar service regression checks,
including permissions, pagination, UTC/DST handling, duplicate prevention, and
interrupted writes. These also use in-memory doubles and make no Outlook requests.
Run `npm run test:events` for both event-schedule and Outlook checks, including
single/multi-day input validation, legacy records, day overlap, and DST-safe editing.
Run `npm run test:champions` for duplicate creation/editing, identity normalization,
disabled profiles, failed reads, and overlapping-save checks. The isolated
`tests\championIdentityKey.test.ps1` checks schema preflight/backfill without a tenant
connection; run it under your approved PowerShell execution policy.

---

## Project structure

```
src/
  App.tsx                # Router + provider tree (data → theme → toast) with loading/error gates
  index.css              # Theme tokens (light/dark) + brand variables + all component styles
  lib/
    enums.ts             # Option-set integer values + label maps + font stacks
    branding.ts          # Brand presets + color math + applyBrand() (drives CSS variables)
    access.ts            # Campaign/activity gating helpers
    campaignHealth.ts    # RAG scoring
    reports.ts           # Report data builders + CSV/print export
    format.ts            # Date/number helpers
  data/entities.ts       # Aliased services, model types, EntitySet + bind()
  generated/             # AUTOGENERATED by pac code add-data-source — do not edit
  context/AppDataContext.tsx   # Loads tables once; role flags; points roll-up; reload()
  theme/ThemeProvider.tsx      # Per-user theme + app brand color/logo → document root
  components/            # Layout, Modal, Toast, ui.tsx (Avatar/Pill/KpiCard/HealthBadge/…), charts.tsx
  screens/               # One file per route

deploy/
  DEPLOYMENT.md          # Cross-tenant deployment guide
  solutions/             # AIChampionsHubApp_managed.zip + _unmanaged.zip (tables + roles + bundled app)
```

---

## Working with data

Always go through the generated services and read `result.data`:

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
- The `generated/` folder is regenerated by `pac code add-data-source`; don't hand‑edit it.

---

## Notes

- A harmless libuv `Assertion failed` line can print at the end of some `pac` commands on Windows;
  it does not affect the operation.

---

_Developed by **Zafar Ul Islam** ([zafaru@microsoft.com](mailto:zafaru@microsoft.com))._
