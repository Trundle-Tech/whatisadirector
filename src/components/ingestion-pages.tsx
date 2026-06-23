import * as React from "react"
import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  CircleIcon,
  FileInputIcon,
  FileTextIcon,
  LoaderCircleIcon,
  SendIcon,
  ShieldCheckIcon,
  XCircleIcon,
  X,
  Pencil,
  Trash2,
  Plus,
  Sparkles,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs"

import {
  approvePackageInFirestore,
  createIngestionPackage,
  listenToIngestionPackages,
  listenToOperationalDocuments,
  rejectPackageInFirestore,
  requestApplicationStepInFirestore,
  stagePackageInFirestore,
  updateImpactDecisionInFirestore,
  updateDraftSectionsInFirestore,
  updatePackageGapsInFirestore,
  publishPackageInFirestore,
  updateProposedSuggestionsInFirestore,
  type AgentLogEntry,
  type AgentStatus,
  type AppRoute,
  type GapEntry,
  type IngestionPackage,
  type OperationalDocument,
  type PackageSubmission,
  type PackageStatus,
} from "@/lib/firestore-store"

import { runIngestionPipeline, runResolutionPipeline } from "@/lib/agent-pipeline"
import { toast } from "sonner"

export type { AppRoute } from "@/lib/firestore-store"

const isMultiLineField = (label: string): boolean => {
  const lowercase = label.toLowerCase()
  return (
    lowercase.includes("steps") ||
    lowercase.includes("safety") ||
    lowercase.includes("description") ||
    lowercase.includes("details") ||
    lowercase.includes("requirements") ||
    lowercase.includes("prerequisites")
  )
}

const downloadDocument = (doc: OperationalDocument, format: "markdown" | "json") => {
  let content = ""
  let mimeType = ""
  let filename = ""

  if (format === "json") {
    content = JSON.stringify(doc.rawData || doc, null, 2)
    mimeType = "application/json"
    filename = `${doc.id}.json`
  } else {
    // Markdown
    content = `# ${doc.title}\n\n`
    content += `**Document ID:** ${doc.id}\n`
    content += `**Library:** ${doc.collection.replace("/", "").toUpperCase()}\n`
    content += `**Version:** ${doc.version}\n`
    content += `**Status:** ${doc.status}\n`
    content += `**Owner:** ${doc.owner}\n`
    content += `**Last Updated:** ${doc.updatedAt}\n\n`
    content += `---\n\n`

    if (doc.rawData) {
      Object.entries(doc.rawData).forEach(([key, val]) => {
        const skip = ["title", "id", "collection", "status", "version", "owner", "updatedAt", "createdAt", "docId", "docType"]
        if (skip.includes(key)) return
        
        const label = formatLabel(key)
        content += `## ${label}\n\n${val}\n\n`
      })
    }
    mimeType = "text/markdown"
    filename = `${doc.id}.md`
  }

  const blob = new Blob([content], { type: `${mimeType};charset=utf-8;` })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.setAttribute("download", filename)
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
}

const emptyPackage: IngestionPackage = {
  id: "no-package",
  title: "No ingestion package selected",
  submittedBy: "None",
  submittedAt: "Not recorded",
  status: "Processing",
  primaryAction: "No action",
  targetCollection: "/sops",
  autoFilledFields: 0,
  agentLog: [],
  gaps: [],
  impacts: [],
  draftSections: [],
  applicationLog: [],
}

export function IngestionPages({ route }: { route: AppRoute }) {
  const [packages, setPackages] = React.useState<IngestionPackage[]>([])
  const [operationalDocuments, setOperationalDocuments] = React.useState<OperationalDocument[]>([])
  const [selectedId, setSelectedId] = React.useState("")
  const [isDatabaseLoading, setIsDatabaseLoading] = React.useState(true)
  const [databaseError, setDatabaseError] = React.useState("")
  const [submission, setSubmission] = React.useState<PackageSubmission>({
    url: "",
    description: "",
    userIntent: "",
    files: [],
  })

  const [aiLoading, setAiLoading] = React.useState(false)
  const [aiProposedGaps, setAiProposedGaps] = React.useState<Record<string, string>>({})
  const [aiProposedDraft, setAiProposedDraft] = React.useState<Record<string, string>>({})
  const [viewingDoc, setViewingDoc] = React.useState<OperationalDocument | null>(null)

  React.useEffect(() => {
    const pkg = packages.find((item) => item.id === selectedId) || packages[0]
    if (pkg && pkg.id !== "no-package") {
      setAiProposedGaps(pkg.proposedGaps || {})
      setAiProposedDraft(pkg.proposedDraft || {})
    } else {
      setAiProposedGaps({})
      setAiProposedDraft({})
    }
  }, [packages, selectedId])

  React.useEffect(() => {
    let unsubscribePackages: (() => void) | undefined
    let unsubscribeDocuments: (() => void) | undefined
    let isMounted = true

    unsubscribePackages = listenToIngestionPackages(
      (nextPackages) => {
        if (!isMounted) return
        setPackages(nextPackages)
        setIsDatabaseLoading(false)
        setDatabaseError("")
      },
      (message) => {
        if (!isMounted) return
        setDatabaseError(message)
        setIsDatabaseLoading(false)
      }
    )
    unsubscribeDocuments = listenToOperationalDocuments(
      (documents) => {
        if (!isMounted) return
        setOperationalDocuments(documents)
      },
      (message) => {
        if (!isMounted) return
        setDatabaseError(message)
      }
    )

    return () => {
      isMounted = false
      unsubscribePackages?.()
      unsubscribeDocuments?.()
    }
  }, [])

  React.useEffect(() => {
    if (packages.length > 0 && !packages.some((item) => item.id === selectedId)) {
      setSelectedId(packages[0].id)
    }
  }, [packages, selectedId])

  const selectedPackage = packages.find((item) => item.id === selectedId) ?? packages[0] ?? emptyPackage
  const reviewQueue = packages.filter((item) =>
    ["StagedForReview", "UnderReview"].includes(item.status)
  )
  const openGapCount = packages.reduce(
    (total, item) => total + (item.gaps || []).filter((gap) => gap.required && !gap.resolvedValue).length,
    0
  )
  const processingCount = packages.filter((item) => item.status === "Processing").length
  const appliedCount = packages.filter((item) => item.status === "Applied").length

  async function submitPackage(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    try {
      const packageId = await createIngestionPackage(submission)
      setSelectedId(packageId)
      setSubmission({ url: "", description: "", userIntent: "", files: [] })
      window.location.hash = "ingestion"
      // Asynchronously trigger the subagent pipeline run
      runIngestionPipeline(packageId)
    } catch (error) {
      setDatabaseError(error instanceof Error ? error.message : "Failed to create ingestion package")
    }
  }



  async function resolveGap(packageId: string, field: string, value: string) {
    const item = packages.find((current) => current.id === packageId)
    if (!item) return
    try {
      const updatedGaps = (item.gaps || []).map((gap) =>
        gap.field === field
          ? {
              ...gap,
              resolvedValue: value,
            }
          : gap
      )
      await updatePackageGapsInFirestore(packageId, updatedGaps)
    } catch (error) {
      setDatabaseError(error instanceof Error ? error.message : "Failed to resolve gap")
    }
  }

  async function updateGap(packageId: string, oldField: string, updatedGap: GapEntry) {
    const item = packages.find((current) => current.id === packageId)
    if (!item) return
    try {
      const updatedGaps = (item.gaps || []).map((gap) => (gap.field === oldField ? updatedGap : gap))
      await updatePackageGapsInFirestore(packageId, updatedGaps)
    } catch (error) {
      setDatabaseError(error instanceof Error ? error.message : "Failed to update gap")
    }
  }

  async function deleteGap(packageId: string, field: string) {
    const item = packages.find((current) => current.id === packageId)
    if (!item) return
    try {
      const updatedGaps = (item.gaps || []).filter((gap) => gap.field !== field)
      await updatePackageGapsInFirestore(packageId, updatedGaps)
    } catch (error) {
      setDatabaseError(error instanceof Error ? error.message : "Failed to delete gap")
    }
  }

  async function addGap(packageId: string) {
    const item = packages.find((current) => current.id === packageId)
    if (!item) return
    const newGap: GapEntry = {
      field: `customField_${Date.now()}`,
      reason: "User identified gap",
      suggestion: "Enter value details...",
      resolvedValue: "",
      required: true,
    }
    try {
      await updatePackageGapsInFirestore(packageId, [...(item.gaps || []), newGap])
    } catch (error) {
      setDatabaseError(error instanceof Error ? error.message : "Failed to add gap")
    }
  }

  async function updateDraftSections(packageId: string, sections: IngestionPackage["draftSections"]) {
    try {
      await updateDraftSectionsInFirestore(packageId, sections)
    } catch (error) {
      setDatabaseError(error instanceof Error ? error.message : "Failed to update draft sections")
    }
  }

  async function publishPackage(packageId: string) {
    const item = packages.find((current) => current.id === packageId)
    if (!item) return
    try {
      await publishPackageInFirestore(item)
    } catch (error) {
      setDatabaseError(error instanceof Error ? error.message : "Failed to publish package")
    }
  }

  async function stagePackage(packageId: string) {
    const item = packages.find((current) => current.id === packageId)
    if (!item) return
    try {
      await stagePackageInFirestore(item)
    } catch (error) {
      setDatabaseError(error instanceof Error ? error.message : "Failed to stage package")
    }
  }

  async function toggleImpact(packageId: string, impactId: string, accepted: boolean) {
    const item = packages.find((current) => current.id === packageId)
    if (!item) return
    try {
      await updateImpactDecisionInFirestore(item, impactId, accepted)
    } catch (error) {
      setDatabaseError(error instanceof Error ? error.message : "Failed to update impact decision")
    }
  }

  async function approvePackage(packageId: string) {
    const item = packages.find((current) => current.id === packageId)
    if (!item) return
    try {
      await approvePackageInFirestore(item)
    } catch (error) {
      setDatabaseError(error instanceof Error ? error.message : "Failed to approve package")
    }
  }

  async function applyPackage(packageId: string) {
    const item = packages.find((current) => current.id === packageId)
    if (!item) return
    try {
      await requestApplicationStepInFirestore(item)
    } catch (error) {
      setDatabaseError(error instanceof Error ? error.message : "Failed to request Application Step")
    }
  }

  async function rejectPackage(packageId: string) {
    const item = packages.find((current) => current.id === packageId)
    if (!item) return
    try {
      await rejectPackageInFirestore(item)
    } catch (error) {
      setDatabaseError(error instanceof Error ? error.message : "Failed to reject package")
    }
  }

  async function runAIAutoFill() {
    if (!selectedPackage || selectedPackage.id === "no-package") return
    setAiLoading(true)
    try {
      // Fire off background resolution pipeline subagents
      runResolutionPipeline(selectedPackage.id)
      toast.success("AI resolution subagents fired off successfully!")
    } catch (e: any) {
      console.error(e)
      toast.error(`Failed to trigger resolution subagents: ${e.message || e}`)
    } finally {
      setAiLoading(false)
    }
  }

  const pageProps = {
    aiLoading,
    aiProposedGaps,
    aiProposedDraft,
    runAIAutoFill,
    setAiProposedGaps,
    setAiProposedDraft,
    packages,
    selectedPackage,
    setSelectedId,
    reviewQueue,
    openGapCount,
    processingCount,
    appliedCount,
    submission,
    setSubmission,
    submitPackage,
    resolveGap,
    updateGap,
    deleteGap,
    addGap,
    updateDraftSections,
    publishPackage,
    stagePackage,
    toggleImpact,
    approvePackage,
    applyPackage,
    rejectPackage,
    operationalDocuments,
    isDatabaseLoading,
    databaseError,
  }

  const renderContent = () => {
    if (route === "ingestion") return <IngestionPage {...pageProps} />
    if (route === "review-queue") return <ReviewQueuePage {...pageProps} />
    if (route === "publish-queue") return <PublishQueuePage {...pageProps} />
    if (route === "operational-docs") return <OperationalDocsPage documents={operationalDocuments} />
    if (route === "audit-trail") return <AuditTrailPage packages={packages} />
    if (route === "sops") return <DocumentLibraryPage collection="/sops" documents={operationalDocuments} onSelectDoc={setViewingDoc} />
    if (route === "mops") return <DocumentLibraryPage collection="/mops" documents={operationalDocuments} onSelectDoc={setViewingDoc} />
    if (route === "eops") return <DocumentLibraryPage collection="/eops" documents={operationalDocuments} onSelectDoc={setViewingDoc} />
    return <DashboardPage {...pageProps} />
  }

  return (
    <>
      {renderContent()}
      {viewingDoc && (
        <DocumentViewerModal doc={viewingDoc} onClose={() => setViewingDoc(null)} />
      )}
    </>
  )
}

