# G-Mana Support AI — Complete AI Guide
## Where Does the AI "Learn" About Your System?

---

## The Short Answer

GPT-4o has **no built-in knowledge** of G-Mana, SSAI, your clusters, your customers, or your error codes. Every single piece of domain knowledge must be **given to it in the prompt**, every single time you call the API.

The file that does this is:
```
backend/src/services/AIService.ts
```

This is the most important file to understand if you want to customize how the AI behaves.

---

## How the AI "Learns" — Three-Layer Architecture

Every call to GPT-4o is built from three layers:

```
┌─────────────────────────────────────────────────────────┐
│ LAYER 1: SYSTEM PROMPT (role: "system")                 │
│ Static domain knowledge — never changes between calls   │
│                                                         │
│ • What is G-Mana / SSAI?                               │
│ • What do ds_uuid, UH, CI, cluster, Redis mean?        │
│ • Cluster topology (hub1x, hub21)                      │
│ • Redis topology (Am, Bm, Cm + which customer uses what)│
│ • Error code meanings (all 6 error codes explained)    │
│ • Business rules (VIP, waiting time, 2-restart limit)  │
│ • How to write customer messages (tone, format, don'ts)│
│ • How to write internal reports                        │
└────────────────────────────┬────────────────────────────┘
                             │ Sent with EVERY API call
                             ▼
┌─────────────────────────────────────────────────────────┐
│ LAYER 2: INCIDENT CONTEXT (role: "user", first part)   │
│ Dynamic live data — different for every incident        │
│                                                         │
│ • Channel name, UUID, cluster, Redis instance          │
│ • Is this a VIP customer?                              │
│ • Current error code (e.g., SEGMENT_MISMATCH_ERROR)    │
│ • Confidence score from analyzers (e.g., 88%)          │
│ • Stream health (G-Mana reachable? Source reachable?)  │
│ • Pod status (UH: Running/Pending/CrashLoopBackOff)    │
│ • Media sequence drift (how stale is the manifest?)    │
│ • Restart attempts so far (e.g., 1 of 2 max)          │
│ • Past incidents for this channel (memory)             │
└────────────────────────────┬────────────────────────────┘
                             │ Injected per incident
                             ▼
┌─────────────────────────────────────────────────────────┐
│ LAYER 3: TASK INSTRUCTION (role: "user", second part)  │
│ What we want the AI to produce right now               │
│                                                         │
│ • "Write a 3-sentence WhatsApp message to the customer"│
│ • "Write a detailed technical email"                   │
│ • "Write a technical report for Yoni with full details"│
│ • "Explain in plain English what happened"             │
│ • "Suggest the best next action with reasoning"        │
│ • "Write a resolution message — the stream is fixed"   │
└─────────────────────────────────────────────────────────┘
```

---

## The Analogy: Employee Onboarding

Think of it exactly like onboarding a new support engineer:

| Onboarding Element | GPT-4o Equivalent | Where in Code |
|---|---|---|
| **Company handbook** (never changes) | System prompt | `buildSystemPrompt()` |
| **Today's shift briefing** (current status) | Context block | `buildContextBlock()` |
| **Specific task assigned** ("write this email") | Task instruction | `buildTaskInstruction()` |

Without the handbook, the new engineer wouldn't know what "UH", "CI", or "SCTE-35" means.  
Without the briefing, they wouldn't know which channel is down right now.  
Without the task, they wouldn't know whether to write an email or a technical report.

---

## Layer 1 in Detail: The System Prompt

Located in `AIService.buildSystemPrompt()`.

This is what the AI reads **before** every response. It teaches GPT-4o:

### What G-Mana Is
```
G-Mana is a Server-Side Ad Insertion (SSAI) platform. We sit between
a broadcaster's live source stream and the end viewer. Our job is to
replace ad-break markers in the live HLS/DASH stream with actual ad
content...
```

### Technical Vocabulary
Every internal term is defined so the AI can understand context data:
```
ds_uuid     — A unique identifier for each channel deployment.
User Handler (UH) — The core G-Mana pod. Handles manifest proxying and ad stitching.
CueMana-In (CI)   — Detects SCTE-35 cue tones from source encoder.
Redis       — In-memory store for manifest caching and state.
...
```

### Cluster and Redis Topology
```
Clusters: hub1x (primary), hub21 (secondary)
Redis: Am (default), Bm (Keshet), Cm (overflow)
VIP Customers: Keshet → Bm Redis, Reshet → Am Redis
```

