import {
  ArrowRight,
  CheckCircle2,
  Clock3,
  CreditCard,
  Phone,
  RefreshCw,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { motion } from "framer-motion";
import type { ExecutionTrace } from "@/lib/api-client";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { labelState } from "@/lib/state-copy";

function machineColor(machine: string): string {
  if (machine === "CALL") return "bg-blue-500";
  if (machine === "APPROVAL") return "bg-amber-500";
  if (machine === "PAYMENT") return "bg-emerald-500";
  if (machine === "SYNC") return "bg-violet-500";
  return "bg-slate-500";
}

function machineIcon(machine: string) {
  if (machine === "CALL") return <Phone className="size-3" />;
  if (machine === "APPROVAL") return <ShieldCheck className="size-3" />;
  if (machine === "PAYMENT") return <CreditCard className="size-3" />;
  if (machine === "SYNC") return <RefreshCw className="size-3" />;
  return <ArrowRight className="size-3" />;
}

function stateIcon(to: string) {
  if (to.includes("SUCCESS") || to.includes("COMPLETED") || to.includes("APPROVED")) {
    return <CheckCircle2 className="size-4 text-emerald-500" />;
  }
  if (to.includes("FAILED") || to.includes("REJECTED")) {
    return <XCircle className="size-4 text-red-500" />;
  }
  return <Clock3 className="size-4 text-amber-500" />;
}

function prettyMetadata(metadataJson: string | null): string {
  if (!metadataJson) return "n/a";
  try {
    const parsed = JSON.parse(metadataJson) as unknown;
    return JSON.stringify(parsed, null, 2);
  } catch {
    return metadataJson;
  }
}

export function TimelinePanel({ trace }: { trace?: ExecutionTrace | null }) {
  const transitions = trace?.transitions ?? [];
  return (
    <Card>
      <CardHeader>
        <CardTitle>Execution Timeline</CardTitle>
      </CardHeader>
      <CardContent>
        {transitions.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No transitions yet. Load a correlationId to view audit timeline.
          </p>
        ) : (
          <div className="relative pl-6">
            <div className="absolute left-[9px] top-0 h-full w-px bg-border" />
            <div className="space-y-4">
              {transitions.map((t, idx) => {
                const latest = idx === transitions.length - 1;
                return (
                <motion.div
                  key={`${t.occurredAt}-${idx}`}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.2, ease: "easeOut", delay: Math.min(idx * 0.02, 0.2) }}
                  className={`relative rounded-lg border p-3 transition-saas ${latest ? "border-primary/40 bg-primary/5" : ""}`}
                >
                  <div
                    className={`absolute -left-[17px] top-4 h-3 w-3 rounded-full ${machineColor(t.machine)}`}
                  />
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <Badge variant="secondary" className="gap-1">
                      {machineIcon(t.machine)}
                      {t.machine}
                    </Badge>
                    <div className="flex items-center gap-1 text-sm font-medium">
                      {stateIcon(t.to)}
                      <span>{labelState(t.from)}</span>
                      <ArrowRight className="size-3 text-muted-foreground" />
                      <span>{labelState(t.to)}</span>
                    </div>
                  </div>
                  <div className="grid gap-2 text-xs text-muted-foreground md:grid-cols-2">
                    <div>
                      <span className="font-medium text-foreground">Timestamp: </span>
                      {new Date(t.occurredAt).toLocaleString()}
                    </div>
                    <div>
                      <span className="font-medium text-foreground">Actor: </span>
                      {t.actor ?? "n/a"}
                    </div>
                  </div>
                  <pre className="mt-2 overflow-x-auto rounded bg-muted p-2 text-xs">
                    {prettyMetadata(t.metadataJson)}
                  </pre>
                </motion.div>
              )})}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

