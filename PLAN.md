# G-Mana Support AI v5 — Complete System Documentation & Development Plan

---

## 1. What Is G-Mana?

G-Mana is a **Server-Side Ad Insertion (SSAI)** platform. It sits between a content source (broadcaster encoder / CDN) and the end viewer. Its job is to stitch ads into live video streams transparently so that viewers receive a single, uninterrupted stream with ads already baked in.

### How It Works (High Level)
1. A broadcaster publishes a live HLS or DASH stream to a CDN (the "source stream")
2. G-Mana receives that source stream and rewrites the manifest in real time
3. When an ad break is signalled (via SCTE-35 cue), G-Mana swaps the content segments for ad segments
4. The viewer's player receives the G-Mana URL, not the source URL — they never touch the source directly
5. If G-Mana breaks, the viewer sees a broken stream (buffering, black screen, or error)

### Key Components Inside G-Mana (per channel)
| Component | Full Name | Role |
|-----------|-----------|------|
| **UH** | User Handler | Rewrites HLS/DASH manifests. Serves the `.m3u8` or `.mpd` file to viewers. If UH breaks, the stream URL returns 502/404. |
| **CI** | CueMana-In | Processes ad insertion cues (SCTE-35 markers). Tells UH when to splice in ads. If CI breaks, ad insertion stops working. |
| **Redis** | Redis Cluster | Shared session state between UH and CI pods. Stores current ad break state, manifest version, viewer context. If Redis goes down, both UH and CI lose state. |

### Deployment Structure
- Each channel (stream) has its own `ds_uuid` (Data Source UUID)
- Channels run on clusters: `hub1x`, `hub21`, `hub3x`, `hub4x`
- Each cluster has Redis instances named `Am`, `Bm`, `Cm`
- UH pod name format: `user-handler-{ds_uuid}-{random}`
- CI pod name format: `cuemana-in-{ds_uuid}-{random}`

### What Causes Alarms?
- G-Mana's Hub Monitor system detects when a stream is broken and fires an alarm
- Alarm types include: `NO_CONTENT`, `MANIFEST_ERROR`, `AD_INSERTION_FAIL`, `POD_CRASH`
- Alarms have `status: ON` (active problem) or `status: OFF` (resolved)
- An alarm with `review: true` means a human is already looking at it — the AI skips these

---

## 2. What Does This Project Do?

**G-Mana Support AI v5** is an automated incident management system. When a G-Mana stream breaks, this system:

1. **Detects the alarm** — polls Hub Monitor every 30 seconds
2. **Decides if it's a G-Mana problem or a source problem** — if multiple channels on the same source all break at the same time, the source is down (not G-Mana's fault)
3. **Investigates the infrastructure** — fetches pod logs and Redis health for the specific channel
4. **Uses GPT-4o to synthesize** — all collected data goes to GPT-4o which decides what action to take
5. **Asks a human for approval** — shows the recommendation in the UI with a countdown timer
6. **Executes the fix** — restarts UH pod, waits 30s, checks if fixed. If not, restarts CI pod.
7. **Verifies resolution** — polls Hub Monitor to confirm the alarm cleared
8. **Closes the incident** — records what worked for future reference (memory patterns)

The system has a **dashboard UI** (Vue 3) that shows all active alarms, their status, and lets support agents approve/reject restart actions.

---

## 3. System Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         G-Mana Hub Monitor                          │
│              https://hub-monitor.g-mana.live                        │
│   (Fires alarms when streams break — polled every 30s by backend)   │
└─────────────────────────────┬───────────────────────────────────────┘
                              │ GET /sendalarms/status/alarms
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     Backend (Node.js + TypeScript)                   │
│                         localhost:3000                               │
│                                                                     │
│  ┌──────────────┐    ┌───────────────────────┐    ┌──────────────┐  │
│  │  index.ts    │    │    ManagerAgent        │    │  InMemory    │  │
│  │  Polling     │───▶│    Orchestrator        │───▶│  Store       │  │
│  │  loop 30s    │    │                        │    │              │  │
│  └──────────────┘    └───────┬───────┬────────┘    └──────────────┘  │
│                              │       │                               │
│               ┌──────────────┘       └─────────────────┐            │
│               ▼                                        ▼            │
│  ┌────────────────────────┐          ┌──────────────────────────┐   │
│  │ ResourcesAnalyzerAgent │          │    HubMonitorTool         │   │
│  │ (UH/CI logs + Redis)   │          │    (all API calls)        │   │
│  └────────────────────────┘          └──────────────────────────┘   │
│               │                                        │            │
│               ▼                                        ▼            │
│  ┌────────────────────────┐          ┌──────────────────────────┐   │
│  │  GPT-4o Synthesis      │          │  Hub Monitor API          │   │
│  │  (OpenAI)              │          │  G11 Channel API          │   │
│  └────────────────────────┘          └──────────────────────────┘   │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  Express Routes: /api/incidents  /api/approve  /api/alarms   │   │
│  └──────────────────────────────────────────────────────────────┘   │
└──────────────────────────────┬──────────────────────────────────────┘
                               │ HTTP API
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    Frontend (Vue 3 + Pinia + Vite)                   │
│                         localhost:5173                               │
│                                                                     │
│  DashboardView ──── IncidentCard ──── IncidentDetailView            │
│       │                                      │                      │
│  Sidebar (Active/History)             RestartWorkflow                │
│  Filter tabs                          ApprovalTimer                  │
│  Manual trigger                       Timeline                       │
│  KPI badges                           HLS Player                     │
│  RedisPanel                           Redis Panel                    │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 4. External APIs Used

### 4.1 Hub Monitor API
**Base URL:** `https://hub-monitor.g-mana.live`
**Auth:** `x-api-key: support123` (header)

| # | Method | Path | Purpose |
|---|--------|------|---------|
| 1 | GET | `/sendalarms/status/alarms` | Get all active alarms |
| 2 | GET | `/sendalarms/streams/{ds_uuid}/details` | Get cluster name + Redis key for a stream |
| 3 | GET | `/sendalarms/clusters/{cluster}/redis-instances` | Get Redis health for a cluster |
| 4 | GET | `/sendalarms/clusters/{cluster}/deployments/user-handler-{uuid}/pods` | Get UH pod names |
| 5 | GET | `/sendalarms/clusters/{cluster}/pods/{pod_name}/logs` | Get logs from a specific pod |
| 6 | GET | `/sendalarms/clusters/{cluster}/deployments/cuemana-in-{uuid}/pods` | Get CI pod names |
| 7 | POST | `/sendalarms/clusters/{cluster}/deployments/user-handler-{uuid}/restart` | Restart UH deployment |
| 8 | POST | `/sendalarms/clusters/{cluster}/deployments/cuemana-in-{uuid}/restart` | Restart CI deployment |

### 4.2 G11 Channel API
**Base URL:** `https://g11.g-mana.live`
**Auth:** `Authorization: {G11_AUTH_TOKEN}`, `Login-As: null`

| # | Method | Path | Purpose |
|---|--------|------|---------|
| 1 | GET | `/api_v1/channel/get/{ds_uuid}` | Get stream source URL and G-Mana output URL |

**Important:** The G11 API **never returns** the cluster name. Cluster comes only from the Hub Monitor `/details` endpoint. This caused a bug where auto-restart used an empty cluster string — it must always use `incident.clusterId` from the store (set by `getStreamDetails()`).

### 4.3 OpenAI API
- Model: `gpt-4o` (configurable via `OPENAI_MODEL`)
- Used in: `ManagerAgent.synthesizeReports()` — decision synthesis
- Input: alarm data + stream analysis + resources analysis
- Output: `{ recommendedAction, confidenceScore, explanation, errorCode }`
- Temperature: 0 (deterministic)
- Max tokens: 300

---

## 5. Backend — Full Detail

### 5.1 Entry Point: `src/index.ts`

**Purpose:** Bootstrap the application, validate environment, start the polling loop.

