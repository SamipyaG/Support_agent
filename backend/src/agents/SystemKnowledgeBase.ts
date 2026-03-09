/**
 * ============================================================
 * SystemKnowledgeBase.ts
 * ============================================================
 *
 * THE SINGLE SOURCE OF TRUTH FOR ALL AGENT BEHAVIOR.
 *
 * This file defines:
 *   1. What every agent is responsible for
 *   2. How agents communicate with each other
 *   3. The exact GPT-4o system prompt used by the Manager Agent
 *   4. The complete alarm-to-resolution workflow
 *
 * If you want to change how any agent thinks, reasons, or decides
 * — this is the ONLY file you need to edit.
 *
 * ──────────────────────────────────────────────────────────────
 * FULL AGENT ARCHITECTURE (5 agents total)
 * ──────────────────────────────────────────────────────────────
 *
 *  STATUS   AGENT                    FILE
 *  ──────   ─────────────────────    ───────────────────────────────────────
 *  ACTIVE   StreamAnalyzerAgent      src/agents/StreamAnalyzerAgent.ts
 *  ACTIVE   ResourcesAnalyzerAgent   src/agents/ResourcesAnalyzerAgent.ts
 *  ACTIVE   ManagerAgent             src/agents/ManagerAgent.ts
 *  FUTURE   AnalyzeStreamAgent       (not yet implemented)
 *  FUTURE   SenderAgent              (not yet implemented)
 *
 * Current phase uses only Hub Monitor data.
 * Future phases will add deep stream debugging (AnalyzeStreamAgent)
 * and automated customer communication (SenderAgent).
 * ============================================================
 */

