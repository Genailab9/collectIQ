import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function AppLoading() {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Loading</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Preparing page content...
        </CardContent>
      </Card>
    </div>
  );
}

