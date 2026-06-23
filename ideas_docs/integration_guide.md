# Ingestion Tool — Integration Guide

This document defines how the Electron app integrates with the ingestion pipeline. It covers the Firestore data contract, the UI states the app must handle, the review/approval flow, and the application step that writes approved changes to operational collections.

---

## What the App Is Responsible For

The ingestion pipeline (defined in `ingestion_pipeline.md`) produces a fully populated `IngestionPackage` in Firestore. The Electron app is responsible for:

1. **Accepting user input** — the upload/submission interface
2. **Displaying pipeline progress** — showing the user what agents are doing
3. **Surfacing NeedsInput prompts** — collecting additional user input when classification confidence is low
4. **The review interface** — presenting the staged package for human review and approval
5. **Triggering the application step** — writing approved changes to operational collections via a Cloud Function
6. **Displaying confirmation** — showing what was applied and to which documents

---

## Firestore Collections Used

| Collection | Purpose |
|------------|---------|
| `/ingestionPackages` | All ingestion packages, all statuses |
| `/sops`, `/mops`, `/eops` | Operational collections — written to ONLY on approval |
| `/{collection}/{docId}/versions` | Version history subcollection — written to on approval |

The app reads from `/ingestionPackages` throughout the review flow. It never writes directly to operational collections — that is handled by the Application Step (Cloud Function or equivalent server-side logic).

---

## Firestore Listeners the App Must Maintain

### 1. Active Package Listener
When a user submits an ingestion, open a real-time listener on:
```
/ingestionPackages/{packageId}
```
This drives the progress and review UI. The app reacts to `status` field changes.

### 2. Review Queue Listener
For users with reviewer permissions, maintain a listener on:
```
/ingestionPackages where status in ["StagedForReview", "UnderReview"]
```
This populates the review queue badge and list.

---

## UI States — Ingestion Flow

### State 1: Submission Screen
The entry point. The user can:
- Drop or select files (any type — image, PDF, audio, video)
- Paste a URL
- Type or dictate a description
- Enter a free-text intent statement: "What do you want to do?" (maps to `input.userIntent`)

Allow multiple items to be submitted together as a single package. Display them as a list before submission.

On submit:
- Create the `IngestionPackage` document in Firestore with `status: "Processing"`
- Transition to State 2

---

### State 2: Processing View
Displayed while agents are running. Show a live progress indicator per agent:

```
✓  Classification Agent      Identified: Dell PowerEdge R750 Server
⟳  Research Agent            Searching manufacturer documentation...
○  Schema Mapper             Waiting...
○  Dependency Agent          Waiting...
○  Gap Agent                 Waiting...
```

Drive this from the `subagentLog[]` array in the package document (real-time listener).

If `status` transitions to `NeedsInput`, transition to State 3.
If `status` transitions to `StagedForReview`, transition to State 4.
If `status` transitions to `Failed`, display the error from `statusDetail` with a retry option.

---

### State 3: Needs Input View
Displayed when the Classification Agent (or Gap Agent) cannot proceed without more information.

Show the specific questions from:
- `classification.confidenceFlags` (if classification is the blocker)
- `gapReport[]` entries where `reason` blocks staging

Display as a simple form — each question on its own line with a text input. Do not show the entire package at this point. Keep it focused.

On submission: append the user's answers to `input.userIntent` or the relevant gap `resolvedValue` and re-trigger the pipeline from the appropriate agent.

---

### State 4: Review Interface
This is the core of the integration. The package is staged and ready for human decision.

The review interface has three panels:

#### Panel A: Summary Header
```
Ingestion Package #PKG-2024-0041
Submitted by: Nick Lynch · June 22, 2026

PRIMARY ACTION
  → Create new MOP: "Dell PowerEdge R750 Server — Initial Setup and Maintenance"
  → Collection: /mops

IMPACTED DOCUMENTS    [3 documents may be affected]  ▼
  → MOP: "Data Center Equipment Maintenance Checklist"
  → EOP: "Building A Emergency Operations Plan"
  → SOP: "IT Equipment Procurement and Intake"

GAPS REQUIRING INPUT  [2 fields need your input]  ▼

AUTO-FILLED FIELDS    [47 fields auto-populated]  ▼
```

#### Panel B: Document Review
Tabbed or accordion layout with one tab per document:

**Tab 1 — Primary Document (new MOP)**
Show the full proposed document draft rendered in a readable format (not raw JSON). Each field should be clearly labeled. Auto-filled fields are marked with a subtle "auto" badge. Gap fields are highlighted in amber with the Gap Agent's suggestion displayed inline.

The reviewer can:
- Edit any field directly in this view
- Accept or modify the Gap Agent's suggestions
- Mark individual steps as `criticalStep` or `holdPoint`

**Tab 2, 3, 4... — Impacted Documents**
For each entry in `impactedDocuments[]`, show:
- The document name and current state
- The `rationale` explaining why this document is affected
- A before/after diff of the proposed changes (`currentValue` → `proposedValue`)
- An **Accept / Reject** toggle per impact item (maps to `reviewerDecision`)

Individual impact items can be rejected without rejecting the whole package. If a reviewer rejects one impact item, that document is simply not updated — the rest of the package still applies.

