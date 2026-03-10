# Decision Rules

Business rules that ALL agents must follow.

---

## Rule 1 — SOURCE RULE
If source stream is down → `NOTIFY_CUSTOMER` only one time per channel.
**NEVER restart G-Mana pods when the source is broken. It is not our fault.**

## Rule 2 — REDIS RULE
If Redis cluster is down → `ESCALATE` to DevOps immediately.
If Redis cpu exceed threshold → `ESCALATE` to DevOps.
Pod restarts will not help when session state storage is unavailable.

## Rule 3 — Priority RULE
If channel is Keshet or Reshet → escalate to Yoni immediately, regardless of confidence.
Priority customers must never wait for automated resolution.


## Rule 4— POD STABILITY RULE
If any pod has restarted more than 10 times → treat as unstable.
Report as `POD_UNSTABLE` and escalate alongside any restart action.

## Rule 5 — RESTART ORDER
Always try in this sequence:
1. `RESTART_UH` first  (manifest / 502 / sequence issues)
2. `RESTART_CI` second (ad insertion / SCTE-35 issues)
3. `MOVE_TO_SOURCE` as last resort (viewers see raw stream, no ads)

## Rule 6 — MAX RESTARTS
Never restart the same pod more than 2 times per incident.
After 2 failed restarts → `MOVE_TO_SOURCE` + escalate to Yoni.

## Rule 7 — NOISE FILTER
Same channel alarmed more than 3 times in 60 minutes →
flag as recurring pattern, escalate instead of restarting again.

## Rule 8 — COMMUNICATION RULE
Any message to a customer must be drafted by SenderAgent (future),
reviewed by ManagerAgent, and approved by the support team before sending.
