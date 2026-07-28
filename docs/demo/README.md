# AI Champions Hub — Demo Video

A short (~2 minute) narrated walkthrough of the **AI Champions Hub (Code)** Power Apps code app,
captured live against Dataverse (app version **v1.0.2**).

## Contents

| File | Description |
|------|-------------|
| `AI_Champions_Hub_demo.mp4` | 1280×800 H.264/AAC guided tour with neural-voice narration, a subtle ambient music bed, and burned-in captions. |
| `narration_script.txt` | Full narration transcript. |
| `captions.srt` | Timed transcript sidecar. |

## What it shows

The tour is split into two chapters:

**Part 1 — Program Manager**
Home dashboard (live program KPIs incl. *Campaigns at Risk*) → Campaigns grouped by status with
health indicators → campaign detail → Activities & claim review → Requests triage → the **Reports**
executive roll-up (CSV/PDF export) → Settings (program config + promote/demote app admins with a
protected default admin) → the admin-configurable **Request Categories**.

**Part 2 — Champion**
A personalized Home (points, rank, joined campaigns) → browsing and joining a campaign →
activities unlocking after joining → claims tracked to approval (each activity claimable only once)
→ raising a **New Request** using the admin-configured categories → the leaderboard.

## How it was produced

- Ran locally with `pac code run` + Vite and driven with Playwright to capture each screen.
- Narration synthesized with a neural TTS voice; the ambient music bed is synthesized and
  side-chain-ducked under the voice (no third-party/copyright audio).
- The champion perspective was rendered via a demo-only, `sessionStorage`-gated persona override
  that is **not** part of the shipping app code.