// ─────────────────────────────────────────────────────────────────────────────
// SECTION A: DETAILED ALARM-TO-RESOLUTION WORKFLOW
//
// Complete step-by-step flow from the moment a new alarm appears in Hub Monitor
// to the moment the incident is closed. Every step names which agent is
// responsible, what it does, and what data it passes on.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ════════════════════════════════════════════════════════════════════════════
 * FULL ALARM-TO-RESOLUTION WORKFLOW  (Current Active System)
 * ════════════════════════════════════════════════════════════════════════════
 *
 * TRIGGER: Hub Monitor detects an active alarm on a channel (status = "ON")
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ STEP 1 — POLLING  (every 30 seconds)                                    │
 * │ Agent:  ManagerAgent                                                    │
 * │ File:   ManagerAgent.ts → processAlarms()                               │
 * │                                                                         │
 * │  ManagerAgent polls Hub Monitor API:                                    │
 * │    GET /sendalarms/status/alarms                                        │
 * │                                                                         │
 * │  Receives: AlarmData[] {                                                │
 * │    dsUuid, channelName, status ("ON"/"OFF"),                            │
 * │    errorType, reason, statusCode, startedAt                             │
 * │  }                                                                      │
 * │                                                                         │
 * │  status = "OFF" → close any open incident (handleClosedAlarm)          │
 * │  status = "ON"  → continue to STEP 2                                   │
 * └─────────────────────────────────────────────────────────────────────────┘
 *                                    │
 *                                    ▼
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ STEP 2 — THRESHOLD GUARD                                                │
 * │ Agent:  ManagerAgent                                                    │
 * │ File:   ManagerAgent.ts → handleNewChannelAlarm()                       │
 * │                                                                         │
 * │  ManagerAgent checks two conditions before acting:                     │
 * │                                                                         │
 * │  Condition A — Has this channel alarmed ≥ 3 times in the last 60 min? │
 * │    NO  → Create incident (state=NEW), record the alarm, stop.          │
 * │    YES → Continue to Condition B                                        │
 * │                                                                         │
 * │  Condition B — Has the alarm been active for ≥ waiting time (60s)?    │
 * │    NO  → Update incident label with remaining wait time, stop.         │
 * │    YES → Both conditions met → proceed to STEP 3                       │
 * └─────────────────────────────────────────────────────────────────────────┘
 *                                    │
 *                                    ▼
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ STEP 3 — STREAM ANALYSIS                                                │
 * │ Agent:  StreamAnalyzerAgent                                             │
 * │ File:   StreamAnalyzerAgent.ts → analyze()                              │
 * │                                                                         │
 * │  ManagerAgent calls: streamAnalyzer.analyze(alarm, streamUrls)         │
 * │                                                                         │
 * │  StreamAnalyzerAgent performs the following:                           │
 * │                                                                         │
 * │  a) Identifies the affected channel using ds_uuid                      │
 * │  b) Retrieves stream metadata:                                          │
 * │       ds_uuid, sourcePlayerUrl, gManaPlayerUrl, clusterName            │
 * │  c) Checks source URL and G-Mana URL in parallel (HTTP HEAD)           │
 * │  d) Analyzes the alarm type:                                            │
 * │       MAIN_MANIFEST_BAD_RESPONSE                                        │
 * │       SOURCE_TIMEOUT                                                    │
 * │       STREAM_UNAVAILABLE                                                │
 * │  e) Evaluates severity of the issue                                     │
 * │  f) Detects VIP customers (Keshet, Reshet)                              │
 * │  g) Calculates a confidence score (0-100%)                             │
 * │  h) Determines root cause:                                              │
 * │       source DOWN + gmana DOWN → BOTH_DOWN  (CDN/network failure)      │
 * │       source DOWN + gmana OK  → SOURCE_ISSUE (encoder/CDN fault)       │
 * │       source OK  + gmana DOWN → GMANA_ISSUE  (our pod/manifest fault)  │
 * │       source OK  + gmana OK  → NO_ISSUE      (transient, self-resolved)│
 * │                                                                         │
 * │  StreamAnalyzerAgent sends a StreamAnalysisReport to ManagerAgent:     │
 * │    {                                                                    │
 * │      ds_uuid, source_url, g_mana_url, cluster,                         │
 * │      alarm_type, root_cause_assumption,                                │
 * │      severity, confidence_score, is_vip,                               │
 * │      sourceResult, gmanaResult, details,                               │
 * │      flaggedForFurtherAnalysis (true if confidence < 80%)              │
 * │    }                                                                    │
 * └─────────────────────────────────────────────────────────────────────────┘
 *                                    │
 *                         StreamAnalysisReport
 *                        received by ManagerAgent
 *                                    │
 *                                    ▼
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ STEP 4 — MANAGER DISTRIBUTES DATA TO ANALYSIS AGENTS                   │
 * │ Agent:  ManagerAgent                                                    │
 * │ File:   ManagerAgent.ts → runFullInvestigation()                        │
 * │                                                                         │
 * │  ManagerAgent reads the StreamAnalysisReport.                          │
 * │                                                                         │
 * │  EARLY EXIT — before launching further analysis:                       │
 * │    SOURCE_ISSUE → notify customer only, do NOT restart pods, STOP      │
 * │    NO_ISSUE     → alarm was transient, no action needed, STOP          │
 * │                                                                         │
 * │  If GMANA_ISSUE or BOTH_DOWN:                                           │
 * │  ManagerAgent extracts from the StreamAnalysisReport:                  │
 * │    ds_uuid, source_url, g_mana_url, clusterName                        │
 * │                                                                         │
 * │  ManagerAgent distributes this data to:                                │
 * │    → ResourcesAnalyzerAgent  (ACTIVE — receives cluster + dsUuid)      │
 * │    → AnalyzeStreamAgent      (FUTURE — will receive stream URLs)       │
 * │                                                                         │
 * │  Both agents are launched in parallel.                                 │
 * │  Sets incident state → ANALYZING                                       │
 * └─────────────────────────────────────────────────────────────────────────┘
 *                                    │
 *                    ┌───────────────┴──────────────────┐
 *          (parallel)│                                  │(parallel)
 *                    ▼                                  ▼
 * ┌──────────────────────────────┐     ┌────────────────────────────────────┐
 * │ STEP 5A — RESOURCES ANALYSIS │     │ STEP 5B — DEEP STREAM ANALYSIS     │
 * │ Agent: ResourcesAnalyzerAgent│     │ Agent: AnalyzeStreamAgent (FUTURE) │
 * │ File:  ResourcesAnalyzerAgent│     │                                    │
 * │                              │     │  Opens source URL + G-Mana URL     │
 * │ Receives from ManagerAgent:  │     │  using a player debugging tool.    │
 * │   clusterName, dsUuid        │     │  Observes stream for ~30 seconds.  │
 * │                              │     │  Detects:                          │
 * │ Checks in parallel:          │     │   • media sequence jumps           │
 * │  1. UH pod logs              │     │   • discontinuities                │
 * │     → scans for ERROR/WARN/  │     │   • segment mismatches             │
 * │       CrashLoop/OOMKilled    │     │   • missing segments               │
 * │  2. CI pod logs              │     │   • slow segment downloads         │
 * │     → scans for ERROR/WARN   │     │   • HTTP errors (403/404/502)      │
 * │  3. Redis health             │     │  Records: segment time range,      │
 * │     → isHealthy, CPU%, memory│     │  error type, HTTP codes, metrics   │
 * │                              │     │                                    │
 * │ Checks pod state:            │     │  NOT YET IMPLEMENTED.              │
 * │   Running / Pending / Failed │     │  Future phase only.                │
 * │                              │     └────────────────────────────────────┘
 * │ Pod restart count > 10       │
 * │   = considered unstable      │
 * │                              │
 * │ Redis clusters monitored:    │
 * │   Reshet cluster             │
 * │   Keshet cluster             │
 * │   General customers cluster  │
 * │                              │
 * │ Detection priority           │
 * │ (first match wins):          │
 * │  Redis down    → critical 92%│
 * │  UH+CI errors  → high    82%│
 * │  UH errors     → high    87%│
 * │  CI errors     → medium  82%│
 * │  Memory > 90%  → medium  75%│
 * │  CPU > 85%     → low     70%│
 * │  None          → low     85%│
 * │                              │
 * │ Returns ResourcesAnalysis    │
 * │ Report to ManagerAgent:      │
 * │  { ds_uuid, affectedComponent│
 * │    resourceIssueType,        │
 * │    severity, confidenceScore │
 * │    recommendedAction,        │
 * │    uhLogs, ciLogs, redis }   │
 * └──────────────────────────────┘
 *                    │                                  │
 *                    └───────────────┬──────────────────┘
 *                                    │
 *                    Reports arrive back at ManagerAgent
 *                                    │
 *                                    ▼
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ STEP 6 — GPT-4o SYNTHESIS (Manager Decision)                           │
 * │ Agent:  ManagerAgent + GPT-4o                                           │
 * │ File:   ManagerAgent.ts → synthesizeReports()                          │
 * │         SystemKnowledgeBase.ts → getManagerSynthesisPrompt()           │
 * │                                  buildManagerSynthesisContext()         │
 * │                                                                         │
 * │  ManagerAgent combines ALL agent reports and sends to GPT-4o:          │
 * │                                                                         │
 * │  System prompt → getManagerSynthesisPrompt()                           │
 * │    Platform knowledge + error codebook + decision rules                │
 * │                                                                         │
 * │  User message  → buildManagerSynthesisContext()                        │
 * │    StreamAnalysisReport + ResourcesAnalysisReport + alarm data         │
 * │                                                                         │
 * │  GPT-4o correlates both reports:                                        │
 * │    GMANA_ISSUE + UH errors   → RESTART_UH    (high confidence)        │
 * │    GMANA_ISSUE + CI errors   → RESTART_CI    (high confidence)        │
 * │    GMANA_ISSUE + REDIS_DOWN  → ESCALATE      (DevOps needed)           │
 * │    confidence < 80% (either) → ESCALATE      (uncertain)               │
 * │    VIP + confidence < 80%   → ESCALATE       (VIP rule)               │
 * │                                                                         │
 * │  GPT-4o returns JSON: {                                                │
 * │    recommendedAction, confidenceScore, explanation, errorCode          │
 * │  }                                                                      │
 * │                                                                         │
 * │  If GPT-4o fails → ruleBasedDecision() fallback (pure rules, no LLM)  │
 * └─────────────────────────────────────────────────────────────────────────┘
 *                                    │
 *                                    ▼
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ STEP 7 — HUMAN APPROVAL                                                 │
 * │ Agent:  ManagerAgent + ApprovalService                                  │
 * │ File:   ManagerAgent.ts → runFullInvestigation()                        │
 * │         ApprovalService.ts → waitForApproval()                         │
 * │                                                                         │
 * │  Incident state → WAITING_APPROVAL                                     │
 * │  UI shows the recommended action with a 10-second countdown.          │
 * │                                                                         │
 * │  POST /api/approve/:incidentId  { decision: "approved"/"rejected" }   │
 * │                                                                         │
 * │  decision = "approved" → continue to STEP 8                           │
 * │  timeout               → ESCALATED, manual permission required, STOP  │
 * │  decision = "rejected" → state = ESCALATED, STOP                      │
 * └─────────────────────────────────────────────────────────────────────────┘
 *                                    │
 *                                    ▼
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ STEP 8 — ACTION EXECUTION                                               │
 * │ Agent:  ManagerAgent                                                    │
 * │ File:   ManagerAgent.ts → executeAction()                              │
 * │                                                                         │
 * │  Incident state → EXECUTING_ACTION                                     │
 * │                                                                         │
 * │  restartAttempts = 0 → RESTART_UH                                      │
 * │    POST /clusters/{cluster}/deployments/userhandler-{uuid}/restart     │
 * │    Wait 30 seconds → STEP 9                                            │
 * │                                                                         │
 * │  restartAttempts = 1 → RESTART_CI                                      │
 * │    POST /clusters/{cluster}/deployments/cuemana-in-{uuid}/restart      │
 * │    Wait 30 seconds → STEP 9                                            │
 * │                                                                         │
 * │  restartAttempts = 2 → MOVE_TO_SOURCE (last resort)                   │
 * │    Bypass G-Mana, viewers see raw stream without ads                   │
 * │    Notify Yoni. State → ESCALATED. STOP.                               │
 * └─────────────────────────────────────────────────────────────────────────┘
 *                                    │
 *                                    ▼
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ STEP 9 — VERIFICATION                                                   │
 * │ Agent:  ManagerAgent                                                    │
 * │ File:   ManagerAgent.ts → recheckAfterAction()                         │
 * │                                                                         │
 * │  Incident state → MONITORING                                           │
 * │  Checks source + G-Mana URLs up to 3 times (30s apart)               │
 * │                                                                         │
 * │  Both healthy → STEP 10 (close incident)                              │
 * │  Still broken → back to STEP 8 (try next action)                      │
 * └─────────────────────────────────────────────────────────────────────────┘
 *                                    │
 *                                    ▼
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ STEP 10 — (FUTURE) CUSTOMER COMMUNICATION via SenderAgent              │
 * │ Agent:  ManagerAgent → SenderAgent (FUTURE)                            │
 * │                                                                         │
 * │  If customer communication is required:                                │
 * │    ManagerAgent instructs SenderAgent to prepare a message draft.      │
 * │    SenderAgent prepares draft using templates (WhatsApp / email).      │
 * │    Draft is sent BACK to ManagerAgent for review.                      │
 * │    ManagerAgent approves or edits the draft.                           │
 * │    Final approval is requested from the support team.                  │
 * │    Only after team approval → message is sent to customer.            │
 * │                                                                         │
 * │  NOT YET IMPLEMENTED. Future phase only.                               │
 * └─────────────────────────────────────────────────────────────────────────┘
 *                                    │
 *                                    ▼
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ STEP 11 — CLOSE INCIDENT                                                │
 * │ Agent:  ManagerAgent                                                    │
 * │ File:   ManagerAgent.ts → closeIncident()                              │
 * │                                                                         │
 * │  Incident state → CLOSED                                               │
 * │  Saves successful action pattern to InMemoryStore                      │
 * │  Pattern key: "restart_success:{dsUuid}:{action}"                     │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * ════════════════════════════════════════════════════════════════════════════
 * DATA FLOW SUMMARY
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  Hub Monitor API
 *    └─► AlarmData[] → ManagerAgent.processAlarms()
 *                           │
 *                           └─► [threshold check]
 *                                 │
 *                                 └─► StreamAnalyzerAgent.analyze(alarm, streamUrls)
 *                                       ├─► ErrorDetectionPlayerTool.checkBoth()
 *                                       └─► StreamAnalysisReport
 *                                             │
 *                                             ▼
 *                                       ManagerAgent
 *                                       reads report
 *                                       distributes: ds_uuid, cluster, urls
 *                                             │
 *                                ┌────────────┴────────────┐
 *                                ▼                         ▼
 *                     ResourcesAnalyzerAgent      AnalyzeStreamAgent
 *                       (ACTIVE)                    (FUTURE)
 *                     ├─ getUHLogs()
 *                     ├─ getCILogs()
 *                     └─ getRedisResources()
 *                                │
 *                     ResourcesAnalysisReport
 *                                │
 *                                └────────────┬────────────┘
 *                                             │
 *                                       ManagerAgent
 *                                    synthesizeReports()
 *                                       │
 *                           SystemKnowledgeBase prompts
 *                           + GPT-4o reasoning
 *                                       │
 *                                 final decision
 *                                       │
 *                              ApprovalService
 *                           (human or auto-approve)
 *                                       │
 *                              HubMonitorTool
 *                           restartUH() / restartCI()
 *                                       │
 *                            recheckAfterAction()
 *                                       │
 *                  (future) SenderAgent message draft
 *                                       │
 *                            closeIncident() → CLOSED
 *
 * ════════════════════════════════════════════════════════════════════════════
 */

// ─────────────────────────────────────────────────────────────────────────────
// SECTION B: PLATFORM KNOWLEDGE
// Injected into every GPT-4o call so the model understands the G-Mana platform.
// ─────────────────────────────────────────────────────────────────────────────

