import {
  arrayUnion,
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  type DocumentData,
  type Unsubscribe,
} from "firebase/firestore"

import { db, auth } from "@/lib/firebase"

export type AppRoute =
  | "dashboard"
  | "ingestion"
  | "review-queue"
  | "publish-queue"
  | "operational-docs"
  | "audit-trail"
  | "sops"
  | "mops"
  | "eops"
  | "login"

export type PackageStatus =
  | "Processing"
  | "NeedsInput"
  | "StagedForReview"
  | "UnderReview"
  | "Approved"
  | "Applied"
  | "Rejected"
  | "Failed"

export type AgentStatus = "complete" | "running" | "waiting" | "blocked"

export type AgentLogEntry = {
  name: string
  status: AgentStatus
  detail: string
}

export type GapEntry = {
  field: string
  reason: string
  suggestion: string
  resolvedValue: string
  required: boolean
}

export type ImpactItem = {
  id: string
  document: string
  collection: "/sops" | "/mops" | "/eops"
  rationale: string
  currentValue: string
  proposedValue: string
  accepted: boolean
}

export type IngestionPackage = {
  id: string
  title: string
  submittedBy: string
  submittedAt: string
  status: PackageStatus
  primaryAction: string
  targetCollection: "/sops" | "/mops" | "/eops"
  autoFilledFields: number
  agentLog: AgentLogEntry[]
  gaps: GapEntry[]
  impacts: ImpactItem[]
  draftSections: { label: string; value: string; source: "user" | "auto" | "gap" }[]
  applicationLog: string[]
  rejectionReason?: string
  statusDetail?: string
  proposedGaps?: Record<string, string>
  proposedDraft?: Record<string, string>
}

export type OperationalDocument = {
  id: string
  title: string
  collection: "/sops" | "/mops" | "/eops"
  status: "Draft" | "Active" | "UnderReview"
  version: string
  owner: string
  updatedAt: string
  rawData?: Record<string, any>
}

export type PackageSubmission = {
  url: string
  description: string
  userIntent: string
  files: string[]
}

const packageCollection = collection(db, "ingestionPackages")

export function listenToIngestionPackages(
  onData: (packages: IngestionPackage[]) => void,
  onError: (message: string) => void
): Unsubscribe {
  return onSnapshot(
    query(packageCollection, orderBy("createdAt", "desc")),
    (snapshot) => onData(snapshot.docs.map((item) => mapIngestionPackage(item.id, item.data()))),
    (error) => onError(error.message)
  )
}

export function listenToOperationalDocuments(
  onData: (documents: OperationalDocument[]) => void,
  onError: (message: string) => void
): Unsubscribe {
  const collections = ["sops", "mops", "eops"] as const
  const current = new Map<string, OperationalDocument>()
  const unsubscribers = collections.map((collectionName) =>
    onSnapshot(
      collection(db, collectionName),
      (snapshot) => {
        for (const item of snapshot.docs) {
          current.set(
            `${collectionName}/${item.id}`,
            mapOperationalDocument(item.id, `/${collectionName}` as OperationalDocument["collection"], item.data())
          )
        }
        for (const change of snapshot.docChanges()) {
          if (change.type === "removed") {
            current.delete(`${collectionName}/${change.doc.id}`)
          }
        }
        onData(Array.from(current.values()))
      },
      (error) => onError(error.message)
    )
  )

  return () => unsubscribers.forEach((unsubscribe) => unsubscribe())
}

