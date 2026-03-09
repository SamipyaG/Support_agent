# G-Mana Support AI — How the AI Learns About Your System

## The Most Important Concept: LLMs Have No Memory

GPT-4o does not "remember" anything between API calls. Every time we call
OpenAI, it starts completely fresh — it has never heard of G-Mana, SSAI,
User Handler, CueMana-In, ds_uuid, or any of your system's concepts.

**We teach it everything in real time, on every call.**

This is done via the **system message** — a structured briefing document we
inject at the start of every API request. Think of it like handing an
expert contractor a 10-page spec sheet before each task.

---

## Where the AI Knowledge Lives

### 📁 `backend/src/agents/SystemKnowledgeBase.ts`

**This is the single most important file in the entire project.**

It contains every piece of G-Mana knowledge that GPT-4o receives.
If you want the AI to behave differently — understand a new error,
follow a new business rule, or write messages differently — **you edit this file.**

```
SystemKnowledgeBase.ts
├── PLATFORM_CONTEXT       ← What is G-Mana? What is SSAI? What are UH/CI/Redis?
├── ERROR_CODEBOOK         ← Every known error code with cause and fix
├── DECISION_RULES         ← Business rules (VIP, max restarts, confidence threshold)
├── ACTION_PLAYBOOK        ← Step-by-step remediation procedures
├── TONE_GUIDE             ← How to write customer messages
│
├── getIncidentAnalysisPrompt()     ← System prompt for GPT-4o analysis
├── getCustomerShortMessagePrompt() ← System prompt for customer notifications
├── getCustomerResolutionPrompt()   ← System prompt for resolution messages
├── getEscalationReportPrompt()     ← System prompt for Yoni's report
├── getCustomerQAPrompt()           ← System prompt for Q&A from email/WhatsApp
├── getRootCauseAnalysisPrompt()    ← System prompt for pattern analysis
├── getManifestInterpretationPrompt() ← System prompt for HLS/DASH analysis
│
├── buildIncidentContext()          ← Formats incident data for GPT user message
├── buildCustomerMessageContext()   ← Formats customer info for message drafting
└── buildEscalationContext()        ← Formats escalation data for Yoni's report
```

---

## How One GPT-4o Call Works (Step by Step)

Here is the anatomy of the most important AI call in the system —
the one that merges all agent results into a final recommendation.

### 1. The API call is made in `ManagerAgent.mergeAnalysisResultsWithGPT()`

```typescript
const response = await this.openai.chat.completions.create({
  model: 'gpt-4o',
  messages: [
    {
      role: 'system',
      content: getIncidentAnalysisPrompt(), // ← G-Mana knowledge
    },
    {
      role: 'user',
      content: buildIncidentContext({...}), // ← This incident's data
    },
  ],
  response_format: { type: 'json_object' },
});
```

### 2. The `system` message contains (from `getIncidentAnalysisPrompt()`):

```
You are an expert support engineer at G-Mana, a Server-Side Ad Insertion (SSAI) platform.

## What is G-Mana?
G-Mana intercepts HLS/DASH streams, stitches ads at SCTE-35 cue points...

## Core Terminology
- ds_uuid: unique stream session identifier
- User Handler (UH): main pod managing the stream
- CueMana-In (CI): ad insertion engine pod
- Clusters: hub1x, hub21 (where pods run)
- Redis instances: Am, Bm, Cm (session state storage)
...

## Error Codes Reference
| MPD_MANIFEST_BAD_RESPONSE | G-Mana manifest stale | UH memory leak | Restart UH |
| SSAI_AD_BREAK_NOT_DETECTED | No SCTE-35 markers | CI stalled | Restart CI |
...

## Decision Rules (MUST FOLLOW)
1. VIP channels → notify Yoni immediately
2. Confidence < 80% → never auto-act, escalate
3. Source broken → DO NOT restart G-Mana pods
...

## Your Task
Return JSON with: recommendedAction, confidenceScore, explanation, customerMessage...
```

### 3. The `user` message contains (from `buildIncidentContext()`):

