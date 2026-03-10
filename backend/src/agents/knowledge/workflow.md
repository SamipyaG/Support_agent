# Alarm-to-Resolution Workflow

Full step-by-step flow from the moment a new alarm appears in Hub Monitor
to the moment the incident is closed. Every step names which agent is
responsible, what it does, and what data it passes on.

---

## FULL ALARM-TO-RESOLUTION WORKFLOW (Current Active System)

**TRIGGER:** Hub Monitor detects an active alarm on a channel (status = "ON")

---

### STEP 1 — POLLING (every 30 seconds)
**Agent:** ManagerAgent
**File:** `ManagerAgent.ts → processAlarms()`

- ManagerAgent polls Hub Monitor API: `GET /sendalarms/status/alarms`
- Receives: `AlarmData[] { dsUuid, channelName, status ("ON"/"OFF"), errorType, reason, statusCode, startedAt }`
- `status = "OFF"` → close any open incident (`handleClosedAlarm`)
- `status = "ON"` → continue to STEP 2

---

### STEP 2 — THRESHOLD GUARD
**Agent:** ManagerAgent
**File:** `ManagerAgent.ts → handleNewChannelAlarm()`

ManagerAgent checks two conditions before acting:

**Condition A** — Has this channel alarmed ≥ 3 times in the last 60 min?
- NO → Create incident (state=NEW), record the alarm, stop.
- YES → Continue to Condition B

**Condition B** — Has the alarm been active for ≥ waiting time (60s)?
- NO → Update incident label with remaining wait time, stop.
- YES → Both conditions met → proceed to STEP 3

---

### STEP 3 — STREAM ANALYSIS
**Agent:** StreamAnalyzerAgent
**File:** `StreamAnalyzerAgent.ts → analyze()`

ManagerAgent calls: `streamAnalyzer.analyze(alarm, streamUrls)`

StreamAnalyzerAgent performs:
- a) Identifies the affected channel using ds_uuid
- b) Retrieves stream metadata: ds_uuid, sourcePlayerUrl, gManaPlayerUrl, clusterName
- c) Checks source URL and G-Mana URL in parallel (HTTP HEAD)
- d) Analyzes the alarm type: `MAIN_MANIFEST_BAD_RESPONSE`, `SOURCE_TIMEOUT`, `STREAM_UNAVAILABLE`
- e) Evaluates severity of the issue
- f) Detects VIP customers (Keshet, Reshet)
- g) Calculates a confidence score (0–100%)
- h) Determines root cause:
  - `source DOWN + gmana DOWN` → `BOTH_DOWN`  (CDN/network failure)
  - `source DOWN + gmana OK`  → `SOURCE_ISSUE` (encoder/CDN fault)
  - `source OK  + gmana DOWN` → `GMANA_ISSUE`  (our pod/manifest fault)
  - `source OK  + gmana OK`  → `NO_ISSUE`      (transient, self-resolved)

StreamAnalyzerAgent sends a `StreamAnalysisReport` to ManagerAgent:
```
{
  ds_uuid, source_url, g_mana_url, cluster,
  alarm_type, root_cause_assumption,
  severity, confidence_score, is_vip,
  sourceResult, gmanaResult, details,
  flaggedForFurtherAnalysis (true if confidence < 80%)
}
```

---

### STEP 4 — MANAGER DISTRIBUTES DATA TO ANALYSIS AGENTS
**Agent:** ManagerAgent
**File:** `ManagerAgent.ts → runFullInvestigation()`

ManagerAgent reads the StreamAnalysisReport.

**EARLY EXIT** — before launching further analysis:
- `SOURCE_ISSUE` → notify customer only, do NOT restart pods, STOP
- `NO_ISSUE`     → alarm was transient, no action needed, STOP

If `GMANA_ISSUE` or `BOTH_DOWN`:
- ManagerAgent extracts: ds_uuid, source_url, g_mana_url, clusterName
- Distributes to:
  - → `ResourcesAnalyzerAgent` (ACTIVE — receives cluster + dsUuid)
  - → `PlayerAnalyzerAgent`     (FUTURE — will receive stream URLs)
- Both agents launched in parallel.
- Sets incident state → `ANALYZING`

---

### STEP 5A — RESOURCES ANALYSIS (Active)
**Agent:** ResourcesAnalyzerAgent
**File:** `ResourcesAnalyzerAgent.ts`

Receives from ManagerAgent: `clusterName`, `dsUuid`

Checks in parallel:
1. **UH pod logs** — scans for `ERROR` / `WARN` / `CrashLoop` / `OOMKilled`
2. **CI pod logs** — scans for `ERROR` / `WARN`
3. **Redis health** — `isHealthy`, `CPU%`, `memory`

Detection priority (first match wins):

| Condition              | Type         | Component | Severity  | Confidence |
|------------------------|--------------|-----------|-----------|------------|
| Redis isHealthy=false  | REDIS_DOWN   | REDIS     | critical  | 92%        |
| UH errors AND CI errors| POD_CRASH    | UH        | high      | 82%        |
| UH errors only         | POD_CRASH    | UH        | high      | 87%        |
| CI errors only         | POD_CRASH    | CI        | medium    | 82%        |
| Redis memory > 90%     | MEMORY_HIGH  | REDIS     | medium    | 75%        |
| Redis CPU > 85%        | CPU_HIGH     | REDIS     | low       | 70%        |
| None of the above      | NONE         | NONE      | low       | 85%        |

