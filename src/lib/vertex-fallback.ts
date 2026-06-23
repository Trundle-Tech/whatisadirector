// Global client-side fallback for window.vertex when running in web browser environments outside Electron

interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

function generateMockChatResponse(messages: Message[]): string {
  const systemMsg = messages.find(m => m.role === 'system')?.content || '';
  const lowerSystem = systemMsg.toLowerCase();

  // 1. Classification Agent Fallback
  if (lowerSystem.includes('classification agent')) {
    return JSON.stringify({
      identifiedSubject: "Dell PowerEdge R750 Server",
      subjectCategory: "ITEquipment",
      intent: "CreateNewDocumentation",
      primaryDocType: "MOP",
      impliedDocTypes: ["SOP"],
      confidence: 0.95,
      confidenceFlags: []
    });
  }

  // 2. Research Agent Fallback
  if (lowerSystem.includes('research agent')) {
    return JSON.stringify({
      manufacturer: "Dell",
      model: "PowerEdge R750",
      specifications: [
        { key: "CPU", value: "Intel Xeon Scalable 3rd Gen", source: "OEM Specs" },
        { key: "Memory", value: "Up to 8TB DDR4 RDIMM", source: "OEM Specs" },
        { key: "Power", value: "Dual redundant hot-plug power supplies (up to 2400W)", source: "OEM Specs" }
      ],
      knownHazards: ["Electrical hazard during maintenance", "Heavy lift hazard (36 kg max weight)"],
      applicableStandards: ["OSHA 29 CFR 1910.147 (LOTO)", "UL 60950"],
      oemDocumentationUrls: ["https://www.dell.com/support"],
      additionalContext: "Enterprise rack-mount server requiring standard energy isolation prior to component servicing."
    });
  }

  // 3. Schema Mapper Agent Fallback
  if (lowerSystem.includes('schema mapper agent')) {
    return JSON.stringify({
      docId: "dell-r750-setup-mop",
      docType: "MOP",
      name: "Dell PowerEdge R750 Rack Server Setup and Maintenance",
      description: "Standard maintenance procedure for unboxing, rack mounting, cabling, and initial configuration of the Dell PowerEdge R750 server.",
      status: "Draft",
      version: "1.0.0",
      owner: { name: "IT Infrastructure Team" },
      creator: { name: "Gemini Schema Mapper" },
      dateCreated: new Date().toISOString(),
      dateModified: new Date().toISOString(),
      tags: ["dell", "r750", "rack-mount", "loto", "server-setup"],
      maintenanceType: "Preventative",
      safetyRequirements: [
        { description: "Ensure electro-static discharge (ESD) wristband is worn.", type: "PPE", standard: "ESD-S20.20", mandatory: true },
        { description: "Verify dual power cords are disconnected before opening chassis.", type: "LOTO", standard: "OSHA 1910.147", mandatory: true }
      ],
      equipment: [
        { name: "Dell PowerEdge R750 Server", assetId: "" }
      ],
      steps: [
        { stepNumber: "1", name: "Pre-Install Safety Check", instructions: "Wear ESD wristband. Verify work area is dry and clear of obstacles.", criticalStep: true, holdPoint: false },
        { stepNumber: "2", name: "Rack Mount Installation", instructions: "Extend sliding rails. Slide chassis into rack until secure. Verify latch locking.", criticalStep: false, holdPoint: false },
        { stepNumber: "3", name: "Power Isolation Verification", instructions: "Insert server components. Do not plug in power cords until cabling is checked.", criticalStep: true, holdPoint: true, holdPointApprover: "Infrastructure Lead" }
      ],
      verificationMethod: "SystemCheck"
    });
  }

  // 4. Dependency Agent Fallback
  if (lowerSystem.includes('dependency agent')) {
    return JSON.stringify({
      impactedDocuments: [
        {
          existingDocId: "rack-standards-sop",
          existingDocName: "IT Rack Installation Standards SOP",
          collection: "sops",
          changeType: "AddReference",
          rationale: "Must link to the new R750 specifications for maximum rack weight allowance.",
          proposedChanges: [
            {
              fieldPath: "relatedDocuments",
              currentValue: "References to R740 and older generations.",
              proposedValue: "Append references to Dell PowerEdge R750 Server specifications."
            }
          ]
        }
      ]
    });
  }

  // 5. Gap Agent Fallback
  if (lowerSystem.includes('gap agent')) {
    return JSON.stringify({
      gapReport: [
        {
          field: "owner.contactEmail",
          docTarget: "primary",
          reason: "NotFoundInResearch",
          suggestion: "Who is the primary contact email for the IT Infrastructure Team?"
        },
        {
          field: "equipment[0].assetId",
          docTarget: "primary",
          reason: "RequiresOnSiteVerification",
          suggestion: "Please enter the physical asset barcode tag ID for this server."
        }
      ]
    });
  }

  const lastUserMessage = [...messages].reverse().find(m => m.role === 'user')?.content || '';
  const lowerMsg = lastUserMessage.toLowerCase();

  if (lowerMsg.includes('loto') || lowerMsg.includes('safety') || lowerMsg.includes('isolation') || lowerMsg.includes('missing precautions')) {
    return `**Safety & LOTO Audit Findings (Gemini Cloud Simulation)**:
* **Recommendation 1**: A lock-out/tag-out (LOTO) step is missing from Step 2. Isolation of the main circuit breaker must be explicitly documented.
* **Recommendation 2**: Ensure electro-static discharge (ESD) wristbands are worn during component replacement to protect sensitive logic cards.
* **Recommendation 3**: Verify energy discharge before starting work.`;
  }

  if (lowerMsg.includes('gap') || lowerMsg.includes('fields') || lowerMsg.includes('suggest entry')) {
    return `**Document Gap Analysis (Gemini Cloud Simulation)**:
* **Field: \`documentOwner\`**: Recommending \`Facilities Operations\` or \`IT Infrastructure SME\`.
* **Field: \`regulatoryReferences\`**: Recommend cross-referencing \`OSHA 1910.147 (LOTO)\` due to the power isolation requirements in the description.`;
  }

  if (lowerMsg.includes('hi') || lowerMsg.includes('hello')) {
    return `Hello! I am your cloud-based Vertex AI review assistant. Ask me to audit this staged document for safety precautions, gaps, or spelling corrections.`;
  }

  return `**Vertex AI Assistant Response (Gemini Cloud Simulation)**:
I've reviewed the staged document draft. To optimize this document:
1. Ensure the step sequence lists isolation procedures clearly.
2. Confirm the verification test in the final step is measurable.
Let me know if you would like to run any other audit checks!`;
}