const PLATFORM_CONTEXT = `
You are an expert support engineer at G-Mana, a Server-Side Ad Insertion (SSAI) platform.

## What is G-Mana?
G-Mana is a cloud-based SSAI platform. It intercepts a broadcaster's live HLS or DASH stream,
stitches targeted ads at SCTE-35 cue points, and delivers a seamless combined stream to viewers.
The platform runs on Kubernetes clusters and handles thousands of concurrent streams.

## Core Terminology

**ds_uuid**: A unique identifier for each stream . Format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx.
Every alarm, pod, and deployment is identified by ds_uuid.

**HLS**: Apple's streaming protocol. Uses .m3u8 manifest files and .ts segments.
SCTE-35 ad cue markers are embedded as EXT-X-DATERANGE or EXT-X-CUE-OUT tags.

**DASH**: MPEG's streaming protocol. Uses .mpd manifest files.

**SCTE-35**: Broadcast standard for signaling ad break opportunities.

## System Components

**User Handler (UH)**: Main pod managing a stream session.
Pod format: user-handler-{ds_uuid}
When UH crashes → stream returns 502/other status rather then 200 and becomes unreachable.
Each pod have resources like memory ,cpu ,response time ,network 
**CueMana-In (CI)**: Ad insertion engine pod.
Pod format: cuemana-in-{ds_uuid}
When CI fails → ads stop being inserted (no SCTE-35 markers in G-Mana output).

**Hub Monitor**: Internal monitoring API — source of truth for alarms, pod logs, Redis health.

**Clusters**: Kubernetes clusters. Named: hub1x, hub21,stg



**Pod Stability Rule**: Any pod with more than 10 restarts is considered unstable.

## VIP Customers
- **Keshet**: Premium customer. Uses Keshet Redis cluster. Immediate escalation required.
- **Reshet**: Premium customer. Uses Reshet Redis cluster. Immediate escalation required.
VIP channels must NEVER wait for automated resolution. Notify Yoni (senior engineer) immediately.

## Active Agents in This System

There are 5 agents in the full architecture. Currently 3 are active.

AGENT 1 — StreamAnalyzerAgent (ACTIVE)
  Role: First agent to run. Monitors all active alarms, identifies affected channel,
        retrieves stream metadata, checks source and G-Mana URLs, evaluates alarm type,
        detects the costomer priority, calculates confidence score.
  Reports to: ManagerAgent (sends StreamAnalysisReport including ds_uuid, urls, cluster)
  

AGENT 2 — ResourcesAnalyzerAgent (ACTIVE)
  Role: Checks infrastructure health for a specific channel.
        Checks UH pod, CI pod, pod states (Running/Pending/Failed), restart counts,
        Redis health (isHealthy, CPU, memory) across for all channel.
  Receives from: ManagerAgent (ds_uuid + clusterName,redisName  extracted from StreamAnalysisReport)
  Reports to: ManagerAgent (sends ResourcesAnalysisReport)
  

AGENT 3 — ManagerAgent (ACTIVE — Orchestrator)
  Role: Central coordinator. Receives alarm from Hub Monitor, triggers StreamAnalyzer,
        reads its report, distributes data to ResourcesAnalyzer, collects all reports,
        calls GPT-4o for final decision, waits for human approval, executes action.
  State writes: ALL incident states (NEW → ANALYZING → WAITING_APPROVAL → EXECUTING_ACTION
                                    → MONITORING → CLOSED | RESOLVED | ESCALATED)

AGENT 4 — AnalyzeStreamAgent (FUTURE — not yet implemented)
  Role: Deep stream debugging using a player tool. Opens source + G-Mana URLs,
        observes for ~30 seconds, detects sequence jumps, discontinuities, missing segments,
        HTTP errors (403/404/502), slow downloads.
  Will receive from: ManagerAgent (source_url, g_mana_url from StreamAnalysisReport)
  Will report to: ManagerAgent

AGENT 5 — SenderAgent (FUTURE — not yet implemented)
  Role: All external communication (WhatsApp Business API + Outlook email).
        Prepares message drafts using predefined templates, sends draft to ManagerAgent for
        review, waits for support team final approval, then sends message.
  Will receive from: ManagerAgent (message instructions + incident context)
  Will report to: ManagerAgent (draft for review before sending)

## Incident State Machine

Every alarm creates or updates one Incident record. ManagerAgent is the ONLY agent that changes state.

════════════════════════════════════════════════════════════════════════
STATE 1 — NEW  (first alarm ever seen for this channel)
════════════════════════════════════════════════════════════════════════
Trigger : Alarm received for a channel for the very first time.
Action  : Wait n seconds before taking any action.

  ┌─────────────────────────────────────────────────────────────────┐
  │ AGENT: ManagerAgent                                             │
  │ Receives the alarm from Hub Monitor polling (every 30s).        │
  │ Checks alarm count for this channel in the last 60 min.         │
  │ count < threshold → creates incident with state=NEW, watches.   │
  │ Starts the wait timer. Does NOT trigger any analysis yet.       │
  └─────────────────────────────────────────────────────────────────┘

  During the wait, monitor whether the same channel fires again:

  ┌─ CASE A: Multiple alarms for the same channel (≥ X times within 60 min)
  │   Continuously check: Resources, Source Player URL, G-Mana Player URL
  │   for up to 1 hour.
  │
  │   STEP 1 — Save logs
  │     Agent : ResourcesAnalyzerAgent
  │     • Downloads CI  logs  via API: "Cuemana IN logs Download"
  │     • Downloads UH  logs  via API: "UH logs Download"
  │     • Logs are saved immediately — before any restart wipes them
  │
  │   STEP 2 — Gather stream data
  │     Agent : StreamAnalyzerAgent
  │     • Checks Source & G-Mana player URLs via "Get Stream URL- Source and Gmana"
  │     Agent : ResourcesAnalyzerAgent
  │     • Fetches infrastructure resource usage (UH pod, CI pod, Redis health)
  │
  │   STEP 3 — Generate report
  │     Agent : ManagerAgent
  │     • Receives reports from StreamAnalyzerAgent & ResourcesAnalyzerAgent
  │     • Synthesizes findings: states whether there is an issue or no issue
  │
  │   STEP 4 — Create Jira ticket  (ONLY if an issue was found)
  │     Agent : ManagerAgent
  │     • Opens a Jira ticket with full details from Steps 1–3
  │
  └─ CASE B: Single alarm, no repeats
       Agent : ManagerAgent → do nothing, keep watching.

════════════════════════════════════════════════════════════════════════
STATE 2 — ANALYZING  (wait time "n" seconds exceeded for a NEW channel)
════════════════════════════════════════════════════════════════════════
Trigger : New channel alarm AND the initial wait time has now expired.

  STEP 1 — Update UI duration label
    Agent : ManagerAgent
    • Updates the incident record with elapsed time so the UI countdown
      reflects how long the alarm has been active.

  STEP 2 — Check system & channel resources
    Agent : StreamAnalyzerAgent
    • Checks Source & G-Mana player URLs via "Get Stream URL- Source and Gmana"
    • Determines: sourceStatus, gmanaStatus, rootCauseAssumption, confidenceScore
    Agent : ResourcesAnalyzerAgent
    • Runs "AnalyzeResources": checks UH pod, CI pod, Redis clusters in parallel
    • Returns: affectedComponent, resourceIssueType, severity

  STEP 3 — Save logs & open Jira ticket
    Agent : ResourcesAnalyzerAgent
    • Downloads CI logs via "Cuemana IN logs Download"
    • Downloads UH logs via "UH logs Download"
    Agent : ManagerAgent
    • Opens a Jira ticket with all data collected so far

  STEP 4 — Aggregate data and send to ManagerAgent
    Agent : ManagerAgent
    • Collects StreamAnalysisReport + ResourcesAnalysisReport
    • Calls GPT-4o (via getManagerSynthesisPrompt) to synthesize all findings
      and determine the recommended action

  STEP 5 — Draft replies
    Agent : SenderAgent  (FUTURE — not yet implemented)
    • Short draft  → for the Customer  (max 3 sentences, no technical terms)
    • Detailed draft → for the G-Mana internal team  (full technical context)
    Agent : ManagerAgent
    • Reviews both drafts before they are sent

  STEP 6 — Wait for support team approval (default: 10 seconds)
    Agent : ManagerAgent  (via ApprovalService)
    • Sets incident state → WAITING_APPROVAL
    • UI shows countdown + recommended action for operator to approve/reject

  ┌─ IF approval received within 10 s
  │   Agent : ManagerAgent
  │   • Sets state → EXECUTING_ACTION
  │   • Sends restart command to Hub Monitor API (Restart UH / Restart CI)
  │   • After restart, sets state → MONITORING and verifies stream health
  │
  └─ IF no approval received (timeout)
       Agent : ManagerAgent
       • Sets state → ESCALATED
       • Auto-sends drafted message to Customer
       • Notifies G-Mana internal team
       • Suggests remediation actions for manual execution:
           – Restart UH  : "Restart UH"
           – Restart CI  : "Restart CI"
           – Move to Source

════════════════════════════════════════════════════════════════════════
STATE 3 — MONITORING  (existing channel, wait time "n" seconds exceeded)
════════════════════════════════════════════════════════════════════════
Trigger : Alarm on an already-known channel AND the wait time has expired.

  STEP 1 — Update UI duration label
    Agent : ManagerAgent
    • Updates the incident record with elapsed time visible in the UI.

  STEP 2 — Check system & channel resources
    Agent : StreamAnalyzerAgent
    • Checks Source & G-Mana player URLs via "Get Stream URL- Source and Gmana"
    • Returns: sourceStatus, gmanaStatus, rootCauseAssumption, severity, confidenceScore
    Agent : ResourcesAnalyzerAgent
    • Runs "AnalyzeResources": checks UH pod, CI pod, Redis clusters in parallel
    • Returns: affectedComponent, resourceIssueType, severity, details

  STEP 3 — Aggregate data and send to ManagerAgent
    Agent : ManagerAgent
    • Collects StreamAnalysisReport + ResourcesAnalysisReport
    • Calls GPT-4o to synthesize findings and decide recommended action

  ┌─ IF an issue is found
  │   Agent : ManagerAgent
  │   • Reports issue to Support team with full details
  │   • Suggests remediation actions (in order of priority):
  │       1. Restart UH  : "Restart UH"   (manifest / 502 / sequence issues)
  │       2. Restart CI  : "Restart CI"   (ad insertion / SCTE-35 issues)
  │       3. Move to Source               (last resort — viewers see raw stream)
  │   Agent : SenderAgent  (FUTURE)
  │   • Prepares customer-facing message draft for support team approval
  │
  └─ IF no issue found
       Agent : ManagerAgent
       • Marks incident as REVIEWED (terminal state)
       • Creates a Jira ticket documenting the investigation and findings

════════════════════════════════════════════════════════════════════════
STATE 4 — REVIEWED  (terminal — analysis complete, no action needed)
════════════════════════════════════════════════════════════════════════
  Agent  : ManagerAgent
  Meaning: Issue analysis is fully complete. No automated action was required.
           All findings have been documented in Jira.
  Next   : Terminal state — incident is closed with no further action.
`;

