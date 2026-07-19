# UI Contract: Frontend Props & API Payloads

This document defines the request/response payloads for the API endpoints queried by the React frontend.

## 1. GraphRAG Search API (`POST /query`)

Executed by the Graph Console in the React frontend.

### Request Body
```json
{
  "query": "What are the main operational issues discussed across vendor emails?",
  "mode": "global" // or "local"
}
```

### Response Body
```json
{
  "answer": "We are experiencing significant database performance bottlenecks on Project Apollo. Alice reported that the API query latency has spiked to over 1500ms [Thread: API Query Latency Issues]. Additionally, Acme Corp has flagged a blocker regarding the payment webhook credentials verification flow [Thread: Acme Webhook Blocker]."
}
```

---

## 2. Graph Diagnostics API (`GET/POST /graph-debug`)

Executed by admin or debug panels.

### Scenario A: Triplet Extraction Dry-Run (`POST /graph-debug?action=extract-sample`)
#### Request Body
```json
{
  "text": "Alice emailed Bob requesting that Acme Corp fix the credentials on Project Apollo."
}
```
#### Response Body
```json
{
  "entities": [
    { "name": "ALICE", "type": "CONTACT", "description": "Requests Acme Corp to fix credentials" },
    { "name": "BOB", "type": "CONTACT", "description": "Email recipient" },
    { "name": "ACME CORP", "type": "ORGANIZATION", "description": "Vendor organization" },
    { "name": "PROJECT APOLLO", "type": "PROJECT", "description": "Internal project name" }
  ],
  "relationships": [
    { "source": "ALICE", "target": "PROJECT APOLLO", "relation": "RELATES_TO", "description": "Alice is working on Project Apollo", "strength": 7 }
  ]
}
```

### Scenario B: Inspect Node Connections (`GET /graph-debug?action=inspect-node&name=ALICE`)
#### Response Body
```json
{
  "entity": {
    "id": "e8a9cf29-d588-4c12-bd77-a16f6b55d91c",
    "name": "ALICE SMITH",
    "type": "CONTACT",
    "organization": "TASKER",
    "bio_summary": "Lead engineer for API platforms."
  },
  "connections": [
    {
      "edge_id": "78bcfd71-55c1-4889-8dcf-33bb7f5a111a",
      "target_name": "PROJECT APOLLO",
      "target_type": "PROJECT",
      "relationship_type": "ASSIGNED_TO",
      "description": "Alice is assigned as lead developer on Project Apollo"
    }
  ]
}
```