export async function createIngestionPackage(submission: PackageSubmission): Promise<string> {
  const docRef = doc(packageCollection)
  const title = submission.description || submission.userIntent || "Untitled ingestion package"
  const inputItems = [
    ...submission.files.map((fileName, index) => ({
      inputId: `file-${index + 1}`,
      inputType: "PlainText",
      fileName,
      rawText: `File selected in renderer: ${fileName}`,
      uploadedAt: new Date().toISOString(),
    })),
    ...(submission.url
      ? [
          {
            inputId: "url-1",
            inputType: "URL",
            url: submission.url,
            uploadedAt: new Date().toISOString(),
          },
        ]
      : []),
    ...(submission.userIntent
      ? [
          {
            inputId: "intent-1",
            inputType: "PlainText",
            rawText: submission.userIntent,
            uploadedAt: new Date().toISOString(),
          },
        ]
      : []),
  ]

  await setDoc(docRef, {
    packageId: docRef.id,
    title,
    status: "Processing",
    statusDetail: "Queued for Classification Agent",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    submittedBy: {
      userId: auth.currentUser?.uid || "local-user",
      name: auth.currentUser?.displayName || auth.currentUser?.email?.split("@")[0] || "Nick Lynch",
      email: auth.currentUser?.email || "nick@whatisadirector.local",
      role: "Admin",
    },
    input: {
      userIntent: submission.userIntent,
      items: inputItems.length ? inputItems : [
        {
          inputId: "description-1",
          inputType: "PlainText",
          rawText: title,
          uploadedAt: new Date().toISOString(),
        },
      ],
    },
    primaryAction: {
      actionType: "Create",
      targetCollection: "sops",
      proposedVersion: "v0.1.0",
      changeSummary: title,
      documentDraft: {
        title,
        userIntent: submission.userIntent,
      },
    },
    classification: {
      identifiedSubject: title,
      intent: "CreateNewDocumentation",
      primaryDocType: "SOP",
      confidence: 0,
      confidenceFlags: [],
    },
    subagentLog: [
      {
        agentId: "classification",
        agentType: "ClassificationAgent",
        status: "Running",
        startedAt: new Date().toISOString(),
        findingsSummary: "Reading submitted inputs and user intent",
      },
      {
        agentId: "research",
        agentType: "ResearchAgent",
        status: "Pending",
        findingsSummary: "Waiting for classification",
      },
      {
        agentId: "schema-mapper",
        agentType: "SchemaMapperAgent",
        status: "Pending",
        findingsSummary: "Waiting for source facts",
      },
      {
        agentId: "dependency",
        agentType: "DependencyAgent",
        status: "Pending",
        findingsSummary: "Waiting for mapped draft",
      },
      {
        agentId: "gap",
        agentType: "GapAgent",
        status: "Pending",
        findingsSummary: "Waiting for draft fields",
      },
    ],
    gapReport: [],
    impactedDocuments: [],
    approvalPackage: {
      reviewActions: [],
      finalDecision: "Pending",
    },
    applicationLog: [],
  })

  return docRef.id
}



export async function updateGapInFirestore(item: IngestionPackage, field: string, value: string) {
  await updateDoc(doc(db, "ingestionPackages", item.id), {
    gapReport: item.gaps.map((gap) => ({
      field: gap.field,
      docTarget: "primary",
      reason: gap.reason,
      suggestion: gap.suggestion,
      resolvedValue: gap.field === field ? value : gap.resolvedValue,
      resolvedBy: gap.field === field && value ? (auth.currentUser?.uid || "local-user") : undefined,
      resolvedAt: gap.field === field && value ? new Date().toISOString() : undefined,
    })),
    updatedAt: serverTimestamp(),
  })
}

export async function stagePackageInFirestore(item: IngestionPackage) {
  await updateDoc(doc(db, "ingestionPackages", item.id), {
    status: "StagedForReview",
    statusDetail: "Ready for human review",
    updatedAt: serverTimestamp(),
    subagentLog: item.agentLog.map((entry) => ({
      agentId: slugify(entry.name),
      agentType: reverseAgentName(entry.name),
      status: entry.name === "Gap Agent" ? "Completed" : reverseAgentStatus(entry.status),
      findingsSummary: entry.name === "Gap Agent" ? "Required gaps resolved" : entry.detail,
    })),
  })
}

