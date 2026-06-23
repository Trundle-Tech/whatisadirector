import * as React from "react";
import { 
  BotIcon, 
  SparklesIcon, 
  ShieldAlertIcon, 
  SendIcon, 
  LightbulbIcon,
  CheckCircle2Icon
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface ReviewerAssistantProps {
  documentId?: string;
  documentTitle?: string;
  documentType?: "SOP" | "MOP" | "EOP";
  documentContent?: any;
  onApplyFieldUpdate?: (fieldPath: string, newValue: any) => void;
  availableFields?: string[];
}

interface AssistantMsg {
  role: "user" | "assistant";
  content: string;
}

function AssistantMessage({
  msg,
  availableFields,
  onApply,
}: {
  msg: AssistantMsg
  availableFields?: string[]
  onApply?: (field: string, text: string) => void
}) {
  const [selectedField, setSelectedField] = React.useState("")

  React.useEffect(() => {
    if (availableFields && availableFields.length > 0) {
      // Find a good default field, or take the first one
      const defaultField = availableFields.find(f => f.toLowerCase().includes("steps") || f.toLowerCase().includes("safety")) || availableFields[0];
      setSelectedField(defaultField);
    }
  }, [availableFields])

  return (
    <div className="flex gap-2.5 max-w-[90%] mr-auto">
      <div className="size-6 rounded-full shrink-0 flex items-center justify-center border text-[9px] bg-primary/10 border-primary/20 text-primary">
        <BotIcon className="size-3" />
      </div>
      <div className="rounded-lg p-3 text-xs leading-relaxed shadow-sm bg-muted/60 border border-border text-foreground rounded-tl-none space-y-2">
        <div className="whitespace-pre-wrap">{msg.content}</div>
        
        {availableFields && availableFields.length > 0 && onApply && (
          <div className="mt-3 pt-2.5 border-t border-border flex flex-col sm:flex-row sm:items-center gap-2">
            <span className="text-[10px] text-muted-foreground font-medium whitespace-nowrap">Apply suggestion to:</span>
            <div className="flex items-center gap-1.5 w-full">
              <select
                value={selectedField}
                onChange={(e) => setSelectedField(e.target.value)}
                className="bg-background border border-input rounded px-2 py-0.5 text-[10px] text-foreground outline-none focus-visible:ring-1 focus-visible:ring-primary flex-1 min-w-0"
              >
                {availableFields.map((field) => (
                  <option key={field} value={field}>
                    {field}
                  </option>
                ))}
              </select>
              <Button
                size="sm"
                onClick={() => onApply(selectedField, msg.content)}
                className="h-6 text-[10px] bg-primary hover:bg-primary/95 text-primary-foreground px-2 py-0 cursor-pointer shadow-sm flex items-center gap-1 shrink-0"
              >
                <CheckCircle2Icon className="size-3" />
                Apply
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export function ReviewerAssistant({ 
  documentId = "DOC-STAGE-001",
  documentTitle = "Dell R750 Server Initialization MOP",
  documentType = "MOP",
  documentContent,
  onApplyFieldUpdate,
  availableFields
}: ReviewerAssistantProps) {
  const [messages, setMessages] = React.useState<AssistantMsg[]>([]);
  const [inputText, setInputText] = React.useState<string>("");
  const [loading, setLoading] = React.useState<boolean>(false);
  const [streamText, setStreamText] = React.useState<string>("");
  const [connected, setConnected] = React.useState<boolean>(true);

  React.useEffect(() => {
    if (window.vertex && typeof window.vertex.chat === "function") {
      setConnected(true);
    } else {
      setConnected(false);
    }
  }, []);

  const sendQuery = async (queryText: string) => {
    if (!queryText.trim() || loading) return;

    // Inject document context in system prompt
    const docContextPrompt = `You are an AI assistant helping a reviewer verify a staged operational document of type "${documentType}" titled "${documentTitle}".
Active Document Content (JSON):
${JSON.stringify(documentContent || { title: documentTitle, type: documentType, steps: ["1. Verify power", "2. Mount chassis", "3. Power on and monitor"] }, null, 2)}

Provide clear, brief suggestions. If asked to rewrite a step or requirement, output the exact proposed text.`;

    const userMsg: AssistantMsg = { role: "user", content: queryText };
    const updatedMessages = [...messages, userMsg];
    
    setMessages(updatedMessages);
    setInputText("");
    setLoading(true);
    setStreamText("");

    const systemMsg = { role: "system", content: docContextPrompt };
    const chatPayload = [systemMsg, ...updatedMessages].map(m => ({ role: m.role, content: m.content }));

    try {
      const responseText = await window.vertex.chat(chatPayload);
      setMessages(prev => [...prev, { role: "assistant", content: responseText }]);
    } catch (e: any) {
      setMessages(prev => [...prev, { role: "assistant", content: `⚠️ Vertex Error: ${e.message || e}` }]);
    } finally {
      setLoading(false);
    }
  };

  const handleAuditSafety = () => {
    sendQuery("Analyze the proposed document steps for energy isolation (LOTO) or safety issues. Highlight any missing precautions.");
  };

  const handleResolveGaps = () => {
    sendQuery("Review the document structure and suggest entries for any missing fields or gap areas.");
  };

  return (
    <div className="flex flex-col h-full bg-card w-full shadow-sm backdrop-blur-md">
      
      {/* Header */}
      <div className="p-4 border-b border-border flex flex-col gap-1.5 shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <SparklesIcon className="size-4.5 text-primary" />
            <h3 className="text-sm font-bold text-foreground">Reviewer Assistant</h3>
          </div>
          {connected ? (
            <Badge variant="outline" className="border-emerald-500/30 text-emerald-600 bg-emerald-500/5 text-[10px] py-0 px-2 h-5 font-semibold">
              Vertex AI
            </Badge>
          ) : (
            <Badge variant="outline" className="border-rose-500/30 text-rose-600 bg-rose-500/5 text-[10px] py-0 px-2 h-5 font-semibold">
              Offline
            </Badge>
          )}
        </div>
        <p className="text-[11px] text-muted-foreground leading-normal">
          AI companion analyzing staged package **{documentId}**.
        </p>
      </div>

      {/* Quick Actions Panel */}
      <div className="p-3 border-b border-border bg-muted/20 grid grid-cols-2 gap-2 shrink-0">
        <Button 
          variant="outline" 
          onClick={handleAuditSafety}
          disabled={!connected || loading}
          className="h-8 text-[10px] border-border hover:bg-muted text-muted-foreground hover:text-foreground font-semibold cursor-pointer"
        >
          <ShieldAlertIcon className="size-3.5 mr-1.5 text-amber-500" />
          Audit Safety
        </Button>
        
        <Button 
          variant="outline" 
          onClick={handleResolveGaps}
          disabled={!connected || loading}
          className="h-8 text-[10px] border-border hover:bg-muted text-muted-foreground hover:text-foreground font-semibold cursor-pointer"
        >
          <LightbulbIcon className="size-3.5 mr-1.5 text-indigo-500" />
          Suggest Gap Fixes
        </Button>
      </div>

      {/* Chat Area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 min-h-0 scrollbar-thin">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-4 text-muted-foreground space-y-3">
            <BotIcon className="size-8 text-muted-foreground/60 animate-pulse" />
            <div className="max-w-[200px]">
              <p className="text-[11px] leading-relaxed">
                Click one of the audit options above, or ask me directly to rewrite steps or verify credentials.
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {messages.map((msg, i) => {
              if (msg.role === "user") {
                return (
                  <div key={i} className="flex gap-2 max-w-[90%] ml-auto flex-row-reverse">
                    <div className="size-6 rounded-full shrink-0 flex items-center justify-center border text-[9px] bg-primary/10 border-primary/20 text-primary">
                      U
                    </div>
                    <div className="rounded-lg p-2.5 text-xs leading-relaxed shadow-sm bg-primary text-primary-foreground rounded-tr-none">
                      <div className="whitespace-pre-wrap">{msg.content}</div>
                    </div>
                  </div>
                )
              } else {
                return (
                  <AssistantMessage
                    key={i}
                    msg={msg}
                    availableFields={availableFields}
                    onApply={onApplyFieldUpdate}
                  />
                )
              }
            })}

            {/* Stream */}
            {streamText && (
              <div className="flex gap-2 max-w-[90%] mr-auto">
                <div className="size-6 rounded-full bg-primary/10 border border-primary/20 text-primary flex items-center justify-center shrink-0">
                  <BotIcon className="size-3" />
                </div>
                <div className="bg-muted/60 border border-border rounded-lg rounded-tl-none p-2.5 text-xs text-foreground leading-relaxed shadow-sm">
                  <div className="whitespace-pre-wrap">{streamText}</div>
                  <span className="inline-block size-1.5 rounded-full bg-primary animate-ping ml-0.5" />
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Input */}
      <div className="p-3 border-t border-border bg-muted/10">
        <form 
          onSubmit={(e: React.FormEvent) => {
            e.preventDefault();
            sendQuery(inputText);
          }}
          className="flex gap-2 items-end"
        >
          <textarea 
            value={inputText}
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setInputText(e.target.value)}
            disabled={!connected || loading}
            placeholder="Ask AI reviewer..."
            className="flex-1 bg-background border border-input rounded-lg text-xs focus-visible:ring-1 focus-visible:ring-primary min-h-8 max-h-24 py-1.5 px-2.5 resize-none h-8 text-foreground"
            onKeyDown={(e: React.KeyboardEvent<HTMLTextAreaElement>) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                sendQuery(inputText);
              }
            }}
          />
          <Button 
            type="submit" 
            size="icon"
            disabled={!connected || loading || !inputText.trim()}
            className="bg-primary hover:bg-primary/90 text-primary-foreground size-8 rounded-lg shadow shrink-0 cursor-pointer"
          >
            <SendIcon className="size-3.5" />
          </Button>
        </form>
      </div>

    </div>
  );
}