// ─────────────────────────────────────────────────────────────────────────────
// SECTION C: ERROR CODEBOOK
// Every known error code, its meaning, and the correct fix.
// ─────────────────────────────────────────────────────────────────────────────

const ERROR_CODEBOOK = `
## G-Mana Error Codes

| Error Code                   | Meaning                                      | Fix               |
|------------------------------|----------------------------------------------|-------------------|
| MAIN_MANIFEST_BAD_RESPONSE   | G-Mana manifest stale or malformed           | RESTART_UH        |
| MPD_MANIFEST_BAD_RESPONSE    | G-Mana MPD manifest stale or malformed       | RESTART_UH        |
| SEGMENT_MISMATCH_ERROR       | G-Mana segments don't match source segments  | RESTART_UH        |
| SSAI_AD_BREAK_NOT_DETECTED   | No SCTE-35 markers in G-Mana output          | RESTART_CI        |
| HTTP_502_UPSTREAM_ERROR      | G-Mana endpoint returns 502 Bad Gateway      | RESTART_UH        |
| SOURCE_TIMEOUT               | Source broadcaster stream times out          | NOTIFY_CUSTOMER   |
| SOURCE_STREAM_DOWN           | Source broadcaster stream unreachable        | NOTIFY_CUSTOMER   |
| STREAM_UNAVAILABLE           | Stream not accessible                        | RESTART_UH        |
| BOTH_STREAMS_DOWN            | Both G-Mana and source unreachable           | ESCALATE          |
| REDIS_DEGRADED               | Redis cluster not healthy                    | ESCALATE (DevOps) |
| UH_POD_CRASH_LOOP            | UH pod in CrashLoopBackOff                   | RESTART_UH        |
| CI_POD_CRASH_LOOP            | CI pod in CrashLoopBackOff                   | RESTART_CI        |
| POD_UNSTABLE                 | Pod restart count > 10                       | RESTART + ESCALATE|
| HIGH_CPU                     | Redis CPU > 85%                              | ESCALATE (DevOps) |
| HIGH_MEMORY                  | Redis memory > 90%                           | ESCALATE (DevOps) |
| NO_STREAM_ISSUE              | Both streams healthy                         | MONITOR           |
`;

// ─────────────────────────────────────────────────────────────────────────────
// SECTION D: DECISION RULES
// Business rules all agents must follow.
// ─────────────────────────────────────────────────────────────────────────────

const DECISION_RULES = `
## Decision Rules (ALL AGENTS MUST FOLLOW)

1. SOURCE RULE: If source stream is down → NOTIFY_CUSTOMER only.
   NEVER restart G-Mana pods when the source is broken. It is not our fault.

2. REDIS RULE: If Redis cluster is down → ESCALATE to DevOps immediately.
   Pod restarts will not help when session state storage is unavailable.

3. VIP RULE: If channel is Keshet or Reshet → escalate to Yoni immediately, regardless of confidence.
   VIP customers must never wait for automated resolution.

4. CONFIDENCE RULE: If confidence score < 80% → recommend ESCALATE.
   Never guess when uncertain. Human review is safer than a wrong restart.

5. POD STABILITY RULE: If any pod has restarted more than 10 times → treat as unstable.
   Report as POD_UNSTABLE and escalate alongside any restart action.

6. RESTART ORDER: Always try in this sequence:
   a. RESTART_UH first  (manifest/502/sequence issues)
   b. RESTART_CI second (ad insertion/SCTE-35 issues)
   c. MOVE_TO_SOURCE as last resort (viewers see raw stream, no ads)

7. MAX RESTARTS: Never restart the same pod more than 2 times per incident.
   After 2 failed restarts → MOVE_TO_SOURCE + escalate to Yoni.

8. NOISE FILTER: Same channel alarmed more than 3 times in 60 minutes →
   flag as recurring pattern, escalate instead of restarting again.

9. COMMUNICATION RULE: Any message to a customer must be drafted by SenderAgent (future),
   reviewed by ManagerAgent, and approved by the support team before sending.
`;

// ─────────────────────────────────────────────────────────────────────────────
// SECTION E: AGENT DEFINITIONS
// Each agent's full role: what it is, how it receives data, what it does,
// how it communicates, what it returns, and what state it owns.
// ─────────────────────────────────────────────────────────────────────────────

// ══════════════════════════════════════════════════════════════════════════════
// AGENT 1: STREAM ANALYZER AGENT  [ACTIVE]
// File: backend/src/agents/StreamAnalyzerAgent.ts
// ══════════════════════════════════════════════════════════════════════════════

/**
 * STREAM ANALYZER AGENT — Full Role Definition
 * ──────────────────────────────────────────────
 *
 * WHAT IT IS:
 *   The first agent to run in every alarm cycle.
 *   Rule-based specialist — does NOT call GPT-4o, does NOT write incident state.
 *   Its job is to collect stream metadata, check stream health, and send a full
 *   report (including ds_uuid, urls, cluster) to ManagerAgent.
 *
 * HOW IT RECEIVES DATA:
 *   ManagerAgent calls: streamAnalyzer.analyze(alarm, streamUrls)
 *     alarm.dsUuid        — unique session ID
 *     alarm.channelName   — channel that triggered the alarm
 *     alarm.errorType     — alarm code (e.g. MAIN_MANIFEST_BAD_RESPONSE)
 *     alarm.reason        — reason text from Hub Monitor
 *     alarm.statusCode    — HTTP status code in the alarm
 *     streamUrls.sourcePlayerUrl — raw broadcaster stream URL
 *     streamUrls.gManaPlayerUrl  — G-Mana output stream URL
 *     streamUrls.clusterName     — Kubernetes cluster (e.g. hub1x)
 *     streamUrls.customerName    — customer name (used for VIP detection)
 *
 * WHAT IT DOES INTERNALLY:
 *   1. Identifies the affected channel using ds_uuid
 *   2. Retrieves and validates stream metadata (ds_uuid, sourceUrl, gManaUrl, cluster)
 *   3. Checks source URL + G-Mana URL simultaneously (HTTP HEAD in parallel)
 *   4. Analyzes the alarm type:
 *        MAIN_MANIFEST_BAD_RESPONSE — manifest stale or malformed
 *        SOURCE_TIMEOUT             — source not responding
 *        STREAM_UNAVAILABLE         — stream not accessible
 *   5. Evaluates severity based on alarm type and URL check results
 *   6. Detects VIP: channelName or customerName contains "keshet" or "reshet" (case-insensitive)
 *   7. Calculates confidence score:
 *        MANIFEST alarm + 404/502 HTTP response → 88%
 *        AD/SCTE alarm type                     → 82%
 *        502/503 status from G-Mana             → 85%
 *        Pattern does not clearly match          → 70% (flagged)
 *   8. Determines root cause assumption:
 *        source=DOWN + gmana=DOWN  → BOTH_DOWN      confidence=90
 *        source=DOWN + gmana=OK   → SOURCE_ISSUE    confidence=95
 *        source=OK   + gmana=DOWN → GMANA_ISSUE     confidence=70-88
 *        source=OK   + gmana=OK  → NO_ISSUE         confidence=85
 *   9. Sets flaggedForFurtherAnalysis = true if confidence < 80%
 *
 * HOW IT COMMUNICATES BACK:
 *   Returns a StreamAnalysisReport to ManagerAgent (direct TypeScript return value).
 *   ManagerAgent reads this report and decides next steps.
 *   This report is also the source of data (ds_uuid, urls, cluster) that
 *   ManagerAgent will distribute to ResourcesAnalyzerAgent.
 *
 * StreamAnalysisReport contains:
 *   channelName, dsUuid, isVip
 *   alarmType, alarmReason
 *   sourceStatus ("healthy" | "down")
 *   gmanaStatus  ("healthy" | "down")
 *   rootCauseAssumption (SOURCE_ISSUE | GMANA_ISSUE | BOTH_DOWN | NO_ISSUE)
 *   severity ("low" | "medium" | "high" | "critical")
 *   confidenceScore (0-100)
 *   sourceResult (full PlayerCheckResult from ErrorDetectionPlayerTool)
 *   gmanaResult  (full PlayerCheckResult from ErrorDetectionPlayerTool)
 *   flaggedForFurtherAnalysis (bool)
 *   details (human-readable explanation)
 *
 * INCIDENT STATE IMPACT:
 *   None. Read-only agent. ManagerAgent writes all incident state.
 *
 * ENABLES EARLY EXITS (before ResourcesAnalyzer or GPT-4o runs):
 *   SOURCE_ISSUE → ManagerAgent notifies customer only, no pod restarts, STOP
 *   NO_ISSUE     → Alarm was transient, no action needed, STOP
 */
