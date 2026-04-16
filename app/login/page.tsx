"use client";

import { FormEvent, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { loginCollectiq } from "@/lib/api-client";

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const search = useSearchParams();

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await loginCollectiq(username, password);
      const next = search.get("next") || "/dashboard";
      router.replace(next);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md items-center px-6">
      <Card className="w-full">
        <CardHeader>
          <CardTitle>CollectIQ Login</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <form className="space-y-3" onSubmit={onSubmit}>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Username"
              className="h-10 w-full rounded-md border bg-background px-3 text-sm"
            />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              className="h-10 w-full rounded-md border bg-background px-3 text-sm"
            />
            <Button type="submit" disabled={loading || !username.trim() || !password.trim()} className="w-full">
              {loading ? "Signing in..." : "Sign in"}
            </Button>
          </form>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <p className="text-xs text-muted-foreground">Use credentials configured via server environment variables.</p>
        </CardContent>
      </Card>
    </div>
  );
}

