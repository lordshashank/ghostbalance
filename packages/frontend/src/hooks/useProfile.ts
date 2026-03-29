import {
  useQuery,
  useMutation,
  useInfiniteQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import type { Profile, CursorPage } from "@/lib/types";
import { useAuth } from "@/providers/AuthProvider";
import { useToast } from "@/providers/ToastProvider";

export function useProfile(nullifier: string | null | undefined) {
  return useQuery<Profile>({
    queryKey: ["profile", nullifier],
    queryFn: () => apiFetch<Profile>(`/profiles/${nullifier}`),
    enabled: !!nullifier,
  });
}

export function useMyProfile() {
  const { user, isLoading } = useAuth();
  return { profile: user, isLoading };
}

export function useUpdateProfile() {
  const queryClient = useQueryClient();
  const { toastError } = useToast();

  return useMutation({
    mutationFn: (data: Partial<Profile>) =>
      apiFetch<Profile>("/profiles", {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["auth", "me"] });
    },
    onError: (err: Error) => {
      toastError(err.message);
    },
  });
}

export function useSuggestedUsers(limit = 5) {
  const { isAuthenticated } = useAuth();

  return useQuery<Profile[]>({
    queryKey: ["profiles", "suggested", limit],
    queryFn: async () => {
      const res = await apiFetch<{ data: Profile[] }>(`/profiles/suggested?limit=${limit}`);
      return res.data;
    },
    enabled: isAuthenticated,
  });
}

export function useFollowers(nullifier: string) {
  return useInfiniteQuery<CursorPage<Profile>>({
    queryKey: ["profile", nullifier, "followers"],
    queryFn: ({ pageParam }) =>
      apiFetch<CursorPage<Profile>>(`/profiles/${nullifier}/followers`, {
        params: {
          ...(pageParam ? { cursor: pageParam as string } : {}),
        },
      }),
    getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
    initialPageParam: null as string | null,
  });
}

export function useFollowing(nullifier: string) {
  return useInfiniteQuery<CursorPage<Profile>>({
    queryKey: ["profile", nullifier, "following"],
    queryFn: ({ pageParam }) =>
      apiFetch<CursorPage<Profile>>(`/profiles/${nullifier}/following`, {
        params: {
          ...(pageParam ? { cursor: pageParam as string } : {}),
        },
      }),
    getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
    initialPageParam: null as string | null,
  });
}