export const STREAM_ANALYZER_ROLE = `
AGENT: StreamAnalyzerAgent
FILE:  backend/src/agents/StreamAnalyzerAgent.ts
STATUS: ACTIVE
TYPE:  Rule-based specialist (no GPT-4o, no state writes)

─── ROLE ──────────────────────────────────────────────────────────────────────
First agent to run in every alarm cycle. Collects stream metadata, checks both
stream URLs, evaluates alarm type, detects VIP, calculates confidence score.
Sends full report (including ds_uuid, urls, cluster) to ManagerAgent.


1. Identify channel using ds_uuid
2. Validate stream metadata (sourceUrl, gManaUrl, cluster)
3. ErrorDetectionPlayerTool.checkBoth(sourceUrl, gManaUrl) — both in parallel
4. Analyze alarm type: MAIN_MANIFEST_BAD_RESPONSE | SOURCE_TIMEOUT | STREAM_UNAVAILABLE
5. Root cause decision:
     source=DOWN + gmana=DOWN  → BOTH_DOWN      confidence=90  severity=low
     source=OK   + gmana=DOWN → GMANA_ISSUE     confidence=70-88 severity=high/critical
     source=OK   + gmana=OK  → NO_ISSUE         confidence=85  severity=low
6. VIP detection: channelName or customerName contains "keshet" or "reshet"
7. Confidence scoring by alarm-to-error pattern alignment
8. flaggedForFurtherAnalysis = confidence < 80%

─── COMMUNICATION OUT ─────────────────────────────────────────────────────────
Returns to: ManagerAgent (direct TypeScript return value)
Report:     StreamAnalysisReport {
              channelName, dsUuid, isVip,
              alarmType, alarmReason,
              sourceStatus, gmanaStatus,
              rootCauseAssumption, severity, confidenceScore,
              sourceResult, gmanaResult,
              flaggedForFurtherAnalysis, details
            }

This report is the source of ds_uuid, urls, and clusterName that
ManagerAgent distributes to ResourcesAnalyzerAgent.

─── STATE CHANGES ─────────────────────────────────────────────────────────────
None. ManagerAgent writes all incident state based on this report.
`;

// ══════════════════════════════════════════════════════════════════════════════
// AGENT 2: RESOURCES ANALYZER AGENT  [ACTIVE]
// File: backend/src/agents/ResourcesAnalyzerAgent.ts
// ══════════════════════════════════════════════════════════════════════════════

/**
 * RESOURCES ANALYZER AGENT — Full Role Definition
 * ─────────────────────────────────────────────────
 *
 * WHAT IT IS:
 *   Second analysis agent. Checks all infrastructure health for the affected channel.
 *   Rule-based specialist — does NOT call GPT-4o, does NOT write incident state.
 *   Runs after ManagerAgent distributes data from the StreamAnalysisReport.
 *
 * HOW IT RECEIVES DATA:
 *   ManagerAgent extracts from StreamAnalysisReport and calls:
 *   resourcesAnalyzer.analyze(clusterName, dsUuid)
 *     clusterName — from StreamAnalysisReport (e.g. "hub1x")
 *     dsUuid      — from AlarmData
 *
 * WHAT IT DOES INTERNALLY (all three fetches run in parallel via Promise.allSettled):
 *
 *   CHECK 1 — UH Pod Health
 *     GET /sendalarms/clusters/{cluster}/pods/user-handler-{dsUuid}/logs
 *     Checks pod state: Running | Pending | Failed
 *     Counts restarts — if > 10 → pod is UNSTABLE
 *     Scans logs for: ERROR, WARN, CrashLoop, OOMKilled, panic
 *
 *   CHECK 2 — CI Pod Health
 *     GET /sendalarms/clusters/{cluster}/pods/cuemana-in-{dsUuid}/logs
 *     Checks pod state: Running | Pending | Failed
 *     Counts restarts — if > 10 → pod is UNSTABLE
 *     Scans logs for: ERROR, WARN, CrashLoop
 *
 *   CHECK 3 — Redis Cluster Health (all three clusters)
 *     GET /sendalarms/clusters/{cluster}/redis-instances
 *     Monitors: Reshet cluster, Keshet cluster, General customers cluster
 *     Checks per instance: isHealthy, cpuUsagePercent, usedMemoryBytes/maxMemoryBytes
 *
 *   If any fetch fails → allSettled ensures other results are still used.
 *
 *   Detection priority (first match wins):
 *     Redis isHealthy=false          → REDIS_DOWN   REDIS   critical  92%
 *     UH errors AND CI errors        → POD_CRASH    UH      high      82%
 *     UH errors only                 → POD_CRASH    UH      high      87%
 *     CI errors only                 → POD_CRASH    CI      medium    82%
 *     Redis memory > 90%             → MEMORY_HIGH  REDIS   medium    75%
 *     Redis CPU > 85%                → CPU_HIGH     REDIS   low       70%
 *     Restart count > 10             → POD_UNSTABLE UH/CI   high      82%
 *     None of the above              → NONE         NONE    low       85%
 *
 * HOW IT COMMUNICATES BACK:
 *   Returns a ResourcesAnalysisReport to ManagerAgent (direct TypeScript return value).
 *
 * ResourcesAnalysisReport contains:
 *   clusterName, dsUuid
 *   uhLogs (PodLogs: podName + logs string)
 *   ciLogs (PodLogs: podName + logs string)
 *   redisResources (ClusterResources: all Redis instance stats)
 *   affectedComponent ("UH" | "CI" | "REDIS" | "NONE" | "UNKNOWN")
 *   resourceIssueType ("CPU_HIGH" | "MEMORY_HIGH" | "REDIS_DOWN" | "POD_CRASH" | "NONE")
 *   severity ("low" | "medium" | "high" | "critical")
 *   possibleStreamImpact (plain-English description)
 *   confidenceScore (0-100)
 *   flaggedForFurtherAnalysis (bool)
 *   details (human-readable explanation)
 *
 * INCIDENT STATE IMPACT:
 *   None. Read-only agent. ManagerAgent writes all state.
 *
 * IMPORTANT: Logs are fetched BEFORE any restart is triggered.
 *   UH and CI logs are lost when a pod restarts. Fetching here preserves evidence.
 */
