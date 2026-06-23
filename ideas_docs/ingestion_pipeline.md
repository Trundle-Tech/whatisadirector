# Ingestion Pipeline — Agent Instructions & Specification

This document defines the behavior, responsibilities, inputs, outputs, and decision rules for every agent in the omnimodal ingestion pipeline. Any implementation of this pipeline must conform to this specification.

---

## Overview

The ingestion pipeline transforms raw user input (image, PDF, audio, video, text, URL, or any combination) into a fully staged `IngestionPackage` ready for human review and approval. The pipeline is **fully staged** — no document is created or modified in the operational collections until a human approves the complete package.

The pipeline produces one output: a populated `IngestionPackage` (see `schema/ingestion_package.schema.json`).

---

## Pipeline Stages

```
User Input
    │
    ▼
[1] Classification Agent        ← What is this? What does the user want?
    │
    ├── Low confidence → NeedsInput → Prompt user → Re-run
    │
    ▼
[2] Orchestration Layer         ← Fires subagents in parallel
    │
    ├── [2a] Research Agent     ← Gathers facts about the identified subject
    ├── [2b] Schema Mapper      ← Maps findings to schema fields
    ├── [2c] Dependency Agent   ← Finds impacted existing documents
    └── [2d] Gap Agent          ← Identifies unfillable fields
    │
    ▼
[3] Package Assembly            ← Assembles the complete IngestionPackage
    │
    ▼
[4] Staging Validation          ← Confirms package is ready for human review
    │
    ├── Gaps blocking? → NeedsInput
    └── Ready → StagedForReview
```

---

## Agent 1 — Classification Agent

**Runs:** Immediately on submission, before any other agent.

**Purpose:** Determine what the input is, what the user wants to do, and what document types will be involved.

### Inputs
- All items in `input.items[]` (image bytes, text, file content, URL)
- `input.userIntent` — the user's free-text instruction

### Outputs (written to `classification`)
- `identifiedSubject` — specific identification of what was submitted
- `subjectCategory` — high-level category
- `intent` — what action is requested
- `primaryDocType` — the main document type to create or update
- `impliedDocTypes` — other document types likely affected
- `confidence` — 0.0–1.0

### Decision Rules

| Confidence | Action |
|------------|--------|
| ≥ 0.90 | Proceed immediately to orchestration |
| 0.75–0.89 | Proceed but flag `confidenceFlags` for reviewer attention |
| < 0.75 | Set package to `NeedsInput`, surface specific questions to the user |

### Classification Behavior by Input Type

**Image:**
- Run visual identification to identify the object (device, equipment, label, diagram, hazard, person)
- Cross-reference with known product categories, manufacturer logos, label text, safety pictograms
- If multiple objects in frame, identify the primary subject and note secondary objects

**PDF:**
- Extract text and structure
- Identify document type if it's an existing document (manual, spec sheet, existing SOP, permit)
- Extract key entities: manufacturer, model, part numbers, standards references, step lists, contact info

**Audio / Video:**
- Transcribe to text first
- Apply text classification rules to the transcript
- Flag timestamps for sections that contain instructions, safety notices, or named entities

**URL:**
- Fetch page content
- Identify whether it is: manufacturer product page, regulatory standard, existing internal doc, external SOP reference
- Extract structured data (specs, model numbers, hazard classifications)

**Plain Text:**
- Parse for named entities, quantities, part numbers, role names, location references
- Identify if the user is describing a process, an asset, an incident, or a policy

**Multiple inputs submitted together:**
- Treat as a single coherent submission
- Synthesize across all inputs — an image + text description together produce a better classification than either alone
- Reconcile conflicts between inputs and flag them in `confidenceFlags`

### Questions to Ask When NeedsInput
The agent must surface specific, answerable questions — not vague requests. Examples:
- "I identified this as a Dell server but could not determine the model. Is this a PowerEdge R750 or R650?"
- "Your description mentions 'the lab' — which facility is this for?"
- "This appears to be a maintenance procedure. Should this create a new MOP, or update an existing one?"

---

## Agent 2a — Research Agent

**Runs:** After Classification Agent completes with confidence ≥ 0.75.

**Purpose:** Gather external and internal facts about the identified subject to pre-fill as many schema fields as possible.

### Inputs
- `classification.identifiedSubject`
- `classification.subjectCategory`
- `classification.primaryDocType`
- `researchFindings` (any partial data already extracted from the input itself)

### Research Strategy by Subject Category