**Startup sequence:**
1. Load `.env` via `dotenv/config`
2. Validate required env vars: `HUB_MONITOR_BASE_URL`, `G11_BASE_URL`, `G11_AUTH_TOKEN`
3. Instantiate `HubMonitorTool` and `ApprovalService`
4. Instantiate `ManagerAgent(hubMonitor, approvalSvc)`
5. Register `managerAgent` and `hubMonitor` on Express app (so routes can access them)
6. Run first poll immediately: `hubMonitor.getActiveAlarms()` → `managerAgent.processAlarms(alarms)`
7. Set `setInterval(poll, POLL_INTERVAL_MS)` for recurring polls (default 30s)
8. Start HTTP server on `PORT` (default 3000)
9. Register `SIGTERM` + `SIGINT` handlers for graceful shutdown

**Key constants:**
- `POLL_INTERVAL_MS` — how often to check for alarms (default: 30000ms)
- `PORT` — HTTP server port (default: 3000)

**Concurrent poll protection:** `isPolling` flag prevents overlapping poll cycles. If previous poll is still running when the timer fires, it is skipped.

---

### 5.2 Express App: `src/app.ts`

**Middleware applied:**
- `cors({ origin: FRONTEND_URL })` — allow frontend requests
- `express.json()` — parse JSON bodies
- `express-rate-limit` — prevent API abuse

**Routes mounted:**
- `GET /health` — returns `{ status: 'ok', timestamp }`
- `GET/POST /api/incidents` — incident management
- `GET/POST /api/approve` — human approval decisions
- `POST /api/alarms/manual` — manually trigger investigation
- `GET /api/redis` — Redis cluster health

---

### 5.3 Agent 1: `ManagerAgent` — Central Orchestrator

**File:** `src/agents/ManagerAgent.ts`

**Role:** Receives all alarms every poll cycle and drives the full incident lifecycle from detection to closure.

**Constructor:**
```
ManagerAgent(hubMonitor: HubMonitorTool, approvalService: ApprovalService)
```
Internally creates: `OpenAI` client, `ResourcesAnalyzerAgent`

**Constants defined at top:**
- `POST_RESTART_WAIT_MS = 30_000` — wait 30s after restart before rechecking
- `STABLE_CHECK_INTERVAL_MS = 30_000` — 30s between recheck polls
- `STABLE_CHECK_ATTEMPTS = 3` — poll 3 times max before giving up
- `SOURCE_ISSUE_WINDOW_MS = 60_000` — 1 min window to detect source outages
- `VIP_KEYWORDS = ['keshet', 'reshet']` — channels with these names in channel name get immediate escalation

**Private state:**
- `alarmOccurrences: Map<string, number[]>` — tracks timestamps of each alarm per dsUuid, used for repeat threshold logic

---

#### `processAlarms(alarms: AlarmData[]): Promise<void>`
**Entry point called by `index.ts` polling loop.**

1. If `alarms.length === 0` → log "No alarms" and return
2. Filter out alarms with `alarm.review === true` (human is handling them)
3. Call `detectSourceIssues(actionableAlarms)` → returns `Set<string>` of dsUuids with source issues
4. Use `Promise.allSettled()` to process all alarms concurrently:
   - If dsUuid is in `sourceDownUuids` → `handleSourceAlarm(alarm)`
   - Otherwise → `handleAlarm(alarm)`

---

#### `detectSourceIssues(alarms: AlarmData[]): Set<string>`
**Detects when the upstream source is down rather than G-Mana.**

Logic:
1. Filter to `status === 'ON'` alarms that have an `alarmUrl`
2. Group them by `alarmUrl` (the source stream URL)
3. For each group with 2+ channels:
   - Calculate time spread: `max(startedAt) - min(startedAt)`
   - If spread ≤ 60 seconds → all these channels alarmed at nearly the same time on the same source → source is down
   - Add all their dsUuids to `sourceDownUuids`
4. Return `Set<string>` of dsUuids with source issues

**Why this matters:** If the broadcaster's encoder goes down, 50 channels all fire alarms at once. Restarting G-Mana pods would do nothing. We detect this pattern and skip restarting — instead we notify the customer.

---

#### `handleSourceAlarm(alarm: AlarmData): Promise<void>`
**Handles a channel confirmed to have a source issue.**

1. If `alarm.status === 'OFF'` → call `handleClosedAlarm()` (alarm cleared itself)
2. Fetch stream details + stream URLs in parallel (for UI display)
3. Create or update incident with:
   - `state: 'RESOLVED'`
   - `errorCode: 'SOURCE_DOWN'`
   - `recommendedAction: 'NOTIFY_CUSTOMER'`
   - `confidenceScore: 90`
   - Customer message: "Source stream is down for channel X. Please check your encoder/CDN."

---

#### `handleClosedAlarm(alarm: AlarmData): Promise<void>`
**Called when `alarm.status === 'OFF'` (alarm turned off by Hub Monitor).**

1. Find open incident for this `dsUuid` (not CLOSED or RESOLVED)
2. If found → call `closeIncident(incident, 'Alarm cleared by Hub Monitor')`

---

#### `handleAlarm(alarm: AlarmData): Promise<void>`
**Routes alarm to closed or active handler with error catching.**

- `status === 'OFF'` → `handleClosedAlarm()`
- `status === 'ON'` → `handleActiveAlarm()`
- Catches any unhandled errors and logs them (prevents one broken alarm from crashing the whole poll)

---

#### `handleActiveAlarm(alarm: AlarmData): Promise<void>`
**Decides between new channel and existing channel handling.**

1. Look for existing open incident for this `dsUuid` (not CLOSED/RESOLVED/FAILED)
2. If exists AND state is not NEW → `handleExistingChannelAlarm(alarm, incident)`
3. Otherwise → `handleNewChannelAlarm(alarm, existingIncident)`

---

#### `handleNewChannelAlarm(alarm, existingIncident): Promise<void>`
**The 3-scenario gate that determines if/when to act.**

1. Call `trackAlarmOccurrence(alarm)` — records current timestamp for this dsUuid
2. Count recent alarms: `countRecentAlarms(dsUuid, repeatWindowMs)` within the last 60 minutes
3. Calculate alarm age: `(Date.now() - alarm.startedAt) / 1000` in seconds

**Scenario 1 — Below repeat threshold (default: < 3 alarms in 60 min):**
- Create/update tracking incident with label: `"Watching — wait 60s before acting (N/3 alarms)"`
- Return without investigation — this might be a transient glitch

**Scenario 2 — Threshold met but alarm too young (< 60s old):**
- Create/update tracking incident with label: `"Threshold met — waiting Ns more before action"`
- Return — alarm is real but we give it time to self-resolve

**Scenario 3 — Threshold met AND alarm old enough:**
- Update label: `"Waiting time exceeded — investigating"`
- Call `runFullInvestigation(alarm, existingIncident)`

---

#### `createOrUpdateTrackingIncident(alarm, existingIncident, statusLabel): Promise<void>`
**Creates or updates a lightweight incident for tracking purposes (Scenarios 1 and 2).**

1. Fetch `getStreamDetails()` and `getStreamUrls()` in parallel (for cluster/redis/player URLs)
2. If `existingIncident` exists → update it with new statusLabel + cluster/redis if available
3. If no existing incident → create a new one with `state: 'NEW'`

---

#### `handleExistingChannelAlarm(alarm, incident): Promise<void>`
**Handles an alarm that already has an open non-NEW incident.**

1. If state is `EXECUTING_ACTION`, `MONITORING`, or `WAITING_APPROVAL` → skip (already being handled)
2. Check alarm age vs waiting time
   - Too young → update statusLabel, return
   - Old enough → call `runFullInvestigation(alarm, incident)`

---

#### `runFullInvestigation(alarm, existingIncident): Promise<void>`
**The full 7-step multi-agent investigation pipeline.**

