"use client";

import { useQuery } from "@tanstack/react-query";
import { getAuthUser, type AuthUser } from "@/lib/api-client";

export function useAuthUser() {
  return useQuery({
    queryKey: ["auth-user"],
    queryFn: async (): Promise<AuthUser> => getAuthUser(),
    retry: false,
  });
}

