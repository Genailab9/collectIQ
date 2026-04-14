import { ApprovalQueueCard } from "@/components/approval/approval-queue-card";

export default function ApprovalsPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Approvals</h1>
      <ApprovalQueueCard />
    </div>
  );
}