### Error Code Dictionary
Each of the 6 error codes is explained with its root cause and fix:
```
SEGMENT_MISMATCH_ERROR
  G-Mana's media sequence is behind source.
  Root cause: UH serving stale cached segments.
  Fix: Restart UH to reset cache.
```

### Business Rules
The AI is trained on your business rules to avoid inappropriate suggestions:
```
WAITING TIME RULE: Do not act until channel has been down for n seconds.
VIP RULE: Keshet/Reshet → notify Yoni immediately, no waiting.
RESTART LIMIT: Max 2 restarts per incident (UH → CI → move to source).
CONFIDENCE RULE: Below 80% → always escalate, never auto-act.
SOURCE DOWN RULE: Source broken → notify customer only, do NOT restart G-Mana.
```

### Communication Rules
Critically, the AI knows what it must NEVER say to customers:
```
NEVER SAY: "The User Handler crashed" / "Redis instance Bm is degraded"
INSTEAD SAY: "Our SSAI service encountered a processing issue"
```

---

## Layer 2 in Detail: The Context Block

Located in `AIService.buildContextBlock()`.

This is generated fresh for every incident. Example output sent to GPT-4o:

```
=== CURRENT INCIDENT CONTEXT ===

Channel Name:    Keshet 12 Live
Customer:        Keshet Broadcasting
UUID:            a1b2c3d4-e5f6-7890-abcd-ef1234567890
Cluster:         hub1x
Redis Instance:  Bm
Stream Type:     HLS
VIP Customer:    YES — Treat with highest priority
Incident Age:    8 minutes

--- DETECTED PROBLEM ---
Error Code:      SEGMENT_MISMATCH_ERROR
Confidence:      88%
Recommended Act: RESTART UH

--- STREAM HEALTH ---
G-Mana Stream:   ✗ UNREACHABLE
Source Stream:   ✓ Reachable
Manifest Drift:  15 sequences behind source (stream is stale)
Ad Markers:      Present (SCTE-35 detected)

--- RESOURCE STATUS ---
UH Pod Status:   Running
CI Pod Status:   Running
CPU Usage:       62%
Memory Usage:    74%
Redis Health:    healthy

--- ANALYZER FINDINGS ---
[StreamAnalyzerAgent] G-Mana media sequence (405) is far behind source (420). Manifest stale.
[ResourceAnalyzerAgent] All resources healthy. Redis: healthy, UH: Running, CI: Running.
[PlayerAnalyzerAgent] Critical media sequence drift: G-Mana at 405 vs source at 420.

--- INCIDENT HISTORY ---
Restart Attempts: 0 of 2 max
Past Incidents:  3 previous alarms for this channel
Last Fix That Worked: RESTART_UH
```

With this context, when you ask for a "short customer message", the AI can write:

> "⚠️ Hi Keshet team, we've detected an issue with Keshet 12 Live and our team is actively investigating. We'll update you within 10 minutes."

Instead of a generic: "We are experiencing technical difficulties."

---

## Layer 3 in Detail: Task Instructions

Located in `AIService.buildTaskInstruction()`. Each task has specific formatting rules:

| Task | Max Tokens | Temp | Format Rule |
|---|---|---|---|
| `draft_customer_message_short` | 200 | 0.4 | 3 sentences max, no jargon |
| `draft_customer_message_detailed` | 600 | 0.35 | Subject + body, 150-250 words |
| `draft_internal_report` | 800 | 0.15 | Structured sections, all technical details |
| `explain_incident_plain` | 500 | 0.3 | 4 labeled sections, plain English |
| `suggest_action` | 400 | 0.1 | RECOMMENDATION/CONFIDENCE/REASONING/RISKS |
| `draft_resolution_message` | 200 | 0.4 | Short, positive, confirms stream healthy |
| `draft_email_reply` | 500 | 0.35 | Reply format, acknowledges customer email |
| `draft_whatsapp_reply` | 150 | 0.4 | 5 lines max, emoji, *bold* for WhatsApp |

**Temperature controls creativity:**
- `0.1` = Very consistent, factual (used for action suggestions + reports)
- `0.4` = Natural-sounding messages (used for customer communication)
- We never use high temperature (0.7+) — this is support, not creative writing

---

## How AIService is Used in ManagerAgent

The ManagerAgent calls AIService at specific points:

```typescript
// 1. When drafting the initial "we're looking into it" message to customer
const shortMsg = await aiService.draftChannelDownMessage(aiContext);

// 2. When generating the technical Jira ticket description
const report = await aiService.draftInternalReport(aiContext);

// 3. When replying to a customer email
const emailReply = await aiService.replyToCustomerEmail(aiContext, originalEmailBody);

// 4. When confidence is borderline and we want a second opinion
const suggestion = await aiService.suggestAction(aiContext);

// 5. When the incident is resolved
const resolution = await aiService.draftResolutionMessage(aiContext);

// 6. For the UI dashboard plain-English explanation
const plainExplanation = await aiService.explainIncident(aiContext);
```

Each call automatically includes the full system prompt + the incident's live context.

---

## How to Extend the AI's Knowledge

### Add a new error code
In `buildSystemPrompt()`, add to the ERROR CODES section:
```
NEW_ERROR_CODE
  Description of what this error means.
  Root cause: ...
  Fix: ...
```

### Add a new customer
In `buildSystemPrompt()`, add to the CLUSTER & REDIS TOPOLOGY section:
```
• Channel 24  — treated as VIP, Bm Redis, cluster hub1x
```

### Add a new business rule
In `buildSystemPrompt()`, add to the BUSINESS RULES section:
```
7. WEEKEND RULE
   On weekends, always escalate regardless of confidence.
   Israeli broadcast customers have skeleton support staff on weekends.
```

### Change communication tone
In `buildSystemPrompt()`, edit the HOW TO WRITE CUSTOMER MESSAGES section:
```
TONE:
  • More formal on weekdays, slightly warmer on weekends
  • Hebrew is acceptable for Keshet/Reshet channels
```

### Add a new task type
In `buildTaskInstruction()`, add a new `case`:
```typescript
case 'draft_sla_breach_notice':
  return `TASK: Write an SLA breach notification...`;
```

---

## Where AI is NOT Used (by Design)

The following decisions are made by **deterministic code**, not AI:

| Decision | Why NOT AI |
|---|---|
| Should we restart? (RESTART_UH vs RESTART_CI) | Rule-based analysis is faster, cheaper, and more predictable |
| Is the stream reachable? | Raw HTTP check — no AI interpretation needed |
| Is the pod in CrashLoopBackOff? | API response — deterministic |
| State machine transitions | Must be 100% predictable and auditable |
| Approval timeout value | Business rule from env var |
| Max restart attempts | Hard business rule (2 max) |

AI is only used for **language generation** (writing text) and **borderline decision support** (when confidence < 80% and we want a second opinion from `suggest_action`).

---

## Testing the AI in Isolation

To test what the AI produces for a specific incident, you can call the service directly:

```typescript
import { aiService, AIIncidentContext } from './services/AIService';

const testContext: AIIncidentContext = {
  dsUuid: 'a1b2c3d4-e5f6',
  channelName: 'Keshet 12 Live',
  customerId: 'keshet',
  customerName: 'Keshet Broadcasting',
  clusterId: 'hub1x',
  redisInstance: 'Bm',
  streamType: 'HLS',
  isVip: true,
  errorCode: 'SEGMENT_MISMATCH_ERROR',
  confidenceScore: 88,
  recommendedAction: 'RESTART_UH',
  agentExplanation: 'G-Mana media sequence 405 is behind source 420.',
  gManaReachable: false,
  sourceReachable: true,
  mediaSequenceDrift: 15,
  uhPodStatus: 'Running',
  restartAttempts: 0,
  maxRestartAttempts: 2,
};

// Test all message types
const short = await aiService.draftChannelDownMessage(testContext);
const report = await aiService.draftInternalReport(testContext);
const suggestion = await aiService.suggestAction(testContext);

console.log('SHORT:', short);
console.log('REPORT:', report);
console.log('SUGGESTION:', suggestion);
```

---

## Environment Variables Required for AI

```env
OPENAI_API_KEY=sk-your-key-here
OPENAI_MODEL=gpt-4o          # Always use gpt-4o for best results
```

**Cost estimate per incident:**
- Short message: ~300 tokens = ~$0.001
- Full internal report: ~1200 tokens = ~$0.005
- Average 3-4 AI calls per incident = ~$0.01-0.02 per incident

---

## Summary: The Three Files That Matter Most for AI

| File | What it does |
|---|---|
| `backend/src/services/AIService.ts` | **The brain** — system prompt, context builder, task instructions |
| `backend/src/agents/ManagerAgent.ts` | **The orchestrator** — decides WHEN to call AI, builds AIIncidentContext |
| `backend/src/agents/MemoryAgent.ts` | **The memory** — provides historical context that feeds into AIIncidentContext |