export async function updateImpactDecisionInFirestore(
  item: IngestionPackage,
  impactId: string,
  accepted: boolean
) {
  await updateDoc(doc(db, "ingestionPackages", item.id), {
    impactedDocuments: item.impacts.map((impact) => ({
      impactedDocId: impact.id,
      title: impact.document,
      collection: impact.collection.replace("/", ""),
      rationale: impact.rationale,
      reviewerDecision: impact.id === impactId ? (accepted ? "Accepted" : "Rejected") : impact.accepted ? "Accepted" : "Rejected",
      proposedChanges: [
        {
          fieldPath: "summary",
          currentValue: impact.currentValue,
          proposedValue: impact.proposedValue,
        },
      ],
    })),
    updatedAt: serverTimestamp(),
  })
}

export async function approvePackageInFirestore(item: IngestionPackage) {
  await updateDoc(doc(db, "ingestionPackages", item.id), {
    status: "Approved",
    statusDetail: "Approved; awaiting server-side Application Step",
    updatedAt: serverTimestamp(),
    approvalPackage: {
      finalDecision: "Approved",
      finalDecisionAt: new Date().toISOString(),
      finalDecisionBy: {
        userId: auth.currentUser?.uid || "local-user",
        name: auth.currentUser?.displayName || auth.currentUser?.email?.split("@")[0] || "Nick Lynch",
        role: "Admin",
      },
      reviewActions: [
        {
          action: "Approved",
          timestamp: new Date().toISOString(),
          reviewerUserId: auth.currentUser?.uid || "local-user",
          reviewerName: auth.currentUser?.displayName || auth.currentUser?.email?.split("@")[0] || "Nick Lynch",
          comments: "Approved from Electron review queue",
        },
      ],
    },
    applicationLog: arrayUnion("Approval recorded; Application Step can now run server-side"),
  })
}

export async function requestApplicationStepInFirestore(item: IngestionPackage) {
  await updateDoc(doc(db, "ingestionPackages", item.id), {
    statusDetail: "Application Step requested from renderer; waiting for server-side worker",
    updatedAt: serverTimestamp(),
    applicationRequestedAt: serverTimestamp(),
    applicationLog: arrayUnion("Application Step requested; renderer did not write operational collections"),
  })
}

export async function rejectPackageInFirestore(item: IngestionPackage) {
  await updateDoc(doc(db, "ingestionPackages", item.id), {
    status: "Rejected",
    statusDetail: "Rejected from review queue",
    updatedAt: serverTimestamp(),
    approvalPackage: {
      finalDecision: "Rejected",
      finalDecisionAt: new Date().toISOString(),
      finalDecisionBy: {
        userId: auth.currentUser?.uid || "local-user",
        name: auth.currentUser?.displayName || auth.currentUser?.email?.split("@")[0] || "Nick Lynch",
        role: "Admin",
      },
      reviewActions: [
        {
          action: "Rejected",
          timestamp: new Date().toISOString(),
          reviewerUserId: auth.currentUser?.uid || "local-user",
          reviewerName: auth.currentUser?.displayName || auth.currentUser?.email?.split("@")[0] || "Nick Lynch",
          comments: "Rejected from Electron review queue",
        },
      ],
    },
    applicationLog: arrayUnion("Rejected by reviewer"),
  })
}

