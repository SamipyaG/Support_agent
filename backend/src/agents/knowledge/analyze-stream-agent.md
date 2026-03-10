# AnalyzeStreamAgent

**File:** `backend/src/agents/AnalyzeStreamAgent.ts` (TO BE CREATED)
**Status:** FUTURE — not yet implemented

---

## Role

Deep stream debugging agent. Opens source + G-Mana URLs with a player tool,
observes stream for ~30 seconds, detects manifest and segment-level errors.

---

## Communication In

**Caller:** ManagerAgent
**Method:** `analyzeStreamAgent.analyze(sourceUrl, gManaUrl)`

Data will come from ManagerAgent, which extracted it from StreamAnalysisReport.

---

## Will Detect

- Media sequence jumps
- Discontinuities in the stream
- Segment mismatches
- Missing segments
- Slow segment downloads
- HTTP errors (403, 404, 502)
- Profile alignments
- Playlist duration
- Manifest reset
- Freeze
---

## Will Record Per Error

- Segment time range
- Manifest download time
- Error type
- HTTP status codes
- Performance metrics

---

## Communication Out

**Returns to:** ManagerAgent

```ts
[
  AnalyzeStreamReport {
    segmentTimeRange,
    manifestdownloadTime,
    errorType,
    httpStatusCodes,
    performanceMetrics,
    details,
    confidenceScore,
    screenshot
  }
]
```

ManagerAgent will include this in the GPT-4o synthesis alongside other reports.

---

## Current Status

**NOT ACTIVE.** Planned for a future implementation phase.
