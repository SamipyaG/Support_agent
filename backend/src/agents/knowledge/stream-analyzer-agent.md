# StreamAnalyzerAgent

**File:** `backend/src/agents/StreamAnalyzerAgent.ts`
**Status:** ACTIVE
**Type:** Rule-based specialist (no GPT-4o, no state writes)

---

## Role

The first agent to run in every alarm cycle. Collects stream metadata, checks both
stream URLs, evaluates alarm type, detects VIP customers, calculates confidence score.
Sends a full report (including ds_uuid, urls, cluster) to ManagerAgent.

Does NOT call GPT-4o. Does NOT write incident state.

---

## Communication In

**Caller:** ManagerAgent
**Method:** `streamAnalyzer.analyze(alarm, streamUrls)`

| Parameter                    | Description                                 |
|------------------------------|---------------------------------------------|
| `alarm.dsUuid`               | Unique session ID                           |
| `alarm.channelName`          | Channel that triggered the alarm            |
| `alarm.errorType`            | Alarm code (e.g. `MAIN_MANIFEST_BAD_RESPONSE`) |
| `alarm.reason`               | Reason text from Hub Monitor                |
| `alarm.statusCode`           | HTTP status code in the alarm               |
| `streamUrls.sourcePlayerUrl` | Raw broadcaster stream URL                  |
| `streamUrls.gManaPlayerUrl`  | G-Mana output stream URL                   |
| `streamUrls.clusterName`     | Kubernetes cluster (e.g. `hub1x`)          |
| `streamUrls.customerName`    | Customer name (used for VIP detection)      |

---

## Internal Logic

1. Identify channel using `ds_uuid`
2. Validate stream metadata (`sourceUrl`, `gManaUrl`, `cluster`)
3. `ErrorDetectionPlayerTool.checkBoth(sourceUrl, gManaUrl)` — both in parallel
4. Analyze alarm type: `MAIN_MANIFEST_BAD_RESPONSE` | `SOURCE_TIMEOUT` | `STREAM_UNAVAILABLE`
5. Root cause decision:

   | Source | G-Mana | Root Cause    | Confidence | Severity       |
   |--------|--------|---------------|------------|----------------|
   | DOWN   | DOWN   | `BOTH_DOWN`   | 90%        | high/critical  |
   | DOWN   | OK     | `SOURCE_ISSUE`| 95%        | medium/high    |
   | OK     | DOWN   | `GMANA_ISSUE` | 70–88%     | high/critical  |
   | OK     | OK     | `NO_ISSUE`    | 85%        | low            |

6. VIP detection: `channelName` or `customerName` contains `"keshet"` or `"reshet"` (case-insensitive)
7. Confidence scoring by alarm-to-error pattern alignment:
   - `MANIFEST/MPD` alarm + `404/502` HTTP response → **88%**
   - `AD/SCTE` alarm type → **82%**
   - `502/503` status from G-Mana → **85%**
   - Pattern unclear → **70%** (flagged)
8. `flaggedForFurtherAnalysis = confidence < 80%`

---

## Communication Out

**Returns to:** ManagerAgent (direct TypeScript return value)

```ts
StreamAnalysisReport {
  channelName, dsUuid, isVip,
  alarmType, alarmReason,
  sourceStatus,       // "healthy" | "down"
  gmanaStatus,        // "healthy" | "down"
  rootCauseAssumption, // SOURCE_ISSUE | GMANA_ISSUE | BOTH_DOWN | NO_ISSUE
  severity,           // "low" | "medium" | "high" | "critical"
  confidenceScore,    // 0–100
  sourceResult,       // full PlayerCheckResult from ErrorDetectionPlayerTool
  gmanaResult,        // full PlayerCheckResult from ErrorDetectionPlayerTool
  flaggedForFurtherAnalysis,
  details             // human-readable explanation
}
```

This report is the source of `ds_uuid`, `urls`, and `clusterName` that
ManagerAgent distributes to ResourcesAnalyzerAgent.

---

## State Changes

**None.** ManagerAgent writes all incident state based on this report.

---

## Enables Early Exits (before ResourcesAnalyzer or GPT-4o runs)

- `SOURCE_ISSUE` → ManagerAgent notifies customer only, no pod restarts, STOP
- `NO_ISSUE`     → Alarm was transient, no action needed, STOP