type PageProps = {
  aiLoading: boolean
  aiProposedGaps: Record<string, string>
  aiProposedDraft: Record<string, string>
  runAIAutoFill: () => Promise<void>
  setAiProposedGaps: React.Dispatch<React.SetStateAction<Record<string, string>>>
  setAiProposedDraft: React.Dispatch<React.SetStateAction<Record<string, string>>>
  packages: IngestionPackage[]
  selectedPackage: IngestionPackage
  setSelectedId: React.Dispatch<React.SetStateAction<string>>
  reviewQueue: IngestionPackage[]
  openGapCount: number
  processingCount: number
  appliedCount: number
  submission: { url: string; description: string; userIntent: string; files: string[] }
  setSubmission: React.Dispatch<
    React.SetStateAction<{ url: string; description: string; userIntent: string; files: string[] }>
  >
  submitPackage: (event: React.FormEvent<HTMLFormElement>) => void
  resolveGap: (packageId: string, field: string, value: string) => void
  updateGap: (packageId: string, oldField: string, updatedGap: GapEntry) => void
  deleteGap: (packageId: string, field: string) => void
  addGap: (packageId: string) => void
  updateDraftSections: (packageId: string, sections: IngestionPackage["draftSections"]) => void
  publishPackage: (packageId: string) => void
  stagePackage: (packageId: string) => void
  toggleImpact: (packageId: string, impactId: string, accepted: boolean) => void
  approvePackage: (packageId: string) => void
  applyPackage: (packageId: string) => void
  rejectPackage: (packageId: string) => void
  operationalDocuments: OperationalDocument[]
  isDatabaseLoading: boolean
  databaseError: string
}

function DashboardPage({
  packages,
  reviewQueue,
  openGapCount,
  processingCount,
  appliedCount,
  setSelectedId,
}: PageProps) {
  const totalAuto = packages.reduce((total, item) => total + item.autoFilledFields, 0)
  return (
    <PageGrid>
      <MetricCard label="Review Queue" value={reviewQueue.length} />
      <MetricCard label="Processing" value={processingCount} />
      <MetricCard label="Open Gaps" value={openGapCount} />
      <MetricCard label="Applied" value={appliedCount} />
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>Recent Ingestions</CardTitle>
          <CardDescription>Status of the latest ingestion packages in the pipeline.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {packages.slice(0, 5).map((item) => (
            <div
              key={item.id}
              className="flex items-center justify-between p-3 rounded-lg border hover:bg-muted/40 transition-colors cursor-pointer"
              onClick={() => {
                setSelectedId(item.id)
                if (["NeedsInput", "Processing"].includes(item.status)) {
                  window.location.hash = "ingestion"
                } else if (["StagedForReview", "UnderReview"].includes(item.status)) {
                  window.location.hash = "review-queue"
                } else if (item.status === "Approved") {
                  window.location.hash = "publish-queue"
                } else {
                  window.location.hash = "audit-trail"
                }
              }}
            >
              <div className="min-w-0 flex-1 pr-3">
                <div className="font-medium text-sm truncate">{item.title}</div>
                <div className="text-xs text-muted-foreground mt-0.5 flex gap-2">
                  <span>{item.id}</span>
                  <span>•</span>
                  <span>{item.submittedAt}</span>
                </div>
              </div>
              <div className="shrink-0 flex items-center gap-2">
                <span className="text-xs text-muted-foreground truncate hidden md:inline">
                  {item.primaryAction}
                </span>
                {statusBadge(item.status)}
              </div>
            </div>
          ))}
          {packages.length === 0 && (
            <EmptyState>No packages submitted yet.</EmptyState>
          )}
        </CardContent>
      </Card>
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>Ingestion Signals</CardTitle>
          <CardDescription>Current package signals that will become Firestore visualizations.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-3">
          <Signal label="Auto-filled fields" value={totalAuto} icon={<FileInputIcon />} />
          <Signal label="Impacted docs" value={packages.reduce((total, item) => total + item.impacts.length, 0)} icon={<FileTextIcon />} />
          <Signal label="Audit entries" value={packages.reduce((total, item) => total + item.applicationLog.length, 0)} icon={<ShieldCheckIcon />} />
        </CardContent>
      </Card>
    </PageGrid>
  )
}

