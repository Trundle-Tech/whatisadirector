import { db } from "@/lib/firebase"
import {
  doc,
  getDoc,
  updateDoc,
  serverTimestamp,
  collection,
  getDocs,
} from "firebase/firestore"

// Deep sanitization helper to replace undefined with null for Firestore safety
function sanitizeFirestoreData(data: any): any {
  if (data === undefined) return null
  if (data === null) return null
  if (Array.isArray(data)) {
    return data.map(item => sanitizeFirestoreData(item))
  }
  if (typeof data === "object") {
    const clean: any = {}
    for (const key of Object.keys(data)) {
      const val = data[key]
      if (val !== undefined) {
        clean[key] = sanitizeFirestoreData(val)
      }
    }
    return clean
  }
  return data
}

// Helper function to call Gemini and parse JSON response
async function callGeminiJSON<T>(systemPrompt: string, userPrompt: string): Promise<T> {
  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ]

  // Pass responseMimeType to enforce JSON output structure from Gemini
  const response = await (window.vertex as any).chat(messages, { responseMimeType: "application/json" })

  // Clean markdown json formatting if present
  let cleanText = response.trim()
  if (cleanText.startsWith("```json")) {
    cleanText = cleanText.substring(7)
  } else if (cleanText.startsWith("```")) {
    cleanText = cleanText.substring(3)
  }
  if (cleanText.endsWith("```")) {
    cleanText = cleanText.substring(0, cleanText.length - 3)
  }

  const trimmed = cleanText.trim()
  try {
    return JSON.parse(trimmed) as T
  } catch (err: any) {
    // Robust extraction fallback: try to find the first '{' and the last '}'
    const jsonMatch = trimmed.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[0]) as T
      } catch (innerErr: any) {
        console.error("Failed to parse extracted JSON block:", jsonMatch[0], innerErr)
      }
    }
    console.error("Failed to parse Gemini JSON response:", response, err)
    throw new Error(`Gemini did not return valid JSON: ${err.message}`)
  }
}