**ITEquipment / IndustrialEquipment / Product:**
1. Search manufacturer website for product page, spec sheet, and support documentation
2. Pull: model number, dimensions, power requirements, environmental specs, known failure modes, recommended maintenance intervals
3. Search for applicable safety standards (UL, CE, OSHA regulations, NFPA codes)
4. Look for OEM-provided maintenance procedures or installation guides
5. Search for known hazards, recalls, or safety notices

**Chemical:**
1. Retrieve Safety Data Sheet (SDS/MSDS)
2. Extract: GHS hazard classifications, PPE requirements, storage requirements, spill response procedures, disposal procedures, exposure limits
3. Identify applicable regulatory requirements (OSHA HazCom, EPA, DOT)

**Facility / Place:**
1. Pull internal records if available (from Firestore — existing EOPs, MOPs referencing this facility)
2. Identify relevant local emergency services, utility contacts, applicable fire codes

**Process / Procedure:**
1. Search for industry best practices and standard methodologies
2. Identify applicable regulatory or accreditation requirements for this process type

### Outputs (written to `researchFindings`)
- All gathered structured data
- Source URLs for every fact (for reviewer traceability)
- `additionalContext` for anything relevant that didn't map to a structured field

### Research Boundaries
- Research is read-only. The Research Agent never modifies any document or external source.
- If a source requires authentication, skip it and note the gap.
- Prefer primary sources (manufacturer, regulatory body) over secondary sources.
- If conflicting information is found across sources, include all versions and flag the conflict in `confidenceFlags`.

---

## Agent 2b — Schema Mapper Agent

**Runs:** After Research Agent completes.

**Purpose:** Map all available information (from the original input + research findings) to the correct schema fields for the primary document draft.

### Inputs
- `classification` (determines which schema to map to)
- `input.items[]` (original submission content)
- `researchFindings`

### Mapping Rules

1. **Field priority:** Information directly provided in the user's input always takes precedence over researched information. Research fills gaps, it does not override what the user explicitly stated.

2. **Required fields:** Every field marked `required` in the target schema must either be filled or added to the `gapReport`. A package cannot reach `StagedForReview` with an unfilled required field that lacks a `gapReport` entry.

3. **Auto-fill transparency:** Every field path that was auto-filled must be recorded in `primaryAction.autoFilledFields`. Reviewers must be able to see exactly which fields were populated by agents vs. provided by the user.

4. **Steps construction:**
   - If the input contains a numbered list, a sequence of instructions, or an audio walkthrough — extract and map to `steps[]`
   - Each step must have at minimum: `stepNumber`, `name`, `instructions`
   - Flag steps where instructions are vague, incomplete, or contain conditional language that may indicate missing sub-steps
   - Mark `criticalStep: true` on any step containing safety-critical keywords: "lock out", "de-energize", "verify zero energy", "do not proceed until", "ensure no power", "verify isolation", "test before", "emergency stop"

5. **Safety mapping:**
   - Any mention of PPE → map to `safetyRequirements` with appropriate type
   - Any mention of lockout/tagout → `safetyRequirements` type: LOTO + `energyIsolationPlan` (MOP only)
   - Any permit mention → flag for `safetyClassifications.permitRequired: true`

6. **Version assignment:**
   - New document: `version: "1.0.0"`
   - Update to existing: increment MINOR if content changed, PATCH if correction only

### Output (written to `primaryAction.documentDraft`)
- A complete proposed document conforming to the target schema
- Partially filled is acceptable — gaps are captured in `gapReport`, not left as nulls without explanation

---

## Agent 2c — Dependency Agent

**Runs:** In parallel with Schema Mapper Agent after Research Agent completes.

**Purpose:** Query existing Firestore documents to identify which ones are affected by this ingestion and what changes they need.

### Inputs
- `classification.identifiedSubject`
- `classification.subjectCategory`
- `classification.primaryDocType`
- The proposed document draft (from Schema Mapper, when available)

### Search Strategy

The Dependency Agent queries across all operational collections using these criteria:

**Asset/Equipment match:**
- Search `/mops` where `equipment[].name` or `equipment[].assetId` matches the identified subject
- Search `/sops` where `tools[].name` or `supplies[].name` matches
- Search `/eops` where `resourceInventories[].name` matches

**Location match:**
- If the subject has a `facility` or `location` — search all collections where `facility` matches

**Process/Category match:**
- Search for documents in the same `sopCategory`, `maintenanceType`, or `eopType`
- Search `relatedDocuments[]` arrays for cross-references

**Document reference match:**
- If this ingestion creates a new document, search for any existing doc that would logically reference it (e.g. creating an SOP for a new piece of equipment → find MOPs that reference that equipment type)

