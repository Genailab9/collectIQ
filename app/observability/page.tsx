import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export default function ObservabilityPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Observability</h1>
      <Card>
        <CardHeader>
          <CardTitle>Trace Viewer Route</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>Open a specific correlation trace at:</p>
          <p className="font-mono text-foreground">/observability/[correlationId]</p>
          <Link href="/observability/sample-correlation-id" className="inline-block">
            <Button variant="secondary" size="sm">Open sample trace viewer</Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}