Returns `ResourcesAnalysisReport` to ManagerAgent:
```
{ ds_uuid, affectedComponent, resourceIssueType, severity,
  confidenceScore, recommendedAction, uhLogs, ciLogs, redis }
```

---

### STEP 5B — DEEP STREAM ANALYSIS (Future)
**Agent:** PlayerAnalyzerAgent (NOT YET IMPLEMENTED)

Opens source URL + G-Mana URL using a player debugging tool.
Observes stream for ~30 seconds. Detects:
- Media sequence jumps, discontinuities, segment mismatches
- Missing segments, slow segment downloads
- HTTP errors (403/404/502)

---

### STEP 6 — GPT-4o SYNTHESIS (Manager Decision)
**Agent:** ManagerAgent + GPT-4o
**Files:** `ManagerAgent.ts → synthesizeReports()`, prompt functions in same file

ManagerAgent combines ALL agent reports and sends to GPT-4o:
- **System prompt** → `getManagerSynthesisPrompt()` — platform knowledge + error codebook + decision rules
- **User message** → `buildManagerSynthesisContext()` — StreamAnalysisReport + ResourcesAnalysisReport + alarm data

GPT-4o correlates both reports:

| Stream Report    | Resources Report | Action       |
|------------------|------------------|--------------|
| GMANA_ISSUE      | UH errors        | RESTART_UH   |
| GMANA_ISSUE      | CI errors        | RESTART_CI   |
| GMANA_ISSUE      | REDIS_DOWN       | ESCALATE     |
| confidence < 80% | any              | ESCALATE     |
| VIP + conf < 80% | any              | ESCALATE     |

GPT-4o returns JSON:
```json
{ "recommendedAction": "...", "confidenceScore": 0-100, "explanation": "...", "errorCode": "..." }
```

If GPT-4o fails → `ruleBasedDecision()` fallback (pure rules, no LLM)

---

### STEP 7 — HUMAN APPROVAL
**Agent:** ManagerAgent + ApprovalService
**Files:** `ManagerAgent.ts`, `ApprovalService.ts → waitForApproval()`

- Incident state → `WAITING_APPROVAL`
- UI shows the recommended action with countdown
- `POST /api/approve/:incidentId  { decision: "approved"/"rejected" }`

| Decision   | Outcome                              |
|------------|--------------------------------------|
| "approved" | continue to STEP 8                   |
| timeout    | ESCALATED, manual permission needed  |
| "rejected" | state = ESCALATED, STOP             |

---

### STEP 8 — ACTION EXECUTION
**Agent:** ManagerAgent
**File:** `ManagerAgent.ts → executeAction()`

- Incident state → `EXECUTING_ACTION`
- `restartAttempts = 0` → `RESTART_UH` → wait 30s → STEP 9
  - `POST /clusters/{cluster}/deployments/userhandler-{uuid}/restart`
- `restartAttempts = 1` → `RESTART_CI` → wait 30s → STEP 9
  - `POST /clusters/{cluster}/deployments/cuemana-in-{uuid}/restart`
- `restartAttempts = 2` → `MOVE_TO_SOURCE` (last resort) → ESCALATED, STOP

---

### STEP 9 — VERIFICATION
**Agent:** ManagerAgent
**File:** `ManagerAgent.ts → recheckAfterAction()`

- Incident state → `MONITORING`
- Checks alarm status up to 3 times (30s apart)
- Alarm gone → STEP 11 (close incident)
- Still active → back to STEP 8 (try next action)

---

### STEP 10 — CUSTOMER COMMUNICATION (Future)
**Agent:** ManagerAgent → SenderAgent (NOT YET IMPLEMENTED)

If customer communication is required:
1. ManagerAgent instructs SenderAgent to prepare a message draft
2. SenderAgent prepares draft using templates (WhatsApp / email)
3. Draft is sent BACK to ManagerAgent for review
4. ManagerAgent approves or edits the draft
5. Final approval requested from the support team
6. Only after team approval → message is sent to customer

---

### STEP 11 — CLOSE INCIDENT
**Agent:** ManagerAgent
**File:** `ManagerAgent.ts → closeIncident()`

- Incident state → `CLOSED`
- Saves successful action pattern to InMemoryStore
- Pattern key: `"restart_success:{dsUuid}:{action}"`

---

## Data Flow Summary

```
Hub Monitor API
  └─► AlarmData[] → ManagerAgent.processAlarms()
                         │
                         └─► [threshold check]
                               │
                               └─► StreamAnalyzerAgent.analyze(alarm, streamUrls)
                                     ├─► ErrorDetectionPlayerTool.checkBoth()
                                     └─► StreamAnalysisReport
                                           │
                                           ▼
                                     ManagerAgent reads report
                                     distributes: ds_uuid, cluster, urls
                                           │
                              ┌────────────┴────────────┐
                              ▼                         ▼
                   ResourcesAnalyzerAgent      PlayerAnalyzerAgent
                     (ACTIVE)                    (FUTURE)
                   ├─ getUHLogs()
                   ├─ getCILogs()
                   └─ getRedisResources()
                              │
                   ResourcesAnalysisReport
                              │
                              └────────────┬────────────┘
                                           │
                                     ManagerAgent
                                  synthesizeReports()
                                         │
                         prompt functions + GPT-4o reasoning
                                         │
                                   final decision
                                         │
                                  ApprovalService
                               (human or auto-approve)
                                         │
                                  HubMonitorTool
                               restartUH() / restartCI()
                                         │
                            recheckAfterAction()
                                         │
                  (future) SenderAgent message draft
                                         │
                            closeIncident() → CLOSED
```