export async function runIngestionPipeline(packageId: string): Promise<void> {
  const docRef = doc(db, "ingestionPackages", packageId)
  const docSnap = await getDoc(docRef)
  if (!docSnap.exists()) {
    console.error(`Ingestion package not found for ID: ${packageId}`)
    return
  }

  const packageData = docSnap.data()
  const userIntent = packageData.input?.userIntent || ""
  const title = packageData.title || ""
  const url = packageData.input?.items?.[0]?.url || ""
  const files = (packageData.input?.items || [])
    .filter((item: any) => item.fileName)
    .map((item: any) => item.fileName)

  // Helper to update agent status
  const updateAgentStatus = async (
    agentId: string,
    status: "Running" | "Completed" | "Failed",
    findings: string,
    errorMessage?: string
  ) => {
    const freshSnap = await getDoc(docRef)
    if (!freshSnap.exists()) return
    const currentLog = freshSnap.data().subagentLog || []
    const nextLog = currentLog.map((agent: any) => {
      if (agent.agentId === agentId) {
        return {
          ...agent,
          status,
          findingsSummary: findings,
          completedAt: status === "Completed" || status === "Failed" ? new Date().toISOString() : null,
          errorMessage: errorMessage || null,
        }
      }
      return agent
    })
    await updateDoc(docRef, {
      subagentLog: sanitizeFirestoreData(nextLog),
      updatedAt: serverTimestamp(),
    })
  }

  try {
    // ----------------------------------------------------
    // 1. Classification Agent
    // ----------------------------------------------------
    await updateAgentStatus(
      "classification",
      "Running",
      "Analyzing inputs and classifying intent..."
    )

    const classSystemPrompt = `You are the Classification Agent for an omnimodal document ingestion pipeline.
Your job is to identify what was submitted, categorize it, determine the user's intent, and identify the primary document type (SOP, MOP, or EOP) to create or update.
You must output a valid JSON object matching this structure:
{
  "identifiedSubject": "Specific identification of what was submitted",
  "subjectCategory": "ITEquipment" | "IndustrialEquipment" | "Chemical" | "Facility" | "Person" | "Process" | "Policy" | "Product" | "Hazard" | "Vehicle" | "Other",
  "intent": "CreateNewDocumentation" | "UpdateExistingDocumentation" | "RetireAsset" | "LinkToExisting" | "ReviewOnly",
  "primaryDocType": "SOP" | "MOP" | "EOP",
  "impliedDocTypes": ["other doc types affected"],
  "confidence": 0.0 to 1.0,
  "confidenceFlags": ["flags or reasons for low confidence"]
}
Output ONLY this JSON. Do not write any other conversational text.`

    const classUserPrompt = `Submission details:
Intent: ${userIntent}
Description: ${title}
URL: ${url}
Files: ${files.join(", ")}`

    const classificationResult = await callGeminiJSON<any>(classSystemPrompt, classUserPrompt)

    await updateDoc(docRef, {
      classification: sanitizeFirestoreData({
        identifiedSubject: classificationResult.identifiedSubject ?? title ?? "Unknown",
        subjectCategory: classificationResult.subjectCategory ?? "Other",
        intent: classificationResult.intent ?? "CreateNewDocumentation",
        primaryDocType: classificationResult.primaryDocType ?? "SOP",
        impliedDocTypes: classificationResult.impliedDocTypes || [],
        confidence: classificationResult.confidence ?? 1.0,
        confidenceFlags: classificationResult.confidenceFlags || [],
        classifiedAt: new Date().toISOString(),
        classifiedByAgent: "GeminiClassificationAgent",
      }),
    })

    await updateAgentStatus(
      "classification",
      "Completed",
      `Identified subject: "${classificationResult.identifiedSubject}" (${classificationResult.subjectCategory})`
    )

    // Check confidence threshold
    if (classificationResult.confidence < 0.75) {
      await updateDoc(docRef, {
        status: "NeedsInput",
        statusDetail: "Classification confidence too low. Awaiting user input.",
        updatedAt: serverTimestamp(),
      })
      return
    }

    // ----------------------------------------------------
    // 2. Parallel Orchestration Layer (Research, Schema Mapper, Dependency, Gap)
    // ----------------------------------------------------
    await Promise.all([
      updateAgentStatus("research", "Running", "Researching specifications, standards, and hazards..."),
      updateAgentStatus("schema-mapper", "Running", "Structuring information into target schema draft..."),
      updateAgentStatus("dependency", "Running", "Scanning existing operational files for references and conflicts..."),
      updateAgentStatus("gap", "Running", "Waiting for draft to audit..."),
    ])

    // Research Agent Call
    const runResearch = async () => {
      const researchSystem = `You are the Research Agent. Your job is to gather and structure specifications, standards, and hazards about the identified subject.
You must output a valid JSON object matching this structure:
{
  "manufacturer": "Manufacturer name",
  "model": "Model identifier",
  "specifications": [
    { "key": "e.g., Power consumption", "value": "e.g., 750W", "source": "OEM Specs" }
  ],
  "knownHazards": ["hazard 1", "hazard 2"],
  "applicableStandards": ["e.g. OSHA 1910.147", "e.g. UL 60950"],
  "oemDocumentationUrls": ["documentation URL"],
  "additionalContext": "Any other context gathered"
}
Output ONLY this JSON. Do not write any other conversational text.`

      const researchUser = `Identified Subject: ${classificationResult.identifiedSubject}
Subject Category: ${classificationResult.subjectCategory}
Primary Doc Type: ${classificationResult.primaryDocType}
Original Intent: ${userIntent}`

      const res = await callGeminiJSON<any>(researchSystem, researchUser)
      await updateAgentStatus("research", "Completed", `Specifications gathered for model: ${res.model || "generic"}`)
      return res
    }

    // Schema Mapper Agent Call (dependent on research data)
    const runSchemaMapper = async (researchFindings: any) => {
      const mapperSystem = `You are the Schema Mapper Agent. Your job is to generate a complete document draft matching the schema rules for ${classificationResult.primaryDocType}.
The schema requires:
- docId: generate a clean slug or leave blank
- docType: "${classificationResult.primaryDocType}"
- name: The official title
- description: Summary
- status: "Draft"
- version: "1.0.0"
- owner: { "name": "Operations" }
- creator: { "name": "System Agent" }
- dateCreated: ISO timestamp
- dateModified: ISO timestamp
- tags: tags array
- sopCategory / maintenanceType / eopType (depending on docType)
- safetyRequirements: array of { description, type ("PPE"|"LOTO"|"Permit"|"Isolation"|"Other"), standard, mandatory }
- tools/equipment: array of items
- steps: array of { stepNumber, name, instructions, criticalStep (boolean), holdPoint (boolean), holdPointApprover }
- verificationMethod: "VisualInspection" | "Measurement" | "Test" | "SignOff" | "None"

Output a valid JSON representing the document draft. Do not include any other text.`

      const mapperUser = `Primary Doc Type: ${classificationResult.primaryDocType}
User Intent: ${userIntent}
Description: ${title}
Research Findings: ${JSON.stringify(researchFindings)}`

      const res = await callGeminiJSON<any>(mapperSystem, mapperUser)
      await updateAgentStatus("schema-mapper", "Completed", `Generated draft titled: "${res.name}"`)
      return res
    }

    // Dependency Agent Call
    const runDependency = async (draft: any) => {
      // Fetch existing documents from Firestore
      const existingDocs: any[] = []
      const collections = ["sops", "mops", "eops"]
      for (const col of collections) {
        const snap = await getDocs(collection(db, col))
        snap.forEach((d) => {
          existingDocs.push({
            id: d.id,
            collection: `/${col}`,
            title: d.data().title || d.data().name || d.id,
          })
        })
      }

      const depSystem = `You are the Dependency Agent. Your job is to identify which existing operational documents will be impacted by the ingestion of the new subject.
You are given a list of existing documents and the new ingestion package's subject and draft.
Determine if any existing document needs to be updated (e.g. to reference the new document, update contact info, add the new equipment, etc.).
Output a valid JSON object matching this structure:
{
  "impactedDocuments": [
    {
      "existingDocId": "ID of existing doc",
      "existingDocName": "Title of existing doc",
      "collection": "sops" | "mops" | "eops",
      "changeType": "AddReference" | "UpdateContactInfo" | "AddEquipment" | "UpdateEquipment" | "AddStep" | "UpdateStep" | "UpdateSafetyRequirement" | "AddToResourceInventory" | "AddRelatedDocument",
      "rationale": "Reason why this document is affected",
      "proposedChanges": [
        {
          "fieldPath": "field to change, e.g. relatedDocuments",
          "currentValue": "current value",
          "proposedValue": "proposed new value"
        }
      ]
    }
  ]
}
Output ONLY this JSON. If no documents are impacted, return { "impactedDocuments": [] }.`

      const depUser = `New Subject: ${classificationResult.identifiedSubject}
New Doc Type: ${classificationResult.primaryDocType}
New Draft Title: ${draft?.name || title}
Existing Documents in system:
${JSON.stringify(existingDocs)}`

      const res = await callGeminiJSON<any>(depSystem, depUser)
      const list = res.impactedDocuments || []
      await updateAgentStatus("dependency", "Completed", `Found ${list.length} impacted operational documents`)
      return list
    }

    // Gap Agent Call (dependent on draft)
    const runGap = async (draft: any) => {
      await updateAgentStatus("gap", "Running", "Auditing draft fields against schema constraints...")
      const gapSystem = `You are the Gap Agent. Your job is to audit the generated document draft against schema rules and identify any missing required fields or low-confidence information.
A gap is a field that is empty, null, or requires human input (like SME validation, on-site verification, etc.).
Output a valid JSON object matching this structure:
{
  "gapReport": [
    {
      "field": "field path, e.g., safetyRequirements[0].standard or owner.contactEmail",
      "docTarget": "primary",
      "reason": "NotFoundInResearch" | "RequiresOnSiteVerification" | "RequiresSMEInput" | "AmbiguousFromInput" | "MultipleOptionsFound" | "PermitRequirementUnknown",
      "suggestion": "Specific suggestion or question to ask the reviewer to resolve this gap."
    }
  ]
}
Output ONLY this JSON. If no gaps exist, return { "gapReport": [] }.`

      const gapUser = `Primary Doc Type: ${classificationResult.primaryDocType}
Draft Document: ${JSON.stringify(draft)}`

      const res = await callGeminiJSON<any>(gapSystem, gapUser)
      const list = res.gapReport || []
      await updateAgentStatus("gap", "Completed", `Audited draft. Found ${list.length} fields requiring reviewer attention`)
      return list
    }

    // Execute Research first, then Mapper -> Gap & Dependency
    const researchFindings = await runResearch()
    
    // We execute Schema Mapper to produce the draft
    const draft = await runSchemaMapper(researchFindings)

    // Run Gap Agent and Dependency Agent in parallel using the generated draft
    const [gaps, impacts] = await Promise.all([
      runGap(draft),
      runDependency(draft),
    ])

    // ----------------------------------------------------
    // 3. Package Assembly & Staging Validation
    // ----------------------------------------------------
    // Determine package status based on gaps
    const requiredGaps = gaps.filter((gap: any) => gap.required !== false)
    const nextStatus = requiredGaps.length > 0 ? "NeedsInput" : "StagedForReview"
    const nextStatusDetail =
      requiredGaps.length > 0
        ? `Awaiting reviewer resolution on ${requiredGaps.length} required fields.`
        : "Staged for review. All schema fields completed."

    // Count autofilled fields
    const autoFilledFields = Object.keys(draft).filter((k) => draft[k] !== null && draft[k] !== "").length

    // Write back entire assembled package data
    await updateDoc(docRef, {
      status: nextStatus,
      statusDetail: nextStatusDetail,
      autoFilledFieldCount: autoFilledFields,
      primaryAction: sanitizeFirestoreData({
        actionType: "Create",
        targetCollection: classificationResult.primaryDocType === "MOP" ? "mops" : classificationResult.primaryDocType === "EOP" ? "eops" : "sops",
        proposedVersion: "v1.0.0",
        changeSummary: `Create ${classificationResult.primaryDocType}: "${draft.name || title}"`,
        documentDraft: draft,
      }),
      gapReport: sanitizeFirestoreData(gaps.map((gap: any) => ({
        field: gap.field || "",
        docTarget: gap.docTarget || "primary",
        reason: gap.reason || "NotFoundInResearch",
        suggestion: gap.suggestion || "",
        resolvedValue: "",
        required: gap.required !== false,
      }))),
      impactedDocuments: sanitizeFirestoreData(impacts.map((impact: any, idx: number) => ({
        impactId: `impact-${idx + 1}`,
        existingDocId: impact.existingDocId,
        title: impact.existingDocName || impact.existingDocId,
        collection: impact.collection,
        changeType: impact.changeType,
        rationale: impact.rationale,
        proposedChanges: impact.proposedChanges || [],
        reviewerDecision: "Accepted",
      }))),
      updatedAt: serverTimestamp(),
    })

    console.log(`Ingestion pipeline completed for ${packageId}. Status: ${nextStatus}`)
  } catch (error: any) {
    console.error(`Ingestion pipeline failed for ${packageId}:`, error)
    // Mark remaining pending/running agents as Failed
    const freshSnap = await getDoc(docRef)
    if (freshSnap.exists()) {
      const currentLog = freshSnap.data().subagentLog || []
      const nextLog = currentLog.map((agent: any) => {
        if (agent.status === "Running" || agent.status === "Pending") {
          return {
            ...agent,
            status: "Failed",
            errorMessage: error.message || "Failed during pipeline run",
            completedAt: new Date().toISOString(),
          }
        }
        return agent
      })
      await updateDoc(docRef, {
        status: "Failed",
        statusDetail: `Ingestion pipeline execution failed: ${error.message}`,
        subagentLog: sanitizeFirestoreData(nextLog),
        updatedAt: serverTimestamp(),
      })
    }
  }
}