function mapIngestionPackage(id: string, data: DocumentData): IngestionPackage {
  const targetCollection = normalizeCollection(data.primaryAction?.targetCollection ?? data.targetCollection)
  const draft = data.primaryAction?.documentDraft ?? {}

  return {
    id: data.packageId ?? id,
    title:
      data.title ??
      draft.title ??
      data.classification?.identifiedSubject ??
      data.input?.userIntent ??
      id,
    submittedBy: data.submittedBy?.name ?? data.submittedBy ?? "Unknown",
    submittedAt: formatDate(data.createdAt ?? data.submittedAt),
    status: normalizeStatus(data.status),
    primaryAction:
      data.primaryAction && typeof data.primaryAction === "object"
        ? `${data.primaryAction.actionType ?? "Create"} ${docTypeFromCollection(targetCollection)}`
        : data.primaryAction ?? "Classify and stage document",
    targetCollection,
    autoFilledFields:
      data.autoFilledFields ??
      data.autoFilledFieldCount ??
      countDraftFields(draft),
    agentLog: mapAgentLog(data.subagentLog ?? data.agentLog ?? []),
    gaps: mapGaps(data.gapReport ?? data.gaps ?? []),
    impacts: mapImpacts(data.impactedDocuments ?? data.impacts ?? []),
    draftSections: mapDraftSections(draft, data.draftSections ?? [], data.input?.userIntent),
    applicationLog: mapApplicationLog(data.applicationLog ?? []),
    rejectionReason: data.rejectionReason ?? data.statusDetail,
    statusDetail: data.statusDetail,
    proposedGaps: data.proposedGaps ?? {},
    proposedDraft: data.proposedDraft ?? {},
  }
}

function mapOperationalDocument(
  id: string,
  collectionName: OperationalDocument["collection"],
  data: DocumentData
): OperationalDocument {
  return {
    id,
    title: data.title ?? data.documentTitle ?? data.name ?? id,
    collection: collectionName,
    status: normalizeDocumentStatus(data.status),
    version: data.version ?? data.currentVersion ?? data.proposedVersion ?? "v0.1.0",
    owner: data.owner?.name ?? data.owner ?? data.department ?? "Unassigned",
    updatedAt: formatDate(data.updatedAt ?? data.createdAt),
    rawData: data,
  }
}

function mapAgentLog(log: DocumentData[]): AgentLogEntry[] {
  if (!log.length) return []
  return log.map((entry) => ({
    name: agentName(entry.agentType ?? entry.name),
    status: normalizeAgentStatus(entry.status),
    detail: entry.findingsSummary ?? entry.detail ?? entry.errorMessage ?? "No detail available",
  }))
}

function mapGaps(gaps: DocumentData[]): GapEntry[] {
  return gaps.map((gap) => ({
    field: gap.field ?? "unknownField",
    reason: gap.reason ?? "RequiresInput",
    suggestion: gap.suggestion ?? "",
    resolvedValue: gap.resolvedValue ?? "",
    required: gap.required ?? true,
  }))
}

function mapImpacts(impacts: DocumentData[]): ImpactItem[] {
  return impacts.map((impact, index) => {
    const change = impact.proposedChanges?.[0] ?? {}
    return {
      id: impact.impactedDocId ?? impact.id ?? `impact-${index + 1}`,
      document: impact.title ?? impact.document ?? impact.impactedDocId ?? `Impacted document ${index + 1}`,
      collection: normalizeCollection(impact.collection),
      rationale: impact.rationale ?? "",
      currentValue: String(change.currentValue ?? impact.currentValue ?? ""),
      proposedValue: String(change.proposedValue ?? impact.proposedValue ?? ""),
      accepted: (impact.reviewerDecision ?? "Accepted") !== "Rejected",
    }
  })
}

function formatLabel(label: string): string {
  if (label === 'docId') return 'Document ID';
  if (label === 'docType') return 'Document Type';
  if (label === 'dateCreated') return 'Date Created';
  if (label === 'dateModified') return 'Date Modified';
  const result = label.replace(/([A-Z])/g, " $1");
  return result.charAt(0).toUpperCase() + result.slice(1);
}

