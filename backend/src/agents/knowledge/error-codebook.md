# G-Mana Error Codebook

Every known error code, its meaning, and the correct fix.

---

| Error Code                   | Meaning                                      | Fix                |
|------------------------------|----------------------------------------------|--------------------|
| `MAIN_MANIFEST_BAD_RESPONSE` | G-Mana manifest stale or malformed           | `RESTART_UH`       |
| `MPD_MANIFEST_BAD_RESPONSE`  | G-Mana MPD manifest stale or malformed       | `RESTART_UH`       |
| `SEGMENT_MISMATCH_ERROR`     | G-Mana segments don't match source segments  | `RESTART_UH`       |
| `SSAI_AD_BREAK_NOT_DETECTED` | No SCTE-35 markers in G-Mana output          | `RESTART_CI`       |
| `HTTP_502_UPSTREAM_ERROR`    | G-Mana endpoint returns 502 Bad Gateway      | `RESTART_UH`       |
| `SOURCE_TIMEOUT`             | Source broadcaster stream times out          | `NOTIFY_CUSTOMER`  |
| `SOURCE_STREAM_DOWN`         | Source broadcaster stream unreachable        | `NOTIFY_CUSTOMER`  |
| `STREAM_UNAVAILABLE`         | Stream not accessible                        | `RESTART_UH`       |
| `BOTH_STREAMS_DOWN`          | Both G-Mana and source unreachable           | `ESCALATE`         |
| `REDIS_DEGRADED`             | Redis cluster not healthy                    | `ESCALATE (DevOps)`|
| `UH_POD_CRASH_LOOP`          | UH pod in CrashLoopBackOff                   | `RESTART_UH`       |
| `CI_POD_CRASH_LOOP`          | CI pod in CrashLoopBackOff                   | `RESTART_CI`       |
| `POD_UNSTABLE`               | Pod restart count > 10                       | `RESTART + ESCALATE`|
| `HIGH_CPU`                   | Redis CPU > 85%                              | `ESCALATE (DevOps)`|
| `HIGH_MEMORY`                | Redis memory > 90%                           | `ESCALATE (DevOps)`|
| `NO_STREAM_ISSUE`            | Both streams healthy                         | `MONITOR`          |
