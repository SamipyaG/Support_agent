# G-Mana Platform Knowledge

This document is injected into every GPT-4o call so the model understands the platform.

---

## What is G-Mana?

G-Mana is a cloud-based **Server-Side Ad Insertion (SSAI)** platform. It intercepts a
broadcaster's live HLS or DASH stream, stitches targeted ads at SCTE-35 cue points,
and delivers a seamless combined stream to viewers.

The platform runs on Kubernetes clusters and handles thousands of concurrent streams.

---

## Core Terminology

**ds_uuid** — A unique identifier for each stream.
Format: `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`
Every alarm, pod, and deployment is identified by ds_uuid.

**HLS** — Apple's streaming protocol. Uses `.m3u8` manifest files and `.ts` segments.Live/VOD
SCTE-35 ad cue markers are embedded as `EXT-X-DATERANGE` or `EXT-X-CUE-OUT` tags.

**DASH** — MPEG's streaming protocol. Uses `.mpd` manifest files.

**SCTE-35** — Broadcast standard for signaling ad break opportunities.

---

## System Components

**User Handler (UH)**
- Main pod managing a stream session
- Pod format: `user-handler-{ds_uuid}`
- When UH crashes → stream returns 502/other status rather than 200 and becomes unreachable
- Each pod has resources: memory, CPU, response time, network

**CueMana-In (CI)**
- Ad insertion engine pod
- Pod format: `cuemana-in-{ds_uuid}`
- When CI fails → ads stop being inserted (no SCTE-35 markers in G-Mana output)

**Hub Monitor**
- Internal monitoring API — source of truth for alarms, pod logs, Redis health

**Clusters**
- Kubernetes clusters. Named: `hub1x`, `hub21`, `stg`

**Pod Stability Rule**
- Any pod with more than 10 restarts is considered unstable

---

## Prirority Customers

- **Keshet** — Premium customer. Uses Keshet Redis cluster. Immediate escalation required.
- **Reshet** — Premium customer. Uses Reshet Redis cluster. Immediate escalation required.

> Priority channels must NEVER wait for automated resolution. Notify Yoni (senior engineer) immediately.

---

## Active Agents in This System

There are 5 agents in the full architecture. Currently 3 are active.

### AGENT 1 — StreamAnalyzerAgent (ACTIVE)
- **Role:** First agent to run. Monitors all active alarms, identifies affected channel,
  retrieves stream metadata, checks source and G-Mana URLs, evaluates alarm type,
  detects customer priority, calculates confidence score.
- **Reports to:** ManagerAgent (sends StreamAnalysisReport including ds_uuid, urls, cluster)

### AGENT 2 — ResourcesAnalyzerAgent (ACTIVE)
- **Role:** Checks infrastructure health for a specific channel.
  Checks UH pod, CI pod, pod states (Running/Pending/Failed), restart counts,
  Redis health (isHealthy, CPU, memory) across all channels.
- **Receives from:** ManagerAgent (ds_uuid + clusterName, redisName extracted from StreamAnalysisReport)
- **Reports to:** ManagerAgent (sends ResourcesAnalysisReport)

### AGENT 3 — ManagerAgent (ACTIVE — Orchestrator)
- **Role:** Central coordinator. Receives alarm from Hub Monitor, triggers StreamAnalyzer,
  reads its report, distributes data to ResourcesAnalyzer, collects all reports,
  calls GPT-4o for final decision, waits for human approval, executes action.
- **State** ALL incident states
  (`NEW → ANALYZING → WAITING_APPROVAL → EXECUTING_ACTION → MONITORING → CLOSED | RESOLVED | ESCALATED`)

### AGENT 4 — PlayerAnalyzerAgent (FUTURE — not yet implemented)
- **Role:** Deep stream debugging using a player tool. Opens source + G-Mana URLs,
  observes for ~30 seconds, detects sequence jumps, discontinuities, missing segments,
  HTTP errors (403/404/502), slow downloads.
- **Will receive from:** ManagerAgent (source_url, g_mana_url from StreamAnalysisReport)
- **Will report to:** ManagerAgent

### AGENT 5 — SenderAgent (FUTURE — not yet implemented)
- **Role:** All external communication (WhatsApp Business API + Outlook email).
  Prepares message drafts using predefined templates, sends draft to ManagerAgent for
  review, waits for support team final approval, then sends message.
- **Will receive from:** ManagerAgent (message instructions + incident context)
- **Will report to:** ManagerAgent (draft for review before sending)

---

## Incident State Machine

Every alarm creates or updates one Incident record.
**ManagerAgent is the ONLY agent that changes state.**

| State              | Meaning                                                                 |
|--------------------|-------------------------------------------------------------------------|
| `NEW`              | First alarm seen for this channel — watching, threshold not met yet     |
| `ANALYZING`        | StreamAnalyzer ran, distributing data to other agents                   |
| `WAITING_APPROVAL` | GPT-4o decision ready, awaiting human confirmation                      |
| `EXECUTING_ACTION` | Restart command being sent to Hub Monitor API                           |
| `MONITORING`       | Restart complete, verifying stream health (3 checks × 30s)             |
| `RESOLVED`         | No action needed (source down or transient alarm) — terminal            |
| `ESCALATED`        | Rejected / Priority / max restarts / confidence too low — terminal           |
| `CLOSED`           | Stream healthy, pattern saved — terminal                                |