export const RESOURCES_ANALYZER_ROLE = `
AGENT: ResourcesAnalyzerAgent
FILE:  backend/src/agents/ResourcesAnalyzerAgent.ts
STATUS: ACTIVE
TYPE:  Rule-based specialist (no GPT-4o, no state writes)

─── ROLE ──────────────────────────────────────────────────────────────────────
Second analysis agent. Checks infrastructure health (UH pod, CI pod, Redis clusters).
Receives data distributed by ManagerAgent from the StreamAnalysisReport.
Reports findings back to ManagerAgent.

─── COMMUNICATION IN ──────────────────────────────────────────────────────────
Caller:  ManagerAgent
Method:  resourcesAnalyzer.analyze(clusterName, dsUuid)
Source:  ManagerAgent extracts clusterName and dsUuid from StreamAnalysisReport

Receives:
  clusterName — Kubernetes cluster name from StreamAnalysisReport (e.g. "hub1x")
  dsUuid      — unique session ID for the affected channel

─── INTERNAL LOGIC ────────────────────────────────────────────────────────────
All three checks run simultaneously via Promise.allSettled (partial failure OK):

CHECK 1 → UH Pod
  GET /sendalarms/clusters/{cluster}/pods/user-handler-{dsUuid}/logs
  Pod state check: Running | Pending | Failed
  Restart count: if > 10 → POD_UNSTABLE
  

CHECK 2 → CI Pod
  GET /sendalarms/clusters/{cluster}/pods/cuemana-in-{dsUuid}/logs
  Pod state check: Running | Pending | Failed
  Restart count: if > 10 → POD_UNSTABLE
  

CHECK 3 → Redis Clusters
  GET /sendalarms/clusters/{cluster}/redis-instances
  Monitors: Reshet cluster | Keshet cluster | General customers cluster
  Per instance: isHealthy, cpuUsagePercent, usedMemoryBytes/maxMemoryBytes
  Result: redisDown (bool), highCpu (bool), highMemory (bool)



─── COMMUNICATION OUT ─────────────────────────────────────────────────────────
Returns to: ManagerAgent (direct TypeScript return value)
Report:     ResourcesAnalysisReport {
              clusterName, dsUuid,
              uhLogs, ciLogs, redisResources,
              affectedComponent, resourceIssueType, severity,
              confidenceScore, possibleStreamImpact, details,
              flaggedForFurtherAnalysis
            }

─── STATE CHANGES ─────────────────────────────────────────────────────────────
`;

// ══════════════════════════════════════════════════════════════════════════════
// AGENT 3: ANALYZE STREAM AGENT  [FUTURE — NOT YET IMPLEMENTED]
// File: backend/src/agents/AnalyzeStreamAgent.ts  (to be created)
// ══════════════════════════════════════════════════════════════════════════════

/**
 * ANALYZE STREAM AGENT — Full Role Definition
 * ────────────────────────────────────────────
 *
 * STATUS: FUTURE — not yet implemented.
 *
 * WHAT IT WILL DO:
 *   Perform deep stream debugging when basic monitoring cannot determine the problem.
 *   Opens both source URL and G-Mana URL using a player debugging tool.
 *   Observes stream behavior for approximately 30 seconds.
 *   Analyzes the manifest and segments in detail.
 *
 * HOW IT WILL RECEIVE DATA:
 *   ManagerAgent will call: analyzeStreamAgent.analyze(sourceUrl, gManaUrl)
 *   Data will come from ManagerAgent, which extracted it from StreamAnalysisReport.
 *
 * WHAT IT WILL DETECT:
 *   - Media sequence jumps
 *   - Discontinuities in the stream
 *   - Segment mismatches
 *   - Missing segments
 *   - Slow segment downloads
 *   - HTTP errors (403, 404, 502)
 *
 * WHAT IT WILL RECORD PER ERROR:
 *   - Segment time range
 *   - Error type
 *   - HTTP status codes
 *   - Performance metrics
 *
 * HOW IT WILL COMMUNICATE BACK:
 *   Will return an AnalyzeStreamReport to ManagerAgent.
 *   ManagerAgent will include this in the GPT-4o synthesis alongside the other reports.
 */
export const ANALYZE_STREAM_ROLE = `
AGENT: AnalyzeStreamAgent
FILE:  backend/src/agents/AnalyzeStreamAgent.ts  (TO BE CREATED)
STATUS: FUTURE — not yet implemented

─── ROLE ──────────────────────────────────────────────────────────────────────
Deep stream debugging agent. Opens source + G-Mana URLs with a player tool,
observes stream for ~30 seconds, detects manifest and segment-level errors.

─── COMMUNICATION IN ──────────────────────────────────────────────────────────
Caller:  ManagerAgent
Method:  analyzeStreamAgent.analyze(sourceUrl, gManaUrl)
Source:  ManagerAgent extracts URLs from StreamAnalysisReport

─── WILL DETECT ───────────────────────────────────────────────────────────────
  • Media sequence jumps
  • Discontinuities
  • Segment mismatches
  • Missing segments
  • Slow segment downloads
  • HTTP errors (403 / 404 / 502)

─── COMMUNICATION OUT ─────────────────────────────────────────────────────────
Returns to: ManagerAgent
Report:     AnalyzeStreamReport {
              segmentTimeRange, errorType, httpStatusCodes,
              performanceMetrics, details, confidenceScore
            }



─── CURRENT STATUS ────────────────────────────────────────────────────────────
NOT ACTIVE. Planned for a future implementation phase.
`;

// ══════════════════════════════════════════════════════════════════════════════
// AGENT 4: SENDER AGENT  [FUTURE — NOT YET IMPLEMENTED]
// File: backend/src/agents/SenderAgent.ts  (to be created)
// ══════════════════════════════════════════════════════════════════════════════

/**
 * SENDER AGENT — Full Role Definition
 * ─────────────────────────────────────
 *
 * STATUS: FUTURE — not yet implemented.
 *
 * WHAT IT WILL DO:
 *   Handle ALL external communication with customers and internal teams.
 *   Channels: WhatsApp Business API + Outlook email.
 *   Prepare message drafts based on predefined templates depending on situation.
 *
 * COMMUNICATION SITUATIONS (templates):
 *   - investigation_started    — "We are investigating an issue with your stream"
 *   - issue_detected           — "We have detected an issue and are working on it"
 *   - clarification_required   — "We need additional info from your team"
 *   - resolution_confirmation  — "Your stream has been restored"
 *   - escalation_notice        — "We are escalating this to our senior team"
 *
 * HOW IT WILL RECEIVE DATA:
 *   ManagerAgent will call: senderAgent.prepareDraft(situation, incidentContext)
 *   ManagerAgent instructs the agent on which template to use and provides context.
 *
 * APPROVAL WORKFLOW (MANDATORY):
 *   1. SenderAgent prepares the message draft
 *   2. SenderAgent sends the DRAFT back to ManagerAgent for review
 *   3. ManagerAgent reviews and optionally edits the draft
 *   4. ManagerAgent requests final approval from the support team
 *   5. Only after team approval → SenderAgent sends the message
 *   NO message is EVER sent without this approval workflow.
 *
 * HOW IT WILL COMMUNICATE BACK:
 *   Returns a MessageDraft to ManagerAgent for review.
 *   After approval: returns MessageSentConfirmation to ManagerAgent.
 */
export const SENDER_AGENT_ROLE = `
AGENT: SenderAgent
FILE:  backend/src/agents/SenderAgent.ts  (TO BE CREATED)
STATUS: FUTURE — not yet implemented

─── ROLE ──────────────────────────────────────────────────────────────────────
Handles all external communication. Prepares message drafts using predefined
templates, sends drafts to ManagerAgent for review, waits for support team
approval before sending. NEVER sends without approval.

─── COMMUNICATION IN ──────────────────────────────────────────────────────────
Caller:  ManagerAgent
Method:  senderAgent.prepareDraft(situation, incidentContext)
Receives:
  situation        — which template to use (investigation_started / issue_detected / etc.)
  incidentContext  — channel name, customer, error type, action taken, duration

─── TEMPLATES ─────────────────────────────────────────────────────────────────
  investigation_started    — alarm received, we are investigating
  issue_detected           — problem confirmed, we are working on it
  clarification_required   — need info from customer
  resolution_confirmation  — stream restored
  escalation_notice        — escalating to senior team

─── APPROVAL WORKFLOW ─────────────────────────────────────────────────────────
  1. SenderAgent prepares draft
  2. Draft sent to ManagerAgent for review          ← BACK TO MANAGER
  3. ManagerAgent reviews / edits
  4. ManagerAgent requests support team approval
  5. Support team approves
  6. SenderAgent sends message                      ← ONLY AFTER APPROVAL

─── COMMUNICATION OUT ─────────────────────────────────────────────────────────
Returns to ManagerAgent: MessageDraft { channel, recipient, body, template }
After approval: sends via WhatsApp Business API or Outlook email

─── CHANNELS ──────────────────────────────────────────────────────────────────
  WhatsApp Business API
  Outlook email

─── STATE CHANGES ─────────────────────────────────────────────────────────────
None. ManagerAgent writes all state.

─── CURRENT STATUS ────────────────────────────────────────────────────────────
NOT ACTIVE. Planned for a future implementation phase.
`;

// ══════════════════════════════════════════════════════════════════════════════
// AGENT 5: MANAGER AGENT  [ACTIVE — Orchestrator]
// File: backend/src/agents/ManagerAgent.ts
// ══════════════════════════════════════════════════════════════════════════════

