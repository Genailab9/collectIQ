const STATE_LABELS: Record<string, string> = {
  SUCCESS: "Payment Completed",
  FAILED: "Payment Failed",
  PROCESSING: "Processing Payment",
  INITIATED: "Payment Initiated",
  WAITING_APPROVAL: "Waiting Approval",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  PENDING: "Pending Review",
  REQUESTED: "Approval Requested",
  ESCALATED: "Escalated",
  COMPLETED: "Completed",
  AUTHENTICATED: "Authenticated",
  NEGOTIATING: "Negotiating",
  NOT_STARTED: "Not Started",
};

export function labelState(raw: string | null | undefined): string {
  if (!raw) {
    return "—";
  }
  const key = raw.trim().toUpperCase();
  return STATE_LABELS[key] ?? raw;
}

export function stateTone(raw: string | null | undefined): "success" | "warning" | "error" | "neutral" {
  const key = (raw ?? "").trim().toUpperCase();
  if (["SUCCESS", "APPROVED", "COMPLETED"].includes(key)) {
    return "success";
  }
  if (["FAILED", "REJECTED", "DISPUTED"].includes(key)) {
    return "error";
  }
  if (["PROCESSING", "PENDING", "WAITING_APPROVAL", "ESCALATED", "INITIATED"].includes(key)) {
    return "warning";
  }
  return "neutral";
}