function IngestionPage({
  selectedPackage,
  submission,
  setSubmission,
  submitPackage,
  resolveGap,
  updateGap,
  deleteGap,
  addGap,
  stagePackage,
  aiLoading,
  aiProposedGaps,
  runAIAutoFill,
}: PageProps) {
  const unresolved = (selectedPackage.gaps || []).filter((gap) => gap.required && !gap.resolvedValue)
  return (
    <div className="grid min-h-0 grid-cols-1 gap-4 xl:grid-cols-[420px_1fr]">
      <Card>
        <CardHeader>
          <CardTitle>Submit Package</CardTitle>
          <CardDescription>Create one ingestion package from files, links, notes, and intent.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-4" onSubmit={submitPackage}>
            <div className="grid gap-2">
              <Label htmlFor="package-intent">Intent</Label>
              <textarea
                id="package-intent"
                className="min-h-24 rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                placeholder="What do you want to do?"
                value={submission.userIntent}
                onChange={(event) =>
                  setSubmission((current) => ({ ...current, userIntent: event.target.value }))
                }
              />
            </div>
            <FieldInput
              id="package-description"
              label="Description"
              placeholder="Short package title"
              value={submission.description}
              onChange={(value) =>
                setSubmission((current) => ({ ...current, description: value }))
              }
            />
            <FieldInput
              id="package-url"
              label="Source URL"
              placeholder="https://..."
              value={submission.url}
              onChange={(value) => setSubmission((current) => ({ ...current, url: value }))}
            />
            <div className="grid gap-2">
              <Label htmlFor="package-files">Files</Label>
              <Input
                id="package-files"
                type="file"
                multiple
                onChange={(event) =>
                  setSubmission((current) => ({
                    ...current,
                    files: Array.from(event.target.files ?? []).map((file) => file.name),
                  }))
                }
              />
              {submission.files.length ? (
                <div className="text-xs text-muted-foreground">{submission.files.join(", ")}</div>
              ) : null}
            </div>
            <Button type="submit" disabled={!submission.userIntent && !submission.description}>
              <SendIcon />
              Submit Package
            </Button>
          </form>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Pipeline Progress</CardTitle>
          <CardDescription>{selectedPackage.title}</CardDescription>
          <CardAction>{statusBadge(selectedPackage.status)}</CardAction>
        </CardHeader>
        <CardContent className="space-y-4">
          <AgentTimeline agentLog={selectedPackage.agentLog} />

          {selectedPackage.status === "NeedsInput" ? (
            <div className="space-y-3 rounded-lg border p-4">
              <div className="flex items-center justify-between">
                <div className="font-medium text-sm">Gaps Requiring Resolution</div>
                <div className="flex items-center gap-2">
                  {(selectedPackage.gaps || []).length > 0 && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={runAIAutoFill}
                      disabled={aiLoading}
                      className="h-7 text-xs font-semibold gap-1.5 cursor-pointer bg-primary/5 hover:bg-primary/10 border-primary/20 hover:border-primary/30 text-primary transition-all"
                    >
                      {aiLoading ? (
                        <LoaderCircleIcon className="animate-spin size-3" />
                      ) : (
                        <Sparkles className="size-3 text-primary animate-pulse" />
                      )}
                      {aiLoading ? "AI Resolving..." : "AI Auto-Fill"}
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => addGap(selectedPackage.id)}
                    className="h-7 text-xs"
                  >
                    <Plus className="size-3 mr-1" /> Add Custom Gap
                  </Button>
                </div>
              </div>
              {(selectedPackage.gaps || []).map((gap) => (
                <GapEditor
                  key={gap.field}
                  gap={gap}
                  onResolve={(value) => resolveGap(selectedPackage.id, gap.field, value)}
                  onUpdate={(updated) => updateGap(selectedPackage.id, gap.field, updated)}
                  onDelete={() => deleteGap(selectedPackage.id, gap.field)}
                  aiSuggestion={aiProposedGaps[gap.field]}
                  onAcceptSuggestion={(value) => {
                    resolveGap(selectedPackage.id, gap.field, value)
                    const nextGaps = { ...(selectedPackage.proposedGaps || {}) }
                    delete nextGaps[gap.field]
                    updateProposedSuggestionsInFirestore(selectedPackage.id, nextGaps, selectedPackage.proposedDraft || {})
                  }}
                  onDiscardSuggestion={() => {
                    const nextGaps = { ...(selectedPackage.proposedGaps || {}) }
                    delete nextGaps[gap.field]
                    updateProposedSuggestionsInFirestore(selectedPackage.id, nextGaps, selectedPackage.proposedDraft || {})
                  }}
                />
              ))}
              <Button disabled={unresolved.length > 0} onClick={() => stagePackage(selectedPackage.id)}>
                Stage For Review
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  )
}

function ReviewQueuePage({
  packages,
  selectedPackage,
  setSelectedId,
  resolveGap,
  updateGap,
  deleteGap,
  addGap,
  updateDraftSections,
  toggleImpact,
  approvePackage,
  rejectPackage,
  aiLoading,
  aiProposedGaps,
  aiProposedDraft,
  runAIAutoFill,
}: PageProps) {
  const [isModalOpen, setIsModalOpen] = React.useState(false)
  const [localDraftSections, setLocalDraftSections] = React.useState<IngestionPackage["draftSections"]>([])
  const unresolved = (selectedPackage.gaps || []).filter((gap) => gap.required && !gap.resolvedValue)

  React.useEffect(() => {
    if (selectedPackage) {
      setLocalDraftSections(selectedPackage.draftSections || [])
    }
  }, [selectedPackage, isModalOpen])

  const handleSelect = (id: string) => {
    setSelectedId(id)
    setIsModalOpen(true)
  }

  const handleSaveDraft = async () => {
    await updateDraftSections(selectedPackage.id, localDraftSections)
  }

  return (
    <div className="min-h-0">
      <Card>
        <CardHeader>
          <CardTitle>Review Queue</CardTitle>
          <CardDescription>Staged packages awaiting human decision.</CardDescription>
        </CardHeader>
        <CardContent>
          <PackageTable
            packages={packages.filter((item) => ["StagedForReview", "UnderReview"].includes(item.status))}
            selectedId={isModalOpen ? selectedPackage.id : ""}
            onSelect={handleSelect}
          />
        </CardContent>
      </Card>

      {/* Modal Dialog */}
      {isModalOpen && selectedPackage && selectedPackage.id !== "no-package" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-md animate-in fade-in-0 duration-150">
          <div className="relative w-full max-w-7xl h-[90vh] max-h-[90vh] flex flex-col bg-card border rounded-xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-150">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b px-6 py-4 bg-muted/20 shrink-0">
              <div>
                <h2 className="text-lg font-semibold flex items-center gap-2">
                  <span>Package Review</span>
                  {statusBadge(selectedPackage.status)}
                </h2>
                <p className="text-xs text-muted-foreground mt-0.5">Package ID: {selectedPackage.id}</p>
              </div>
              <div className="flex items-center gap-3">
                {selectedPackage.status !== "Applied" && (
                  <Button
                    onClick={runAIAutoFill}
                    disabled={aiLoading}
                    variant="outline"
                    className="h-8 text-xs font-semibold gap-1.5 cursor-pointer bg-primary/5 hover:bg-primary/10 border-primary/20 hover:border-primary/30 text-primary transition-all"
                  >
                    {aiLoading ? (
                      <LoaderCircleIcon className="animate-spin size-3.5" />
                    ) : (
                      <Sparkles className="size-3.5 animate-pulse text-primary" />
                    )}
                    {aiLoading ? "AI Resolving..." : "AI Auto-Fill"}
                  </Button>
                )}
                <button
                  onClick={() => setIsModalOpen(false)}
                  className="rounded-lg p-1.5 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                >
                  <X className="size-5" />
                </button>
              </div>
            </div>

            {/* Modal Content */}
            <div className="flex-1 overflow-y-auto p-6 min-h-0 bg-background/50">
              <Tabs defaultValue="draft">
                <TabsList>
                  <TabsTrigger value="draft">Draft & Revisions</TabsTrigger>
                  <TabsTrigger value="gaps">Gaps</TabsTrigger>
                  <TabsTrigger value="impacts">Impacts</TabsTrigger>
                  <TabsTrigger value="summary">Summary</TabsTrigger>
                </TabsList>
                <TabsContent value="summary" className="mt-4 space-y-3">
                  <div className="font-medium">{selectedPackage.title}</div>
                  <div className="text-sm text-muted-foreground">
                    {selectedPackage.primaryAction} into {selectedPackage.targetCollection}
                  </div>
                  <Separator />
                  <AgentTimeline agentLog={selectedPackage.agentLog} />
                </TabsContent>
                <TabsContent value="draft" className="mt-4 space-y-4">
                  <div className="flex justify-between items-center bg-muted/10 p-3 rounded-lg border">
                    <div>
                      <span className="text-sm font-semibold block">Edit Document Draft</span>
                      <span className="text-xs text-muted-foreground">Modify final document values before approving.</span>
                    </div>
                    <Button
                      size="sm"
                      onClick={handleSaveDraft}
                      className="h-8 shadow-sm cursor-pointer"
                    >
                      Save Revisions
                    </Button>
                  </div>

                  {/* Metadata Grid (Single Line Fields) */}
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 bg-muted/10 p-4 rounded-xl border border-border/60">
                    {localDraftSections
                      .map((section, index) => ({ section, index }))
                      .filter(({ section }) => !isMultiLineField(section.label))
                      .map(({ section, index }) => (
                        <div key={section.label} className="space-y-1">
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">{section.label}</span>
                            <Badge variant="outline" className="text-[9px] uppercase scale-90">{section.source}</Badge>
                          </div>
                          <Input
                            className="h-9 text-sm font-mono"
                            value={section.value}
                            onChange={(e) => {
                              const newValue = e.target.value
                              setLocalDraftSections((prev) =>
                                prev.map((s, idx) => (idx === index ? { ...s, value: newValue } : s))
                              )
                            }}
                          />
                          {aiProposedDraft[section.label] && (
                            <div className="mt-1.5 p-2 bg-primary/5 border border-primary/20 rounded-md space-y-1.5">
                              <div className="text-[9px] font-bold text-primary flex items-center gap-1">
                                <Sparkles className="size-2.5 text-primary animate-pulse" />
                                AI Suggestion:
                              </div>
                              <div className="text-xs text-foreground font-mono bg-background p-1.5 rounded border border-border/40 whitespace-pre-wrap">
                                {aiProposedDraft[section.label]}
                              </div>
                              <div className="flex gap-1.5">
                                <Button
                                  size="sm"
                                  className="h-5 text-[9px] bg-primary text-primary-foreground font-semibold px-2 cursor-pointer"
                                  onClick={() => {
                                    setLocalDraftSections((prev) =>
                                      prev.map((s, idx) => (idx === index ? { ...s, value: aiProposedDraft[section.label] } : s))
                                    )
                                    const nextDraft = { ...(selectedPackage.proposedDraft || {}) }
                                    delete nextDraft[section.label]
                                    updateProposedSuggestionsInFirestore(selectedPackage.id, selectedPackage.proposedGaps || {}, nextDraft)
                                    toast.success(`Applied AI suggestion to ${section.label}`)
                                  }}
                                >
                                  Yes
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-5 text-[9px] text-muted-foreground font-semibold px-2 cursor-pointer"
                                  onClick={() => {
                                    const nextDraft = { ...(selectedPackage.proposedDraft || {}) }
                                    delete nextDraft[section.label]
                                    updateProposedSuggestionsInFirestore(selectedPackage.id, selectedPackage.proposedGaps || {}, nextDraft)
                                  }}
                                >
                                  No
                                </Button>
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                  </div>

                  {/* Multi-line Fields (Textareas) */}
                  <div className="space-y-4">
                    {localDraftSections
                      .map((section, index) => ({ section, index }))
                      .filter(({ section }) => isMultiLineField(section.label))
                      .map(({ section, index }) => (
                        <div key={section.label} className="rounded-xl border p-4 space-y-2 bg-card">
                          <div className="flex items-center justify-between">
                            <span className="font-semibold text-xs text-muted-foreground uppercase tracking-wider">{section.label}</span>
                            <Badge variant="outline" className="text-[10px] uppercase font-bold">{section.source}</Badge>
                          </div>
                          <textarea
                            className={`w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/50 resize-y ${
                              section.label.toLowerCase() === "steps" ? "min-h-[250px] font-mono" : "min-h-24"
                            }`}
                            value={section.value}
                            onChange={(e) => {
                              const newValue = e.target.value
                              setLocalDraftSections((prev) =>
                                prev.map((s, idx) => (idx === index ? { ...s, value: newValue } : s))
                              )
                            }}
                          />
                          {aiProposedDraft[section.label] && (
                            <div className="mt-2.5 p-3 bg-primary/5 border border-primary/20 rounded-lg space-y-2">
                              <div className="text-[10px] font-bold text-primary flex items-center gap-1.5 uppercase tracking-wider">
                                <Sparkles className="size-3 text-primary animate-pulse" />
                                AI Suggestion
                              </div>
                              <div className="text-xs text-foreground font-mono bg-background/50 p-2.5 rounded border border-border/60 max-h-32 overflow-y-auto whitespace-pre-wrap">
                                {aiProposedDraft[section.label]}
                              </div>
                              <div className="flex gap-2">
                                <Button
                                  size="sm"
                                  className="h-7 text-xs bg-primary text-primary-foreground font-semibold px-3 cursor-pointer flex items-center gap-1"
                                  onClick={() => {
                                    setLocalDraftSections((prev) =>
                                      prev.map((s) =>
                                        s.label === section.label
                                          ? { ...s, value: aiProposedDraft[section.label] }
                                          : s
                                      )
                                    )
                                    const nextDraft = { ...(selectedPackage.proposedDraft || {}) }
                                    delete nextDraft[section.label]
                                    updateProposedSuggestionsInFirestore(selectedPackage.id, selectedPackage.proposedGaps || {}, nextDraft)
                                    toast.success(`Updated ${section.label} with AI suggestion!`)
                                  }}
                                >
                                  Accept (Yes)
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 text-xs text-muted-foreground font-semibold px-3 cursor-pointer"
                                  onClick={() => {
                                    const nextDraft = { ...(selectedPackage.proposedDraft || {}) }
                                    delete nextDraft[section.label]
                                    updateProposedSuggestionsInFirestore(selectedPackage.id, selectedPackage.proposedGaps || {}, nextDraft)
                                  }}
                                >
                                  Discard (No)
                                </Button>
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                  </div>
                </TabsContent>
                <TabsContent value="impacts" className="mt-4 space-y-3">
                  {selectedPackage.impacts.length ? (
                    selectedPackage.impacts.map((impact) => (
                      <div key={impact.id} className="rounded-lg border p-3">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="font-medium">{impact.document}</div>
                            <div className="text-xs text-muted-foreground">{impact.collection}</div>
                          </div>
                          <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                            <Checkbox
                              checked={impact.accepted}
                              onCheckedChange={(value) =>
                                toggleImpact(selectedPackage.id, impact.id, Boolean(value))
                              }
                            />
                            Accept
                          </label>
                        </div>
                        <div className="mt-2 text-sm text-muted-foreground">{impact.rationale}</div>
                      </div>
                    ))
                  ) : (
                    <EmptyState>No impacted documents.</EmptyState>
                  )}
                </TabsContent>
                <TabsContent value="gaps" className="mt-4 space-y-3">
                  <div className="flex items-center justify-between bg-muted/10 p-3 rounded-lg border mb-2">
                    <div>
                      <span className="text-sm font-semibold block">Resolve & Edit Gaps</span>
                      <span className="text-xs text-muted-foreground">Answer all required gaps to approve this package.</span>
                    </div>
                    <Button size="sm" variant="outline" onClick={() => addGap(selectedPackage.id)} className="h-8 cursor-pointer">
                      <Plus className="size-3.5 mr-1.5" /> Add Custom Gap
                    </Button>
                  </div>
                  {(selectedPackage.gaps || []).length ? (
                    (selectedPackage.gaps || []).map((gap) => (
                      <GapEditor
                        key={gap.field}
                        gap={gap}
                        onResolve={(value) => resolveGap(selectedPackage.id, gap.field, value)}
                        onUpdate={(updated) => updateGap(selectedPackage.id, gap.field, updated)}
                        onDelete={() => deleteGap(selectedPackage.id, gap.field)}
                        aiSuggestion={aiProposedGaps[gap.field]}
                        onAcceptSuggestion={(value) => {
                          resolveGap(selectedPackage.id, gap.field, value)
                          const nextGaps = { ...(selectedPackage.proposedGaps || {}) }
                          delete nextGaps[gap.field]
                          updateProposedSuggestionsInFirestore(selectedPackage.id, nextGaps, selectedPackage.proposedDraft || {})
                        }}
                        onDiscardSuggestion={() => {
                          const nextGaps = { ...(selectedPackage.proposedGaps || {}) }
                          delete nextGaps[gap.field]
                          updateProposedSuggestionsInFirestore(selectedPackage.id, nextGaps, selectedPackage.proposedDraft || {})
                        }}
                      />
                    ))
                  ) : (
                    <EmptyState>No gaps are open.</EmptyState>
                  )}
                </TabsContent>
              </Tabs>
            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-end gap-2 border-t px-6 py-4 bg-muted/10 shrink-0">
              <Button variant="outline" onClick={() => setIsModalOpen(false)}>
                Close
              </Button>
              <Button
                disabled={
                  unresolved.length > 0 ||
                  ["Applied", "Rejected", "Failed"].includes(selectedPackage.status)
                }
                onClick={async () => {
                  await approvePackage(selectedPackage.id);
                  setIsModalOpen(false);
                }}
              >
                Approve
              </Button>
              <Button
                variant="destructive"
                disabled={["Applied", "Rejected"].includes(selectedPackage.status)}
                onClick={async () => {
                  await rejectPackage(selectedPackage.id);
                  setIsModalOpen(false);
                }}
              >
                Reject
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function PublishQueuePage({
  packages,
  selectedPackage,
  setSelectedId,
  publishPackage,
  rejectPackage,
}: PageProps) {
  const [isModalOpen, setIsModalOpen] = React.useState(false)

  const handleSelect = (id: string) => {
    setSelectedId(id)
    setIsModalOpen(true)
  }

  return (
    <div className="min-h-0">
      <Card>
        <CardHeader>
          <CardTitle>Publish Queue</CardTitle>
          <CardDescription>Approved packages awaiting final publication to the operational database.</CardDescription>
        </CardHeader>
        <CardContent>
          <PackageTable
            packages={packages.filter((item) => item.status === "Approved")}
            selectedId={isModalOpen ? selectedPackage.id : ""}
            onSelect={handleSelect}
          />
        </CardContent>
      </Card>

      {/* Modal Dialog */}
      {isModalOpen && selectedPackage && selectedPackage.id !== "no-package" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-md animate-in fade-in-0 duration-150">
          <div className="relative w-full max-w-7xl h-[90vh] max-h-[90vh] flex flex-col bg-card border rounded-xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-150">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b px-6 py-4 bg-muted/20 shrink-0">
              <div>
                <h2 className="text-lg font-semibold flex items-center gap-2">
                  <span>Package Publication</span>
                  {statusBadge(selectedPackage.status)}
                </h2>
                <p className="text-xs text-muted-foreground mt-0.5">Package ID: {selectedPackage.id}</p>
              </div>
              <button
                onClick={() => setIsModalOpen(false)}
                className="rounded-lg p-1.5 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
              >
                <X className="size-5" />
              </button>
            </div>

            {/* Modal Content */}
            <div className="flex-1 overflow-y-auto p-6 min-h-0 bg-background/50">
              <Tabs defaultValue="draft">
                <TabsList>
                  <TabsTrigger value="draft">Final Draft</TabsTrigger>
                  <TabsTrigger value="gaps">Gaps History</TabsTrigger>
                  <TabsTrigger value="impacts">Impacts</TabsTrigger>
                  <TabsTrigger value="summary">Summary</TabsTrigger>
                </TabsList>
                <TabsContent value="summary" className="mt-4 space-y-3">
                  <div className="font-medium">{selectedPackage.title}</div>
                  <div className="text-sm text-muted-foreground">
                    {selectedPackage.primaryAction} into {selectedPackage.targetCollection}
                  </div>
                  <Separator />
                  <AgentTimeline agentLog={selectedPackage.agentLog} />
                </TabsContent>
                <TabsContent value="draft" className="mt-4 space-y-4">
                  {/* Metadata Grid (Single Line Fields) */}
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 bg-muted/10 p-4 rounded-xl border border-border/60">
                    {(selectedPackage.draftSections || [])
                      .filter((section) => !isMultiLineField(section.label))
                      .map((section) => (
                        <div key={section.label} className="space-y-1">
                          <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">{section.label}</span>
                          <div className="text-sm font-medium text-foreground bg-background px-3 py-1.5 rounded-lg border border-border/40 font-mono text-ellipsis overflow-hidden whitespace-nowrap" title={section.value}>
                            {section.value || <span className="text-muted-foreground/50 italic">None</span>}
                          </div>
                        </div>
                      ))}
                  </div>

                  {/* Large Content Sections */}
                  <div className="space-y-4">
                    {(selectedPackage.draftSections || [])
                      .filter((section) => isMultiLineField(section.label))
                      .map((section) => (
                        <div key={section.label} className="rounded-xl border p-4 space-y-2 bg-card">
                          <div className="flex items-center justify-between">
                            <span className="font-semibold text-xs text-muted-foreground uppercase tracking-wider">{section.label}</span>
                            <Badge variant="outline" className="text-[10px] uppercase font-bold">{section.source}</Badge>
                          </div>
                          <div className="text-sm text-foreground whitespace-pre-wrap leading-relaxed font-mono bg-muted/20 p-3 rounded-lg border border-border/30">
                            {section.value}
                          </div>
                        </div>
                      ))}
                  </div>
                </TabsContent>
                <TabsContent value="impacts" className="mt-4 space-y-3">
                  {selectedPackage.impacts.length ? (
                    selectedPackage.impacts.map((impact) => (
                      <div key={impact.id} className="rounded-lg border p-3">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="font-medium">{impact.document}</div>
                            <div className="text-xs text-muted-foreground">{impact.collection}</div>
                          </div>
                          <Badge variant="outline">{impact.accepted ? "Accepted" : "Declined"}</Badge>
                        </div>
                        <div className="mt-2 text-sm text-muted-foreground">{impact.rationale}</div>
                      </div>
                    ))
                  ) : (
                    <EmptyState>No impacted documents.</EmptyState>
                  )}
                </TabsContent>
                <TabsContent value="gaps" className="mt-4 space-y-3">
                  {(selectedPackage.gaps || []).length ? (
                    (selectedPackage.gaps || []).map((gap) => (
                      <div key={gap.field} className="rounded-lg border p-3 bg-muted/10 space-y-1">
                        <div className="flex justify-between items-center">
                          <span className="font-semibold text-sm">{formatLabel(gap.field)}</span>
                          {gap.required ? <Badge variant="outline" className="text-[10px] text-destructive">required</Badge> : <Badge variant="outline" className="text-[10px]">optional</Badge>}
                        </div>
                        <div className="text-xs text-muted-foreground">Reason: {gap.reason}</div>
                        <div className="text-xs text-foreground bg-card p-2 rounded border border-border/40 mt-1">
                          Resolved value: <span className="font-medium font-mono">{gap.resolvedValue || "(Not resolved)"}</span>
                        </div>
                      </div>
                    ))
                  ) : (
                    <EmptyState>No gaps recorded.</EmptyState>
                  )}
                </TabsContent>
              </Tabs>
            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-end gap-2 border-t px-6 py-4 bg-muted/10 shrink-0">
              <Button variant="outline" onClick={() => setIsModalOpen(false)}>
                Close
              </Button>
              {selectedPackage.status === "Approved" ? (
                <Button onClick={async () => {
                  await publishPackage(selectedPackage.id);
                  setIsModalOpen(false);
                  const targetLib = selectedPackage.targetCollection.replace("/", "");
                  window.location.hash = targetLib;
                  toast.success(`Staged document successfully published to ${targetLib.toUpperCase()} Library!`);
                }}>
                  Publish to Database
                </Button>
              ) : (
                <Button disabled>
                  Published
                </Button>
              )}
              {selectedPackage.status === "Approved" && (
                <Button
                  variant="destructive"
                  onClick={async () => {
                    await rejectPackage(selectedPackage.id);
                    setIsModalOpen(false);
                  }}
                >
                  Reject Package
                </Button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function OperationalDocsPage({
  documents,
}: {
  documents: OperationalDocument[]
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <CollectionCard collection="/sops" title="SOP Library" documents={documents} />
      <CollectionCard collection="/mops" title="MOP Library" documents={documents} />
      <CollectionCard collection="/eops" title="EOP Library" documents={documents} />
    </div>
  )
}

function AuditTrailPage({ packages }: { packages: IngestionPackage[] }) {
  const events = packages.flatMap((item) =>
    item.applicationLog.map((entry) => ({
      packageId: item.id,
      title: item.title,
      status: item.status,
      entry,
    }))
  )
  return (
    <Card>
      <CardHeader>
        <CardTitle>Audit Trail</CardTitle>
        <CardDescription>Package approvals, application-step results, and chain-of-custody records.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {events.length ? (
          events.map((event) => (
            <div key={`${event.packageId}-${event.entry}`} className="rounded-lg border p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="font-medium">{event.entry}</div>
                {statusBadge(event.status)}
              </div>
              <div className="text-sm text-muted-foreground">
                {event.packageId} - {event.title}
              </div>
            </div>
          ))
        ) : (
          <EmptyState>No application records yet.</EmptyState>
        )}
      </CardContent>
    </Card>
  )
}

function DocumentLibraryPage({
  collection,
  documents,
  onSelectDoc,
}: {
  collection: OperationalDocument["collection"]
  documents: OperationalDocument[]
  onSelectDoc: (doc: OperationalDocument) => void
}) {
  const [showTemplate, setShowTemplate] = React.useState(false)
  const filteredDocuments = documents.filter((document) => document.collection === collection)
  const title = collection === "/sops" ? "SOP Library" : collection === "/mops" ? "MOP Library" : "EOP Library"
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
          <div>
            <CardTitle>{title}</CardTitle>
            <CardDescription className="mt-1">Documents in {collection}. Click a document to view details or download.</CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowTemplate(!showTemplate)}
            className="h-8 text-xs font-semibold cursor-pointer"
          >
            {showTemplate ? "Hide Schema Template" : "Show Schema Template"}
          </Button>
        </CardHeader>
        <CardContent>
          {filteredDocuments.length ? (
            <DocumentsTable documents={filteredDocuments} onSelectDoc={onSelectDoc} />
          ) : (
            <EmptyState>No documents in {collection} yet. Use the ingestion pipeline to create one.</EmptyState>
          )}
        </CardContent>
      </Card>
      {showTemplate && (
        <div className="animate-in fade-in slide-in-from-bottom-2 duration-150">
          <LibraryStructureExample collection={collection} />
        </div>
      )}
    </div>
  )
}

function LibraryStructureExample({ collection }: { collection: OperationalDocument["collection"] }) {
  if (collection === "/sops") return <SopStructureExample />
  if (collection === "/mops") return <MopStructureExample />
  return <EopStructureExample />
}

function SopStructureExample() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Example Document Structure</CardTitle>
        <CardDescription>
          A representative SOP showing the key fields every Standard Operating Procedure carries. Real documents are created via the ingestion pipeline and written here by the Application Step.
        </CardDescription>
        <CardAction><Badge variant="outline">SOP · HowTo</Badge></CardAction>
      </CardHeader>
      <CardContent className="space-y-4">
        <StructureSection label="Identity">
          <StructureField label="name" value="Lockout/Tagout — Electrical Panel Isolation" />
          <StructureField label="docType" value="SOP" />
          <StructureField label="status" value="Active" />
          <StructureField label="version" value="1.0.0" />
          <StructureField label="sopCategory" value="Safety" />
          <StructureField label="totalTime" value="PT45M" note="ISO 8601 — 45 minutes" />
        </StructureSection>
        <StructureSection label="Ownership">
          <StructureField label="owner.name" value="Facilities & Maintenance" />
          <StructureField label="creator.name" value="J. Torres" />
          <StructureField label="audience.audienceType" value="Field Technician" />
          <StructureField label="regulatoryReferences" value="OSHA 29 CFR 1910.147" />
        </StructureSection>
        <StructureSection label="Safety Requirements">
          <StructureRow columns={["Type", "Description", "Standard", "Mandatory"]}>
            <StructureDataRow values={["PPE", "Hard hat, safety glasses, insulated gloves (class 00)", "OSHA 1910.138", "Yes"]} />
            <StructureDataRow values={["LOTO", "Apply personal lock to MCC-7 Breaker 14 before any work begins", "OSHA 1910.147", "Yes"]} />
          </StructureRow>
        </StructureSection>
        <StructureSection label="Tools & Supplies">
          <StructureRow columns={["Type", "Name", "Specification", "Calibration Required"]}>
            <StructureDataRow values={["Tool", "Digital Multimeter", "CAT III 600V rated", "Yes"]} />
            <StructureDataRow values={["Tool", "Personal Lock + Tag", "ANSI Z244.1 compliant", "No"]} />
            <StructureDataRow values={["Supply", "Danger Tag", "Quantity: 2", "—"]} />
          </StructureRow>
        </StructureSection>
        <StructureSection label="Steps">
          <StructureRow columns={["Step", "Name", "Critical", "Hold Point", "Hold Approver"]}>
            <StructureDataRow values={["1", "Notify all affected personnel of planned isolation", "No", "No", "—"]} />
            <StructureDataRow values={["2", "Identify all energy sources at MCC-7 Panel", "Yes", "No", "—"]} />
            <StructureDataRow values={["3", "Open and lock out Breaker 14 — apply personal lock and danger tag", "Yes", "No", "—"]} />
            <StructureDataRow values={["4", "Verify zero-energy state with calibrated multimeter at terminal block", "Yes", "Yes", "Shift Supervisor"]} />
            <StructureDataRow values={["5", "Perform authorized work", "No", "No", "—"]} />
            <StructureDataRow values={["6", "Remove lock and tag — restore energy in reverse order", "Yes", "Yes", "Shift Supervisor"]} />
          </StructureRow>
        </StructureSection>
        <StructureSection label="Completion">
          <StructureField label="verificationMethod" value="SignOff" />
          <StructureField label="completionSignOff.requiredRole" value="Shift Supervisor" />
          <StructureField label="completionSignOff.twoPersonIntegrity" value="true" />
          <StructureField label="dateNextReview" value="2027-06-22" />
        </StructureSection>
        <StructureSection label="Version History Subcollection  →  /sops/{docId}/versions/{versionId}">
          <StructureField label="versionNumber" value="1.0.0" />
          <StructureField label="changeType" value="InitialCreation" />
          <StructureField label="changedBy.name" value="J. Torres" />
          <StructureField label="changeDate" value="2026-06-22T14:30:00Z" />
          <StructureField label="approvalChain[0].action" value="Approved" />
          <StructureField label="approvalChain[0].approverRole" value="Operations Manager" />
          <StructureField label="approvalChain[0].timestamp" value="2026-06-22T16:00:00Z" />
        </StructureSection>
      </CardContent>
    </Card>
  )
}

function MopStructureExample() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Example Document Structure</CardTitle>
        <CardDescription>
          A representative MOP showing the key fields every Maintenance Operating Procedure carries. Real documents are created via the ingestion pipeline and written here by the Application Step.
        </CardDescription>
        <CardAction><Badge variant="outline">MOP · TechArticle</Badge></CardAction>
      </CardHeader>
      <CardContent className="space-y-4">
        <StructureSection label="Identity">
          <StructureField label="name" value="Dell PowerEdge R750 — Quarterly Preventive Maintenance" />
          <StructureField label="docType" value="MOP" />
          <StructureField label="status" value="Active" />
          <StructureField label="version" value="1.0.0" />
          <StructureField label="maintenanceType" value="Preventive" />
          <StructureField label="totalTime" value="PT2H" note="ISO 8601 — 2 hours" />
        </StructureSection>
        <StructureSection label="Ownership">
          <StructureField label="owner.name" value="IT Infrastructure" />
          <StructureField label="creator.name" value="R. Patel" />
          <StructureField label="audience.audienceType" value="Data Center Technician" />
          <StructureField label="audience.certificationRequired" value="CompTIA Server+" />
          <StructureField label="maintenanceFrequency.interval" value="Every 3 months" />
        </StructureSection>
        <StructureSection label="Equipment">
          <StructureRow columns={["Name", "Manufacturer", "Model", "Asset ID", "Manual Ref"]}>
            <StructureDataRow values={["Primary Server", "Dell", "PowerEdge R750", "DC-SRV-042", "Dell PN: 12345-PM"]} />
          </StructureRow>
        </StructureSection>
        <StructureSection label="Energy Isolation Plan (LOTO)">
          <StructureRow columns={["Energy Type", "Isolation Point", "Isolation Method", "Verification Method"]}>
            <StructureDataRow values={["Electrical", "PDU-B Row 4 Circuit 12", "Power off via iDRAC, pull both PSU cables, apply lock + tag", "Confirm power LEDs off; verify with multimeter at PSU input"]} />
          </StructureRow>
        </StructureSection>
        <StructureSection label="Safety Classifications">
          <StructureRow columns={["Term", "Permit Required", "Standard"]}>
            <StructureDataRow values={["LOTO Required", "No", "OSHA 29 CFR 1910.147"]} />
            <StructureDataRow values={["ESD Sensitive Equipment", "No", "ANSI/ESD S20.20"]} />
          </StructureRow>
        </StructureSection>
        <StructureSection label="Spare Parts">
          <StructureRow columns={["Name", "Part Number", "Quantity", "Critical Spare", "Lead Time"]}>
            <StructureDataRow values={["Cooling Fan Module", "Dell 0W2YKX", "2", "Yes", "3 days"]} />
            <StructureDataRow values={["Air Filter Pad", "Dell 330-BBEK", "1", "No", "1 day"]} />
          </StructureRow>
        </StructureSection>
        <StructureSection label="Phased Steps">
          <StructureRow columns={["Step", "Phase", "Name", "Critical", "Hold Point", "Measured Value"]}>
            <StructureDataRow values={["1", "Preparation", "Open iDRAC console, confirm no active alerts", "No", "No", "—"]} />
            <StructureDataRow values={["2", "Isolation", "Graceful shutdown via OS; wait for power LED off", "Yes", "No", "—"]} />
            <StructureDataRow values={["3", "Isolation", "Disconnect PSU cables; apply LOTO lock and tag", "Yes", "No", "—"]} />
            <StructureDataRow values={["4", "Execution", "Remove and clean air filter; inspect fans for bearing noise", "No", "No", "—"]} />
            <StructureDataRow values={["5", "Execution", "Blow out chassis with ESD-safe compressed air", "No", "No", "—"]} />
            <StructureDataRow values={["6", "Restoration", "Reconnect PSU cables; remove LOTO lock and tag", "Yes", "No", "—"]} />
            <StructureDataRow values={["7", "Testing", "Boot server; verify POST completes without errors", "Yes", "Yes", "Fan RPM ≥ 3200"]} />
            <StructureDataRow values={["8", "Closeout", "Document findings and sign off in CMMS", "No", "No", "—"]} />
          </StructureRow>
        </StructureSection>
        <StructureSection label="Post-Work Tests">
          <StructureRow columns={["Test", "Method", "Acceptance Criteria"]}>
            <StructureDataRow values={["POST verification", "Visual — iDRAC event log", "No critical errors; all fans reporting ≥ 3200 RPM"]} />
            <StructureDataRow values={["Temperature baseline", "iDRAC sensor read", "Inlet temp ≤ 27°C after 10 min runtime"]} />
          </StructureRow>
        </StructureSection>
        <StructureSection label="Version History Subcollection  →  /mops/{docId}/versions/{versionId}">
          <StructureField label="versionNumber" value="1.0.0" />
          <StructureField label="changeType" value="InitialCreation" />
          <StructureField label="changedBy.name" value="R. Patel" />
          <StructureField label="changeReason" value="Ingestion Package #PKG-2026-0001 — New asset onboarding" />
          <StructureField label="approvalChain[0].action" value="Approved" />
          <StructureField label="approvalChain[0].approverRole" value="IT Infrastructure Manager" />
        </StructureSection>
      </CardContent>
    </Card>
  )
}

function EopStructureExample() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Example Document Structure</CardTitle>
        <CardDescription>
          A representative EOP showing the key fields every Emergency Operations Plan carries. Real documents are created via the ingestion pipeline and written here by the Application Step.
        </CardDescription>
        <CardAction><Badge variant="outline">EOP · CreativeWork</Badge></CardAction>
      </CardHeader>
      <CardContent className="space-y-4">
        <StructureSection label="Identity">
          <StructureField label="name" value="Building A — Electrical Utility Failure Emergency Operations Plan" />
          <StructureField label="docType" value="EOP" />
          <StructureField label="status" value="Active" />
          <StructureField label="version" value="2.1.0" />
          <StructureField label="eopType" value="UtilityFailure" />
        </StructureSection>
        <StructureSection label="Ownership">
          <StructureField label="owner.name" value="Emergency Management" />
          <StructureField label="creator.name" value="K. Williams" />
          <StructureField label="audience.audienceType" value="Incident Commander, Department Heads" />
          <StructureField label="dateNextReview" value="2027-01-01" />
          <StructureField label="planMaintenanceSchedule.reviewFrequency" value="Annually and after every activation" />
        </StructureSection>
        <StructureSection label="Activation Criteria">
          <StructureRow columns={["Condition", "Declaration Authority", "Notification Required"]}>
            <StructureDataRow values={["Utility power loss exceeding 15 minutes with no confirmed ETA from provider", "Facility Manager", "Yes"]} />
            <StructureDataRow values={["Generator failure during active utility outage", "Incident Commander", "Yes"]} />
          </StructureRow>
        </StructureSection>
        <StructureSection label="Command Structure (ICS)">
          <StructureRow columns={["Position", "Primary", "Phone", "Reports To"]}>
            <StructureDataRow values={["Incident Commander", "K. Williams", "555-0101", "—"]} />
            <StructureDataRow values={["Operations Section Chief", "M. Chen", "555-0102", "Incident Commander"]} />
            <StructureDataRow values={["Logistics Section Chief", "A. Brooks", "555-0103", "Incident Commander"]} />
            <StructureDataRow values={["Public Information Officer", "T. Davis", "555-0104", "Incident Commander"]} />
          </StructureRow>
        </StructureSection>
        <StructureSection label="Emergency Contacts">
          <StructureRow columns={["Name / Org", "Type", "24hr Phone", "Notes"]}>
            <StructureDataRow values={["Metro Power Authority", "Utility", "800-555-0200", "Report outage, get ETA"]} />
            <StructureDataRow values={["Generator Vendor — AcmePower", "Vendor", "800-555-0201", "Service contract #GV-441"]} />
            <StructureDataRow values={["Local Fire Dept — Station 7", "FireDepartment", "911 / 555-0300", "Non-emergency line"]} />
          </StructureRow>
        </StructureSection>
        <StructureSection label="Facilities">
          <StructureRow columns={["Name", "Type", "Address", "Capacity"]}>
            <StructureDataRow values={["Building A — Main", "PrimaryFacility", "100 Industrial Blvd", "—"]} />
            <StructureDataRow values={["Parking Lot C North End", "AssemblyArea", "100 Industrial Blvd", "400 persons"]} />
            <StructureDataRow values={["Building B Conference Room 1", "EmergencyOperationsCenter", "110 Industrial Blvd", "25 persons"]} />
          </StructureRow>
        </StructureSection>
        <StructureSection label="Functional Annexes">
          <StructureRow columns={["Annex", "Function", "Lead Role", "Procedure Example"]}>
            <StructureDataRow values={["Annex A", "Communications", "Public Information Officer", "Activate mass notification system within 10 min of declaration"]} />
            <StructureDataRow values={["Annex B", "IT-Recovery", "Operations Section Chief", "Transfer critical systems to generator power; notify on-call IT"]} />
            <StructureDataRow values={["Annex C", "Logistics", "Logistics Section Chief", "Deploy portable lighting to exit corridors within 20 min"]} />
          </StructureRow>
        </StructureSection>
        <StructureSection label="Resource Inventories">
          <StructureRow columns={["Resource", "Type", "Location", "Qty", "Last Inspected"]}>
            <StructureDataRow values={["Emergency Generator — 250kW", "EmergencyGenerator", "Loading Dock B", "1", "2026-03-15"]} />
            <StructureDataRow values={["Portable LED Light Tower", "Other", "Maintenance Storage Rm 4", "4", "2026-03-15"]} />
            <StructureDataRow values={["First Aid Cabinet", "FirstAidKit", "Floor 1 Hallway A", "2", "2026-05-01"]} />
          </StructureRow>
        </StructureSection>
        <StructureSection label="Training Requirements">
          <StructureRow columns={["Training", "Type", "Frequency", "Last Conducted"]}>
            <StructureDataRow values={["Full utility failure tabletop drill", "Tabletop", "Annually", "2025-11-12"]} />
            <StructureDataRow values={["Generator failover test", "Functional", "Semi-annually", "2026-03-15"]} />
          </StructureRow>
        </StructureSection>
        <StructureSection label="Version History Subcollection  →  /eops/{docId}/versions/{versionId}">
          <StructureField label="versionNumber" value="2.1.0" />
          <StructureField label="changeType" value="ContentRevision" />
          <StructureField label="changeSummary" value="Added generator vendor contact; updated assembly area capacity after site survey" />
          <StructureField label="changedBy.name" value="K. Williams" />
          <StructureField label="linkedIncidents[0].type" value="AuditFinding" />
          <StructureField label="linkedIncidents[0].description" value="2025 annual review — assembly area capacity was outdated" />
          <StructureField label="approvalChain[0].action" value="Approved" />
          <StructureField label="approvalChain[0].approverRole" value="Director of Operations" />
        </StructureSection>
      </CardContent>
    </Card>
  )
}

function StructureSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="rounded-lg border divide-y">{children}</div>
    </div>
  )
}

function StructureField({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 px-3 py-2">
      <span className="shrink-0 font-mono text-xs text-muted-foreground">{label}</span>
      <span className="text-right text-sm">
        {value}
        {note ? <span className="ml-1 text-xs text-muted-foreground">({note})</span> : null}
      </span>
    </div>
  )
}

function StructureRow({ columns, children }: { columns: string[]; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b">
            {columns.map((col) => (
              <th key={col} className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground">
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y">{children}</tbody>
      </table>
    </div>
  )
}

function StructureDataRow({ values }: { values: string[] }) {
  return (
    <tr>
      {values.map((value, index) => (
        <td key={index} className="px-3 py-2 text-sm align-top">
          {value}
        </td>
      ))}
    </tr>
  )
}

function PackageTable({
  packages,
  selectedId,
  onSelect,
}: {
  packages: IngestionPackage[]
  selectedId: string
  onSelect: (id: string) => void
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Package</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Action</TableHead>
          <TableHead className="text-right">Auto</TableHead>
          <TableHead className="text-right">Gaps</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {packages.map((item) => {
          const gaps = item.gaps.filter((gap) => gap.required && !gap.resolvedValue).length
          return (
            <TableRow
              key={item.id}
              data-state={item.id === selectedId ? "selected" : undefined}
              onClick={() => onSelect(item.id)}
              className="cursor-pointer"
            >
              <TableCell className="max-w-[360px] whitespace-normal">
                <div className="font-medium">{item.title}</div>
                <div className="text-xs text-muted-foreground">{item.id}</div>
              </TableCell>
              <TableCell>{statusBadge(item.status)}</TableCell>
              <TableCell>{item.primaryAction}</TableCell>
              <TableCell className="text-right tabular-nums">{item.autoFilledFields}</TableCell>
              <TableCell className="text-right tabular-nums">{gaps}</TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}

function DocumentsTable({
  documents,
  onSelectDoc,
}: {
  documents: OperationalDocument[]
  onSelectDoc?: (doc: OperationalDocument) => void
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Document</TableHead>
          <TableHead>Collection</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Version</TableHead>
          <TableHead>Owner</TableHead>
          <TableHead>Updated</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {documents.map((document) => (
          <TableRow
            key={document.id}
            className={onSelectDoc ? "cursor-pointer hover:bg-muted/50 transition-colors" : ""}
            onClick={() => onSelectDoc?.(document)}
          >
            <TableCell className="max-w-[360px] whitespace-normal">
              <div className="font-medium">{document.title}</div>
              <div className="text-xs text-muted-foreground">{document.id}</div>
            </TableCell>
            <TableCell>{document.collection}</TableCell>
            <TableCell>
              <Badge variant="outline">{document.status}</Badge>
            </TableCell>
            <TableCell>{document.version}</TableCell>
            <TableCell>{document.owner}</TableCell>
            <TableCell>{document.updatedAt}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

function CollectionCard({
  collection,
  title,
  documents,
}: {
  collection: OperationalDocument["collection"]
  title: string
  documents: OperationalDocument[]
}) {
  const collectionDocuments = documents.filter((document) => document.collection === collection)
  return (
    <Card
      className="cursor-pointer hover:bg-muted/50 transition-colors"
      onClick={() => {
        window.location.hash = collection.replace("/", "")
      }}
    >
      <CardHeader>
        <CardDescription>{collection}</CardDescription>
        <CardTitle className="text-2xl tabular-nums">{collectionDocuments.length}</CardTitle>
        <CardAction>
          <Badge variant="outline">{title}</Badge>
        </CardAction>
      </CardHeader>
    </Card>
  )
}

function MetricCard({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-2xl tabular-nums">{value}</CardTitle>
      </CardHeader>
    </Card>
  )
}


function Signal({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div className="flex items-center justify-between rounded-lg border p-3">
      <div className="flex items-center gap-2">
        <span className="[&>svg]:size-4">{icon}</span>
        <span>{label}</span>
      </div>
      <span className="font-semibold tabular-nums">{value}</span>
    </div>
  )
}

function AgentTimeline({ agentLog }: { agentLog: AgentLogEntry[] }) {
  return (
    <div className="space-y-2">
      {agentLog.map((entry) => (
        <div key={entry.name} className="flex items-start gap-3 rounded-lg border p-3">
          {agentIcon(entry.status)}
          <div className="min-w-0">
            <div className="font-medium">{entry.name}</div>
            <div className="text-sm text-muted-foreground">{entry.detail}</div>
          </div>
        </div>
      ))}
    </div>
  )
}

function formatLabel(label: string): string {
  if (label === 'docId') return 'Document ID';
  if (label === 'docType') return 'Document Type';
  if (label === 'dateCreated') return 'Date Created';
  if (label === 'dateModified') return 'Date Modified';
  const result = label.replace(/([A-Z])/g, " $1");
  return result.charAt(0).toUpperCase() + result.slice(1);
}

function GapEditor({
  gap,
  onResolve,
  onUpdate,
  onDelete,
  aiSuggestion,
  onAcceptSuggestion,
  onDiscardSuggestion,
}: {
  gap: GapEntry
  onResolve: (value: string) => void
  onUpdate?: (updatedGap: GapEntry) => void
  onDelete?: () => void
  aiSuggestion?: string
  onAcceptSuggestion?: (value: string) => void
  onDiscardSuggestion?: () => void
}) {
  const [isEditing, setIsEditing] = React.useState(false)
  const [localVal, setLocalVal] = React.useState(gap.resolvedValue || "")
  
  // Fields for editing the gap definition
  const [editField, setEditField] = React.useState(gap.field)
  const [editReason, setEditReason] = React.useState(gap.reason)
  const [editSuggestion, setEditSuggestion] = React.useState(gap.suggestion)
  const [editRequired, setEditRequired] = React.useState(gap.required)

  React.useEffect(() => {
    setLocalVal(gap.resolvedValue || "")
  }, [gap.resolvedValue])

  React.useEffect(() => {
    setEditField(gap.field)
    setEditReason(gap.reason)
    setEditSuggestion(gap.suggestion)
    setEditRequired(gap.required)
  }, [gap])

  const handleSaveEdit = () => {
    if (onUpdate) {
      onUpdate({
        field: editField,
        reason: editReason,
        suggestion: editSuggestion,
        required: editRequired,
        resolvedValue: localVal,
      })
    }
    setIsEditing(false)
  }

  if (isEditing) {
    return (
      <div className="rounded-lg border p-4 bg-muted/30 space-y-3">
        <div className="text-sm font-semibold border-b pb-1.5 flex justify-between items-center">
          <span>Edit Gap Definition</span>
          <span className="text-[10px] text-muted-foreground font-mono">({gap.field})</span>
        </div>
        
        <div className="grid gap-2.5">
          <div>
            <label className="text-[10px] font-bold text-muted-foreground uppercase">Target Field Path</label>
            <Input
              className="h-8 text-sm mt-1"
              value={editField}
              onChange={(e) => setEditField(e.target.value)}
              placeholder="e.g. owner.name"
            />
          </div>

          <div>
            <label className="text-[10px] font-bold text-muted-foreground uppercase">Reason</label>
            <Input
              className="h-8 text-sm mt-1"
              value={editReason}
              onChange={(e) => setEditReason(e.target.value)}
              placeholder="e.g. NotFoundInResearch"
            />
          </div>

          <div>
            <label className="text-[10px] font-bold text-muted-foreground uppercase">Suggestion / Description</label>
            <textarea
              className="w-full min-h-16 rounded-md border border-input bg-transparent px-2.5 py-1.5 text-xs outline-none focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/50 mt-1"
              value={editSuggestion}
              onChange={(e) => setEditSuggestion(e.target.value)}
              placeholder="What needs to be filled?"
            />
          </div>

          <label className="flex items-center gap-2 text-xs font-medium mt-1 cursor-pointer select-none">
            <Checkbox
              checked={editRequired}
              onCheckedChange={(checked) => setEditRequired(Boolean(checked))}
            />
            This gap is required to approve the package
          </label>
        </div>

        <div className="flex justify-end gap-2 pt-2 border-t mt-2">
          <Button size="sm" variant="outline" className="h-7 text-xs cursor-pointer" onClick={() => setIsEditing(false)}>
            Cancel
          </Button>
          <Button size="sm" className="h-7 text-xs cursor-pointer" onClick={handleSaveEdit} disabled={!editField.trim()}>
            Save Changes
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-lg border p-3 bg-muted/20 relative group">
      <div className="flex items-center justify-between gap-3">
        <div className="font-semibold text-sm flex items-center gap-2">
          <span>{formatLabel(gap.field)}</span>
          <span className="text-[10px] text-muted-foreground font-mono">({gap.field})</span>
        </div>
        <div className="flex items-center gap-2">
          {gap.required ? (
            <Badge variant="outline" className="border-destructive/30 text-destructive text-[10px] uppercase font-bold px-1.5 py-0.5">
              required
            </Badge>
          ) : (
            <Badge variant="outline" className="text-muted-foreground text-[10px] uppercase font-bold px-1.5 py-0.5">
              optional
            </Badge>
          )}
          
          {onUpdate && (
            <button
              onClick={() => setIsEditing(true)}
              className="rounded p-1 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
              title="Edit Gap Definition"
            >
              <Pencil className="size-3.5" />
            </button>
          )}
          
          {onDelete && (
            <button
              onClick={onDelete}
              className="rounded p-1 hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors cursor-pointer"
              title="Delete Gap"
            >
              <Trash2 className="size-3.5" />
            </button>
          )}
        </div>
      </div>
      <div className="mt-1 text-xs text-muted-foreground">Reason: {gap.reason}</div>
      <div className="mt-2 text-xs italic text-foreground/80 bg-background/50 p-2 rounded-md border border-border/40">
        Suggestion: {gap.suggestion}
      </div>
      {aiSuggestion && (
        <div className="mt-2.5 p-3 bg-primary/5 border border-primary/20 rounded-lg space-y-2">
          <div className="text-[10px] font-bold text-primary flex items-center gap-1.5 uppercase tracking-wider">
            <Sparkles className="size-3 text-primary animate-pulse" />
            AI Suggestion
          </div>
          <div className="text-xs text-foreground font-mono bg-background/50 p-2.5 rounded border border-border/60 max-h-32 overflow-y-auto whitespace-pre-wrap">
            {aiSuggestion}
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              className="h-7 text-xs bg-primary text-primary-foreground font-semibold px-3 cursor-pointer flex items-center gap-1"
              onClick={() => onAcceptSuggestion?.(aiSuggestion)}
            >
              Accept (Yes)
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs text-muted-foreground font-semibold px-3 cursor-pointer"
              onClick={onDiscardSuggestion}
            >
              Discard (No)
            </Button>
          </div>
        </div>
      )}
      <div className="mt-3 flex gap-2">
        <Input
          className="flex-1 h-8 text-sm"
          value={localVal}
          placeholder="Enter resolved value..."
          onChange={(event) => setLocalVal(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              onResolve(localVal);
            }
          }}
        />
        <Button
          size="sm"
          variant={localVal.trim() ? "default" : "secondary"}
          className="h-8 shrink-0 cursor-pointer"
          onClick={() => onResolve(localVal)}
        >
          Resolve
        </Button>
      </div>
    </div>
  )
}

function FieldInput({
  id,
  label,
  placeholder,
  value,
  onChange,
}: {
  id: string
  label: string
  placeholder: string
  value: string
  onChange: (value: string) => void
}) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  )
}

function PageGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">{children}</div>
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return <div className="rounded-lg border p-4 text-sm text-muted-foreground">{children}</div>
}

function statusBadge(status: PackageStatus) {
  if (status === "Applied" || status === "Approved") {
    return (
      <Badge variant="outline">
        <CheckCircle2Icon />
        {status}
      </Badge>
    )
  }
  if (status === "NeedsInput" || status === "Failed") {
    return (
      <Badge variant={status === "Failed" ? "destructive" : "outline"}>
        <AlertTriangleIcon />
        {status}
      </Badge>
    )
  }
  if (status === "Rejected") {
    return (
      <Badge variant="destructive">
        <XCircleIcon />
        {status}
      </Badge>
    )
  }
  return (
    <Badge variant="outline">
      <LoaderCircleIcon />
      {status}
    </Badge>
  )
}

function agentIcon(status: AgentStatus) {
  if (status === "complete") return <CheckCircle2Icon className="size-4 text-green-600" />
  if (status === "running") return <LoaderCircleIcon className="size-4 animate-spin" />
  if (status === "blocked") return <AlertTriangleIcon className="size-4 text-amber-600" />
  return <CircleIcon className="size-4 text-muted-foreground" />
}

function DocumentViewerModal({
  doc,
  onClose,
}: {
  doc: OperationalDocument
  onClose: () => void
}) {
  const [activeTab, setActiveTab] = React.useState<"preview" | "raw">("preview")
  
  const handleDownload = (format: "markdown" | "json") => {
    downloadDocument(doc, format)
  }

  const data = doc.rawData || {}

  // Helper to parse safetyRequirements string to structured rows
  const getSafetyRequirements = () => {
    const rawReq = data.safetyRequirements || ""
    if (!rawReq) return []
    if (Array.isArray(rawReq)) return rawReq
    
    const lines = String(rawReq).split("\n").filter(Boolean)
    return lines.map((line, idx) => {
      const typeMatch = line.match(/\[(PPE|LOTO|Permit|Isolation|Other)\]/)
      const stdMatch = line.match(/\(Standard:\s*([^)]+)\)/)
      const isMandatory = line.includes("[Mandatory]")
      
      const type = typeMatch ? typeMatch[1] : "Other"
      const standard = stdMatch ? stdMatch[1] : "General Safety"
      
      let desc = line.replace(/^\d+\.\s*/, "") // remove number prefix
      desc = desc.replace(/\[(PPE|LOTO|Permit|Isolation|Other)\]\s*/, "")
      desc = desc.replace(/\(Standard:\s*[^)]+\)\s*/, "")
      desc = desc.replace(/\[Mandatory\]\s*/, "")
      desc = desc.trim()

      return {
        id: idx + 1,
        type,
        description: desc || line,
        standard,
        mandatory: isMandatory ? "Yes" : "No"
      }
    })
  }

  // Helper to parse tools string to structured rows
  const getTools = () => {
    const rawTools = data["tools/equipment"] || data.toolsEquipment || data.tools || ""
    if (!rawTools) return []
    if (Array.isArray(rawTools)) return rawTools
    
    const lines = String(rawTools).split("\n").filter(Boolean)
    return lines.map((line) => {
      return {
        name: line.trim(),
        type: line.toLowerCase().includes("tag") || line.toLowerCase().includes("lock") ? "Supply" : "Tool",
        spec: "Standard",
        calibration: line.toLowerCase().includes("multimeter") ? "Yes" : "No"
      }
    })
  }

  // Helper to parse steps string to structured rows
  const getSteps = () => {
    const rawSteps = data.steps || ""
    if (!rawSteps) return []
    if (Array.isArray(rawSteps)) return rawSteps

    const blocks = String(rawSteps).split(/\n\n+/)
    return blocks.map((block, idx) => {
      const lines = block.split("\n").filter(Boolean)
      const firstLine = lines[0] || ""
      const instructions = lines.slice(1).join("\n").replace(/^Instructions:\s*/, "")

      const nameMatch = firstLine.match(/Step\s*\d+:\s*(.*?)(?:\[|$)/)
      const isCritical = firstLine.includes("[Critical Step]")
      const isHold = firstLine.includes("[Hold Point")
      const holdMatch = firstLine.match(/Approver:\s*([^\]]+)/)

      const name = nameMatch ? nameMatch[1].trim() : firstLine
      const holdApprover = holdMatch ? holdMatch[1].trim() : "SME"

      return {
        number: idx + 1,
        phase: idx < 2 ? "Preparation" : idx >= blocks.length - 2 ? "Restoration" : "Execution",
        name,
        instructions,
        critical: isCritical ? "Yes" : "No",
        holdPoint: isHold ? "Yes" : "No",
        holdApprover: isHold ? holdApprover : "—"
      }
    })
  }

  const rawEntries = doc.rawData
    ? Object.entries(doc.rawData).filter(
        ([key]) =>
          ![
            "title",
            "id",
            "collection",
            "status",
            "version",
            "owner",
            "updatedAt",
            "createdAt",
            "docId",
            "docType",
          ].includes(key)
      )
    : []

  const renderStructuredPreview = () => {
    const safetyReqs = getSafetyRequirements()
    const tools = getTools()
    const steps = getSteps()

    if (doc.collection === "/sops") {
      return (
        <CardContent className="space-y-4 p-0">
          <StructureSection label="Identity">
            <StructureField label="name" value={data.name || doc.title} />
            <StructureField label="docType" value="SOP" />
            <StructureField label="status" value={doc.status} />
            <StructureField label="version" value={doc.version} />
            <StructureField label="sopCategory" value={data.sopCategory || "Safety"} />
            <StructureField label="totalTime" value={data.totalTime || "PT45M"} />
          </StructureSection>
          
          <StructureSection label="Ownership">
            <StructureField label="owner.name" value={doc.owner} />
            <StructureField label="creator.name" value={data.creator?.name || data.creator || "System Agent"} />
            <StructureField label="audience.audienceType" value={data.audience?.audienceType || data.audience || "Technician"} />
            <StructureField label="regulatoryReferences" value={data.regulatoryReferences || "OSHA 1910.147"} />
          </StructureSection>

          <StructureSection label="Safety Requirements">
            {safetyReqs.length ? (
              <StructureRow columns={["Type", "Description", "Standard", "Mandatory"]}>
                {safetyReqs.map((req: any, index: number) => (
                  <StructureDataRow key={index} values={[req.type, req.description, req.standard, req.mandatory]} />
                ))}
              </StructureRow>
            ) : (
              <div className="text-xs text-muted-foreground p-3">No safety requirements specified.</div>
            )}
          </StructureSection>

          <StructureSection label="Tools & Supplies">
            {tools.length ? (
              <StructureRow columns={["Type", "Name", "Specification", "Calibration Required"]}>
                {tools.map((t: any, index: number) => (
                  <StructureDataRow key={index} values={[t.type, t.name, t.spec, t.calibration]} />
                ))}
              </StructureRow>
            ) : (
              <div className="text-xs text-muted-foreground p-3">No tools or supplies specified.</div>
            )}
          </StructureSection>

          <StructureSection label="Steps">
            {steps.length ? (
              <StructureRow columns={["Step", "Name", "Critical", "Hold Point", "Hold Approver"]}>
                {steps.map((s: any, index: number) => (
                  <StructureDataRow key={index} values={[String(s.number), s.name, s.critical, s.holdPoint, s.holdApprover]} />
                ))}
              </StructureRow>
            ) : (
              <div className="text-xs text-muted-foreground p-3">No steps specified.</div>
            )}
          </StructureSection>

          <StructureSection label="Completion">
            <StructureField label="verificationMethod" value={data.verificationMethod || "SignOff"} />
            <StructureField label="completionSignOff.requiredRole" value={data.completionSignOff?.requiredRole || "Shift Supervisor"} />
            <StructureField label="dateNextReview" value={data.dateNextReview || "2027-06-22"} />
          </StructureSection>
        </CardContent>
      )
    }

    if (doc.collection === "/mops") {
      return (
        <CardContent className="space-y-4 p-0">
          <StructureSection label="Identity">
            <StructureField label="name" value={data.name || doc.title} />
            <StructureField label="docType" value="MOP" />
            <StructureField label="status" value={doc.status} />
            <StructureField label="version" value={doc.version} />
            <StructureField label="maintenanceType" value={data.maintenanceType || "Preventive"} />
            <StructureField label="totalTime" value={data.totalTime || "PT2H"} />
          </StructureSection>

          <StructureSection label="Ownership">
            <StructureField label="owner.name" value={doc.owner} />
            <StructureField label="creator.name" value={data.creator?.name || data.creator || "System Agent"} />
            <StructureField label="audience.audienceType" value={data.audience?.audienceType || data.audience || "Data Center Technician"} />
            <StructureField label="maintenanceFrequency.interval" value={data.maintenanceFrequency?.interval || "Every 3 months"} />
          </StructureSection>

          <StructureSection label="Equipment under Maintenance">
            <StructureRow columns={["Name", "Manufacturer", "Model", "Asset ID"]}>
              <StructureDataRow values={[data.name || doc.title, data.manufacturer || "Dell", data.model || "PowerEdge R750", data.assetId || "DC-SRV-042"]} />
            </StructureRow>
          </StructureSection>

          <StructureSection label="Safety & energy isolation (LOTO)">
            {safetyReqs.length ? (
              <StructureRow columns={["Energy Type", "Isolation Point", "Isolation Method", "Verification Method"]}>
                {safetyReqs.filter((req: any) => req.type === "LOTO" || req.type === "Isolation").map((req: any, index: number) => (
                  <StructureDataRow key={index} values={[req.type, req.standard || "PDU circuit", req.description, "Verify LEDs off"]} />
                ))}
                {safetyReqs.filter((req: any) => req.type === "LOTO" || req.type === "Isolation").length === 0 && (
                  <StructureDataRow values={["Electrical", "Power Cord / PSU", "Disconnect AC cables", "Verify power light off"]} />
                )}
              </StructureRow>
            ) : (
              <div className="text-xs text-muted-foreground p-3">No isolation steps specified.</div>
            )}
          </StructureSection>

          <StructureSection label="Phased Steps">
            {steps.length ? (
              <StructureRow columns={["Step", "Phase", "Name", "Critical", "Hold Point", "Measured Value"]}>
                {steps.map((s: any, index: number) => (
                  <StructureDataRow key={index} values={[String(s.number), s.phase, s.name, s.critical, s.holdPoint, "—"]} />
                ))}
              </StructureRow>
            ) : (
              <div className="text-xs text-muted-foreground p-3">No steps specified.</div>
            )}
          </StructureSection>

          <StructureSection label="Post-Work Tests">
            <StructureRow columns={["Test", "Method", "Acceptance Criteria"]}>
              <StructureDataRow values={["POST verification", "iDRAC logs", "Zero critical errors"]} />
              <StructureDataRow values={["Operational Baseline", "Sensor check", "Normal temperature values"]} />
            </StructureRow>
          </StructureSection>
        </CardContent>
      )
    }

    // EOP
    return (
      <CardContent className="space-y-4 p-0">
        <StructureSection label="Identity">
          <StructureField label="name" value={data.name || doc.title} />
          <StructureField label="docType" value="EOP" />
          <StructureField label="status" value={doc.status} />
          <StructureField label="version" value={doc.version} />
          <StructureField label="eopType" value={data.eopType || "Emergency"} />
        </StructureSection>

        <StructureSection label="Ownership">
          <StructureField label="owner.name" value={doc.owner} />
          <StructureField label="creator.name" value={data.creator?.name || data.creator || "System Agent"} />
          <StructureField label="audience.audienceType" value={data.audience?.audienceType || data.audience || "Incident Command"} />
        </StructureSection>

        <StructureSection label="Emergency Safety Measures">
          {safetyReqs.length ? (
            <StructureRow columns={["Type", "Description", "Standard", "Mandatory"]}>
              {safetyReqs.map((req: any, index: number) => (
                <StructureDataRow key={index} values={[req.type, req.description, req.standard, req.mandatory]} />
              ))}
            </StructureRow>
          ) : (
            <div className="text-xs text-muted-foreground p-3">No safety measures specified.</div>
          )}
        </StructureSection>

        <StructureSection label="Emergency Steps">
          {steps.length ? (
            <StructureRow columns={["Step", "Action Item", "Critical", "Hold Point", "Hold Approver"]}>
              {steps.map((s: any, index: number) => (
                <StructureDataRow key={index} values={[String(s.number), s.name, s.critical, s.holdPoint, s.holdApprover]} />
              ))}
            </StructureRow>
          ) : (
            <div className="text-xs text-muted-foreground p-3">No steps specified.</div>
          )}
        </StructureSection>

        <StructureSection label="Tools & Emergency Equipment">
          {tools.length ? (
            <StructureRow columns={["Type", "Name", "Specification", "Calibration"]}>
              {tools.map((t: any, index: number) => (
                <StructureDataRow key={index} values={[t.type, t.name, t.spec, t.calibration]} />
              ))}
            </StructureRow>
          ) : (
            <div className="text-xs text-muted-foreground p-3">No resources or equipment specified.</div>
          )}
        </StructureSection>
      </CardContent>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-md animate-in fade-in-0 duration-150">
      <div className="relative w-full max-w-4xl h-[85vh] max-h-[85vh] flex flex-col bg-card border rounded-xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-center justify-between border-b px-6 py-4 bg-muted/20 shrink-0">
          <div>
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <span>{doc.title}</span>
              <Badge variant="outline" className="text-xs uppercase bg-primary/5 text-primary border-primary/20">
                {doc.collection.replace("/", "")}
              </Badge>
              <Badge variant="outline" className="text-xs">
                {doc.status}
              </Badge>
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">Document ID: {doc.id}</p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              onClick={() => handleDownload("markdown")}
              variant="outline"
              size="sm"
              className="h-8 text-xs font-semibold gap-1.5 cursor-pointer hover:bg-accent"
            >
              Download MD
            </Button>
            <Button
              onClick={() => handleDownload("json")}
              variant="outline"
              size="sm"
              className="h-8 text-xs font-semibold gap-1.5 cursor-pointer hover:bg-accent"
            >
              Download JSON
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-8 rounded-md hover:bg-muted cursor-pointer"
              onClick={onClose}
            >
              <X className="size-4" />
            </Button>
          </div>
        </div>

        {/* Tab Selection */}
        <div className="flex items-center border-b bg-muted/5 px-6 py-2 gap-2 shrink-0">
          <Button
            variant={activeTab === "preview" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setActiveTab("preview")}
            className="h-8 text-xs font-medium cursor-pointer"
          >
            Interactive Preview
          </Button>
          <Button
            variant={activeTab === "raw" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setActiveTab("raw")}
            className="h-8 text-xs font-medium cursor-pointer"
          >
            Raw Fields
          </Button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {activeTab === "preview" ? (
            <div className="space-y-4">
              {renderStructuredPreview()}
            </div>
          ) : (
            <div className="space-y-6">
              {/* Metadata Grid */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-4 rounded-lg bg-muted/30 border border-muted/50">
                <div>
                  <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Owner</div>
                  <div className="text-sm font-medium mt-1">{doc.owner}</div>
                </div>
                <div>
                  <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Version</div>
                  <div className="text-sm font-medium mt-1">{doc.version}</div>
                </div>
                <div>
                  <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Last Updated</div>
                  <div className="text-sm font-medium mt-1">{doc.updatedAt}</div>
                </div>
                <div>
                  <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Collection</div>
                  <div className="text-sm font-medium mt-1 uppercase">{doc.collection.replace("/", "")}</div>
                </div>
              </div>

              {/* Raw Fields */}
              <div className="space-y-4">
                {rawEntries.map(([key, val]) => {
                  const label = formatLabel(key)
                  let displayVal = String(val)

                  if (typeof val === "object" && val !== null) {
                    displayVal = JSON.stringify(val, null, 2)
                  }

                  return (
                    <div key={key} className="space-y-2">
                      <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                        {label}
                      </h3>
                      <pre className="font-mono text-xs bg-muted/50 border rounded-lg p-4 whitespace-pre-wrap break-all max-h-[300px] overflow-y-auto">
                        {displayVal}
                      </pre>
                    </div>
                  )
                })}

                {rawEntries.length === 0 && (
                  <div className="text-sm text-muted-foreground text-center py-8">
                    No additional raw data available.
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