/**
 * MANAGER AGENT — Full Role Definition
 * ──────────────────────────────────────
 *
 * WHAT IT IS:
 *   The central orchestrator. The ONLY agent that calls GPT-4o.
 *   The ONLY agent that writes incident state to InMemoryStore.
 *   The ONLY agent that calls HubMonitorTool for restarts.
 *   All other agents report to it — it makes every final decision.
 *   All agents communicate ONLY through the ManagerAgent.
 *
 * HOW IT RECEIVES DATA:
 *   1. Hub Monitor polling (index.ts):
 *        processAlarms(alarms: AlarmData[]) — every POLL_INTERVAL_MS (default 30s)
 *   2. StreamAnalyzerAgent:
 *        StreamAnalysisReport — returned from streamAnalyzer.analyze()
 *        Contains: rootCauseAssumption, ds_uuid, source_url, g_mana_url, cluster, isVip
 *   3. ResourcesAnalyzerAgent:
 *        ResourcesAnalysisReport — returned from resourcesAnalyzer.analyze()
 *   4. ApprovalService:
 *        { decision: "approved"|"rejected"|"timeout", decidedBy }
 *
 * WHAT IT DOES — FULL STEP-BY-STEP:
 *
 *   Step 1 — THRESHOLD CHECK
 *     Tracks alarm count in the last 60 min for this dsUuid.
 *     count < 3 → create incident state=NEW, watch.
 *     count >= 3 AND age < waitingTime → update label, wait.
 *     count >= 3 AND age >= waitingTime → full investigation.
 *
 *   Step 2 — TRIGGER STREAM ANALYZER
 *     Calls streamAnalyzer.analyze(alarm, streamUrls)
 *     Receives StreamAnalysisReport.
 *
 *   Step 3 — EARLY EXIT CHECK
 *     Reads rootCauseAssumption from StreamAnalysisReport.
 *     SOURCE_ISSUE → notify customer, STOP (do not restart pods)
 *     NO_ISSUE     → alarm was transient, STOP
 *
 *   Step 4 — DISTRIBUTE DATA TO ANALYSIS AGENTS
 *     Extracts from StreamAnalysisReport: clusterName, dsUuid (source + gmana urls for future)
 *     Calls: resourcesAnalyzer.analyze(clusterName, dsUuid)   [ACTIVE]
 *     Future: analyzeStreamAgent.analyze(sourceUrl, gManaUrl) [FUTURE]
 *     Sets incident state → ANALYZING
 *
 *   Step 5 — RECEIVE AGENT REPORTS
 *     Collects ResourcesAnalysisReport (and future: AnalyzeStreamReport)
 *
 *   Step 6 — GPT-4o SYNTHESIS
 *     System prompt: getManagerSynthesisPrompt() from SystemKnowledgeBase
 *     User message:  buildManagerSynthesisContext() with all agent reports + alarm
 *     GPT-4o returns: { recommendedAction, confidenceScore, explanation, errorCode }
 *     Fallback: ruleBasedDecision() if GPT-4o fails
 *
 *   Step 7 — HUMAN APPROVAL
 *     Sets state → WAITING_APPROVAL
 *     Waits for explicit operator approval — NEVER auto-executes on timeout
 *     Timeout → state=ESCALATED, STOP (permission required)
 *     Rejected → state=ESCALATED, STOP
 *
 *   Step 8 — EXECUTE ACTION
 *     Sets state → EXECUTING_ACTION
 *     attempt 0 → restartUH() → wait 30s
 *     attempt 1 → restartCI() → wait 30s
 *     attempt 2 → MOVE_TO_SOURCE → state=ESCALATED → STOP
 *
 *   Step 9 — VERIFY
 *     Sets state → MONITORING
 *     Checks both URLs up to 3 times (30s apart)
 *     Healthy → closeIncident()
 *     Still broken → next attempt (Step 8)
 *
 *   Step 10 — COMMUNICATION (FUTURE)
 *     Instructs SenderAgent to prepare a customer message draft.
 *     Reviews draft, requests support team approval, then sends.
 *
 *   Step 11 — CLOSE
 *     Sets state → CLOSED
 *     Saves pattern: "restart_success:{dsUuid}:{action}"
 *
 * STATE TRANSITIONS:
 *   NEW → ANALYZING → WAITING_APPROVAL → EXECUTING_ACTION → MONITORING → CLOSED
 *                  ↘ RESOLVED (early exit: source down or no issue)
 *                                      ↘ ESCALATED (rejected / VIP / max restarts)
 */
export const MANAGER_AGENT_ROLE = `
AGENT: ManagerAgent
FILE:  backend/src/agents/ManagerAgent.ts
STATUS: ACTIVE
TYPE:  Orchestrator (calls GPT-4o, writes all incident state, executes all actions)

─── ROLE ──────────────────────────────────────────────────────────────────────
Central coordinator. All agents communicate ONLY through the ManagerAgent.
Triggers StreamAnalyzer first, reads its report, distributes data to other agents,
collects all reports, calls GPT-4o for final decision, manages approval and actions.

─── COMMUNICATION IN ──────────────────────────────────────────────────────────
Source 1:  Hub Monitor polling → AlarmData[] { dsUuid, channelName, status, errorType, reason }
Source 2:  StreamAnalyzerAgent → StreamAnalysisReport (includes ds_uuid, urls, cluster)
Source 3:  ResourcesAnalyzerAgent → ResourcesAnalysisReport
Source 4:  AnalyzeStreamAgent (future) → AnalyzeStreamReport
Source 5:  ApprovalService → { decision: approved|rejected|timeout, decidedBy }
Source 6:  SenderAgent (future) → MessageDraft for review

─── WHAT IT DISTRIBUTES ───────────────────────────────────────────────────────
To StreamAnalyzerAgent:     alarm data + streamUrls
To ResourcesAnalyzerAgent:  clusterName + dsUuid (extracted from StreamAnalysisReport)
To AnalyzeStreamAgent:      sourceUrl + gManaUrl (future, from StreamAnalysisReport)
To GPT-4o:                  getManagerSynthesisPrompt() + buildManagerSynthesisContext()
To ApprovalService:         waitForApproval(incidentId, action, context, timeout)
To HubMonitorTool:          restartUH(cluster, dsUuid) / restartCI(cluster, dsUuid)
To InMemoryStore:           createIncident() / updateIncident() at every state change
To SenderAgent (future):    situation + incidentContext for message draft

─── STATE MACHINE ─────────────────────────────────────────────────────────────
NEW              → alarm received, threshold not met, watching
ANALYZING        → StreamAnalyzer ran, distributing data to other agents
WAITING_APPROVAL → GPT-4o decision ready, awaiting human confirmation (timeout = escalate)
EXECUTING_ACTION → restart command being sent to Hub Monitor API
MONITORING       → restart complete, verifying stream health (3 checks × 30s)
RESOLVED         → no action needed (source down or transient alarm) — terminal
ESCALATED        → rejected / VIP / max restarts / confidence too low — terminal
CLOSED           → stream healthy, pattern saved — terminal

─── ACTION ORDER ──────────────────────────────────────────────────────────────
attempt 0 → RESTART_UH   (restartAttempts=0)
attempt 1 → RESTART_CI   (restartAttempts=1)
attempt 2 → MOVE_TO_SOURCE + ESCALATED (max restarts reached)

─── EARLY EXITS ───────────────────────────────────────────────────────────────
SOURCE_ISSUE → state=RESOLVED, customer notified, pods NOT touched, STOP
NO_ISSUE     → no state change, no action, STOP

─── FALLBACK ──────────────────────────────────────────────────────────────────
If GPT-4o call fails → ruleBasedDecision() applies hard-coded rules from agent reports.
`;

// ─────────────────────────────────────────────────────────────────────────────
// SECTION F: GPT-4o PROMPTS
// The exact system prompts sent to GPT-4o.
// Only ManagerAgent currently calls GPT-4o (synthesis step).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * PROMPT: Manager Agent — Synthesis
 * ────────────────────────────────────
 * Used by: ManagerAgent.synthesizeReports()
 *
 * GPT-4o reads all agent reports and decides the final remediation action.
 */
export function getManagerSynthesisPrompt(): string {
  return `
${PLATFORM_CONTEXT}
${ERROR_CODEBOOK}
${DECISION_RULES}

## Your Role
You are the ManagerAgent — the central decision-maker of the G-Mana monitoring system.
You have received analysis reports from the following agents:
  - StreamAnalyzerAgent: checked source and G-Mana stream URLs for errors
  - ResourcesAnalyzerAgent: checked UH pod, CI pod, and Redis cluster health

Your job is to synthesize all reports and recommend the single best action.

## Correlation Rules
- StreamAnalyzer says GMANA_ISSUE AND ResourcesAnalyzer says UH errors → RESTART_UH (high confidence)
- StreamAnalyzer says GMANA_ISSUE AND ResourcesAnalyzer says CI errors → RESTART_CI (high confidence)
- StreamAnalyzer says GMANA_ISSUE AND ResourcesAnalyzer says REDIS_DOWN → ESCALATE (pod restart won't help)
- StreamAnalyzer says GMANA_ISSUE AND ResourcesAnalyzer says NONE → RESTART_UH (moderate confidence)
- Either agent confidence < 80% → ESCALATE
- VIP channel (isVip=true) AND confidence < 80% → ESCALATE
- Any pod with restartCount > 10 → note as unstable, still try restart but flag for escalation

## Output Format
Respond ONLY in valid JSON (no markdown, no explanation outside JSON):
{
  "recommendedAction": "RESTART_UH | RESTART_CI | NOTIFY_CUSTOMER_SOURCE_DOWN | ESCALATE | MOVE_TO_SOURCE",
  "confidenceScore": 0-100,
  "explanation": "one sentence explaining the decision based on both reports",
  "errorCode": "the most specific matching error code from the codebook"
}
`;
}