function cosineSimilarity(vecA: number[], vecB: number[]): number {
  if (!vecA || !vecB || vecA.length !== vecB.length) return 0;
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

// Deterministic 768-dim mock vector matching the Electron main-process logic.
// Used as a graceful fallback when /api/vertex is unavailable.
function mockEmbedding(text: string): number[] {
  let category = 0;
  const lowerText = text.toLowerCase();
  if (lowerText.includes('dell') || lowerText.includes('server')) {
    category = 1;
  } else if (lowerText.includes('fire') || lowerText.includes('evacuation') || lowerText.includes('emergency')) {
    category = 2;
  }

  return Array.from({ length: 768 }, (_, i) => {
    let val = 0;
    if (category === 1) {
      val = Math.sin(i * 0.02) * 0.1;
    } else if (category === 2) {
      val = Math.cos(i * 0.02) * 0.1;
    } else {
      val = Math.sin(i * 0.05) * 0.1;
    }

    let hash = 0;
    for (let charIdx = 0; charIdx < text.length; charIdx++) {
      hash = (hash << 5) - hash + text.charCodeAt(charIdx);
      hash |= 0;
    }
    const noise = Math.sin(i + hash) * 0.015;
    return val + noise;
  });
}

// Calls the server-side Netlify function which holds VERTEX_API_KEY.
async function callVertexFunction(action: 'embed' | 'chat', body: Record<string, unknown>) {
  const response = await fetch('/api/vertex', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...body }),
  });
  if (!response.ok) {
    throw new Error(`/api/vertex ${action} returned ${response.status}`);
  }
  const data = await response.json();
  return data.result;
}

if (typeof window !== 'undefined' && !(window as any).vertex) {
  console.log('[Vertex Web] Initializing browser bridge for window.vertex (real API via /api/vertex, mock fallback)');
  (window as any).vertex = {
    generateEmbedding: async (text: string) => {
      try {
        return await callVertexFunction('embed', { text });
      } catch (err) {
        console.warn('[Vertex Web] embed via /api/vertex failed, using mock:', err);
        return mockEmbedding(text);
      }
    },
    getSimilarity: async (vecA: number[], vecB: number[]) => {
      return cosineSimilarity(vecA, vecB);
    },
    getVectorGraph: async (documents: any[]) => {
      const nodes: any[] = [];
      const edges: any[] = [];
      const similarityThreshold = 0.75;

      for (const doc of documents) {
        nodes.push({
          id: doc.id,
          title: doc.title,
          type: doc.type,
          tags: doc.tags || [],
        });
      }

      for (let i = 0; i < documents.length; i++) {
        const docA = documents[i];
        for (let j = i + 1; j < documents.length; j++) {
          const docB = documents[j];

          if (docA.embedding && docB.embedding) {
            const similarity = cosineSimilarity(docA.embedding, docB.embedding);
            if (similarity >= similarityThreshold) {
              edges.push({
                id: `semantic-${docA.id}-${docB.id}`,
                source: docA.id,
                target: docB.id,
                type: 'semantic',
                value: similarity,
                label: `Similarity: ${similarity.toFixed(2)}`
              });
            }
          }

          const tagsA = docA.tags || [];
          const tagsB = docB.tags || [];
          const overlap = tagsA.filter((t: any) => tagsB.includes(t));
          if (overlap.length > 0) {
            edges.push({
              id: `taxonomic-${docA.id}-${docB.id}`,
              source: docA.id,
              target: docB.id,
              type: 'taxonomic',
              value: overlap.length,
              label: `Tags: ${overlap.join(', ')}`
            });
          }
        }

        const refs = docA.relatedDocuments || [];
        for (const ref of refs) {
          const targetExists = documents.some(d => d.id === ref);
          if (targetExists) {
            edges.push({
              id: `relational-${docA.id}-${ref}`,
              source: docA.id,
              target: ref,
              type: 'relational',
              label: 'References'
            });
          }
        }
      }

      return { nodes, edges };
    },
    chat: async (messages: Message[], options: Record<string, unknown> = {}) => {
      try {
        return await callVertexFunction('chat', { messages, options });
      } catch (err) {
        console.warn('[Vertex Web] chat via /api/vertex failed, using mock:', err);
        return generateMockChatResponse(messages);
      }
    }
  };
}
