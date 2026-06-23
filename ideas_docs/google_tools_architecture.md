# Google Tools Integration Architecture Map

This document serves as the master roadmap and architectural reference for all **Google technologies** utilized in the "What is a Director" desktop application. It defines their roles, configuration locations, boundaries, and how they coordinate to execute the document ingestion and local assistant workflows.

---

## 🛠️ The Google Technology Stack

The application integrates Google tools across three layers: the **Data Layer**, the **Inference Layer**, and the **Execution Layer**.

```
                           ┌────────────────────────────────────────────────────────┐
                           │                      APPLICATION                       │
                           └──────┬───────────────────┬───────────────────┬─────────┘
                                  │                   │                   │
                                  ▼                   ▼                   ▼
                       ┌─────────────────────┐ ┌─────────────┐ ┌────────────────────┐
                       │     DATA LAYER      │ │ EXECUTION   │ │  INFERENCE LAYER   │
                       │                     │ │   LAYER     │ │                    │
                       │  Cloud Firestore    │ │  Firebase   │ │  Gemma 4 (Local)   │
                       │                     │ │  Functions  │ │  Gemini (Cloud)    │
                       └─────────────────────┘ └─────────────┘ └────────────────────┘
```

---

## 📂 1. Data Layer: Cloud Firestore
Cloud Firestore is the server-side, real-time database that stores all operational and staged document records.

*   **Primary Collections & Roles**:
    *   `/ingestionPackages`: Stores ingestion packages at all lifecycle stages (`Processing`, `NeedsInput`, `StagedForReview`, `Approved`, `Applied`, `Rejected`).
    *   `/sops`: Operational Standard Operating Procedures.
    *   `/mops`: Operational Maintenance Operating Procedures.
    *   `/eops`: Operational Emergency Operations Plans.
    *   `/{collection}/{docId}/versions`: Write-once subcollection tracking the complete chain of custody and human approvals.
*   **Key Integration Rules**:
    *   **Main Process Restriction**: In compliance with Security Rule #1, the Electron renderer process *never* writes directly to the operational `/sops`, `/mops`, or `/eops` collections. It may only write to `/ingestionPackages`.
    *   **Listeners**: The application maintains two active real-time listeners:
        1.  *Active Package Listener*: Observes `/ingestionPackages/{packageId}` to drive State 2 (Processing) and State 4 (Review UI).
        2.  *Review Queue Listener*: Observes `/ingestionPackages where status in ["StagedForReview", "UnderReview"]` to populate the reviewer queue.