```
## Current Incident
- Channel: Keshet News ⭐ VIP CHANNEL
- UUID: abc12345-1234-5678-...
- Cluster: hub1x
- Redis: Bm

## StreamAnalyzerAgent Results
{
  "gMana": { "reachable": false, "httpStatus": 502, "latencyMs": 8500 },
  "source": { "reachable": true, "httpStatus": 200, "hasAdMarkers": true },
  "errorCode": "HTTP_502_UPSTREAM_ERROR"
}

## ResourceAnalyzerAgent Results
{
  "uhPod": { "status": "CrashLoopBackOff", "restarts": 3 },
  "redisDegraded": false
}

## PlayerAnalyzerAgent Results
{
  "sequenceDrift": 42,
  "adMarkerMismatch": false
}

## Memory / Historical Context
History: RESTART_UH worked 3 times for this channel. Last seen: 2 days ago.
```

### 4. GPT-4o responds with:

```json
{
  "recommendedAction": "RESTART_UH",
  "confidenceScore": 94,
  "explanation": "G-Mana returning 502 with UH pod in CrashLoopBackOff.
    Source is healthy with ad markers present. Historical data confirms
    RESTART_UH resolved this 3 times previously. This is a VIP channel —
    immediate action recommended after approval.",
  "errorCode": "HTTP_502_UPSTREAM_ERROR",
  "urgency": "critical",
  "customerMessage": "We've detected a technical issue with your stream.
    Our automated systems are taking immediate corrective action.",
  "internalNotes": "UH pod crash-looping. Source healthy. High confidence
    restart will fix this. Monitor for 5 min post-restart."
}
```

---

## All 7 Places the AI Is Used

### 1. Incident Analysis (main AI call)
**File:** `ManagerAgent.mergeAnalysisResultsWithGPT()`  
**When:** After all 4 agents run, before deciding what to do  
**System prompt:** `getIncidentAnalysisPrompt()`  
**What it does:** Reads all agent data, applies G-Mana rules, returns final recommendation  
**Output:** `recommendedAction`, `confidenceScore`, `explanation`

### 2. Customer Short Message (during incident)
**File:** `ManagerAgent.handleSourceDown()` and `SenderAgent`  
**When:** When we need to notify a customer that their stream is down  
**System prompt:** `getCustomerShortMessagePrompt()`  
**What it does:** Writes a 2-3 sentence, non-technical notification  
**Output:** Customer-facing message sent via WhatsApp/email

### 3. Customer Resolution Message (after fix)
**File:** `ManagerAgent.resolveIncident()`  
**When:** After the stream is successfully restored  
**System prompt:** `getCustomerResolutionMessagePrompt()`  
**What it does:** Writes a professional "your stream is fixed" message  
**Output:** Notification sent to customer with duration and brief cause

### 4. Escalation Report for Yoni
**File:** `ManagerAgent.escalateIncident()`  
**When:** When AI can't fix the issue and must escalate  
**System prompt:** `getEscalationReportPrompt()`  
**What it does:** Writes a detailed technical report with all context  
**Output:** Sent to Yoni via WhatsApp and email

### 5. Email Q&A Response
**File:** Email handler in `index.ts`  
**When:** Customer sends a general question to support@g-mana.com  
**System prompt:** `getCustomerQAPrompt()`  
**What it does:** Answers stream-related questions professionally  
**Output:** Reply sent back to customer email

### 6. Root Cause Analysis
**File:** `MemoryAgent` (when called on recurring incidents)  
**When:** Same channel has 3+ incidents in 24 hours  
**System prompt:** `getRootCauseAnalysisPrompt()`  
**What it does:** Analyzes patterns across incidents for root cause  
**Output:** Pattern stored in MongoDB, Yoni notified of recurring issue

### 7. Manifest Interpretation
**File:** `PlayerAnalyzerAgent` (advanced mode)  
**When:** Deep analysis of raw HLS/DASH manifest bytes  
**System prompt:** `getManifestInterpretationPrompt()`  
**What it does:** Reads raw manifest snippets and identifies G-Mana-specific issues  
**Output:** errorCode + technicalDetails fed into main analysis

---

## How to Teach the AI New Things

### Adding a New Error Code

Edit `SystemKnowledgeBase.ts`, find `ERROR_CODEBOOK`, add a new row:

```typescript
// Before:
| SSAI_AD_BREAK_NOT_DETECTED | No SCTE-35 markers | CI stalled | Restart CI |

// After (you added a new error):
| SSAI_AD_BREAK_NOT_DETECTED | No SCTE-35 markers | CI stalled | Restart CI |
| MANIFEST_ENCODING_ERROR    | Encoding mismatch  | Codec issue | Restart UH + notify DevOps |
```

