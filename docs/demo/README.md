# AI Champions Hub — Demo Video

A narrated walkthrough (~2 min 45 s) of the **AI Champions Hub (Code)** Power Apps code app,
captured live against Dataverse (app version **v1.0.2**).

## Contents

| File | Description |
|------|-------------|
| `AI_Champions_Hub_demo.mp4` | 1280×800 H.264/AAC guided tour with lively neural-voice narration and a soft ambient music bed. No on-screen captions. |
| `narration_script.txt` | Full narration transcript. |
| `captions.srt` | Timed transcript sidecar (optional subtitles — captions are **not** burned into the video). |

## What it shows

The tour is split into two chapters:

**Part 1 — Program Manager**
Home dashboard (live program KPIs incl. *Campaigns at Risk*) → the Champions directory
(add/edit/disable/remove) → Campaigns grouped by status with health indicators → campaign detail →
Activities & claim review → Events → a company-wide Leaderboard → Requests triage → the **Reports**
executive roll-up (CSV/PDF export) → Customize (theme/branding) → Settings (program config +
promote/demote app admins with a protected default admin) → the admin-configurable
**Request Categories**.

**Part 2 — Champion**
A personalized Home (points, rank, joined campaigns) → the campaign gallery → joining a campaign →
activities unlocking after joining → claims tracked to approval (each activity claimable only once)
→ raising a **New Request** using the admin-configured categories → tracking those requests →
the leaderboard → personalizing their own theme.

## How it was produced

- Ran locally with `pac code run` + Vite and driven with Playwright to capture each screen.
- Narration synthesized with a lively neural TTS voice (cheerful, conversational); the ambient
  music bed is synthesized and side-chain-ducked under the voice (no third-party/copyright audio).
- The champion perspective was rendered via a demo-only, `sessionStorage`-gated persona override
  that is **not** part of the shipping app code.