/**
 * PROMPT: Customer Short Notification (future SenderAgent)
 */
export function getCustomerNotificationPrompt(): string {
  return `
${PLATFORM_CONTEXT}

## Your Role
Draft a SHORT customer notification about an active stream issue.

Rules:
- Maximum 3 sentences
- No internal technical terms (no UH, CI, Redis, pods, ds_uuid, cluster names)
- Reassuring but honest tone
- Do not promise a specific resolution time unless given one
- Plain text only, no markdown

The incident details will be provided in the user message.
`;
}

/**
 * PROMPT: Customer Resolution Message (future SenderAgent)
 */
export function getCustomerResolutionPrompt(): string {
  return `
${PLATFORM_CONTEXT}

## Your Role
Draft a RESOLUTION message informing the customer their stream has been restored.

Rules:
- Start with confirmation that stream is restored
- Include incident duration
- Brief, non-technical cause explanation
- Warm, professional close
- For VIP customers, include an apology
- 3-5 sentences maximum
- Plain text only

The incident details will be provided in the user message.
`;
}

/**
 * PROMPT: Escalation Report (future EscalationAgent)
 */
export function getEscalationReportPrompt(): string {
  return `
${PLATFORM_CONTEXT}
${ERROR_CODEBOOK}
${DECISION_RULES}

## Your Role
Generate a detailed ESCALATION REPORT for Yoni (Senior Engineer).

Include ALL of the following:
- Incident ID and ds_uuid
- Channel name and customer (flag VIP if applicable)
- Cluster and Redis cluster name
- Error code and what it means
- Timeline of events
- All automated actions attempted and their outcomes
- Confidence scores from StreamAnalyzerAgent and ResourcesAnalyzerAgent
- Why automated resolution failed
- Recommended next manual steps
- Current G-Mana and Source stream status

Format: Use emoji + bold headers for quick mobile scanning.
Tone: Technical, factual, urgent for VIP.
`;
}

/**
 * PROMPT: Root Cause Analysis (future MemoryAgent)
 */
export function getRootCauseAnalysisPrompt(): string {
  return `
${PLATFORM_CONTEXT}
${ERROR_CODEBOOK}
${DECISION_RULES}

## Your Role
Perform a ROOT CAUSE ANALYSIS based on the incident history provided.

Analyze:
1. Is this a recurring pattern? (same error code, same time of day, same Redis cluster?)
2. Did the same fix work multiple times? → Persistent underlying issue
3. Are multiple channels on the same cluster affected? → Cluster-level issue
4. Does this correlate with Redis cluster health?

Respond in JSON:
{
  "isRecurring": true/false,
  "patternDescription": "description of the pattern",
  "rootCauseHypothesis": "most likely underlying cause",
  "preventiveMeasure": "what should be done to prevent recurrence",
  "affectedScope": "channel | cluster | customer | platform",
  "recommendedEscalation": true/false
}
`;
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION G: CONTEXT BUILDERS
// Build the dynamic user message that pairs with each system prompt.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Builds the user message for ManagerAgent's GPT-4o synthesis call.
 * Formats all agent reports into a structured block GPT-4o can reason over.
 */
export function buildManagerSynthesisContext(params: {
  alarm: {
    channelName: string;
    errorType: string;
    reason: string;
    statusCode: number;
  };
  streamReport: {
    rootCauseAssumption: string;
    sourceStatus: string;
    gmanaStatus: string;
    severity: string;
    confidenceScore: number;
    flaggedForFurtherAnalysis: boolean;
    isVip: boolean;
    alarmType: string;
    details: string;
    sourceResult: { hasError: boolean; statusCode: number | null; errorType: string | null };
    gmanaResult: { hasError: boolean; statusCode: number | null; errorType: string | null };
  };
  resourcesReport: {
    affectedComponent: string;
    resourceIssueType: string;
    severity: string;
    confidenceScore: number;
    flaggedForFurtherAnalysis: boolean;
    possibleStreamImpact: string;
    details: string;
  } | null;
}): string {
  return `
## StreamAnalyzerAgent Report
- Channel: ${params.streamReport.isVip ? `${params.alarm.channelName} ⭐ VIP` : params.alarm.channelName}
- Alarm Type: ${params.streamReport.alarmType}
- Source Status: ${params.streamReport.sourceStatus}
- G-Mana Status: ${params.streamReport.gmanaStatus}
- Root Cause Assumption: ${params.streamReport.rootCauseAssumption}
- Severity: ${params.streamReport.severity}
- Confidence Score: ${params.streamReport.confidenceScore}%
- Flagged for Further Analysis: ${params.streamReport.flaggedForFurtherAnalysis}
- Source HTTP status: ${params.streamReport.sourceResult.statusCode} | error: ${params.streamReport.sourceResult.errorType ?? 'none'}
- G-Mana HTTP status: ${params.streamReport.gmanaResult.statusCode} | error: ${params.streamReport.gmanaResult.errorType ?? 'none'}
- Details: ${params.streamReport.details}

## ResourcesAnalyzerAgent Report
${
  params.resourcesReport
    ? `- Affected Component: ${params.resourcesReport.affectedComponent}
- Resource Issue Type: ${params.resourcesReport.resourceIssueType}
- Severity: ${params.resourcesReport.severity}
- Confidence Score: ${params.resourcesReport.confidenceScore}%
- Flagged for Further Analysis: ${params.resourcesReport.flaggedForFurtherAnalysis}
- Possible Stream Impact: ${params.resourcesReport.possibleStreamImpact}
- Details: ${params.resourcesReport.details}`
    : '- ResourcesAnalyzerAgent did not return a report (fetch failed). Treat infrastructure status as unknown.'
}

## Original Alarm Data
- Error Type: ${params.alarm.errorType}
- Reason: ${params.alarm.reason}
- HTTP Status: ${params.alarm.statusCode}

Based on all agent reports above, provide your final recommendation.
${params.streamReport.isVip ? '\n⭐ VIP CHANNEL — apply VIP decision rules strictly.' : ''}
`;
}

/**
 * Builds user message for customer notification drafting.
 */
export function buildCustomerNotificationContext(params: {
  channelName: string;
  customerId: string;
  isVip: boolean;
  errorCode: string;
  durationMinutes: number;
  actionTaken?: string;
}): string {
  return `
Channel: ${params.channelName}
Customer: ${params.customerId}${params.isVip ? ' (VIP)' : ''}
Issue Type: ${params.errorCode}
Duration So Far: ${params.durationMinutes} minutes
Action Being Taken: ${params.actionTaken || 'Under investigation'}

Draft the customer notification message.
`;
}

/**
 * Builds user message for resolution notification.
 */
export function buildCustomerResolutionContext(params: {
  channelName: string;
  customerId: string;
  isVip: boolean;
  errorCode: string;
  durationMinutes: number;
  actionTaken: string;
}): string {
  return `
Channel: ${params.channelName}
Customer: ${params.customerId}${params.isVip ? ' (VIP)' : ''}
Issue Type: ${params.errorCode}
Total Incident Duration: ${params.durationMinutes} minutes
What Resolved It: ${params.actionTaken}

Draft the resolution message.
`;
}

/**
 * Builds user message for escalation report to Yoni.
 */
export function buildEscalationContext(params: {
  incidentId: string;
  dsUuid: string;
  channelName: string;
  isVip: boolean;
  clusterName: string;
  redisInstance: string;
  reason: string;
  actionsAttempted: string[];
  streamConfidence: number;
  resourcesConfidence: number;
  gManaStatus: string;
  sourceStatus: string;
  jiraKey?: string;
}): string {
  return `
Incident ID: ${params.incidentId}
Channel: ${params.channelName}${params.isVip ? ' ⭐ VIP' : ''}
UUID: ${params.dsUuid}
Cluster: ${params.clusterName}
Redis Cluster: ${params.redisInstance}
Escalation Reason: ${params.reason}
StreamAnalyzer Confidence: ${params.streamConfidence}%
ResourcesAnalyzer Confidence: ${params.resourcesConfidence}%
Jira: ${params.jiraKey || 'Not created yet'}

Actions Attempted:
${params.actionsAttempted.map((a, i) => `${i + 1}. ${a}`).join('\n')}

Current Status:
- G-Mana Stream: ${params.gManaStatus}
- Source Stream: ${params.sourceStatus}

Generate the escalation report for Yoni.
`;
}
