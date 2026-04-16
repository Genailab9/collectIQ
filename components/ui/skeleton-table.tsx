import { cn } from "@/lib/utils";

export function SkeletonTable({ rows = 4, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn("space-y-2", className)}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="shimmer h-11 rounded-md border bg-muted/40" />
      ))}
    </div>
  );
}