**STEP 1 — Get stream URLs and details:**
- Call `getStreamUrls(dsUuid)` and `getStreamDetails(dsUuid)` in parallel
- `getStreamUrls` → source URL, G-Mana URL, stream type, customer name (from G11 API)
- `getStreamDetails` → clusterName, redisKey (from Hub Monitor)
- If stream URL fetch fails → log error and return (can't investigate without URLs)

**STEP 2 — ResourcesAnalyzerAgent:**
- Call `resourcesAnalyzer.analyze(clusterName, dsUuid)`
- Fetches UH logs, CI logs, Redis health all in parallel
- Returns `ResourcesAnalysisReport` with affected component + severity
- Failure is non-fatal (caught, report set to null)

**Create/update incident record:**
- Set `state: 'ANALYZING'`
- Store `clusterId`, `redisInstance`, `streamType`, `isVip`, `gManaPlayerUrl`, `sourcePlayerUrl`
- Store `resourceAnalysis` from ResourcesAnalyzerAgent report

**STEP 3 — GPT-4o Synthesis:**
- Call `synthesizeReports(alarm, resourcesReport)`
- Returns `{ recommendedAction, confidenceScore, explanation, errorCode }`
- Update incident with decision fields

**STEP 4 — Store alarm duration metadata:**
- Calculate how long alarm has been active
- Store `durationSeconds` and `durationMinutes` in `streamAnalysis`

**STEP 5 — Execute Action:**
- Call `executeAction(incident, alarm, streamUrls)`
- This handles approval → restart → monitoring loop

---

#### `synthesizeReports(alarm, resourcesReport): Promise<Decision>`
**GPT-4o decision synthesis.**

1. Get system prompt from `SystemKnowledgeBase.getManagerSynthesisPrompt()`
2. Build context via `buildManagerSynthesisContext({ alarm, streamReport, resourcesReport })`
3. Call OpenAI with `model: gpt-4o`, `temperature: 0`, `max_tokens: 300`
4. Parse JSON response: `{ recommendedAction, confidenceScore, explanation, errorCode }`
5. If GPT fails → fall back to `ruleBasedDecision()`

**Rule-based fallback logic (when GPT-4o unavailable):**
- `REDIS_DOWN` in resources → `ESCALATE` (90% confidence)
- `CI` affected or alarm type contains "AD" → `RESTART_CI` (78% confidence)
- `UH` affected → `RESTART_UH` (80% confidence)
- Default → `RESTART_UH` (65% confidence) — best first guess

---

#### `executeAction(incident, alarm, streamUrls): Promise<void>`
**The approval + restart execution loop.**

1. Get latest incident from store (may have been updated during investigation)
2. Get `clusterName` from `latest.clusterId` — **IMPORTANT: never use `streamUrls.clusterName` because G11 API always returns empty string for cluster**
3. Check `restartAttempts >= maxRestartAttempts (2)` → if so, `escalate()` and return
4. Decide action: attempt 0 → `RESTART_UH`, attempt 1 → `RESTART_CI`

**Approval flow:**
1. Set incident `state: 'WAITING_APPROVAL'`
2. Call `approvalService.waitForApproval(incidentId, action, details, timeoutSeconds)`
3. `Promise.race`: waits for human to click approve/reject in UI, OR timeout
4. If `rejected` → update incident `state: 'ESCALATED'`, return
5. If `timeout` → update incident `state: 'ESCALATED'` (permission required), return
6. If `approved` → proceed with restart

**RESTART_UH flow:**
1. Set `state: 'EXECUTING_ACTION'`
2. Call `hubMonitor.restartUH(clusterName, dsUuid)`
3. Increment `restartAttempts`
4. Set `state: 'MONITORING'`
5. Append to `actionHistory`: `{ action: 'RESTART_UH', executedAt, result, approvedBy }`
6. Wait `POST_RESTART_WAIT_MS` (30s)
7. Call `recheckAfterAction(incident, alarm, streamUrls, 'RESTART_UH')`
8. If restart throws → increment attempts, recurse into `executeAction` for CI

**RESTART_CI flow:** Same pattern but calls `hubMonitor.restartCI()`. If CI restart throws → `escalate()`.

---

#### `recheckAfterAction(incident, alarm, streamUrls, actionTaken): Promise<void>`
**Polls Hub Monitor to verify the restart resolved the alarm.**

1. Poll `getActiveAlarms()` up to `STABLE_CHECK_ATTEMPTS` (3) times
2. Each poll: check if this `dsUuid` is still in the active alarm list with `status: 'ON'`
3. If alarm is gone → `closeIncident(incident, 'Resolved by RESTART_UH')` and return
4. If alarm persists after all checks → log "trying next action" → recurse into `executeAction`
5. Wait `STABLE_CHECK_INTERVAL_MS` (30s) between checks

---

#### `escalate(incident, alarm): Promise<void>`
**Called when all automatic fixes have failed.**

1. Set `state: 'ESCALATED'`
2. Set `recommendedAction: 'ESCALATE'`
3. Append to `actionHistory`: `{ action: 'ESCALATE', result: 'All automatic restarts failed' }`
4. Logs warning for human visibility

---

#### `closeIncident(incident, resolution): Promise<void>`
**Marks incident as resolved and stores the memory pattern.**

1. Set `state: 'CLOSED'`
2. Set `resolvedAt` and `closedAt` to now
3. Call `store.upsertMemoryPattern()` with `patternType: 'restart_success'` and `successfulAction`
4. This ensures the AI "remembers" what worked for this channel

---

#### Alarm Tracking (private)
- `alarmOccurrences: Map<string, number[]>` — keyed by dsUuid, value is array of Unix timestamps
- `trackAlarmOccurrence(alarm)` — pushes `Date.now()` to the array for this dsUuid
- `countRecentAlarms(dsUuid, windowMs)` — filters array to only timestamps within `windowMs`, cleans stale ones, returns count

---

### 5.4 Agent 2: `ResourcesAnalyzerAgent` — Infrastructure Inspector

**File:** `src/agents/ResourcesAnalyzerAgent.ts`

**Role:** Fetch UH logs, CI logs, and Redis health in parallel, analyze for problems, return a structured report.

**Constructor:** `ResourcesAnalyzerAgent(hubMonitor: HubMonitorTool)`

---

#### `analyze(clusterName: string, dsUuid: string): Promise<ResourcesAnalysisReport>`
**Main entry point called by ManagerAgent.**

1. Use `Promise.allSettled([getUHLogs(), getCILogs(), getRedisResources()])` — parallel, non-blocking
2. If any fetch fails → log warning, use empty values (don't fail the whole investigation)
3. Extract errors from UH and CI logs via `extractErrors(logs)`
4. Check Redis health flags: `redisDown`, `highCpu` (>85%), `highMemory` (>90%)
5. Call `buildReport()` with all extracted data
6. Return `ResourcesAnalysisReport`

---

#### `buildReport(...)` — Priority-ordered analysis
**Priority order (highest to lowest):**

1. **Redis down** → `REDIS` / `REDIS_DOWN` / `critical` / confidence 92%
   - Impact: "Session state loss — all channels on this cluster may lose stream continuity"

2. **Both UH and CI errors** → `UH` / `POD_CRASH` / `high` / confidence 82%
   - Impact: "Both UH and CI pods degraded — manifest delivery and ad insertion broken"

3. **UH errors only** → `UH` / `POD_CRASH` / `high` / confidence 87%
   - Impact: "Manifest delivery broken — G-Mana stream likely returning 502/404"

4. **CI errors only** → `CI` / `POD_CRASH` / `medium` / confidence 82%
   - Impact: "Ad insertion broken — SCTE-35 markers missing from G-Mana output"

5. **High Redis memory** (>90%) → `REDIS` / `MEMORY_HIGH` / `medium` / confidence 75%
   - Impact: "Risk of key eviction — session state may become inconsistent"

6. **High Redis CPU** (>85%) → `REDIS` / `CPU_HIGH` / `low` / confidence 70%
   - Impact: "Possible latency increase — monitor for worsening"

7. **No issues found** → `NONE` / `NONE` / `low` / confidence 85%
   - Impact: "None — infrastructure appears healthy"

Reports with `confidenceScore < 80` are flagged with `flaggedForFurtherAnalysis: true`.

---

#### `extractErrors(logs: string): string[]`
**Scans log text for error indicators.**

Searches each line for: `ERROR`, `WARN`, `CrashLoop`, `OOMKilled`, `panic`
Returns last 10 matching lines (most recent errors are most relevant).

---

#### `ResourcesAnalysisReport` shape:
```typescript
{
  clusterName: string
  dsUuid: string
  uhLogs: { podName: string, logs: string }
  ciLogs: { podName: string, logs: string }
  redisResources: ClusterResources | null
  affectedComponent: 'UH' | 'CI' | 'REDIS' | 'NONE' | 'UNKNOWN'
  resourceIssueType: 'CPU_HIGH' | 'MEMORY_HIGH' | 'REDIS_DOWN' | 'POD_CRASH' | 'NONE' | 'UNKNOWN'
  severity: 'low' | 'medium' | 'high' | 'critical'
  possibleStreamImpact: string
  confidenceScore: number (0-100)
  flaggedForFurtherAnalysis: boolean
  details: string
}
```

---

### 5.5 Agent 3: `StreamAnalyzerAgent` — Stream Health Checker

**File:** `src/agents/StreamAnalyzerAgent.ts`

**Role:** Directly checks source vs G-Mana stream URLs to determine if the issue is on the source side or G-Mana side.

**Note:** Currently not fully active in the polling flow. The ManagerAgent uses the simpler source detection pattern (multiple channels on same source) instead of live URL checking. The StreamAnalyzerAgent is available for future use when direct URL checking is needed.

---

### 5.6 `SystemKnowledgeBase` — GPT-4o Prompts

**File:** `src/agents/SystemKnowledgeBase.ts`

**Role:** Central store of all system prompts and prompt builders used by agents when calling GPT-4o.

**Exports:**
- `getManagerSynthesisPrompt()` — Returns the system prompt telling GPT-4o what role it plays (senior G-Mana support engineer) and what JSON format to output
- `buildManagerSynthesisContext({ alarm, streamReport, resourcesReport })` — Builds the user message with all collected data formatted for GPT-4o consumption

The system prompt instructs GPT-4o to:
- Output strict JSON: `{ recommendedAction, confidenceScore, explanation, errorCode }`
- Valid actions: `RESTART_UH`, `RESTART_CI`, `ESCALATE`, `NOTIFY_CUSTOMER`
- Never recommend action without clear evidence (escalate if unsure)

---

### 5.7 Tool: `HubMonitorTool` — All External API Calls

**File:** `src/tools/HubMonitorTool.ts`

**Role:** Single class wrapping all HTTP calls to Hub Monitor API and G11 API.

**Constructor:** Creates two Axios instances:
- `hubClient` — `baseURL: HUB_MONITOR_BASE_URL`, header `x-api-key: support123`
- `g11Client` — `baseURL: G11_BASE_URL`, headers `Authorization: G11_AUTH_TOKEN`, `Login-As: null`

Both clients have `timeout: 15000ms`.

**Request interceptor on `hubClient`:** Logs every request as `[HubMonitor REQUEST] METHOD full-url` to console (for debugging).

All methods use `withRetry()` — exponential backoff (500ms → 1s → 2s → 4s → 8s cap), skips retry for 4xx errors.

---

#### `getActiveAlarms(): Promise<AlarmData[]>`
- `GET /sendalarms/status/alarms`
- Maps raw API response to `AlarmData[]`
- `AlarmData` shape: `{ dsUuid, channelName, status: 'ON'|'OFF', alarmUrl, errorType, reason, statusCode, startedAt, review }`

---

#### `getStreamUrls(dsUuid): Promise<StreamUrls>`
- `GET /api_v1/channel/get/{dsUuid}` (G11 API)
- Returns source player URL and G-Mana player URL
- `StreamUrls` shape: `{ sourcePlayerUrl, gManaPlayerUrl, streamType: 'HLS'|'DASH', customerName, clusterName }`
- **clusterName is always empty string** — G11 API does not return cluster info

---

#### `getStreamDetails(dsUuid): Promise<StreamDetails>`
- `GET /sendalarms/streams/{dsUuid}/details`
- Returns `{ clusterName, redisKey }` — this is where the actual cluster name comes from
- Used by ManagerAgent to populate `incident.clusterId`

---

#### `getRedisResources(cluster): Promise<ClusterResources>`
- `GET /sendalarms/clusters/{cluster}/redis-instances`
- Returns `ClusterResources` with array of Redis instances
- Each instance: `{ instanceName, isHealthy, cpuUsagePercent, usedMemoryBytes, maxMemoryBytes, connectedClients, restartCount }`

---

#### `getUHLogs(cluster, dsUuid): Promise<PodLogs>` — 2-step flow
**Step 1:** `GET /sendalarms/clusters/{cluster}/deployments/user-handler-{dsUuid}/pods`
- Extract `pods[0].name` (e.g. `user-handler-1ec914fd-...-75fc8b97cdlhn`)
- Throws if no pods found

**Step 2:** `GET /sendalarms/clusters/{cluster}/pods/{podName}/logs`
- Returns `PodLogs: { podName, logs: string }`

---

#### `getCILogs(cluster, dsUuid): Promise<PodLogs>` — 2-step flow
**Step 1:** `GET /sendalarms/clusters/{cluster}/deployments/cuemana-in-{dsUuid}/pods`
- Extract `pods[0].name`

**Step 2:** `GET /sendalarms/clusters/{cluster}/pods/{podName}/logs`
- Returns `PodLogs: { podName, logs: string }`

---

#### `restartUH(cluster, dsUuid): Promise<RestartResult>`
- `POST /sendalarms/clusters/{cluster}/deployments/user-handler-{dsUuid}/restart`
- Returns `RestartResult: { success, message, deploymentName, timestamp }`
- Logs full URL to console: `[HubMonitor restartUH] Full URL → ...`

---

#### `restartCI(cluster, dsUuid): Promise<RestartResult>`
- `POST /sendalarms/clusters/{cluster}/deployments/cuemana-in-{dsUuid}/restart`
- Returns `RestartResult: { success, message, deploymentName, timestamp }`

---

### 5.8 Tool: `JiraTool`

**File:** `src/tools/JiraTool.ts`

**Role:** Creates Jira tickets for escalated incidents.

**Methods:**
- `createTicket(incident)` — POST to Jira REST API to create ticket in `JIRA_PROJECT_KEY`
- Returns `{ ticketId, ticketKey, url }`
- Ticket includes: channel name, dsUuid, cluster, error code, explanation, logs excerpt, recommended action

---

### 5.9 Tool: `ErrorDetectionPlayerTool`

**File:** `src/tools/ErrorDetectionPlayerTool.ts`

**Role:** Placeholder for stream URL health checking. Currently does basic HTTP HEAD requests to check if a URL is reachable. Designed to be replaced with a full HLS/DASH player that detects actual playback errors (manifest parse errors, segment 404s, codec issues).

---

### 5.10 Service: `ApprovalService`

**File:** `src/services/ApprovalService.ts`

**Role:** Manages human-in-the-loop approval using `Promise.race`.

#### `waitForApproval(incidentId, proposedAction, actionDetails, timeoutSeconds): Promise<ApprovalResult>`

1. Create approval record in store with `decision: 'pending'`
2. Set `pendingApprovals.set(incidentId, resolver)` — stores the resolve function
3. Start a `Promise.race` between:
   - **Human approval promise** — resolves when support agent clicks approve/reject in UI
   - **Timeout promise** — resolves after `timeoutSeconds` with `decision: 'timeout'`
4. Return `{ decision: 'approved'|'rejected'|'timeout', decidedBy }`
5. Clean up: delete from `pendingApprovals` map

#### `resolveApproval(incidentId, decision, decidedBy): boolean`
- Called by the approval route when support agent submits decision
- Finds the pending promise resolver for this incident
- Calls it with `{ decision, decidedBy }` — this resolves the `Promise.race`
- Returns `true` if found, `false` if no pending approval

#### `hasPendingApproval(incidentId): boolean`
- Returns whether this incident has an outstanding approval request

---

### 5.11 Service: `RedisEventBus`

**File:** `src/services/RedisEventBus.ts`

**Role:** Pub/Sub event bus built on ioredis. Allows future decoupling of notification handlers (WhatsApp, email, Slack) from the core ManagerAgent logic.

**Event types:**
- `alarm:new` — new alarm detected
- `alarm:cleared` — alarm turned off
- `incident:created` — new incident opened
- `incident:state_changed` — incident state transition
- `approval:received` — human submitted approval decision
- `incident:escalated` — escalation triggered

**Current status:** Infrastructure is ready but not fully connected. Future WhatsApp and email handlers will subscribe to these events.

---

### 5.12 Store: `InMemoryStore`

**File:** `src/store/InMemoryStore.ts`

**Role:** Single source of truth for all runtime data. Uses JavaScript `Map` for O(1) lookups. No database required for development.

**Data collections:**

| Collection | Type | Purpose |
|------------|------|---------|
| `incidents` | `Map<string, Incident>` | Full incident lifecycle |
| `approvals` | `Map<string, Approval>` | Pending and decided approvals |
| `actionLogs` | `Map<string, ActionLog>` | Audit trail of all actions |
| `memoryPatterns` | `Map<string, MemoryPattern>` | AI memory — what worked before |
| `escalationLogs` | `Map<string, EscalationLog>` | Escalation notification history |

**Key design decisions:**
- Singleton: `export const store = new InMemoryStore()` — imported everywhere
- Thread safe: Node.js is single-threaded, no locking needed
- Swappable: Every method signature matches what a Mongoose call would look like — swap to MongoDB by replacing method bodies only
- Optional file persistence: Set `STORE_PERSIST_PATH=/tmp/gmana-store.json` to survive restarts

---

#### Incident methods:
- `createIncident(data)` → generates UUID, sets `createdAt/updatedAt`, stores in map
- `updateIncident(id, updates)` → merges updates, bumps `updatedAt`
- `getIncident(id)` → O(1) lookup by `_id`
- `findIncidents(filter)` → filter function over all incidents
- `findOneIncident(filter)` → most recently created match
- `getAllIncidents({ state?, limit?, page? })` → sorted newest-first with pagination

#### Approval methods:
- `createApproval(data)` → creates pending approval
- `resolveApproval(incidentId, decision, decidedBy)` → marks pending approval as decided
- `getPendingApproval(incidentId)` → find current pending approval
- `getApprovalHistory(incidentId)` → all approvals ever for this incident

#### Action log methods:
- `logAction(data)` → append action audit entry
- `getActionLogs(incidentId)` → all logs for incident, oldest first

#### Memory pattern methods:
- `upsertMemoryPattern(data)` → insert new or increment `occurrences` if pattern key exists
- `findMemoryPatterns({ dsUuid?, clusterId?, customerId?, patternType? })` → filtered patterns, newest first

#### Escalation log methods:
- `logEscalation(data)` → record escalation notification
- `getEscalations(incidentId)` → all escalations for incident

#### Utility methods:
- `getFullIncident(id)` → `{ incident, approvals, actionLogs, escalations, memoryPatterns }` — used by detail API route
- `getStats()` → count of each collection — used by health/debug routes
- `clear()` → wipe all data + delete persist file

---

#### `Incident` type fields:
```typescript
_id: string                    // Auto UUID
dsUuid: string                 // Stream Data Source UUID
channelName: string            // Human-readable channel name (e.g. "Keshet 12")
clusterId: string              // Kubernetes cluster (e.g. "hub1x")
redisInstance: string          // Redis key (e.g. "Am")
streamType: 'HLS' | 'DASH'
isVip: boolean                 // True if channel name contains 'keshet' or 'reshet'
customerId: string             // Customer name from G11
state: IncidentState           // Current state machine state
reportedBy: 'HubMonitor' | 'WhatsApp' | 'Email' | 'Support'
confidenceScore: number        // 0-100 from GPT-4o
recommendedAction: string      // RESTART_UH | RESTART_CI | ESCALATE | NOTIFY_CUSTOMER
explanation: string            // Human-readable decision explanation
errorCode: string              // Alarm error type from Hub Monitor
jiraTicketId: string
jiraTicketKey: string
gManaPlayerUrl: string         // The G-Mana stream URL viewers use
sourcePlayerUrl: string        // The upstream source URL
streamAnalysis: object         // Stream investigation data
resourceAnalysis: object       // Infrastructure analysis data from ResourcesAnalyzerAgent
playerAnalysis: object         // Player error detection data
actionHistory: ActionHistoryEntry[]  // All restarts attempted
restartAttempts: number        // How many restarts tried so far
maxRestartAttempts: number     // Default: 2
statusLabel: string            // Human-readable current status
resolvedAt?: Date
closedAt?: Date
createdAt: Date
updatedAt: Date
```

---

### 5.13 State Machine: `IncidentStateMachine`

**File:** `src/stateMachine/IncidentStateMachine.ts`

**9 States:**

| State | Meaning |
|-------|---------|
| `NEW` | Alarm detected, tracking started — below threshold |
| `ANALYZING` | Full investigation running — fetching logs, Redis, synthesizing |
| `WAITING_APPROVAL` | Decision made, waiting for human to approve/reject restart |
| `EXECUTING_ACTION` | Restart command sent to Hub Monitor |
| `MONITORING` | Restart done, polling to verify alarm cleared |
| `RESOLVED` | Alarm cleared — either auto or manual (e.g. source issue resolution) |
| `CLOSED` | Incident fully closed after successful restart verification |
| `ESCALATED` | All automatic fixes failed, or approval rejected/timed out |
| `FAILED` | System error during processing |

**Valid transitions:**
```
NEW → ANALYZING
NEW → RESOLVED
ANALYZING → WAITING_APPROVAL
ANALYZING → ESCALATED
ANALYZING → RESOLVED
WAITING_APPROVAL → EXECUTING_ACTION
WAITING_APPROVAL → ESCALATED
EXECUTING_ACTION → MONITORING
EXECUTING_ACTION → ESCALATED
MONITORING → RESOLVED
MONITORING → CLOSED
MONITORING → EXECUTING_ACTION  (retry loop)
RESOLVED → CLOSED
ESCALATED → CLOSED
FAILED → CLOSED
```

---

### 5.14 Routes

#### `src/routes/incidents.ts`

| Method | Path | Handler |
|--------|------|---------|
| GET | `/api/incidents` | List all incidents. Query: `state`, `page`, `limit`. Returns `{ incidents, total, page }` |
| GET | `/api/incidents/filter/active` | Non-terminal incidents only (not CLOSED/RESOLVED/FAILED) |
| GET | `/api/incidents/:id` | Full incident detail with approvals, actionLogs, escalations, memoryPatterns |
| GET | `/api/incidents/debug/stats` | Store statistics (counts of each collection) |
| GET | `/api/incidents/:id/logs/uh` | Fetch UH pod logs via HubMonitorTool. Returns `{ podName, logs }` |
| GET | `/api/incidents/:id/logs/ci` | Fetch CI pod logs via HubMonitorTool. Returns `{ podName, logs }` |
| POST | `/api/incidents/:id/restart/uh` | Manually trigger UH restart. Logs full URL to terminal. |
| POST | `/api/incidents/:id/restart/ci` | Manually trigger CI restart. |

**Helper functions:**
- `getHubMonitor(req)` — reads `hubMonitor` from `app.get('hubMonitor')`
- `getIncidentOrFail(id, res)` — returns incident or sends 404/400

#### `src/routes/approvals.ts`

| Method | Path | Handler |
|--------|------|---------|
| POST | `/api/approve/:incidentId` | Body: `{ decision: 'approved'|'rejected', decidedBy: string }`. Calls `approvalService.resolveApproval()`. Returns 404 if no pending approval. |
| GET | `/api/approve/:incidentId/status` | Returns `{ pending: bool, proposedAction, timeoutSeconds, createdAt }` |

#### `src/routes/alarms.ts`

| Method | Path | Handler |
|--------|------|---------|
| POST | `/api/alarms/manual` | Body: `{ dsUuid }`. Finds or creates incident then calls `runFullInvestigation` via ManagerAgent. Used for testing. |

#### `src/routes/redis.ts`

| Method | Path | Handler |
|--------|------|---------|
| GET | `/api/redis` | Fetches Redis health for all known clusters. Returns per-cluster instance health. |

---

### 5.15 Utils

#### `src/utils/logger.ts`
Winston logger with:
- Console transport (colored, timestamped)
- File transport: `logs/error.log` (errors only)
- File transport: `logs/combined.log` (all levels)
- Log level: `info` in production, `debug` in development

#### `src/utils/retry.ts`
`withRetry(fn, label, maxRetries=3): Promise<T>`
- Exponential backoff: 500ms, 1s, 2s, 4s, 8s (capped)
- Skips retry for 4xx HTTP errors (they are not transient)
- Logs each retry attempt with the label

`sleep(ms): Promise<void>` — used throughout agents for waiting between polls

#### `src/utils/validators.ts`
- `isValidUuid(str)` — validates UUID v4 format
- `isValidCluster(str)` — checks against known clusters: `hub1x`, `hub21`, `hub3x`, `hub4x`
- `isValidRedisInstance(str)` — checks against `Am`, `Bm`, `Cm`

---

## 6. Frontend — Full Detail

### 6.1 `src/store/incidents.ts` — Pinia Store

**Role:** Central state management for all incident data. Polls backend, tracks alarm history, handles approvals.

**State:**
```typescript
incidents: Incident[]          // All incidents from last fetch
alarmHistory: Incident[]       // Incidents that disappeared from active list
trackedActiveIds: Set<string>  // IDs of last known active incidents (for history detection)
selectedIncident: IncidentDetail | null  // Currently viewed incident detail
loading: boolean
error: string | null
total: number
currentPage: number
pendingApprovalId: string | null
```

**Computed:**
- `activeIncidents` — filters `incidents` for non-terminal states
- `vipIncidents` — filters for `isVip === true`
- `awaitingApproval` — filters for `state === 'WAITING_APPROVAL'`

---

#### `fetchIncidents(page?, limit?)`
1. GET `/api/incidents?page=N&limit=N`
2. Call `_syncHistory(newIncidents)` to detect any incidents that vanished
3. Update `incidents`, `total`, `currentPage`

#### `_syncHistory(newIncidents)`
**Alarm history detection — runs on every poll.**

1. Build `newIds` set from new incident list
2. For every ID in `trackedActiveIds`:
   - If not in `newIds` AND not already in `alarmHistory` → this incident disappeared → push to `alarmHistory`
3. Update `trackedActiveIds` with new active incident IDs (non-terminal states only)

This is how "Alarm History" in the sidebar gets populated — incidents that were active but disappeared from the Hub Monitor (resolved externally, or timed out).

#### `fetchIncidentDetail(id)`
- GET `/api/incidents/:id`
- Sets `selectedIncident` with full detail (incident + approvals + logs + escalations + memory patterns)

#### `submitApproval(incidentId, decision, decidedBy)`
- POST `/api/approve/:incidentId`
- Body: `{ decision, decidedBy }`
- On success: re-fetch incident detail to update UI

#### `triggerManualAlarm(dsUuid)`
- POST `/api/alarms/manual`
- Body: `{ dsUuid }`
- Used in dashboard for testing/manual investigation

#### Auto-refresh
- `setInterval(fetchIncidents, 10000)` — every 10s (also runs in `App.vue`)

---

### 6.2 `src/store/redis.ts` — Pinia Store

**Role:** Tracks Redis cluster health for the RedisPanel in the topbar.

**State:**
- `clusters: ClusterHealth[]` — per-cluster Redis instance health
- `loading: boolean`
- `lastUpdated: Date | null`

**Computed:**
- `totalUnhealthy` — count of unhealthy instances across all clusters
- `isInstanceHealthy(cluster, instanceName)` — lookup function for specific instance

**Actions:**
- `fetchRedisHealth()` — GET `/api/redis`, updates clusters
- Auto-polls every 30s in `App.vue`

---

### 6.3 View: `DashboardView.vue`

**Layout:**
```
┌─────────────────────────────────────────────────────┐
│  TOPBAR: G-Mana Support AI | KPIs | RedisPanel | ●  │
├──────────────┬──────────────────────────────────────┤
│              │  Manual trigger input                 │
│  SIDEBAR     │  ─────────────────────────────────── │
│              │  Filter tabs: All/Active/Approval/VIP │
│  ⚡ Active   │  ─────────────────────────────────── │
│  Alarms (N)  │  IncidentCard                        │
│              │  IncidentCard                        │
│  🕐 History  │  IncidentCard                        │
│  (N)         │  ...                                 │
│              │  ─────────────────────────────────── │
│              │  Pagination                           │
└──────────────┴──────────────────────────────────────┘
```

**Topbar KPI badges:**
- Active Incidents (count of non-terminal)
- Awaiting Approval (count of WAITING_APPROVAL)
- VIP Channels (count of VIP incidents)
- Live indicator (blinking green dot)

**Sidebar:**
- `currentView` ref: `'active'` or `'history'`
- Active Alarms: shows current non-terminal incidents
- Alarm History: shows `store.alarmHistory` (incidents that disappeared from polling)

**Manual trigger:**
- Input field for ds_uuid
- Button calls `store.triggerManualAlarm(dsUuid)`
- Shows loading state, success/error feedback

**Filter tabs:**
- All, Active (non-terminal), Awaiting Approval, VIP
- Updates `currentFilter` ref which filters the displayed incident list

**Auto-refresh:** `setInterval(store.fetchIncidents, 10000)` — every 10s, cleaned up on unmount.

---

### 6.4 View: `IncidentDetailView.vue`

**Route:** `/incidents/:id`

**Layout:**
```
┌────────────────────────────────────────────────────────────────┐
│  ← Back  |  Channel Name  [VIP]  [STATE]  [Refresh]           │
├─────────────────────────────┬──────────────────────────────────┤
│  LEFT PANEL                 │  RIGHT PANEL                     │
│                             │                                  │
│  Metadata grid:             │  ApprovalTimer (if WAITING)      │
│  - UUID, Cluster, Redis     │  ────────────────────────────    │
│  - Stream type, Error code  │  RestartWorkflow                 │
│  - Confidence, Action       │  - UH: Download Logs → Restart  │
│  - Explanation              │  - 60s countdown                 │
│                             │  - CI: Download Logs → Restart   │
│  HLS Players:               │  ────────────────────────────    │
│  - Source stream            │  Timeline (actionHistory)        │
│  - G-Mana stream            │  ────────────────────────────    │
│                             │  Approval history                │
│  Draft customer message     │  ────────────────────────────    │
│  (email / WhatsApp)         │  Escalation history              │
└─────────────────────────────┴──────────────────────────────────┘
```

**Auto-refresh:** Fetches incident detail every 15s when on this page.

---

### 6.5 Component: `IncidentCard.vue`

**Props:** `incident: Incident`

**Displays:**
- State dot: colored by state, blinks if `WAITING_APPROVAL`
- Channel name (bold) + VIP badge (gold) + state badge (color-coded)
- Approval badge if `WAITING_APPROVAL` state
- `dsUuid` truncated, cluster ID, Redis instance, stream type
- Error code badge
- `statusLabel` (human-readable current status)
- `recommendedAction` with confidence percentage
- Time ago (e.g. "5 min ago") + who reported it
- Jira ticket key (if exists)

**Click:** Navigates to `/incidents/:id`

**State color mapping:**
- `NEW` → gray
- `ANALYZING` → blue (pulsing)
- `WAITING_APPROVAL` → yellow (blinking)
- `EXECUTING_ACTION` → orange
- `MONITORING` → purple
- `RESOLVED` → green
- `CLOSED` → dark green
- `ESCALATED` → red
- `FAILED` → dark red

---

### 6.6 Component: `ApprovalTimer.vue`

**Props:** `incidentId: string`, `proposedAction: string`, `timeoutSeconds: number`, `explanation: string`

**Functionality:**
- Shows countdown timer (decrements every second)
- Progress bar: `remainingSeconds / timeoutSeconds * 100%`
- When `remainingSeconds < 30` → switches to "urgent" red styling
- Two buttons: **Approve** and **Reject**
- Name input field for `decidedBy`
- On approve/reject: calls `store.submitApproval(incidentId, decision, name)`
- Buttons disabled after decision made

---

### 6.7 Component: `TimelineItem.vue`

**Props:** `entry: ActionHistoryEntry`, `isLast: boolean`

**Displays:**
- Colored dot (color by action type: restart=orange, escalate=red, close=green)
- Vertical connector line between items (hidden on last item)
- Action name, formatted timestamp (`executedAt`)
- Result text
- `approvedBy` if present

---

### 6.8 Component: `RestartWorkflow.vue`

**Props:** `incidentId: string`, `dsUuid: string`, `clusterId: string`

**UH Section:**
- "Download UH Logs" button → GET `/api/incidents/:id/logs/uh` → triggers browser file download as `uh-{uuid}-logs.txt`
- "Restart UH" button → POST `/api/incidents/:id/restart/uh`
- After UH restart success: 60-second countdown bar appears, CI section unlocks after countdown

**CI Section:**
- Locked until UH succeeds + countdown completes
- "Download CI Logs" button → GET `/api/incidents/:id/logs/ci` → downloads `ci-{uuid}-logs.txt`
- "Restart CI" button → POST `/api/incidents/:id/restart/ci`

**States tracked per section:** `idle` | `fetching-logs` | `restarting` | `done` | `error`

**Visual feedback:** Inline status messages, progress spinner, lock icon on CI until unlocked.

---

### 6.9 Component: `HlsPlayer.vue`

**Props:** `url: string`, `label: string`

Uses `hls.js` library to play HLS streams directly in the browser.
- Native HLS fallback for Safari (which supports it natively via `<video>`)
- Shows error state if stream is unreachable or returns errors
- Used in IncidentDetailView to compare source vs G-Mana stream side by side

---

### 6.10 Component: `RedisPanel.vue`

**Location:** Top right of dashboard topbar

**Functionality:**
- Toggle button showing health dot + count of unhealthy instances
- Click to expand dropdown panel
- Lists all clusters (`hub1x`, `hub21`, `hub3x`, `hub4x`)
- Each cluster expandable to show instance list
- Each instance: name, CPU%, memory%, connection count, restart count, health badge
- Green dot = healthy, red dot = unhealthy
- Auto-updates from `store/redis.ts` which polls every 30s

---

### 6.11 Composable: `useToast.ts`

**Status:** Created but not fully wired — `ToastContainer.vue` not yet created, not added to `App.vue`.

**API:**
```typescript
const { toasts, show, remove } = useToast()
show('success' | 'error' | 'warning' | 'info', title, message, durationMs?)
remove(id)
```

Auto-dismisses after 4 seconds (default).

---

### 6.12 Router: `src/router/index.ts`

```
/                    → DashboardView
/incidents/:id       → IncidentDetailView
```

---

### 6.13 API: `src/api/axios.ts`

Axios instance configured with:
- `baseURL: VITE_API_URL || 'http://localhost:3000/api'`
- `timeout: 30000`
- `Content-Type: application/json`
- Response interceptor: logs errors

---

### 6.14 API: `src/api/restart.ts`

```typescript
fetchUHLogs(incidentId)           // GET /incidents/:id/logs/uh
fetchCILogs(incidentId)           // GET /incidents/:id/logs/ci
restartUH(incidentId)             // POST /incidents/:id/restart/uh
restartCI(incidentId)             // POST /incidents/:id/restart/ci
downloadTextFile(content, name)   // Creates Blob, triggers browser download via hidden <a>
```

---

## 7. Environment Variables — Complete Reference

```env
# ── Server ───────────────────────────────────────────────────────────────────
PORT=3000                              # HTTP server port
NODE_ENV=development                   # 'development' or 'production'
FRONTEND_URL=http://localhost:5173     # CORS origin

# ── Hub Monitor API ───────────────────────────────────────────────────────────
HUB_MONITOR_BASE_URL=https://hub-monitor.g-mana.live
HUB_MONITOR_API_KEY=support123         # Sent as x-api-key header

# Path overrides (optional — defaults are correct for current Hub Monitor API)
HUB_ALARMS_PATH=/sendalarms/status/alarms
HUB_STREAM_DETAILS_PATH=/sendalarms/streams/{uuid}/details
HUB_REDIS_PATH=/sendalarms/clusters/{cluster}/redis-instances
HUB_UH_RESTART_PATH=/sendalarms/clusters/{cluster}/deployments/user-handler-{uuid}/restart
HUB_CI_RESTART_PATH=/sendalarms/clusters/{cluster}/deployments/cuemana-in-{uuid}/restart

# ── G11 Channel API ───────────────────────────────────────────────────────────
G11_BASE_URL=https://g11.g-mana.live
G11_AUTH_TOKEN=Bearer eyJ...           # Full Authorization header value
G11_CHANNEL_PATH=/api_v1/channel/get/{uuid}

# ── Polling & Alarm Gate Logic ────────────────────────────────────────────────
POLL_INTERVAL_MS=30000                 # How often to check Hub Monitor (30s)
ALARM_REPEAT_WINDOW_MS=3600000         # Window to count repeat alarms (60 min)
ALARM_REPEAT_THRESHOLD=3               # Alarms in window before investigating
DEFAULT_WAITING_TIME_SECONDS=60        # Min alarm age before acting

# ── Approval ──────────────────────────────────────────────────────────────────
APPROVAL_TIMEOUT_SECONDS=100           # Seconds to wait for human approval
                                       # On timeout: escalate (NOT auto-execute)

# ── OpenAI ────────────────────────────────────────────────────────────────────
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o

# ── Jira (optional) ───────────────────────────────────────────────────────────
JIRA_BASE_URL=https://your-org.atlassian.net
JIRA_EMAIL=support@g-mana.com
JIRA_API_TOKEN=ATATxxxxxxxx
JIRA_PROJECT_KEY=GMANA

# ── Store Persistence (optional) ─────────────────────────────────────────────
STORE_PERSIST_PATH=/tmp/gmana-store.json   # Leave empty to disable

# ── Redis Event Bus (optional) ────────────────────────────────────────────────
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
```

**Frontend `.env`:**
```env
VITE_API_URL=http://localhost:3000/api
```

---

## 8. Data Flow — End to End

### Scenario A: G-Mana Stream Breaks (Normal Case)

```
T+0s   Hub Monitor fires alarm: dsUuid=abc, status=ON, errorType=NO_CONTENT
T+30s  Backend polls → getActiveAlarms() returns alarm
       detectSourceIssues() → only 1 channel on this source → NOT a source issue
       trackAlarmOccurrence('abc') → alarmOccurrences['abc'] = [T+30s]
       countRecentAlarms('abc', 60min) = 1 → below threshold (need 3)
       createIncident({ state: 'NEW', statusLabel: 'Watching — 1/3 alarms' })
T+60s  Second poll → alarm still ON
       countRecentAlarms = 2 → still below threshold, update label
T+90s  Third poll → alarm still ON
       countRecentAlarms = 3 → threshold met!
       alarmAge = 90s → exceeds DEFAULT_WAITING_TIME_SECONDS (60s) ✓
       → runFullInvestigation()

STEP 1: getStreamUrls('abc') + getStreamDetails('abc')
        → sourcePlayerUrl, gManaPlayerUrl, clusterName='hub1x', redisKey='Am'

STEP 2: resourcesAnalyzer.analyze('hub1x', 'abc')
        → getUHLogs() [2-step: get pods → get logs]
        → getCILogs() [2-step: get pods → get logs]
        → getRedisResources('hub1x')
        → extractErrors(uhLogs) → ["ERROR: connection refused to redis"]
        → buildReport() → affectedComponent='UH', severity='high', confidence=87%

        store.updateIncident({ state: 'ANALYZING', resourceAnalysis: {...} })

STEP 3: synthesizeReports() → GPT-4o
        Input: alarm(errorType='NO_CONTENT') + resourcesReport(UH errors)
        Output: { recommendedAction: 'RESTART_UH', confidenceScore: 87, explanation: '...' }

        store.updateIncident({ recommendedAction: 'RESTART_UH', confidenceScore: 87 })

STEP 5: executeAction()
        → restartAttempts=0 → action='RESTART_UH'
        → store.updateIncident({ state: 'WAITING_APPROVAL' })
        → approvalService.waitForApproval(incidentId, 'RESTART_UH', ..., 100)

        [UI shows ApprovalTimer with 100s countdown]
        [Support agent clicks Approve]

        → approval.decision = 'approved'
        → store.updateIncident({ state: 'EXECUTING_ACTION' })
        → hubMonitor.restartUH('hub1x', 'abc')
        → store.updateIncident({ state: 'MONITORING', restartAttempts: 1 })
        → sleep(30s)

STEP 7: recheckAfterAction()
        → getActiveAlarms() → 'abc' not in active list → alarm cleared!
        → closeIncident('Resolved by RESTART_UH')
        → store.upsertMemoryPattern({ patternType: 'restart_success', successfulAction: 'RESTART_UH' })
        → store.updateIncident({ state: 'CLOSED', resolvedAt: now, closedAt: now })
```

### Scenario B: Source Is Down (Multiple Channels)

```
T+0s   Hub Monitor fires alarms for 5 channels:
       all have alarmUrl = "https://encoder.customer.com/stream.m3u8"
       all startedAt within 30 seconds of each other

T+30s  Backend polls → 5 alarms returned
       detectSourceIssues():
       - Groups by alarmUrl → group of 5 channels
       - timeSpread = max(startedAt) - min(startedAt) = 30s ≤ 60s
       - SOURCE ISSUE detected
       - All 5 dsUuids added to sourceDownUuids

       For each alarm → handleSourceAlarm():
       - state: 'RESOLVED', errorCode: 'SOURCE_DOWN'
       - explanation: "Source stream is down. Check encoder/CDN."
       - recommendedAction: 'NOTIFY_CUSTOMER'
       - NO restart triggered
```

### Scenario C: Approval Times Out

```
executeAction() → WAITING_APPROVAL
approvalService.waitForApproval(..., timeoutSeconds=100)
→ Promise.race: [human promise, setTimeout(100s)]
→ setTimeout wins after 100s
→ decision = 'timeout'
→ store.updateIncident({ state: 'ESCALATED', statusLabel: 'Escalated — approval timed out' })
→ No restart attempted — manual intervention required
```

### Scenario D: UH Restart Doesn't Fix It

```
RESTART_UH → sleep(30s) → recheckAfterAction()
→ getActiveAlarms() check 1: still active
→ sleep(30s) → check 2: still active
→ sleep(30s) → check 3: still active
→ executeAction(incident with restartAttempts=1)
→ action = 'RESTART_CI' (restartAttempts=1, not 0)
→ WAITING_APPROVAL again
→ [support agent approves]
→ restartCI() → sleep(30s) → recheckAfterAction()
→ [alarm cleared] → CLOSED
```

---

## 9. Development Setup

### Prerequisites
- Node.js 20+
- npm

### Backend
```bash
cd backend
npm install
cp .env.example .env   # fill in values
npm run dev            # starts nodemon on port 3000, debugger on 9229
```

### Frontend
```bash
cd frontend
npm install
cp .env.example .env.local
npm run dev            # starts Vite on port 5173
```

### nodemon config (`backend/nodemon.json`):
```json
{
  "watch": ["src"],
  "ext": "ts",
  "ignore": ["src/**/*.spec.ts"],
  "exec": "node --inspect=9229 -r ts-node/register src/index.ts"
}
```

### VS Code debugging (`.vscode/launch.json`):
- **Launch Backend** — runs directly with ts-node (no nodemon)
- **Attach to Nodemon** — attaches debugger to port 9229 (use with `npm run dev`), `restart: true` so it reconnects on file change

---

## 10. Repository

**GitHub:** https://github.com/SamipyaG/Support_agent.git

**Branch:** `main`

**What is NOT committed (`.gitignore`):**
- `backend/.env` — API keys
- `frontend/.env*` — API URL config
- `node_modules/` (all locations)
- `dist/`, `logs/`, `*.log`
- `.DS_Store`

---

## 11. What Is Done (Current State)

### Backend ✅
- [x] Express + TypeScript + nodemon dev setup
- [x] HubMonitorTool — all 8 API methods with 2-step pod log flow
- [x] Auth: `x-api-key: support123` replacing Cookie
- [x] ManagerAgent — full 7-step orchestration
- [x] ResourcesAnalyzerAgent — UH/CI/Redis health analysis
- [x] StreamAnalyzerAgent — stream comparison (not active in main flow)
- [x] SystemKnowledgeBase — all GPT-4o prompts
- [x] ApprovalService — Promise.race human approval with timeout
- [x] InMemoryStore — all 5 collections, optional file persistence
- [x] IncidentStateMachine — 9 states with enforced transitions
- [x] All 4 route files with 12 endpoints
- [x] JiraTool, ErrorDetectionPlayerTool
- [x] Winston logger, retry with exponential backoff, validators

### Frontend ✅
- [x] Vue 3 + Pinia + Vue Router + Vite
- [x] DashboardView — sidebar, filters, KPIs, manual trigger, pagination
- [x] IncidentDetailView — full detail with restart workflow
- [x] All 6 components (IncidentCard, ApprovalTimer, TimelineItem, RestartWorkflow, HlsPlayer, RedisPanel)
- [x] Alarm history tracking in Pinia (`_syncHistory`)
- [x] `useToast` composable (created, not wired to UI yet)

### Infrastructure ✅
- [x] `.gitignore` covers all `.env` files
- [x] Pushed to GitHub
- [x] VS Code launch.json for debugging

---

## 12. What Needs to Be Built (Next Up)

### Priority 1 — Toast Notifications
The `useToast.ts` composable exists. Still needed:
- [ ] Create `frontend/src/components/ToastContainer.vue` — fixed position, stacked toasts, auto-dismiss
- [ ] Add `<ToastContainer />` to `App.vue`
- [ ] Call `toast.show('success', 'UH Restarted', 'user-handler restarted successfully')` in `RestartWorkflow.vue` on success
- [ ] Call `toast.show('error', 'Restart Failed', errorMessage)` on failure

### Priority 2 — Log Download in Browser
- [ ] In `RestartWorkflow.vue`, after `fetchUHLogs()` response, call `downloadTextFile(logs, 'uh-{uuid}-logs.txt')`
- [ ] Same for CI logs

### Priority 3 — Approval UI Polish
- [ ] Show who approved and when in the timeline
- [ ] Disable approve/reject buttons immediately after click (prevent double-submit)

### Priority 4 — Incident Detail Tabs
- [ ] Reorganize `IncidentDetailView.vue` into tabs: Overview / Logs / Resources / Timeline / Restart

### Priority 5 — Backend Store Persistence
- [ ] Implement `STORE_PERSIST_PATH` — save/load store to JSON file on startup/shutdown
- [ ] Prevents history loss on backend restart

### Priority 6 — Polling Status API
- [ ] `GET /api/status` → `{ lastPollAt, pollIntervalMs, activeAlarmCount, backendUptime, storeStats }`
- [ ] Show in dashboard topbar

### Priority 7 — Docker for Production
- [ ] Add `backend/.env.example` and `frontend/.env.example`
- [ ] Update `docker-compose.yml` with proper env_file and restart policies
- [ ] Add `healthcheck` endpoint with more detail

---

## 13. Known Bugs Fixed

| Bug | Root Cause | Fix Applied |
|-----|-----------|-------------|
| 502 on UH restart | Path typo: `userhandler-{uuid}` instead of `user-handler-{uuid}` | Fixed `.env` and `HubMonitorTool.ts` fallback default |
| Cluster always empty in auto-restart | `executeAction()` used `streamUrls.clusterName` which G11 API always returns as `''` | Fixed to use `latest.clusterId` from store (set by `getStreamDetails()`) |
| Backend crash on startup | `index.ts` required `HUB_MONITOR_COOKIE` env var after we switched to API key | Removed `HUB_MONITOR_COOKIE` from required vars list |
| Backend subfolder not on GitHub | `backend/` had its own `.git` (nested repo), treated as git submodule | Removed `backend/.git`, re-staged as regular files |
| Log download getting wrong pod | Old code tried to guess pod name from UUID | Fixed to 2-step: get pods list first, then use actual pod name |
