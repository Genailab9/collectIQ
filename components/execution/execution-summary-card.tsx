import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function ExecutionSummaryCard(props: {
  correlationId: string;
  progressPercent: number;
  transitionCount: number;
  errorCount: number;
  lastUpdatedAt: string | null;
}) {
  const pct = Math.max(0, Math.min(100, Math.round(props.progressPercent)));
  return (
    <Card>
      <CardHeader>
        <CardTitle>Execution Summary</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="text-sm text-muted-foreground">
          Correlation ID: <span className="font-mono text-foreground">{props.correlationId}</span>
        </div>
        <div className="h-2 w-full rounded-full bg-muted">
          <div
            className="h-2 rounded-full bg-primary transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div className="text-muted-foreground">Progress</div>
          <div className="font-medium text-right">{pct}%</div>
          <div className="text-muted-foreground">Transitions</div>
          <div className="font-medium text-right">{props.transitionCount}</div>
          <div className="text-muted-foreground">Errors</div>
          <div className="font-medium text-right">{props.errorCount}</div>
          <div className="text-muted-foreground">Last update</div>
          <div className="font-medium text-right">
            {props.lastUpdatedAt ? new Date(props.lastUpdatedAt).toLocaleTimeString() : "n/a"}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

