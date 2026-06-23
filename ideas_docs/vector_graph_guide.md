# Vector Graph Knowledge Base & Semantic Search Integration Guide

This guide details the design, algorithms, API endpoints, and database configurations for the **Vector Graph Knowledge Base** and **Semantic Search** system in the application backend.

---

## 🛠️ System Overview

The Vector Graph overlay maps the relationships between document nodes (SOPs, MOPs, EOPs, and Ingestion Packages) to enable real-time semantic discovery. It builds relations along three dimensions:

1.  **Semantic Relations**: Calculated using cosine similarity of high-dimensional document embeddings.
2.  **Taxonomic Relations**: Established by finding overlapping keywords in document tag arrays.
3.  **Relational Links**: Formed by explicit cross-references defined in the schema (e.g., `relatedDocuments[]`).

```
                ┌───────────────────────────────────────┐
                │          Document Nodes               │
                │     (SOPs, MOPs, EOPs, Packages)      │
                └──────┬────────────┬────────────┬──────┘
                       │            │            │
                       ▼            ▼            ▼
             ┌───────────┐    ┌───────────┐    ┌───────────┐
             │ Semantic  │    │ Taxonomic │    │Relational │
             │   Edge    │    │   Edge    │    │   Edge    │
             │           │    │           │    │           │
             │  Cosine   │    │  Shared   │    │ Explicit  │
             │Similarity │    │   Tags    │    │References │
             └───────────┘    └───────────┘    └───────────┘
```

---

## 🧠 Embedding Generation (Google Vertex AI)

Embeddings are generated using Google Vertex AI's **`text-embedding-004`** model, which outputs a **768-dimensional floating-point vector** representing the semantic meaning of the text.

*   **API Target**:
    `https://{region}-aiplatform.googleapis.com/v1/projects/{project-id}/locations/{region}/publishers/google/models/text-embedding-004:predict`
*   **Authentication**: Authorized via a Google Cloud IAM access token passed in the `Authorization: Bearer` header.
*   **Developer Fallback**: If no `VERTEX_API_KEY` is present in the environment, the backend falls back to a deterministic, category-aware 768-dimension mock vector generator. This enables offline developer testing and validation without GCP credentials.

---

## 📐 Mathematical Foundations

### Cosine Similarity
To measure how semantically similar two documents are, the backend computes the **Cosine Similarity** between their 768-dimensional embedding vectors ($\vec{A}$ and $\vec{B}$):

$$\text{Similarity}(\vec{A}, \vec{B}) = \cos(\theta) = \frac{\vec{A} \cdot \vec{B}}{\|\vec{A}\| \|\vec{B}\|} = \frac{\sum_{i=1}^{n} A_i B_i}{\sqrt{\sum_{i=1}^{n} A_i^2} \sqrt{\sum_{i=1}^{n} B_i^2}}$$

*   **Range**: Results fall between `-1.0` (opposite directions) and `1.0` (identical direction). Since text embeddings generally cluster in a positive orthant, values range from `0.0` to `1.0`.
*   **Similarity Threshold**: The system considers two documents semantically connected if their similarity is **$\ge 0.75$** (equivalent to a distance of $\le 0.25$).

---

## 🔌 IPC Bridge API Reference

The Electron Renderer process interacts with the vector graph and embeddings engine via the context bridge `window.vertex`.

### 1. Generate Embedding
Generates a 768-dimension vector for a given text string.
```typescript
window.vertex.generateEmbedding(text: string): Promise<number[]>;
```

### 2. Calculate Similarity
Computes the Cosine Similarity score between two 768-dimension vectors.
```typescript
window.vertex.getSimilarity(vecA: number[], vecB: number[]): Promise<number>;
```

### 3. Build Vector Graph
Compiles a set of documents into a unified node-edge JSON graph.
```typescript
window.vertex.getVectorGraph(documents: Document[]): Promise<GraphData>;
```

#### Inputs (`Document[]`):
```json
[
  {
    "id": "SOP-1001",
    "title": "Dell PowerEdge R750 Server Initialization SOP",
    "type": "SOP",
    "tags": ["Dell", "Server", "Setup"],
    "relatedDocuments": ["MOP-2001"],
    "embedding": [0.012, -0.045, ..., 0.089]
  }
]
```

#### Outputs (`GraphData`):
```json
{
  "nodes": [
    { "id": "SOP-1001", "title": "Dell PowerEdge R750 Server Initialization SOP", "type": "SOP", "tags": ["Dell", "Server", "Setup"] }
  ],
  "edges": [
    { "id": "semantic-SOP-1001-MOP-2001", "source": "SOP-1001", "target": "MOP-2001", "type": "semantic", "value": 0.96, "label": "Similarity: 0.96" },
    { "id": "taxonomic-SOP-1001-MOP-2001", "source": "SOP-1001", "target": "MOP-2001", "type": "taxonomic", "value": 2, "label": "Tags: Dell, Server" },
    { "id": "relational-SOP-1001-MOP-2001", "source": "SOP-1001", "target": "MOP-2001", "type": "relational", "label": "References" }
  ]
}
```

---

## 🗄️ Firestore Index Configuration

To execute real-time semantic queries directly on Google Cloud Firestore, you must provision a single-field vector index:

1.  Navigate to the **Firebase Console** -> **Firestore Database** -> **Indexes** -> **Single Field**.
2.  Click **Add Exemption**.
3.  Enter the Collection ID (e.g., `sops`, `mops`, `eops`).
4.  Enter the Field Path: `vector_embedding`.
5.  Under Index Options, enable **Vector Indexing**.
6.  Configure the settings:
    *   **Dimension**: `768` (must match Google Vertex `text-embedding-004` output).
    *   **Distance Measure**: `COSINE`.
    *   **Query Model**: k-nearest neighbors (kNN) using standard server-side Firestore query `findNearest`.

---

## 🧪 Verification & Local Testing

You can run the built-in testing script in the scratch directory to verify vector shapes, cosine math, and edge mapping rules:

```bash
node .gemini/antigravity/brain/{conversation-id}/scratch/test_vertex_embeddings.js
```
