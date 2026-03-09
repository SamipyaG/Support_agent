# G-Mana Support AI Agent

Production-ready multi-agent AI system for automated SSAI stream monitoring,
incident investigation, and resolution.

## Architecture

```
5 Input Sources → ManagerAgent → 5 Analyzer Agents → Action → Resolution
                      ↕
               Redis Event Bus
                      ↕
              MongoDB (90-day TTL)
```

### Agents
| Agent | Role |
|---|---|
| ManagerAgent | Orchestrates all agents, owns state machine, handles approval |
| StreamAnalyzerAgent | Compares G-Mana vs Source manifest |
| ResourceAnalyzerAgent | Checks Redis, UH Pod, CI Pod, CPU, Memory |
| PlayerAnalyzerAgent | Deep HLS/DASH manifest analysis |
| SenderAgent | Email, WhatsApp, Jira notifications |
| MemoryAgent | Pattern detection and memory retrieval |

### State Machine
```
NEW → ANALYZING → WAITING_APPROVAL → EXECUTING_ACTION → MONITORING → RESOLVED → CLOSED
                                                       ↘ ESCALATED
                                                       ↘ FAILED
```

---

## Quick Start

### Prerequisites
- Docker & Docker Compose
- Node.js 20+ (for local dev)

### 1. Clone and configure
```bash
git clone <repo>
cd g-mana-support-ai
cp .env.example .env
# Edit .env with your actual API keys and credentials
```

### 2. Run with Docker Compose
```bash
docker-compose up --build -d
```

Services:
- **Frontend**: http://localhost:8080
- **Backend API**: http://localhost:3000
- **MongoDB**: localhost:27017
- **Redis**: localhost:6379

### 3. Check health
```bash
curl http://localhost:3000/health
```

---

## Local Development

### Backend
```bash
cd backend
npm install
cp ../.env.example .env
# fill in .env values
npm run dev
```

### Frontend
```bash
cd frontend
npm install
npm run dev
# http://localhost:5173
```

---

## API Reference

### Incidents
```
GET  /api/incidents              — List all incidents (paginated)
GET  /api/incidents/:id          — Get incident with full details
GET  /api/incidents/filter/active — Active incidents only
```

### Approvals
```
POST /api/approve/:incidentId    — Submit approval decision
  Body: { "decision": "approved" | "rejected", "decidedBy": "name" }

GET  /api/approve/:incidentId/status — Check pending approval
```

### Alarms
```
POST /api/alarms/manual          — Manually trigger investigation
  Body: { "dsUuid": "uuid", "reportedBy": "Support" | "WhatsApp" | "Email" }

POST /api/alarms/webhook         — Hub Monitor webhook
  Body: { "type": "new" | "update" | "closed", "payload": { ... } }
```

---

## Key Configuration

| Variable | Description | Default |
|---|---|---|
| `CONFIDENCE_THRESHOLD` | Min % to auto-act | 80 |
| `APPROVAL_TIMEOUT_SECONDS` | Approval window | 10 |
| `MONITORING_STABLE_SECONDS` | Post-action monitoring | 300 |
| `HUB_MONITOR_POLL_INTERVAL_MS` | Polling interval | 30000 |
| `WHATSAPP_ENABLED` | Enable WhatsApp | true |
| `OUTLOOK_ENABLED` | Enable email monitoring | true |

---

## WhatsApp Setup

On first run with WhatsApp enabled, a QR code will appear in backend logs:
```bash
docker-compose logs -f backend
# Scan the QR code with your WhatsApp
```

Session is persisted in `./backend/whatsapp-session`.

---

## Guardrails
- Max 2 restart attempts per incident (UH → CI → Move to Source)
- VIP channels escalate to Yoni immediately on alarm
- Confidence < 80% → escalate, never auto-act
- Same channel within 60 min → deduplicated
- DOWN duration must exceed waiting time before action
- All incidents blocked from execution if already RESOLVED/CLOSED

---

## Project Structure
```
g-mana-support-ai/
├── backend/
│   └── src/
│       ├── agents/          # 6 agent classes
│       ├── tools/           # HubMonitor, Jira, WhatsApp, Outlook, PlayerDebug
│       ├── services/        # ApprovalService, EscalationService, RedisEventBus
│       ├── models/          # 7 Mongoose schemas with TTL indexes
│       ├── routes/          # incidents, approvals, alarms
│       ├── stateMachine/    # IncidentStateMachine (9 states)
│       └── utils/           # logger, retry, validators
├── frontend/
│   └── src/
│       ├── views/           # DashboardView, IncidentDetailView
│       ├── components/      # IncidentCard, ApprovalTimer, TimelineItem
│       ├── store/           # Pinia incidents store
│       ├── router/          # Vue Router
│       └── api/             # Axios client
├── docker-compose.yml
└── .env.example
```
