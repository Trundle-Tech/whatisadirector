# Schema Architecture — Operational Document Management

This document is the authoritative reference for the schema design decisions behind the operational document system. All future development must align with this architecture.

---

## Purpose

The schema system defines a standard blueprint that all operational documents must conform to. The end goal is an ingestion pipeline where raw information (interviews, existing docs, field notes) can be processed and transformed into structured, versioned, auditable documentation.

The schemas are blueprints first — Firestore structures, UI forms, ingestion parsers, and export templates all derive from these definitions.

---

## Design Decisions

### 1. Separate Firestore Collections per Document Type
Each document type lives in its own top-level Firestore collection:

| Document Type                    | Collection           |
| -------------------------------- | -------------------- |
| Standard Operating Procedure     | `/sops`              |
| Maintenance Operating Procedure  | `/mops`              |
| Emergency Operations Plan        | `/eops`              |
| Runbook                          | `/runbooks`          |
| Incident Response Plan           | `/irps`              |
| Business Continuity Plan         | `/bcps`              |
| Training Procedure               | `/trainingProcedures`|
| Emergency Checklist              | `/emergencyChecklists`|

**Rationale:** Each document type has meaningfully different fields, query patterns, and access patterns. Separate collections keeps queries simple, indexes clean, and avoids sparse documents.

### 2. Internal Namespace
All schema IDs use the internal namespace:
```
https://whatisadirector.internal/schema/
```
This is an internal standard only — not a publicly resolvable URL. If the system is ever made public-facing, this namespace should be updated and a redirect strategy put in place.

### 3. Version History as Subcollection with Full Chain of Custody
Every document has a `versions` subcollection at:
```
/{collection}/{docId}/versions/{versionId}
```
Version records are **write-once and immutable** — they are never modified after creation. Every approved change to a document creates a new version record.

Chain of custody is maintained through:
- `changedBy` — who made the change (name, userId, role)
- `changeDate` — when it was submitted (server-side timestamp)
- `approvalChain` — ordered list of every approval action taken, by whom, when, with comments
- `changeType` — what category of change was made
- `changeSummary` — what specifically changed
- `changeReason` — why the change was made (incident, audit, review cycle, etc.)
- `linkedIncidents` — direct links to any incident or corrective action that drove the change
- `snapshotRef` — a full document snapshot at this version (complete state preservation)

### 4. Blueprint-First Approach
The schemas are the single source of truth. Nothing is built until the blueprint is defined. Downstream artifacts (Firestore rules, UI forms, API endpoints, ingestion parsers, export templates) are all derived from these schema files.

---

## Schema Ontology

The custom type hierarchy:

```
Schema.org/CreativeWork
 └── OperationalDocument  (base_document.schema.json)
      ├── SOP             (sop.schema.json)        → Schema.org/HowTo
      ├── MOP             (mop.schema.json)         → Schema.org/TechArticle
      ├── EOP             (eop.schema.json)         → Schema.org/CreativeWork
      ├── Runbook         (future)                  → Schema.org/HowTo
      ├── IRP             (future)                  → Schema.org/CreativeWork
      ├── BCP             (future)                  → Schema.org/CreativeWork
      ├── TrainingProcedure (future)                → Schema.org/Course
      └── EmergencyChecklist (future)               → Schema.org/HowTo
```

Each document type uses `additionalType` to declare its internal type while remaining compatible with Schema.org:
```json
{
  "@type": "HowTo",
  "additionalType": "https://whatisadirector.internal/schema/SOP"
}
```

---

## Schema Files

| File                           | Purpose                                                        |
| ------------------------------ | -------------------------------------------------------------- |
| `base_document.schema.json`    | Shared base for all document types — identity, ownership, lifecycle, approvals |
| `version_history.schema.json`  | Write-once version record — chain of custody, change tracking  |
| `sop.schema.json`              | SOP blueprint — steps, safety, tools, supplies, hold points    |
| `mop.schema.json`              | MOP blueprint — equipment, LOTO, phases, measurements, risk    |
| `eop.schema.json`              | EOP blueprint — command structure, annexes, contacts, hazards  |

---

## Key Shared Concepts (from base_document)

### Document Lifecycle States
```
Draft → UnderReview → Approved → Active → Superseded → Retired
```

### Semantic Versioning
All documents use `MAJOR.MINOR.PATCH`:
- **MAJOR** — complete rewrite or fundamental scope change
- **MINOR** — significant content change, new steps or sections
- **PATCH** — corrections, clarifications, formatting, typo fixes

### Approval Chain
Every document and every version record carries a structured approval chain — an ordered array of approver actions including role, timestamp, and comments. This ensures that no document reaches `Active` status without a documented approval trail.

---

## SOP vs. MOP vs. EOP — Key Distinctions

| Dimension            | SOP                          | MOP                                  | EOP                                       |
| -------------------- | ---------------------------- | ------------------------------------ | ----------------------------------------- |
| Schema.org type      | HowTo                        | TechArticle                          | CreativeWork                              |
| Primary purpose      | Routine repeatable task      | Equipment/system maintenance         | Emergency response planning               |
| Steps structure      | Sequential steps             | Phased steps (Prep/Exec/Restore/etc) | Functional annexes with embedded HowTos  |
| Safety model         | PPE + permits                | LOTO + energy isolation              | ICS command structure + activation        |
| Equipment model      | Tools + supplies             | Equipment + spare parts + calibration| Resource inventories + facilities         |
| Chain of command     | Completion sign-off          | Hold points + post-work tests        | Full ICS command structure                |
| Lifecycle trigger    | Task request / schedule      | Maintenance schedule / condition     | Emergency declaration                     |

---

## Future Additions

The following document types are planned but not yet schema-defined:

- **Runbook** — IT/operations runbooks (server restart, deployment rollback, etc.)
- **IRP** — Incident Response Plan (cybersecurity and operational incidents)
- **BCP** — Business Continuity Plan
- **TrainingProcedure** — Instructional procedures with learning outcomes
- **EmergencyChecklist** — Rapid reference checklists derived from EOPs
- **JHA** — Job Hazard Analysis (linked to SOPs and MOPs)
- **PermitToWork** — Hot work, confined space, energized work permits

---

## Ingestion Pipeline (Target State)

The ingestion goal: take raw input (existing documents, field interviews, dictation) and produce structured documents that conform to these schemas.

1. **Input** — raw text, PDF, audio transcript, or structured data
2. **Extract** — parse out document sections, steps, contacts, roles, equipment
3. **Map** — map extracted fields to schema properties
4. **Validate** — validate against the JSON schema
5. **Stage** — create a `Draft` document in Firestore with `version: 1.0.0`
6. **Review** — route for human review and correction
7. **Approve** — approval chain sign-off creates first `versions` subcollection record
8. **Activate** — status set to `Active`

---

*Last updated: 2026-06-22*
*Schema version: 1.0.0*
