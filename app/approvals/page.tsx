import { ApprovalQueueCard } from "@/components/approval/approval-queue-card";

export default function ApprovalsPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Approvals</h1>
      <p className="text-sm text-muted-foreground">
        Demo step: approve one high-priority case to move it into payment processing.
      </p>
      <ApprovalQueueCard />
    </div>
  );
}

