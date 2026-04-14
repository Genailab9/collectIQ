import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function TraceLoading() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Loading Trace</CardTitle>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">
        Fetching observability events...
      </CardContent>
    </Card>
  );
}

