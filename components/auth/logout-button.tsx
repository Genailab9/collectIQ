"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { logoutCollectiq } from "@/lib/api-client";

export function LogoutButton() {
  const router = useRouter();
  return (
    <Button
      size="sm"
      variant="outline"
      onClick={async () => {
        await logoutCollectiq();
        router.replace("/login");
      }}
    >
      Logout
    </Button>
  );
}

