import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { labelState } from "@/lib/state-copy";

function variantForState(state: string) {
  if (state === "COMPLETED" || state === "SUCCESS" || state === "APPROVED") {
    return "default" as const;
  }
  if (state === "FAILED" || state === "REJECTED") {
    return "destructive" as const;
  }
  return "secondary" as const;
}

export function MachineStateCard(props: {
  machine: "CALL" | "APPROVAL" | "PAYMENT" | "SYNC";
  state: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{props.machine}</CardTitle>
      </CardHeader>
      <CardContent className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">Current state</span>
        <Badge variant={variantForState(props.state)}>{labelState(props.state)}</Badge>
      </CardContent>
    </Card>
  );
}

