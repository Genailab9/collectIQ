"use client";

import { CheckCircle2 } from "lucide-react";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { labelState } from "@/lib/state-copy";

const PHASES = ["DATA", "CALL", "APPROVAL", "PAYMENT", "SYNC"] as const;

export type ExecutionJourneyState = "active" | "CASE_CLOSED";

export function deriveJourneyState(machineStates: Record<string, string>): ExecutionJourneyState {
  const account = machineStates.ACCOUNT ?? "";
  const sync = machineStates.SYNC ?? "";
  if (account === "CLOSED" || sync === "COMPLETED") {
    return "CASE_CLOSED";
  }
  return "active";
}

export function ExecutionJourneyTimeline({
  machineStates,
  latestPhase,
}: {
  machineStates: Record<string, string>;
  latestPhase: string;
}) {
  const journey = deriveJourneyState(machineStates);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Execution journey</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-2 md:grid-cols-6">
        {PHASES.map((phase, idx) => (
          <motion.div
            key={phase}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2, ease: "easeOut", delay: idx * 0.03 }}
            className={`rounded-md border p-2 text-sm transition-saas ${latestPhase === phase ? "border-primary bg-primary/5 shadow-sm" : ""}`}
          >
            <div className="text-xs text-muted-foreground">{phase}</div>
            <div className="font-medium">{labelState(machineStates[phase] ?? "NOT_STARTED")}</div>
          </motion.div>
        ))}
        <motion.div
          key="case-closed"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2, ease: "easeOut", delay: PHASES.length * 0.03 }}
          className={`rounded-md border p-2 text-sm transition-saas ${
            journey === "CASE_CLOSED" ? "border-emerald-500/50 bg-emerald-500/10 shadow-sm" : "opacity-60"
          }`}
        >
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            {journey === "CASE_CLOSED" ? <CheckCircle2 className="size-3 text-emerald-600" /> : null}
            <span>Outcome</span>
          </div>
          <div className="font-medium">{journey === "CASE_CLOSED" ? "✔ Case closed" : "Pending closure"}</div>
        </motion.div>
      </CardContent>
    </Card>
  );
}