#### Panel C: Gap Resolution
List all entries from `gapReport[]`. For each:
- Show the field name, the reason it couldn't be filled, and the agent's suggestion
- Provide an input field for the reviewer to enter the resolved value
- Mark as resolved when filled

Required gaps must be resolved before the Approve button is enabled.

---

### State 5: Approval Action
When the reviewer clicks Approve:

1. Validate that all required gaps are resolved
2. Show a confirmation dialog:
   ```
   You are about to approve this package. This will:
   · Create 1 new MOP document
   · Update 2 existing documents (1 impact item was rejected)
   · Create 4 version history records

   This action cannot be undone. Confirm?
   ```
3. On confirm:
   - Write the reviewer's decision to `approvalPackage.reviewActions[]`
   - Set `approvalPackage.finalDecision: "Approved"` (or `"ApprovedWithModifications"` if any items were edited or rejected)
   - Set `status: "Approved"`
   - Trigger the Application Step

---

### State 6: Application Step
**This step must run server-side** (Cloud Function, not in the renderer process). The app triggers it and then listens for `status` to transition to `Applied` or `Failed`.

The Application Step must execute as an atomic Firestore transaction:

```
BEGIN TRANSACTION

  1. Write primaryAction.documentDraft to /{targetCollection}/{docId}
     (or update if actionType is Update)

  2. For each accepted item in impactedDocuments[]:
     Apply proposedChanges[] to /{collection}/{docId}

  3. For each document written in steps 1 and 2:
     Create a version record in /{collection}/{docId}/versions/{newVersionId}
     populated from:
       - changedBy: the package submitter (input.submittedBy)
       - changeDate: now
       - changeSummary: primaryAction.changeSummary or impactedDocument rationale
       - changeReason: "Ingestion Package #{packageId}"
       - approvalChain: [{
           approverName: finalDecisionBy.name,
           approverUserId: finalDecisionBy.userId,
           approverRole: finalDecisionBy.role,
           action: "Approved",
           timestamp: finalDecisionAt,
           comments: reviewActions[last].comments
         }]

  4. Set ingestionPackage.status: "Applied"
  5. Write applicationLog

COMMIT TRANSACTION
```

If the transaction fails at any point, roll back everything, set `status: "Failed"`, and write the error to `applicationLog.errors[]`.

---

### State 7: Confirmation View
After `status: "Applied"`:

```
✓  Package Applied Successfully

  CREATED
  · MOP: "Dell PowerEdge R750 Server — Initial Setup and Maintenance" (v1.0.0)

  UPDATED
  · EOP: "Building A Emergency Operations Plan" (v2.3.1 → v2.3.2)
  · MOP: "Data Center Equipment Maintenance Checklist" (v1.1.0 → v1.1.1)

  VERSION RECORDS CREATED: 3
  CHAIN OF CUSTODY: Complete

  [View MOP]  [View Review Queue]  [Submit Another]
```

---

## Rejection Flow

If the reviewer clicks Reject:
- Prompt for a required rejection reason
- Write to `approvalPackage.reviewActions[]` with `action: "Rejected"` and the reason in `comments`
- Set `status: "Rejected"`
- Package is now closed. A new submission must be made to retry — rejected packages are not re-opened.
- The submitter is notified with the rejection reason

---

## Permissions Model

| Role | Can Submit | Can Review | Can Approve | Can View All Packages |
|------|-----------|-----------|------------|----------------------|
| Contributor | ✓ | — | — | Own packages only |
| Reviewer | ✓ | ✓ | — | Assigned packages |
| Approver | ✓ | ✓ | ✓ | All packages |
| Admin | ✓ | ✓ | ✓ | All packages + audit log |

Firestore Security Rules must enforce this — the Application Step (Cloud Function) should run with elevated permissions and validate that the calling user has Approver role before executing.

---

## Key Integration Rules

1. **Never write to operational collections from the renderer process.** All writes to `/sops`, `/mops`, `/eops` and their `versions` subcollections must go through the Application Step (server-side).

2. **Packages are immutable once Applied or Rejected.** No fields may be updated after these terminal states. If a rejected package's content is needed for a retry, copy the relevant fields into a new submission.

3. **The review interface must display `autoFilledFields` to the reviewer.** Reviewers must always know which fields were auto-populated vs. user-provided.

4. **Every gap in `gapReport[]` must have an entry.** The Approve button must be disabled until all required gaps are resolved.

5. **The approval of the package IS the chain of custody entry.** The version records written in the Application Step must reference the package ID and the final approver. This is the non-negotiable audit trail.

6. **Impact item rejection does not reject the package.** Reviewers may reject individual items in `impactedDocuments[]` while approving the rest. Only a full package rejection sets `status: "Rejected"`.

---

## Future Considerations

- **Notification system:** Reviewers should be notified when a package enters `StagedForReview`. Submitters should be notified on approval or rejection. (Email, in-app, or push — TBD.)
- **Review assignment:** Currently any Approver can approve any package. Future versions may require specific roles or two-person integrity for high-risk document types.
- **Package expiration:** Packages left in `StagedForReview` for more than X days should escalate or expire — prevents orphaned drafts in the queue.
- **Bulk ingestion:** For onboarding a large asset library, a batch ingestion mode may be needed. Each asset would still produce its own package, but they could be reviewed in a grouped queue.

---

*Last updated: 2026-06-22*
*Integration Guide version: 1.0.0*