The AI will now recognize this error code and suggest the right fix.

---

### Adding a New Business Rule

Edit `DECISION_RULES` in `SystemKnowledgeBase.ts`:

```typescript
// Add this to DECISION_RULES:
11. **Night Hours Rule**: Between 00:00-06:00 (customer timezone), 
    always require manual approval regardless of confidence score.
    These hours have the lowest support coverage.
```

The AI will now apply this rule when making recommendations during those hours.

---

### Adding a New Customer

Edit `PLATFORM_CONTEXT` in `SystemKnowledgeBase.ts`:

```typescript
// Before:
## VIP Customers
- Keshet: Premium broadcast customer. Uses Bm Redis.
- Reshet: Premium broadcast customer. Uses Am Redis.

// After:
## VIP Customers
- Keshet: Premium broadcast customer. Uses Bm Redis.
- Reshet: Premium broadcast customer. Uses Am Redis.
- Channel 13: New VIP customer. Uses Cm Redis. Very sensitive to ad insertion failures.
              Max waiting time: 30 seconds. Notify both Yoni AND David (CTO) on escalation.
```

---

### Changing the Tone for a Specific Customer

Edit `TONE_GUIDE`:

```typescript
// Add a customer-specific rule:
### Keshet-Specific Tone
- Keshet representatives are highly technical — use technical terms freely
- They prefer Hebrew when available (if language detected in their WhatsApp)
- Always address their stream manager by first name if known
```

---

### Teaching the AI About a New Component

If G-Mana adds a new pod/service called "ContentValidator":

```typescript
// Add to PLATFORM_CONTEXT under "System Components":
**ContentValidator (CV)**: New pod responsible for validating segment integrity
before delivery. Pod name format: content-validator-{ds_uuid}. When CV fails,
viewers see corrupted video segments. Error code: CONTENT_VALIDATION_FAILED.
Fix: Restart CV pod via POST /sendalarms/clusters/{cluster}/deployments/content-validator-{ds_uuid}/restart
```

Then add to `ERROR_CODEBOOK`:

```typescript
| CONTENT_VALIDATION_FAILED | Video segments corrupted | CV pod crash | Restart CV |
```

And add to `ACTION_PLAYBOOK`:

```typescript
### Procedure E: Restart Content Validator (RESTART_CV)
1. Fetch CV pod logs
2. Request approval
3. POST .../content-validator-{ds_uuid}/restart
4. Wait 30 seconds
5. Verify segments playable
```

Then add the actual API call to `HubMonitorTool.ts`:

```typescript
async restartCV(cluster: string, dsUuid: string): Promise<boolean> { ... }
```

And the action handling to `ManagerAgent.executeAction()`:

```typescript
} else if (action === 'RESTART_CV') {
  await this.hubMonitor.restartCV(incident.clusterId, incident.dsUuid);
  actionResult = `ContentValidator restarted on ${incident.clusterId}`;
}
```

---

## How GPT-4o Knows Which Agent's Results to Trust

In `mergeAnalysisResultsWithGPT()`, all 4 agents' results are passed to GPT-4o.
The system prompt tells GPT to weight them:

- **StreamAnalyzerAgent** (40%): Most direct evidence — actual stream URL health
- **ResourceAnalyzerAgent** (35%): Pod crash = almost certainly the cause
- **PlayerAnalyzerAgent** (20%): Confirms with deep manifest analysis
- **MemoryAgent** (5% boost): Historical context improves confidence if match found

When GPT-4o sees:
```
StreamAnalyzer: G-Mana 502, source healthy → RESTART_UH (90% conf)
ResourceAnalyzer: UH pod CrashLoopBackOff → RESTART_UH (90% conf)
PlayerAnalyzer: 42-segment drift → RESTART_UH (88% conf)
Memory: RESTART_UH worked 3 times before → +10% confidence boost
```

It synthesizes: **RESTART_UH, 94% confidence** — all evidence converges.

But when evidence conflicts:
```
StreamAnalyzer: No ad markers → RESTART_CI (85% conf)
ResourceAnalyzer: All pods healthy → NO_RESOURCE_ISSUE (92% conf)
PlayerAnalyzer: Source has ad markers, G-Mana doesn't → RESTART_CI (86% conf)
```

