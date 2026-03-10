# SenderAgent

**File:** `backend/src/agents/SenderAgent.ts` (TO BE CREATED)
**Status:** FUTURE — not yet implemented

---

## Role

Handles ALL external communication with customers and internal teams.
Channels: **WhatsApp Business API** + **Outlook email**.

Prepares message drafts based on predefined templates, sends drafts to ManagerAgent
for review, waits for support team approval before sending.

**NEVER sends any message without approval.**

---

## Communication In

**Caller:** ManagerAgent
**Method:** `senderAgent.prepareDraft(situation, incidentContext)`

| Parameter         | Description                                                           |
|-------------------|-----------------------------------------------------------------------|
| `situation`       | Which template to use (see Templates below)                          |
| `incidentContext` | channel name, customer, error type, action taken, duration           |

---

## Templates

| Situation                 | Message Purpose                                    |
|---------------------------|---------------------------------------------------|
| `investigation_started`   | Alarm received, we are investigating               |
| `issue_detected`          | Problem confirmed, we are working on it            |
| `clarification_required`  | Need info from customer                            |
| `resolution_confirmation` | Stream restored                                    |
| `escalation_notice`       | Escalating to senior team                          |

---

## Approval Workflow (MANDATORY)

1. SenderAgent prepares draft
2. Draft sent to ManagerAgent for review  ← **BACK TO MANAGER**
3. ManagerAgent reviews / edits
4. ManagerAgent requests support team approval
5. Support team approves
6. SenderAgent sends message  ← **ONLY AFTER APPROVAL**

---

## Communication Out

**Returns to ManagerAgent:** `MessageDraft { channel, recipient, body, template }`

After approval: sends via WhatsApp Business API or Outlook email

---

## Channels

- WhatsApp Business API
- Outlook email

---

## State Changes

**None.** ManagerAgent writes all state.

---

## Current Status

**NOT ACTIVE.** Planned for a future implementation phase.