### Impact Classification

For each document found, the agent must determine the `changeType` and propose specific field-level changes:

| Scenario | changeType | What changes |
|----------|------------|--------------|
| New asset added to facility covered by an EOP | `AddToResourceInventory` | `resourceInventories[]` gets new entry |
| New equipment matches tools referenced in an SOP | `AddReference` | `relatedDocuments[]` gets new entry |
| Updated contact info for a person/role | `UpdateContactInfo` | `commandStructure.positions[].primary` or `emergencyContacts[]` |
| New SOP created for equipment that a MOP already references | `AddRelatedDocument` | `relatedDocuments[]` gets entry pointing to new SOP |
| Equipment being retired | `UpdateEquipment` | Remove from active procedures or flag as retired in references |

### Output (written to `impactedDocuments[]`)
- One entry per impacted document
- Each entry must include `rationale` — a clear human-readable explanation of why this document is affected
- Each entry must include `proposedChanges[]` with current and proposed values for reviewer comparison
- Maximum depth: the Dependency Agent identifies first-order impacts only. It does not recursively chase impacts of impacts.

### Threshold
If the Dependency Agent finds more than 20 impacted documents, it must:
1. Include all of them in `impactedDocuments[]`
2. Set a flag in `statusDetail` warning the reviewer of the volume
3. Group them by `changeType` in the review UI (handled by integration layer)

---

## Agent 2d — Gap Agent

**Runs:** After Schema Mapper Agent completes.

**Purpose:** Audit the populated document draft and produce a prioritized list of every field that could not be auto-filled, with context on why and a suggested resolution.

### What constitutes a gap

A gap is any of:
- A `required` field in the schema that is empty or null
- A field that was auto-filled with low-confidence data (below 0.80 confidence)
- A `holdPoint` step that has no `holdPointApprover` specified
- A `safetyRequirement` with no `standard` reference
- An `energyIsolationPlan` entry with no `verificationMethod`
- A `commandStructure.position` with no `primary` contact filled
- An `approvals[]` array that is empty (document cannot be approved without defined approvers)

### Gap Reason Classification

| Reason | When to use |
|--------|-------------|
| `NotFoundInResearch` | Agent searched but found no reliable data |
| `RequiresOnSiteVerification` | Must be physically verified (e.g. exact energy isolation point ID) |
| `RequiresSMEInput` | Needs a subject matter expert or domain specialist |
| `AmbiguousFromInput` | Multiple valid answers found, user must choose |
| `MultipleOptionsFound` | Research returned conflicting values |
| `PermitRequirementUnknown` | Can't determine if a permit is required without organizational context |

### Output (written to `gapReport[]`)
- Every gap as a separate entry
- Ordered by priority: required fields first, then safety-critical fields, then optional fields
- Each entry must include a `suggestion` — a specific question or proposed default for the reviewer, not just a label

---

## Package Assembly

After all subagents complete, the Orchestration Layer assembles the final `IngestionPackage`:

1. Set `status` based on gap report:
   - Any unfilled **required** field with `reason: RequiresOnSiteVerification` or `RequiresSMEInput` and no suggestion → `NeedsInput`
   - All required fields filled or have resolvable gap entries → `StagedForReview`

2. Populate `statusDetail` with a plain-language summary: "Ready for review. Primary action: Create new MOP for Dell PowerEdge R750. 3 existing documents flagged for updates. 2 gaps require reviewer input before approval."

3. Write the complete package to Firestore at `/ingestionPackages/{packageId}`

4. Trigger the review notification (handled by integration layer)

---

## Confidence Thresholds (Summary)

| Threshold | Applied To | Behavior |
|-----------|-----------|----------|
| < 0.75 | Classification | Block orchestration, enter NeedsInput |
| 0.75–0.89 | Classification | Proceed, flag for reviewer |
| < 0.80 | Individual schema field | Add to gapReport |
| ≥ 0.80 | Individual schema field | Auto-fill, record in autoFilledFields |

---

## What the Pipeline Does NOT Do

- It does not write to `/sops`, `/mops`, `/eops`, or any operational collection. Only the Application step (post-approval) does that.
- It does not make decisions about organizational policy, regulatory compliance, or safety engineering. It surfaces the information and flags the gaps — humans decide.
- It does not recursively chase second-order impacts. First-order only.
- It does not delete anything. Retire actions stage a status change to `Retired` — the reviewer approves the retirement.

---

*Last updated: 2026-06-22*
*Pipeline specification version: 1.0.0*
