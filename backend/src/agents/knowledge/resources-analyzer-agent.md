# ResourcesAnalyzerAgent

**File:** `backend/src/agents/ResourcesAnalyzerAgent.ts`
**Status:** ACTIVE
**Type:** Rule-based specialist (no GPT-4o, no state writes)

---

## Role

Second analysis agent. Checks all infrastructure health for the affected channel.
Runs after ManagerAgent distributes data from the StreamAnalysisReport.

Does NOT call GPT-4o. Does NOT write incident state.

> **Important:** Logs are fetched BEFORE any restart is triggered.
> UH and CI logs are lost when a pod restarts — fetching here preserves evidence.

---

## Communication In

**Caller:** ManagerAgent
**Method:** `resourcesAnalyzer.analyze(clusterName, dsUuid)`

| Parameter     | Description                                          |
|---------------|------------------------------------------------------|
| `clusterName` | Kubernetes cluster (e.g. `"hub1x"`) from StreamAnalysisReport |
| `dsUuid`      | Unique session ID for the affected channel           |

---

## Internal Logic

All three checks run simultaneously via `Promise.allSettled` (partial failure OK):

### CHECK 1 — UH Pod Health
```
GET /sendalarms/clusters/{cluster}/pods/user-handler-{dsUuid}/logs
```
- Pod state check: `Running` | `Pending` | `Failed`
- Restart count: if > 10 → `POD_UNSTABLE`
- Log scan: `ERROR`, `WARN`, `CrashLoop`, `OOMKilled`, `panic`

### CHECK 2 — CI Pod Health
```
GET /sendalarms/clusters/{cluster}/pods/cuemana-in-{dsUuid}/logs
```
- Pod state check: `Running` | `Pending` | `Failed`
- Restart count: if > 10 → `POD_UNSTABLE`
- Log scan: `ERROR`, `WARN`, `CrashLoop`

### CHECK 3 — Redis Cluster Health
```
GET /sendalarms/clusters/{cluster}/redis-instances
```
- Monitors: Reshet cluster | Keshet cluster | General customers cluster
- Per instance: `isHealthy`, `cpuUsagePercent`, `usedMemoryBytes / maxMemoryBytes`
- Result: `redisDown (bool)`, `highCpu (bool)`, `highMemory (bool)`

---

## Detection Priority (first match wins)

| Condition              | Issue Type   | Component | Severity  | Confidence |
|------------------------|--------------|-----------|-----------|------------|
| Redis `isHealthy=false`| `REDIS_DOWN` | `REDIS`   | critical  | 92%        |
| UH errors AND CI errors| `POD_CRASH`  | `UH`      | high      | 82%        |
| UH errors only         | `POD_CRASH`  | `UH`      | high      | 87%        |
| CI errors only         | `POD_CRASH`  | `CI`      | medium    | 82%        |
| Redis memory > 90%     | `MEMORY_HIGH`| `REDIS`   | medium    | 75%        |
| Redis CPU > 85%        | `CPU_HIGH`   | `REDIS`   | low       | 70%        |
| None of the above      | `NONE`       | `NONE`    | low       | 85%        |

---

## Communication Out

**Returns to:** ManagerAgent (direct TypeScript return value)

```ts
ResourcesAnalysisReport {
  clusterName, dsUuid,
  uhLogs,           // PodLogs: { podName, logs }
  ciLogs,           // PodLogs: { podName, logs }
  redisResources,   // ClusterResources: all Redis instance stats
  affectedComponent,   // "UH" | "CI" | "REDIS" | "NONE" | "UNKNOWN"
  resourceIssueType,   // "CPU_HIGH" | "MEMORY_HIGH" | "REDIS_DOWN" | "POD_CRASH" | "NONE"
  severity,            // "low" | "medium" | "high" | "critical"
  possibleStreamImpact,
  confidenceScore,     // 0–100
  flaggedForFurtherAnalysis,
  details
}
```

---

## State Changes

**None.** ManagerAgent writes all incident state.
