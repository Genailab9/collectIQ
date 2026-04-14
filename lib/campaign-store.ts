export function computePriority(input: {
  amountCents: number;
  overdueDays?: number;
  pastBehaviorScore?: number;
}): { score: number; label: "HIGH" | "MEDIUM" | "LOW" } {
  const amountScore = Math.min(60, Math.max(0, input.amountCents / 2000));
  const overdueScore = Math.min(25, Math.max(0, (input.overdueDays ?? 0) * 1.2));
  const behaviorScore = Math.min(15, Math.max(0, input.pastBehaviorScore ?? 0));
  const score = Math.round(amountScore + overdueScore + behaviorScore);
  if (score >= 65) return { score, label: "HIGH" };
  if (score >= 35) return { score, label: "MEDIUM" };
  return { score, label: "LOW" };
}

