import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function ExecutionSummary({ correlationId }: { correlationId: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Execution Summary</CardTitle>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">
        Correlation ID: <span className="font-mono text-foreground">{correlationId}</span>
      </CardContent>
    </Card>
  );
}

