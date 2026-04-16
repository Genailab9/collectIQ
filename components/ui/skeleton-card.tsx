import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function SkeletonCard({ className }: { className?: string }) {
  return (
    <Card className={cn("shimmer", className)}>
      <CardContent className="space-y-2 py-4">
        <div className="h-4 w-2/5 rounded bg-muted/60" />
        <div className="h-3 w-full rounded bg-muted/60" />
        <div className="h-3 w-3/4 rounded bg-muted/60" />
      </CardContent>
    </Card>
  );
}
