# ManagerAgent

**File:** `backend/src/agents/ManagerAgent.ts`
**Status:** ACTIVE
**Type:** Orchestrator (calls GPT-4o, writes all incident state, executes all actions)

---

## Role

Central coordinator. The ONLY agent that calls GPT-4o.
The ONLY agent that writes incident state to InMemoryStore.
The ONLY agent that calls HubMonitorTool for restarts.
All agents communicate ONLY through the ManagerAgent.

---

## Communication In

| Source                  | Data                                                          |
|-------------------------|---------------------------------------------------------------|
| Hub Monitor polling     | `AlarmData[] { dsUuid, channelName, status, errorType, reason }` |
| StreamAnalyzerAgent     | `StreamAnalysisReport` (includes ds_uuid, urls, cluster)     |
| ResourcesAnalyzerAgent  | `ResourcesAnalysisReport`                                    |
| PlayerAnalyzerAgent (future) | `PlayerAnalyzerReport`                                    |
| ApprovalService         | `{ decision: "approved"|"rejected"|"timeout", decidedBy }`  |
| SenderAgent (future)    | `MessageDraft` for review                                    |

---

## What It Distributes

| To                      | Data                                                          |
|-------------------------|---------------------------------------------------------------|
| StreamAnalyzerAgent     | alarm data + streamUrls                                       |
| ResourcesAnalyzerAgent  | clusterName + dsUuid (from StreamAnalysisReport)             |
| PlayerAnalyzerAgent      | sourceUrl + gManaUrl (future)                                |
| GPT-4o                  | `getManagerSynthesisPrompt()` + `buildManagerSynthesisContext()` |
| ApprovalService         | `waitForApproval(incidentId, action, context, timeout)`      |
| HubMonitorTool          | `restartUH(cluster, dsUuid)` / `restartCI(cluster, dsUuid)` |
| InMemoryStore           | `createIncident()` / `updateIncident()` at every state change |
| SenderAgent (future)    | situation + incidentContext for message draft                 |

---

## Full Step-by-Step Flow

### Step 1 — THRESHOLD CHECK
- Tracks alarm count in the last 60 min for this `dsUuid`
- `count < 3` → create incident `state=NEW`, watch
- `count >= 3` AND `age < waitingTime` → update label, wait
- `count >= 3` AND `age >= waitingTime` → full investigation

### Step 2 — TRIGGER STREAM ANALYZER
- Calls `streamAnalyzer.analyze(alarm, streamUrls)`
- Receives `StreamAnalysisReport`

### Step 3 — EARLY EXIT CHECK
- Reads `rootCauseAssumption` from StreamAnalysisReport
- `SOURCE_ISSUE` → notify customer, STOP (do not restart pods)
- `NO_ISSUE`     → alarm was transient, STOP

### Step 4 — DISTRIBUTE DATA TO ANALYSIS AGENTS
- Extracts from StreamAnalysisReport: `clusterName`, `dsUuid`
- Calls: `resourcesAnalyzer.analyze(clusterName, dsUuid)` (ACTIVE)
- Future: `playerAnalyzerAgent.analyze(sourceUrl, gManaUrl)` (FUTURE)
- Sets incident state → `ANALYZING`

### Step 5 — RECEIVE AGENT REPORTS
- Collects `ResourcesAnalysisReport` (and future: `PlayerAnalyzerReport`)

### Step 6 — GPT-4o SYNTHESIS
- System prompt: `getManagerSynthesisPrompt()` (defined in `ManagerAgent.ts`)
- User message: `buildManagerSynthesisContext()` with all agent reports + alarm
- GPT-4o returns: `{ recommendedAction, confidenceScore, explanation, errorCode }`
- Fallback: `ruleBasedDecision()` if GPT-4o fails

### Step 7 — HUMAN APPROVAL
- Sets state → `WAITING_APPROVAL`
- Waits for explicit operator approval — NEVER auto-executes on timeout
- Timeout → `state=ESCALATED`, STOP (permission required)
- Rejected → `state=ESCALATED`, STOP

### Step 8 — EXECUTE ACTION
- Sets state → `EXECUTING_ACTION`
- `attempt 0` → `restartUH()` → wait 30s
- `attempt 1` → `restartCI()` → wait 30s
- `attempt 2` → `MOVE_TO_SOURCE` → `state=ESCALATED` → STOP

### Step 9 — VERIFY
- Sets state → `MONITORING`
- Checks alarm status up to 3 times (30s apart)
- Cleared → `closeIncident()`
- Still active → next attempt (Step 8)

### Step 10 — COMMUNICATION (FUTURE)
- Instructs SenderAgent to prepare a customer message draft
- Reviews draft, requests support team approval, then sends

### Step 11 — CLOSE
- Sets state → `CLOSED`
- Saves pattern: `"restart_success:{dsUuid}:{action}"`

---

## State Machine

```
NEW → ANALYZING → WAITING_APPROVAL → EXECUTING_ACTION → MONITORING → CLOSED
               ↘ RESOLVED (early exit: source down or no issue)
                                         ↘ ESCALATED (rejected / VIP / max restarts)
```

| State              | Trigger                                                      |
|--------------------|--------------------------------------------------------------|
| `NEW`              | Alarm received, threshold not met, watching                  |
| `ANALYZING`        | StreamAnalyzer ran, distributing data to other agents        |
| `WAITING_APPROVAL` | GPT-4o decision ready, awaiting human confirmation           |
| `EXECUTING_ACTION` | Restart command being sent to Hub Monitor API                |
| `MONITORING`       | Restart complete, verifying stream health (3 checks × 30s)  |
| `RESOLVED`         | No action needed (source down or transient) — terminal       |
| `ESCALATED`        | Rejected / VIP / max restarts / confidence too low — terminal|
| `CLOSED`           | Stream healthy, pattern saved — terminal                     |

---

## Action Order

| Attempt | Action          | Condition             |
|---------|-----------------|-----------------------|
| 0       | `RESTART_UH`   | `restartAttempts = 0` |
| 1       | `RESTART_CI`   | `restartAttempts = 1` |
| 2       | `MOVE_TO_SOURCE + ESCALATED` | max restarts reached |

---

## Early Exits

- `SOURCE_ISSUE` → `state=RESOLVED`, customer notified, pods NOT touched, STOP
- `NO_ISSUE`     → no state change, no action, STOP

---

## Fallback

If GPT-4o call fails → `ruleBasedDecision()` applies hard-coded rules from agent reports.