export async function runResolutionPipeline(packageId: string): Promise<void> {
  const docRef = doc(db, "ingestionPackages", packageId)
  const docSnap = await getDoc(docRef)
  if (!docSnap.exists()) {
    console.error(`Ingestion package not found for ID: ${packageId}`)
    return
  }

  const packageData = docSnap.data()
  const currentLog = packageData.subagentLog || []

  // Set status to Processing so UI shows loading state and timeline
  await updateDoc(docRef, {
    status: "Processing",
    statusDetail: "AI subagents are resolving gaps and optimizing the draft...",
    updatedAt: serverTimestamp(),
  })

  // Append new agents to log
  let updatedLog = [
    ...currentLog.map((agent: any) => ({
      ...agent,
      status: agent.status === "Running" ? "Completed" : agent.status,
    })),
  ]

  // Add GapResolutionAgent if not already present in the list, or update it
  if (!updatedLog.some((agent: any) => agent.agentId === "gap-resolution")) {
    updatedLog.push({
      agentId: "gap-resolution",
      agentType: "GapResolutionAgent",
      status: "Running",
      startedAt: new Date().toISOString(),
      findingsSummary: "Analyzing source documents and user intent to resolve open gaps...",
    })
  } else {
    updatedLog = updatedLog.map((agent: any) =>
      agent.agentId === "gap-resolution"
        ? {
            ...agent,
            status: "Running",
            findingsSummary: "Analyzing source documents and user intent to resolve open gaps...",
            completedAt: null,
            errorMessage: null,
          }
        : agent
    )
  }

  // Add DraftOptimizerAgent if not present, or reset it
  if (!updatedLog.some((agent: any) => agent.agentId === "draft-optimization")) {
    updatedLog.push({
      agentId: "draft-optimization",
      agentType: "DraftOptimizerAgent",
      status: "Pending",
      findingsSummary: "Waiting for gap resolution...",
    })
  } else {
    updatedLog = updatedLog.map((agent: any) =>
      agent.agentId === "draft-optimization"
        ? {
            ...agent,
            status: "Pending",
            findingsSummary: "Waiting for gap resolution...",
            completedAt: null,
            errorMessage: null,
          }
        : agent
    )
  }

  await updateDoc(docRef, {
    subagentLog: sanitizeFirestoreData(updatedLog),
  })

  // Helper to update our resolution agents
  const updateResolutionAgentStatus = async (
    agentId: string,
    status: "Running" | "Completed" | "Failed",
    findings: string,
    errorMessage?: string
  ) => {
    const freshSnap = await getDoc(docRef)
    if (!freshSnap.exists()) return
    const log = freshSnap.data().subagentLog || []
    const nextLog = log.map((agent: any) => {
      if (agent.agentId === agentId) {
        return {
          ...agent,
          status,
          findingsSummary: findings,
          completedAt: status === "Completed" || status === "Failed" ? new Date().toISOString() : null,
          errorMessage: errorMessage || null,
        }
      }
      return agent
    })
    await updateDoc(docRef, {
      subagentLog: sanitizeFirestoreData(nextLog),
      updatedAt: serverTimestamp(),
    })
  }

  try {
    const documentType = packageData.targetCollection === "/sops" ? "SOP" : packageData.targetCollection === "/mops" ? "MOP" : "EOP"
    const draftSections = packageData.draftSections || []
    const gaps = packageData.gapReport || packageData.gaps || []
    const userIntent = packageData.input?.userIntent || ""
    const title = packageData.title || ""
    const files = (packageData.input?.items || [])
      .filter((item: any) => item.fileName)
      .map((item: any) => item.fileName)

    const draftText = JSON.stringify(draftSections.map((s: any) => ({ label: s.label, value: s.value })), null, 2)
    const gapsText = JSON.stringify(gaps.map((g: any) => ({ field: g.field, reason: g.reason, suggestion: g.suggestion })), null, 2)

    // ----------------------------------------------------
    // 1. Gap Resolution Agent
    // ----------------------------------------------------
    const gapSystemPrompt = `You are the Gap Resolution Agent. Your job is to resolve the open gaps for this document package using the provided draft and context/files.
For each gap, suggest the best value based on the context.
Output a valid JSON object matching this structure:
{
  "gaps": {
    "gapFieldPath": "Suggested resolved value"
  }
}
Do not return any markdown code fences or conversational text, just the raw JSON object.`

    const gapUserPrompt = `Document: "${title}" (${documentType})
User Intent: ${userIntent}
Files available: ${files.join(", ")}
Draft sections:
${draftText}

Open gaps:
${gapsText}`

    const gapResult = await callGeminiJSON<any>(gapSystemPrompt, gapUserPrompt)
    const proposedGaps = gapResult.gaps || {}

    await updateResolutionAgentStatus(
      "gap-resolution",
      "Completed",
      `Resolved ${Object.keys(proposedGaps).length} gaps from available source information.`
    )

    // Update draft optimization agent to Running
    const freshLog = (await getDoc(docRef)).data()?.subagentLog || []
    await updateDoc(docRef, {
      subagentLog: sanitizeFirestoreData(
        freshLog.map((agent: any) =>
          agent.agentId === "draft-optimization"
            ? { ...agent, status: "Running", findingsSummary: "Optimizing draft fields based on resolved gaps..." }
            : agent
        )
      ),
    })

    // ----------------------------------------------------
    // 2. Draft Optimizer Agent
    // ----------------------------------------------------
    const draftSystemPrompt = `You are the Draft Optimization Agent. Your job is to optimize and fill in the draft sections using the resolved gaps and original context.
Suggest improved values for the draft sections.
Output a valid JSON object matching this structure:
{
  "draft": {
    "sectionLabel": "Improved/completed section value"
  }
}
Do not return any markdown code fences or conversational text, just the raw JSON object.`

    const draftUserPrompt = `Document: "${title}" (${documentType})
Draft sections:
${draftText}

Proposed gap resolutions:
${JSON.stringify(proposedGaps, null, 2)}`

    const draftResult = await callGeminiJSON<any>(draftSystemPrompt, draftUserPrompt)
    const proposedDraft = draftResult.draft || {}

    await updateResolutionAgentStatus(
      "draft-optimization",
      "Completed",
      `Optimized ${Object.keys(proposedDraft).length} draft sections.`
    )

    // Save proposed suggestions to Firestore document!
    await updateDoc(docRef, {
      status: "NeedsInput",
      statusDetail: "AI Auto-Fill analysis completed. Check proposed values.",
      proposedGaps,
      proposedDraft,
      updatedAt: serverTimestamp(),
    })

  } catch (error: any) {
    console.error(`Resolution pipeline failed:`, error)
    // Mark pending/running resolution agents as Failed
    const freshSnap = await getDoc(docRef)
    if (freshSnap.exists()) {
      const currentLog = freshSnap.data().subagentLog || []
      const nextLog = currentLog.map((agent: any) => {
        if (agent.agentId === "gap-resolution" || agent.agentId === "draft-optimization") {
          if (agent.status === "Running" || agent.status === "Pending") {
            return {
              ...agent,
              status: "Failed",
              errorMessage: error.message || "Failed during pipeline run",
              completedAt: new Date().toISOString(),
            }
          }
        }
        return agent
      })
      await updateDoc(docRef, {
        status: "NeedsInput",
        statusDetail: `AI Auto-Fill subagent pipeline failed: ${error.message}`,
        subagentLog: sanitizeFirestoreData(nextLog),
        updatedAt: serverTimestamp(),
      })
    }
  }
}
