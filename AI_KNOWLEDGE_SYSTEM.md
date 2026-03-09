# G-Mana Support AI — Complete AI Knowledge System Guide

> **This document explains exactly how and where the AI learns about G-Mana,
> what it knows, what it doesn't know, and how to teach it new things.**

---

## Table of Contents

1. [The Core Problem: GPT-4o Knows Nothing About G-Mana](#1-the-core-problem)
2. [Solution: System Prompts as a Knowledge Base](#2-solution-system-prompts)
3. [File Map: Where AI Learning Happens](#3-file-map)
4. [The Core System Prompt — Explained Line by Line](#4-core-system-prompt)
5. [How Each Agent Uses AI](#5-how-each-agent-uses-ai)
6. [The 5 Prompt Builder Functions](#6-prompt-builder-functions)
7. [How Context Is Built and Sent](#7-how-context-is-built)
8. [The AI Decision Flow — End to End](#8-ai-decision-flow)
9. [How to Add New Knowledge to the AI](#9-how-to-extend)
10. [Confidence Scoring System](#10-confidence-scoring)
11. [Guardrails — What AI Can Never Do](#11-guardrails)
12. [Memory System — How AI Learns Over Time](#12-memory-system)
13. [Common Questions and Answers](#13-faq)

---

## 1. The Core Problem

GPT-4o is a general-purpose AI. Out of the box, it knows **nothing** about G-Mana. It has no idea:

- What SSAI (Server-Side Ad Insertion) is
- What "User Handler" or "CueMana-In" pods do
- That Redis Bm serves Keshet while Redis Am serves Reshet
- That HTTP 502 from G-Mana specifically means the User Handler crashed
- That you should **never** restart pods when Redis is degraded
- What clusters hub1x and hub21 are
- What SCTE-35 markers mean for ad insertion
- The difference between a source CDN issue and a G-Mana issue

**If we sent GPT-4o a raw alarm without context, it would return a generic,
useless response like "please check your server logs."**

---

## 2. Solution: System Prompts as a Knowledge Base

Every time we call the OpenAI API, we send **two messages**:

```
Message 1 (system role):
  → The complete G-Mana knowledge base
  → 600+ lines teaching GPT-4o everything about the platform
  → Always the same across all calls

Message 2 (user role):
  → The specific real-time incident data for THIS alarm
  → Changes every call: stream health, pod state, CPU, error code, etc.
```

GPT-4o reads the system message **first**, building a complete mental model
of G-Mana. Then it reads the incident data and applies that knowledge to
diagnose the specific problem.

**Think of it as:** giving GPT-4o a 600-line technical manual to read
before asking it to diagnose a patient.

---

## 3. File Map: Where AI Learning Happens

```
backend/src/services/AISystemPrompts.ts   ← ★ THE BRAIN — all AI knowledge lives here
backend/src/agents/ManagerAgent.ts        ← WHERE AI IS CALLED (runAIAnalysis, draftGPTMessage)
backend/src/agents/StreamAnalyzerAgent.ts ← Rule-based analysis (fast, deterministic)
backend/src/agents/ResourceAnalyzerAgent.ts ← Rule-based analysis (infrastructure)
backend/src/agents/PlayerAnalyzerAgent.ts ← Rule-based analysis (manifest deep-dive)
backend/src/agents/MemoryAgent.ts         ← Retrieves past patterns FOR the AI context
backend/src/agents/SenderAgent.ts         ← Uses AI-drafted messages to send notifications
```

### AISystemPrompts.ts Structure

```
AISystemPrompts.ts
│
├── Section A: TypeScript Types
│   ├── AIAnalysisResult    ← What GPT-4o MUST return (structured JSON)
│   └── AIIncidentContext   ← All data fields sent TO GPT-4o
│
├── Section B: CORE_SYSTEM_PROMPT (600+ lines)
│   ├── What G-Mana is      ← Business context
│   ├── Architecture        ← UH, CI, Redis, clusters explained
│   ├── Decision Tree       ← Step-by-step diagnostic logic
│   ├── Error Codes         ← Every error code and its meaning
│   ├── VIP Rules           ← Keshet and Reshet special handling
│   ├── Action Rules        ← When to restart what
│   ├── Confidence Scoring  ← How to score 0-100
│   ├── Hard Guardrails     ← Never-violate rules
│   └── Output Format       ← Exact JSON structure required
│
└── Section C: Prompt Builder Functions (5 functions)
    ├── buildStreamAnalysisPrompt()    ← Main incident diagnosis
    ├── buildCustomerMessagePrompt()   ← Draft customer notification
    ├── buildJiraDescriptionPrompt()   ← Jira ticket body
    ├── buildWhatsAppParserPrompt()    ← Parse incoming WA/Email
    └── buildEscalationMessagePrompt() ← Message to Yoni
```

---

## 4. The Core System Prompt — Explained Line by Line

The `CORE_SYSTEM_PROMPT` constant in `AISystemPrompts.ts` is the most
important piece of the system. Here is what each section teaches GPT-4o:

### Section: "What Is G-Mana"
```
G-Mana is a Server-Side Ad Insertion (SSAI) platform used by
Israeli broadcasters. It intercepts live HLS/DASH streams and
inserts advertisements using SCTE-35 cue markers.
```
**Why:** GPT-4o needs to understand the business context to reason
about why a stream failure matters and what the impact is.

---

### Section: "Platform Architecture"
```
USER HANDLER (UH):
  The main pod. Handles player requests, stitches ad segments
  into live stream manifests. One UH pod per channel (ds_uuid).
  Failure signs: HTTP 502/503, media sequence drift, segment mismatch.

CUEMANA-IN (CI):
  Watches the source stream for SCTE-35 ad cue points and signals
  the User Handler to insert ads.
  Failure sign: G-Mana stream healthy but has NO SCTE-35 ad markers.

REDIS (cache layer):
  Am -> Reshet channels | Bm -> Keshet channels | Cm -> Others
  Redis issues require DevOps. NEVER fix by restarting pods.
```
**Why:** GPT-4o must know that UH crash = HTTP 502, and CI crash = missing
ad markers. Without this, it could never map an error to the right component.

---

### Section: "Diagnostic Decision Tree"
```
STEP 1: Compare G-Mana vs Source reachability
  SOURCE OK  + G-MANA BROKEN → G-Mana component issue → Steps 2+
  SOURCE BROKEN + G-MANA OK  → Upstream CDN issue → Step 4
  BOTH BROKEN                → Network/CDN outage → Step 5

STEP 2: G-Mana is broken. Identify the error type:
  HTTP 502 or 503             → User Handler crashed → RESTART_UH
  No SCTE-35 ad markers       → CueMana-In stalled  → RESTART_CI
  Media sequence drift > 10   → Manifest stale (UH) → RESTART_UH
```
**Why:** This is the core diagnostic logic. Without a decision tree, GPT-4o
might "hallucinate" a diagnosis based on general knowledge. With the tree,
it follows a deterministic, company-approved path.

---

### Section: "VIP Customer Rules"
```
VIP customers: Keshet (uses Redis Bm) and Reshet (uses Redis Am).
When isVip = true:
  1. requiresEscalation MUST be true — always notify Yoni
  2. severity MUST be "critical" or "high"
  3. Jira priority = Highest
```
**Why:** GPT-4o has no concept of VIP customers. This section explicitly
tells it the business rule: Keshet and Reshet always get escalated to Yoni,
no matter what the AI decides.

---

### Section: "Confidence Scoring"
```
90-100%: Very high — pod status matches stream error, clear error code
80-89%:  High — evidence clear but not fully confirmed
70-79%:  Medium — ESCALATE, do not auto-act
Below 70: Low — ALWAYS ESCALATE
```
**Why:** The AI needs to know how to rate its own certainty. The confidence
score is used to decide whether to auto-act (≥80%) or escalate (<80%).

---

### Section: "Hard Guardrails"
```
1. MAX RESTARTS: If restartAttempts >= maxRestartAttempts → MOVE_TO_SOURCE or ESCALATE
2. NO RESTART ON SOURCE DOWN: If source unreachable → NEVER recommend RESTART_UH/CI
3. NO AUTO-ACTION BELOW 80%: If confidenceScore < 80 → requiresEscalation=true
4. NO ACTION ON REDIS DEGRADED: If redisStatus != "healthy" → ALWAYS ESCALATE
5. VIP ALWAYS ESCALATES: isVip=true → requiresEscalation=true always
```
**Why:** These are the safety rules that prevent the AI from making dangerous
decisions like restarting pods when Redis is down, or looping restart attempts
indefinitely.

---

### Section: "Output Format"
```json
{
  "rootCause": "...",
  "recommendedAction": "RESTART_UH|RESTART_CI|...",
  "confidenceScore": 85,
  "explanation": "...",
  "customerMessageShort": "...",
  "customerMessageDetailed": "...",
  "severity": "critical|high|medium|low",
  "requiresEscalation": false,
  "reasoning": ["Step 1: ...", "Step 2: ...", "Step 3: ..."]
}
```
**Why:** We use `response_format: { type: "json_object" }` mode. Defining
the exact format in the prompt ensures GPT-4o always returns parseable JSON
with every required field.

---

## 5. How Each Agent Uses AI

### Rule-Based Agents (NO direct AI call)

These agents run deterministic logic — no GPT-4o API call:

| Agent | Method | Why No AI |
|---|---|---|
| StreamAnalyzerAgent | URL comparison, HTTP status, manifest parsing | Fast, deterministic, no hallucination risk |
| ResourceAnalyzerAgent | Pod state checks, CPU/memory thresholds | Binary decisions, no ambiguity |
| PlayerAnalyzerAgent | Sequence drift, discontinuity counts | Mathematical comparisons |
| MemoryAgent | MongoDB pattern lookup | Data retrieval, not reasoning |

**These agents feed their results INTO the AI context**, but don't call AI themselves.

### AI-Powered Operations (GPT-4o calls)

All in `ManagerAgent`:

| Method | Prompt Used | When Called |
|---|---|---|
| `runAIAnalysis()` | `CORE_SYSTEM_PROMPT` + `buildStreamAnalysisPrompt()` | After all 4 agents run |
| `draftGPTMessage()` | `CORE_SYSTEM_PROMPT` + `buildCustomerMessagePrompt()` | Before sending customer notification |
| `ensureJiraTicket()` | `CORE_SYSTEM_PROMPT` + `buildJiraDescriptionPrompt()` | When creating Jira ticket |
| `parseWhatsAppMessage()` | `CORE_SYSTEM_PROMPT` + `buildWhatsAppParserPrompt()` | When WhatsApp/email arrives |
| `escalateIncident()` | `CORE_SYSTEM_PROMPT` + `buildEscalationMessagePrompt()` | When escalating to Yoni |

---

## 6. The 5 Prompt Builder Functions

### 1. `buildStreamAnalysisPrompt(ctx)`
**Purpose:** Main incident diagnosis — tell AI everything about the incident
and ask for a full AIAnalysisResult JSON.

**What it includes:**
- Channel identification (dsUuid, cluster, Redis, VIP flag)
- G-Mana stream: HTTP status, latency, media sequence, ad markers, discontinuities
- Source stream: same fields
- **PRE-COMPUTED derived metrics** (important!):
  - `sequenceDrift = sourceMediaSequence - gManaMediaSequence`
  - `adMarkerMismatch = sourceHasAdMarkers && !gManaHasAdMarkers`
  - `excessDiscontinuities = gManaDiscontinuityCount - sourceDiscontinuityCount`
- Resources: Redis status, UH pod, CI pod, CPU%, Memory%
- History: previous actions, last successful action, memory patterns
- **MANDATORY CONSTRAINTS** block at the bottom — repeating any hard rules
  that apply to THIS specific incident (max restarts, VIP, Redis degraded)

**Why pre-compute metrics?**
GPT-4o is very good at reasoning but weaker at arithmetic. By pre-computing
`sequenceDrift = 15` and labeling it `← CRITICAL DRIFT`, we steer GPT-4o's
attention to what matters, reducing the chance of misinterpretation.

---

### 2. `buildCustomerMessagePrompt(channelName, customerName, isVip, errorCode, action, type)`
**Purpose:** Draft a professional customer notification.

**Two modes:**
- `type = 'short'`: 2-3 sentence WhatsApp/quick email
  - FORBIDDEN words: "pod", "UUID", "Redis", "UH", "CI", "cluster", "CueMana-In"
  - Must be reassuring, no technical jargon
- `type = 'detailed'`: Full technical email for Jira or manager
  - Technical details allowed: what was detected, diagnosis, action, ETA

---

### 3. `buildJiraDescriptionPrompt(ctx, analysis)`
**Purpose:** Generate a structured Jira bug description with wiki markup.

**Includes:** incident summary, root cause, technical details table,
actions taken, next steps — formatted with Jira `h2.` headings and `|| |` tables.

---

### 4. `buildWhatsAppParserPrompt(message, groupName)`
**Purpose:** Parse informal messages from customers in WhatsApp groups
or emails to extract structured intent.

**Example:**
```
Input: "channel 12 is down again!!!! fix it now"
Output: {
  "intent": "channel_down",
  "channelHint": "channel 12",
  "customerHint": "Keshet",
  "urgency": "high",
  "summary": "Keshet Channel 12 reported as down"
}
```

This lets the system map "channel 12" to a dsUuid and create an alarm.

---

### 5. `buildEscalationMessagePrompt(incidentId, channelName, dsUuid, clusterId, reason, analysis)`
**Purpose:** Draft a clear, urgent WhatsApp message for Yoni (engineering lead).

**Format requirements:**
- Starts with `🚨 *ESCALATION — G-Mana Support AI*`
- Uses WhatsApp `*bold*` for key values
- Includes: channel, UUID, cluster, root cause, what was tried
- Ends with: what Yoni should check next
- Max 200 words — concise for WhatsApp

---

## 7. How Context Is Built and Sent

### Step-by-Step Context Construction (in ManagerAgent)

```typescript
// 1. All 4 agents run in parallel and return their results
const [streamResult, resourceResult, playerResult, memoryResult] = await Promise.all([
  streamAnalyzer.execute(context),
  resourceAnalyzer.execute(context),
  playerAnalyzer.execute(context),
  memoryAgent.execute(context),
]);

// 2. Build the AIIncidentContext object from all agent results
const aiContext: AIIncidentContext = {
  // Channel identification
  dsUuid: incident.dsUuid,
  channelName: incident.channelName,
  isVip: incident.isVip,
  clusterId: incident.clusterId,
  redisInstance: incident.redisInstance,

  // Stream health (from StreamAnalyzerAgent + PlayerAnalyzerAgent)
  gManaReachable: streamResult.data.gMana.reachable,
  gManaHttpStatus: streamResult.data.gMana.httpStatus,
  gManaMediaSequence: streamResult.data.gMana.mediaSequence,
  gManaHasAdMarkers: streamResult.data.gMana.hasAdMarkers,
  // ...more stream fields

  // Resources (from ResourceAnalyzerAgent)
  redisStatus: resourceResult.data.redis?.status || 'unknown',
  uhPodStatus: resourceResult.data.uhPod?.status || 'unknown',
  uhCpuPercent: resourceResult.data.uhPod?.cpuPercent || 0,
  // ...more resource fields

  // Memory (from MemoryAgent)
  previousPatterns: memoryResult.data.previousPatterns,
  lastSuccessfulAction: memoryResult.data.lastSuccessfulAction,
};

// 3. Build the user prompt from the context
const userPrompt = buildStreamAnalysisPrompt(aiContext);

// 4. Call GPT-4o with system + user messages
const response = await openai.chat.completions.create({
  model: 'gpt-4o',
  response_format: { type: 'json_object' },  // Enforces JSON output
  messages: [
    { role: 'system', content: CORE_SYSTEM_PROMPT },  // Knowledge base
    { role: 'user', content: userPrompt },              // Incident data
  ],
  max_tokens: 1000,
  temperature: 0.1,  // Low temperature = deterministic, consistent responses
});

// 5. Parse the structured JSON response
const analysis: AIAnalysisResult = JSON.parse(response.choices[0].message.content);
```

---

## 8. The AI Decision Flow — End to End

```
Alarm received (Hub Monitor / WhatsApp / Email / Manual)
    ↓
ManagerAgent creates Incident (state: NEW → ANALYZING)
    ↓
PARALLEL: All 4 agents run simultaneously:
  ┌─────────────────────────────────────────────────────────┐
  │ StreamAnalyzerAgent  → HTTP status, manifest comparison │
  │ ResourceAnalyzerAgent → Redis, UH pod, CI pod, CPU/Mem  │
  │ PlayerAnalyzerAgent  → Deep manifest analysis           │
  │ MemoryAgent          → Past patterns, successful actions │
  └─────────────────────────────────────────────────────────┘
    ↓
ManagerAgent builds AIIncidentContext from all 4 results
    ↓
GPT-4o called with CORE_SYSTEM_PROMPT + buildStreamAnalysisPrompt(aiContext)
    ↓
GPT-4o returns AIAnalysisResult JSON:
  {
    rootCause: "User Handler returning HTTP 502 after pod crash",
    recommendedAction: "RESTART_UH",
    confidenceScore: 92,
    requiresEscalation: false,   ← false because confidence ≥ 80%
    customerMessageShort: "We detected an issue with your stream...",
    reasoning: ["Source healthy", "G-Mana returning 502", "UH pod in CrashLoopBackOff"]
  }
    ↓
ManagerAgent merges AI result with rule-based agent results:
  - If AI and rule-based agree → higher confidence
  - If AI and rule-based disagree → lower confidence
    ↓
confidenceScore check:
  ≥ 80% → proceed to approval
  < 80% → escalate to Yoni
    ↓
Approval timer: 10 seconds
  Human approves → execute action
  No response    → auto-execute
  Human rejects  → escalate
    ↓
Action executed (RESTART_UH via Hub Monitor API)
    ↓
Wait 30 seconds
    ↓
Monitor stream health for 5 minutes
    ↓
Stream healthy → Resolve, close Jira, notify customer
Stream still broken → Re-analyze (may try RESTART_CI or MOVE_TO_SOURCE)
```

---

## 9. How to Add New Knowledge to the AI

All AI knowledge is centralized in **one file**: `AISystemPrompts.ts`.
Any change here immediately affects ALL future AI calls.

### Adding a New Error Code

In `CORE_SYSTEM_PROMPT`, find the `ERROR CODES AND MEANING` section and add:

```
NEW_ERROR_CODE  → description of what it means  → recommended action
```

Example:
```
CDN_EDGE_TIMEOUT  → CDN edge node timeout (> 5s latency)  → RESTART_UH
REDIS_KEY_EXPIRED → Redis session expired prematurely     → ESCALATE
```

---

### Adding a New VIP Customer

In `CORE_SYSTEM_PROMPT`, find the `VIP CUSTOMER RULES` section and add:

```
VIP customers: Keshet (uses Redis Bm), Reshet (uses Redis Am), AND YOUR_NEW_CUSTOMER.
```

Also update the `buildWhatsAppParserPrompt()` function's known customers list:
```
Known customers:
  Keshet -> ch12, ch13
  Reshet -> ch5, ch6, ch7
  YourNewCustomer -> chXX, chYY   ← ADD HERE
```

---

### Adding a New Cluster

In `CORE_SYSTEM_PROMPT`, find the `CLUSTERS` section:
```
hub1x and hub21 are the processing clusters.
ADD: hub3x is the new cluster for [region/purpose]
```

Also update `validators.ts`:
```typescript
export function isValidCluster(cluster: string): boolean {
  const validClusters = ['hub1x', 'hub21', 'hub3x']; // Add new cluster here
  return validClusters.includes(cluster.toLowerCase());
}
```

---

### Adding a New Action

In `CORE_SYSTEM_PROMPT`, find the `ACTION RULES` section:
```
NEW_ACTION  → description of when and what it does
```

Then update the `recommendedAction` field in `AIAnalysisResult` interface.

Also update `ManagerAgent.executeAction()` to handle the new action case:
```typescript
} else if (action === 'NEW_ACTION') {
  // implementation
}
```

---

### Changing Confidence Thresholds

Edit `.env`:
```
CONFIDENCE_THRESHOLD=80  ← Lower = more auto-actions, higher = more escalations
APPROVAL_TIMEOUT_SECONDS=10  ← Lower = faster auto-execution
```

Also update the `CONFIDENCE SCORING` section of `CORE_SYSTEM_PROMPT` to
match your new thresholds so GPT-4o's scoring aligns with the code behavior.

---

### Making AI More/Less Aggressive

Edit `temperature` in ManagerAgent's OpenAI calls:
```typescript
temperature: 0.1,  // 0.0 = fully deterministic, 1.0 = creative/random
                   // Keep at 0.1 for support AI (low creativity, high consistency)
```

---

## 10. Confidence Scoring System

The final confidence score is a **weighted merge** of all agents:

```
Final Score = (StreamAnalyzer × 0.40)
            + (ResourceAnalyzer × 0.35)
            + (PlayerAnalyzer × 0.20)
            + (MemoryAgent boost, max +10%)

Then: GPT-4o's confidenceScore OVERRIDES this if the AI result is used.
```

### Example Score Calculation

| Agent | Score | Weight | Contribution |
|---|---|---|---|
| StreamAnalyzer | 90% (HTTP 502, G-Mana broken, source ok) | 40% | 36 |
| ResourceAnalyzer | 90% (UH pod is CrashLoopBackOff) | 35% | 31.5 |
| PlayerAnalyzer | 88% (sequence drift 15, manifest stale) | 20% | 17.6 |
| MemoryAgent | +8% (same fix worked 4× before) | 5% | 4 |
| **Total** | | | **89.1% → 89%** |

Result: 89% ≥ 80% → **proceed with approval timer**, recommend RESTART_UH.

---

## 11. Guardrails — What AI Can Never Do

These rules are enforced in BOTH the system prompt AND the TypeScript code.
Even if GPT-4o ignores the prompt rule, the code-level check catches it.

| Guardrail | In Prompt | In Code |
|---|---|---|
| Max restarts exceeded → never restart again | ✅ CORE_SYSTEM_PROMPT | ✅ `if (restartAttempts >= max)` check |
| Source broken → never restart G-Mana | ✅ CORE_SYSTEM_PROMPT | ✅ `NOTIFY_CUSTOMER_SOURCE_DOWN` branch |
| Confidence < 80% → always escalate | ✅ CORE_SYSTEM_PROMPT | ✅ `if (merged.confidenceScore < THRESHOLD)` |
| Redis degraded → always escalate | ✅ CORE_SYSTEM_PROMPT | ✅ `ESCALATE_REDIS_ISSUE` branch |
| VIP → always notify Yoni | ✅ CORE_SYSTEM_PROMPT | ✅ `if (alarm.isVip)` escalation |
| No action on CLOSED/RESOLVED | ❌ Not in prompt | ✅ `isActionable()` check |
| Max 2 restarts per incident | ✅ CORE_SYSTEM_PROMPT | ✅ `maxRestartAttempts` field |

**The code-level guardrails are the "last line of defense"** — they catch
cases where the AI might return an incorrect recommendation.

---

## 12. Memory System — How AI Learns Over Time

The `MemoryAgent` + `MemoryPattern` collection implements a simple but
effective learning loop:

### Learning Loop

```
1. Incident occurs → AI recommends RESTART_UH
2. Human approves → Action executed
3. Stream recovers → Incident resolved
4. ManagerAgent calls memoryAgent.recordPattern(
     dsUuid, clusterId, customerId,
     'restart_success',
     'RESTART_UH resolved stream issue for Keshet 12',
     'RESTART_UH'
   )
5. MemoryPattern document upserted with occurrences++
```

### Using Memory in Next Incident

```
6. Same channel fails again 2 weeks later
7. MemoryAgent queries: MemoryPattern.find({ dsUuid: 'abc123' })
8. Finds: { successfulAction: 'RESTART_UH', occurrences: 5 }
9. Adds to AIIncidentContext:
     previousPatterns: ['RESTART_UH resolved stream issue 5 times']
     lastSuccessfulAction: 'RESTART_UH'
10. GPT-4o sees this in buildStreamAnalysisPrompt():
     "Last successful action: RESTART_UH (5 times)"
11. GPT-4o's confidence for RESTART_UH increases
12. MemoryAgent also provides +10% confidence boost (capped at 5 occurrences × 2)
```

### What Memory Stores

```
MemoryPattern {
  patternKey: "restart_success:abc123-def4:RESTART_UH"
  dsUuid: "abc123-def4"
  clusterId: "hub1x"
  patternType: "restart_success"
  description: "RESTART_UH resolved stream issue for Keshet 12"
  successfulAction: "RESTART_UH"
  occurrences: 5          ← increases with each repeat
  lastSeenAt: 2025-01-15  ← updated each time
  // TTL: auto-deleted after 90 days
}
```

---

## 13. FAQ

**Q: What happens if GPT-4o returns invalid JSON?**
A: `ManagerAgent.runAIAnalysis()` wraps the parse in a try/catch. If parsing
fails, it falls back to the rule-based merged result from the 4 agents.

**Q: What happens if the OpenAI API is down?**
A: `withRetry()` retries 3 times. If all fail, ManagerAgent escalates the
incident rather than acting on incomplete information.

**Q: Can GPT-4o recommend an action that's not in the allowed list?**
A: The output format section of CORE_SYSTEM_PROMPT explicitly lists the
allowed actions. Additionally, ManagerAgent.executeAction() has a switch/case
that ignores unrecognized actions and escalates instead.

**Q: How is customer data privacy handled when sending to OpenAI?**
A: We send dsUuid, channel name, and technical metrics — no personal viewer
data, no payment information, no PII. Check your OpenAI data processing
agreement regarding business data.

**Q: Why use GPT-4o specifically?**
A: GPT-4o has the best balance of speed and accuracy for structured JSON
output with complex reasoning chains. It also supports `response_format:
json_object` which guarantees valid JSON every time.

**Q: How do I test a new system prompt change?**
A: 1. Edit `CORE_SYSTEM_PROMPT` in `AISystemPrompts.ts`
   2. Create a test incident manually via `POST /api/alarms/manual`
   3. Watch logs for the AI response
   4. Check MongoDB: `db.incidents.find({}).sort({createdAt:-1}).limit(1)`
   5. Review `confidenceScore`, `recommendedAction`, `reasoning` fields

**Q: The AI is escalating too much. How do I make it act more?**
A: Lower `CONFIDENCE_THRESHOLD` in `.env` (e.g. from 80 to 70). Also
review the `CONFIDENCE SCORING` section of CORE_SYSTEM_PROMPT to see
if the thresholds there need adjustment too.

**Q: The AI is acting too aggressively. How do I make it escalate more?**
A: Raise `CONFIDENCE_THRESHOLD` (e.g. from 80 to 90). Add more specific
guard conditions in the HARD GUARDRAILS section of CORE_SYSTEM_PROMPT.

---

*Last updated: G-Mana Support AI v1.0*
*For changes to this document, update `AISystemPrompts.ts` first,
then update this guide to reflect the changes.*