function mapDraftSections(
  draft: DocumentData,
  existing: DocumentData[],
  userIntent?: string
): IngestionPackage["draftSections"] {
  if (existing.length) return existing as IngestionPackage["draftSections"]
  const entries = Object.entries(draft ?? {}).filter(([key]) => key !== "id")
  if (!entries.length && userIntent) {
    return [{ label: "User Intent", value: userIntent, source: "user" }]
  }
  return entries.slice(0, 20).map(([label, value]) => {
    let formattedValue = '';
    if (label === 'owner' && value && typeof value === 'object' && 'name' in value) {
      formattedValue = String(value.name);
    } else if (label === 'tags' && Array.isArray(value)) {
      formattedValue = value.join(', ');
    } else if (label === 'safetyRequirements' && Array.isArray(value)) {
      formattedValue = value.map((req: any, index: number) => {
        const typeStr = req.type ? `[${req.type}] ` : '';
        const stdStr = req.standard ? ` (Standard: ${req.standard})` : '';
        const mandatoryStr = req.mandatory ? ' [Mandatory]' : '';
        return `${index + 1}. ${typeStr}${req.description || ''}${stdStr}${mandatoryStr}`;
      }).join('\n');
    } else if (label === 'steps' && Array.isArray(value)) {
      formattedValue = value.map((step: any) => {
        const num = step.stepNumber || '';
        const name = step.name || 'Step';
        const instr = step.instructions || '';
        const critical = step.criticalStep ? ' [Critical Step]' : '';
        const hold = step.holdPoint ? ` [Hold Point - Approver: ${step.holdPointApprover || 'SME'}]` : '';
        return `Step ${num}: ${name}${critical}${hold}\nInstructions: ${instr}`;
      }).join('\n\n');
    } else if (Array.isArray(value)) {
      formattedValue = value.map(v => typeof v === 'object' ? JSON.stringify(v) : String(v)).join('\n');
    } else if (value && typeof value === 'object') {
      formattedValue = Object.entries(value)
        .map(([k, v]) => `${formatLabel(k)}: ${typeof v === 'object' ? JSON.stringify(v) : v}`)
        .join('\n');
    } else {
      formattedValue = String(value);
    }

    return {
      label: formatLabel(label),
      value: formattedValue,
      source: label.toLowerCase().includes("gap") ? "gap" : "auto",
    };
  })
}

function mapApplicationLog(log: unknown[]): string[] {
  return log.map((entry) => {
    if (typeof entry === "string") return entry
    return JSON.stringify(entry)
  })
}

function normalizeStatus(status: string): PackageStatus {
  const allowed: PackageStatus[] = [
    "Processing",
    "NeedsInput",
    "StagedForReview",
    "UnderReview",
    "Approved",
    "Applied",
    "Rejected",
    "Failed",
  ]
  return allowed.includes(status as PackageStatus) ? (status as PackageStatus) : "Processing"
}

function normalizeAgentStatus(status: string): AgentStatus {
  if (status === "Completed" || status === "complete") return "complete"
  if (status === "Running" || status === "running") return "running"
  if (status === "Failed" || status === "blocked") return "blocked"
  return "waiting"
}

function reverseAgentStatus(status: AgentStatus) {
  if (status === "complete") return "Completed"
  if (status === "running") return "Running"
  if (status === "blocked") return "Failed"
  return "Pending"
}

function agentName(agentType: string) {
  if (agentType === "ClassificationAgent") return "Classification Agent"
  if (agentType === "ResearchAgent") return "Research Agent"
  if (agentType === "SchemaMapperAgent") return "Schema Mapper"
  if (agentType === "DependencyAgent") return "Dependency Agent"
  if (agentType === "GapAgent") return "Gap Agent"
  if (agentType === "GapResolutionAgent") return "Gap Resolution Agent"
  if (agentType === "DraftOptimizerAgent") return "Draft Optimizer"
  return agentType || "Agent"
}

function reverseAgentName(name: string) {
  if (name === "Classification Agent") return "ClassificationAgent"
  if (name === "Research Agent") return "ResearchAgent"
  if (name === "Schema Mapper") return "SchemaMapperAgent"
  if (name === "Dependency Agent") return "DependencyAgent"
  if (name === "Gap Agent") return "GapAgent"
  if (name === "Gap Resolution Agent") return "GapResolutionAgent"
  if (name === "Draft Optimizer") return "DraftOptimizerAgent"
  return "ClassificationAgent"
}

