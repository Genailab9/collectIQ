"use client";

import { useQuery } from "@tanstack/react-query";

export type AuthUser = {
  username: string;
  role: "admin" | "operator";
};

export function useAuthUser() {
  return useQuery({
    queryKey: ["auth-user"],
    queryFn: async (): Promise<AuthUser> => {
      const res = await fetch("/api/auth/me", { cache: "no-store" });
      if (!res.ok) {
        throw new Error("Unable to resolve session.");
      }
      return (await res.json()) as AuthUser;
    },
    retry: false,
  });
}