*   **Key Files & Configuration**:
    *   [firebase_setup.md](file:///Users/nicklynch/Desktop/whatisadirector/ideas_docs/firebase_setup.md) — Contains initialization credentials (`apiKey`, `authDomain`, `projectId`, etc.).
    *   `ideas_docs/schema/` — Defines JSON Schemas for base documents, version histories, and specific procedures (SOP/MOP/EOP).

### 📂 1.1 Vector Indexing & Semantic Graph (Firestore & Vertex)
To enable real-time semantic search and navigation, the application structures a **Vector Graph** overlay on top of Firestore documents:

1. **Vector Embeddings (`vector_embedding`)**:
   * Every SOP, MOP, and EOP document contains a `vector_embedding` field of type `vector`.
   * Vectors are generated using Google Vertex AI's `text-embedding-004` model (768 dimensions).
2. **Vector Index Configuration**:
   * A composite single-vector index is provisioned on the `vector_embedding` field in the `/sops`, `/mops`, and `/eops` collections.
   * **Distance Measure**: `COSINE` distance (measures the angle difference between document embeddings).
3. **Graph Relationship Rules**:
   * **Semantic Edges**: Dynamically calculated on the client/backend by measuring the cosine similarity between two document embeddings. Edges are established if the similarity is $\ge 0.75$ (equivalent to a distance $\le 0.25$).
   * **Taxonomic Edges**: Calculated by finding overlapping elements in the `tags[]` array of documents.
   * **Relational Edges**: Built from the explicit document keys listed in the `relatedDocuments[]` schema array.


---

## 🧠 2. Inference Layer: Google Gemma 4 & Gemini
The application utilizes a **Hybrid Inference Model** to validate inputs. It combines on-device open-weights models (for privacy and offline speed) with cloud foundation models (for high-fidelity regulatory checks).

### A. Google Gemma 4 (On-Device / Local)
*   **Primary Variants**:
    *   `gemma4:e2b` (Effective 2B parameters): Lightweight, fast response times. Powers the **Reviewer Assistant** and **Submission Intent Helper**.
    *   `gemma4:e4b` (Effective 4B parameters): Powers local-only pipeline agent testing (Classification, Research, Schema Mapper, Gap agents).
*   **Execution Method**: Runs locally via the **Ollama** server daemon. Electron communicates via standard HTTP requests to `127.0.0.1:11434` handled by the Main process to bypass browser sandbox limitations.
*   **Key Files**:
    *   [main.cjs](file:///Users/nicklynch/Desktop/whatisadirector/main.cjs) — Native Node fetch streaming handlers (`ollama:status`, `ollama:pull`, `ollama:chat`).
    *   [preload.js](file:///Users/nicklynch/Desktop/whatisadirector/preload.js) — Exposes safe ipcRenderer callbacks to React.
    *   [chat-assistant.tsx](file:///Users/nicklynch/Desktop/whatisadirector/src/components/chat-assistant.tsx) — Main assistant view & model puller UI.
    *   [reviewer-assistant.tsx](file:///Users/nicklynch/Desktop/whatisadirector/src/components/reviewer-assistant.tsx) — Step safety auditing and gap resolution interface.

### B. Google Gemini (Cloud / API)
*   **Primary Variant**: Gemini 2.5 Flash / Gemini 2.5 Pro.
*   **Role**: Used in the dual-evaluation pipeline. Runs in parallel with the local Gemma 4 model during ingestion processing.
*   **Comparison Interface**: Discrepancies between Gemma's local extraction and Gemini's cloud-validated extraction are highlighted in the UI (e.g. specific safety norms or equipment specs) to ensure the **best official information** is captured.

### C. Google LiteRT-LM (On-Device Web Native - Future)
*   *Role*: Successor to MediaPipe LLM Inference API. Supports running Gemma 4 web task models (e.g., `gemma-4-E2B.litertlm`) inside Chromium's WebGPU sandbox if Ollama is not installed.

---

## ⚡ 3. Execution Layer: Firebase Cloud Functions
Firebase Cloud Functions execute the highly sensitive server-side transaction that moves documents from staging to production.

*   **Role**: Executes the **Application Step** (State 6) as an atomic, all-or-nothing database transaction.
*   **Transaction Logic**:
    1. Writes the primary document draft to the target collection (`/sops`, `/mops`, or `/eops`).
    2. Applies all accepted impact changes to related documents.
    3. Creates a new immutable entry in each modified document's `/versions` subcollection, recording the final approver's credentials and package ID.
    4. Sets the package `status` to `"Applied"`.
*   **Security Boundary**: Enforces the permissions model (Contributor, Reviewer, Approver, Admin) by checking calling user roles before executing writes to production collections.

---

## ⚙️ Summary of Google Tools Architecture Map

| Tool | Process Location | Native / Cloud | Package Config Location |
| :--- | :--- | :--- | :--- |
| **Cloud Firestore** | Server (Google Cloud) | Cloud | `ideas_docs/firebase_setup.md` |
| **Gemma 4 E2B/E4B** | Local Machine (Ollama) | On-Device | `main.cjs` / `preload.js` |
| **Gemini API** | Server (Vertex AI) | Cloud | Firebase AI Logic Config |
| **Cloud Functions** | Server (Google Cloud) | Cloud | Ingestion Application Trigger |
| **LiteRT-LM** | Renderer (WebGPU/Wasm)| On-Device | `@mediapipe/tasks-genai` (future) |