function normalizeCollection(value: string): "/sops" | "/mops" | "/eops" {
  const normalized = String(value ?? "sops").replace("/", "")
  if (normalized === "mops") return "/mops"
  if (normalized === "eops") return "/eops"
  return "/sops"
}

function normalizeDocumentStatus(status: string): OperationalDocument["status"] {
  if (status === "Active" || status === "UnderReview" || status === "Draft") return status
  return "Draft"
}

function docTypeFromCollection(collectionName: "/sops" | "/mops" | "/eops") {
  if (collectionName === "/mops") return "MOP"
  if (collectionName === "/eops") return "EOP"
  return "SOP"
}

function countDraftFields(value: unknown): number {
  if (!value || typeof value !== "object") return 0
  return Object.keys(value).length
}

function formatDate(value: unknown): string {
  if (value instanceof Timestamp) return value.toDate().toLocaleDateString()
  if (typeof value === "string") {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString()
  }
  if (value instanceof Date) return value.toLocaleDateString()
  return "Not recorded"
}

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")
}

export async function updateDraftSectionsInFirestore(
  packageId: string,
  draftSections: IngestionPackage["draftSections"]
) {
  await updateDoc(doc(db, "ingestionPackages", packageId), {
    draftSections,
    updatedAt: serverTimestamp(),
  })
}

export async function updatePackageGapsInFirestore(packageId: string, gaps: GapEntry[]) {
  await updateDoc(doc(db, "ingestionPackages", packageId), {
    gapReport: gaps.map((gap) => ({
      field: gap.field,
      docTarget: "primary",
      reason: gap.reason,
      suggestion: gap.suggestion,
      resolvedValue: gap.resolvedValue || "",
      required: gap.required ?? true,
    })),
    updatedAt: serverTimestamp(),
  })
}

export async function updateProposedSuggestionsInFirestore(
  packageId: string,
  proposedGaps: Record<string, string>,
  proposedDraft: Record<string, string>
) {
  await updateDoc(doc(db, "ingestionPackages", packageId), {
    proposedGaps,
    proposedDraft,
    updatedAt: serverTimestamp(),
  })
}

export async function publishPackageInFirestore(item: IngestionPackage) {
  const collectionName = item.targetCollection.replace("/", "") // "sops", "mops", "eops"

  // Start with default fields
  const docData: Record<string, any> = {
    status: "Active",
    version: "v1.0.0",
    updatedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    owner: "Operations",
    title: item.title,
  }

  let docId = item.id // fallback

  item.draftSections.forEach((section) => {
    const key = reverseFormatLabel(section.label)
    if (key === "docId" || key === "id") {
      docId = section.value.trim()
    } else if (key === "status") {
      docData[key] = "Active"
    } else {
      docData[key] = section.value
    }
  })

  // Write the document
  await setDoc(doc(db, collectionName, docId), docData)

  // Update package status to Applied
  await updateDoc(doc(db, "ingestionPackages", item.id), {
    status: "Applied",
    statusDetail: `Published successfully as "${docId}" in ${item.targetCollection}`,
    updatedAt: serverTimestamp(),
    applicationLog: arrayUnion(`Document published to database collection ${collectionName} with ID: ${docId}`),
  })
}

function reverseFormatLabel(label: string): string {
  if (label === 'Document ID') return 'docId';
  if (label === 'Document Type') return 'docType';
  if (label === 'Date Created') return 'dateCreated';
  if (label === 'Date Modified') return 'dateModified';
  if (label === 'Safety Requirements') return 'safetyRequirements';
  
  const result = label.replace(/\s+/g, '');
  return result.charAt(0).toLowerCase() + result.slice(1);
}