GPT-4o applies the **Decision Rule #8** (Ad Marker Rule) from `DECISION_RULES`:
*"If source has SCTE-35 markers but G-Mana doesn't, the issue is ALWAYS in the CI pod."*

Result: **RESTART_CI, 86% confidence** — GPT correctly ignores the "healthy pods" signal
because the ad marker rule takes precedence.

---

## The Fallback: What Happens If OpenAI Is Down

In `ManagerAgent.mergeAnalysisResultsWithGPT()`, there is a try/catch:

```typescript
try {
  // Call GPT-4o...
  const response = await this.openai.chat.completions.create({...});
  // Parse and return...
} catch (gptErr) {
  // GPT-4o unavailable → fall back to weighted vote
  logger.error('[ManagerAgent] GPT-4o failed, using weighted vote fallback');
  return this.mergeWithWeightedVote([streamResult, resourceResult, playerResult, memoryResult]);
}
```

The fallback uses a simple weighted average:
- Picks the most-voted action across all agents
- Uses weighted average confidence
- System still works, just with less nuanced reasoning

---

## How to Debug AI Decisions

Every GPT-4o call saves the full raw response:

```typescript
data: {
  gptRaw: parsed,           // Full JSON response from GPT-4o
  customerMessage: ...,     // Pre-drafted customer message
  internalNotes: ...,       // GPT's internal reasoning for Yoni
  urgency: 'critical',      // GPT's urgency assessment
}
```

This is stored on `incident.streamAnalysis` and visible in the UI's
"AI Analysis" section and in the API response at `GET /api/incidents/:id`.

To see exactly what GPT-4o received and returned:
1. Find the incident in MongoDB: `db.incidents.findOne({ dsUuid: 'your-uuid' })`
2. Check `streamAnalysis.gptRaw` for the full response
3. Check the backend logs: `docker-compose logs backend | grep "GPT-4o"`

---

## Environment Variables That Control AI Behavior

| Variable | Default | What It Controls |
|---|---|---|
| `OPENAI_API_KEY` | required | Access to GPT-4o |
| `OPENAI_MODEL` | `gpt-4o` | Which model to use (can downgrade to `gpt-4o-mini`) |
| `CONFIDENCE_THRESHOLD` | `80` | Min % before taking automated action |
| `APPROVAL_TIMEOUT_SECONDS` | `10` | Seconds before auto-executing approved action |
| `MONITORING_STABLE_SECONDS` | `300` | How long to monitor after action before resolving |

To make the AI more conservative: raise `CONFIDENCE_THRESHOLD` to 90.  
To always require human approval: set `APPROVAL_TIMEOUT_SECONDS` to 3600.  
To use a cheaper model: set `OPENAI_MODEL` to `gpt-4o-mini`.

---

## Quick Reference: What to Edit for Common Changes

| I want to... | Edit this |
|---|---|
| Add a new error code | `ERROR_CODEBOOK` in `SystemKnowledgeBase.ts` |
| Add a new business rule | `DECISION_RULES` in `SystemKnowledgeBase.ts` |
| Add a new VIP customer | `PLATFORM_CONTEXT → VIP Customers` in `SystemKnowledgeBase.ts` |
| Change customer message tone | `TONE_GUIDE` in `SystemKnowledgeBase.ts` |
| Add a new remediation step | `ACTION_PLAYBOOK` + `ManagerAgent.executeAction()` + `HubMonitorTool.ts` |
| Explain a new system component | `PLATFORM_CONTEXT → System Components` in `SystemKnowledgeBase.ts` |
| Change which model is used | `OPENAI_MODEL` in `.env` |
| Make AI less aggressive | Raise `CONFIDENCE_THRESHOLD` in `.env` |
| Add a new Redis instance | `PLATFORM_CONTEXT → Redis Instances` in `SystemKnowledgeBase.ts` |
| Teach AI about a new cluster | `PLATFORM_CONTEXT → Clusters` in `SystemKnowledgeBase.ts` |
| Change escalation report format | `getEscalationReportPrompt()` in `SystemKnowledgeBase.ts` |
| Add language support | `TONE_GUIDE → Tone Rules` in `SystemKnowledgeBase.ts` |
