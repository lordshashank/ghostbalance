"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { AppLayout } from "@/components/AppLayout";
import { ComposeBox } from "@/components/ComposeBox";
import { Icon } from "@/components/Icon";
import { ImageDisplay } from "@/components/ImageDisplay";
import { PostItem } from "@/components/PostItem";
import type { Post as BackendPost } from "@/lib/types";
import { formatBalance } from "@/lib/format";
import { useAuth } from "@/hooks/useAuth";
import { useFeed, useTrendingFeed } from "@/hooks/useFeed";
import { useCreatePost } from "@/hooks/usePost";
import { useSuggestedUsers } from "@/hooks/useProfile";
import { useLeaderboard } from "@/hooks/useLeaderboard";
import { useFollow } from "@/hooks/useSocial";
import { getTierName } from "@/lib/tiers";
import { weiToEth } from "@/lib/format";

function FeedRightSidebar() {
  const { isAuthenticated } = useAuth();
  const suggested = useSuggestedUsers();
  const leaderboard = useLeaderboard("balance");
  const follow = useFollow();

  const leaderboardAll =
    leaderboard.data?.pages?.flatMap((p) => p.data) ?? [];
  const leaderboardEntries = leaderboardAll.slice(0, 2);

  const whoToFollow = isAuthenticated
    ? (suggested.data ?? [])
    : leaderboardAll.slice(0, 3);
  const whoToFollowLoading = isAuthenticated
    ? suggested.isLoading
    : leaderboard.isLoading;

  return (
    <>
      {/* Who to Follow */}
      <section className="glass-panel p-6">
        <h3 className="font-bold text-lg mb-6 tracking-tight text-primary matrix-glow">
          Who to Follow
        </h3>
        <div className="space-y-4">
          {whoToFollowLoading && (
            <p className="text-xs font-mono text-on-surface-variant/60">
              Loading...
            </p>
          )}
          {!whoToFollowLoading && whoToFollow.length === 0 && (
            <p className="text-xs font-mono text-on-surface-variant/60">
              No suggestions right now
            </p>
          )}
          {whoToFollow.map((u) => (
            <div
              key={u.nullifier}
              className="flex items-center justify-between group"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-primary/10 border border-outline flex items-center justify-center overflow-hidden">
                  {u.avatar_key ? (
                    <ImageDisplay
                      uploadKey={u.avatar_key}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <Icon
                      name="person"
                      className="text-on-surface-variant/60 text-sm"
                    />
                  )}
                </div>
                <p className="text-sm font-bold text-primary matrix-glow">
                  {formatBalance(u.public_balance)}
                </p>
              </div>
              <button
                onClick={() => follow.mutate(u.nullifier)}
                className="px-4 py-1 border border-primary text-[10px] font-bold text-primary hover:bg-primary/10 transition-colors"
              >
                SYNC
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* Leaderboard Preview */}
      <section className="glass-panel p-6 relative overflow-hidden">
        <div className="absolute top-0 left-0 w-full h-0.5 bg-primary" />
        <h3 className="font-bold text-lg mb-6 tracking-tight text-primary matrix-glow">
          GHOST_LEADERBOARD
        </h3>
        <div className="space-y-4 font-mono">
          {leaderboardEntries.map((e, i) => (
            <div
              key={e.nullifier}
              className={`flex items-center gap-4 p-3 border ${
                i === 0
                  ? "bg-primary/10 border-outline"
                  : "border-outline/50 hover:border-outline"
              }`}
            >
              <span
                className={`text-lg font-bold ${
                  i === 0
                    ? "text-primary matrix-glow"
                    : "text-on-surface-variant/60"
                }`}
              >
                {String(i + 1).padStart(2, "0")}
              </span>
              <div className="flex-1">
                <p className="text-sm font-bold text-primary">
                  {formatBalance(e.public_balance)}
                </p>
                <p className="text-[10px] text-on-surface-variant/60 tracking-widest uppercase">
                  CLASS: {getTierName(weiToEth(e.public_balance))}
                </p>
              </div>
              <span className="text-xs text-primary-glow font-mono">
                {e.post_count} posts
              </span>
            </div>
          ))}
          {leaderboard.isLoading && (
            <p className="text-xs text-on-surface-variant/60">Loading...</p>
          )}
        </div>
        <Link
          href="/leaderboard"
          className="block mt-4 text-center text-[10px] font-mono uppercase tracking-widest text-primary hover:text-primary-glow transition-colors"
        >
          VIEW FULL LEADERBOARD
        </Link>
      </section>

      {/* Footer */}
      <footer className="mt-8 px-4 font-mono text-[10px] text-on-surface-variant/50 uppercase">
        <p>&copy; 2026 ghostbalance.chat</p>
      </footer>
    </>
  );
}

function HomeInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const feedType = (searchParams.get("feed") as "latest" | "following" | "trending") || "latest";
  const setFeedType = (type: string) => {
    router.replace(type === "latest" ? "/" : `/?feed=${type}`, { scroll: false });
  };
  const { user, isAuthenticated } = useAuth();
  const createPost = useCreatePost();

  const feed = useFeed({
    type: feedType === "trending" ? "latest" : feedType,
  });
  const trending = useTrendingFeed({});

  const isTrending = feedType === "trending";
  const activeFeed = isTrending ? trending : feed;

  const posts: BackendPost[] = isTrending
    ? (trending.data?.pages?.flatMap((p) => p.data) ?? [])
    : (feed.data?.pages?.flatMap((p) => p.data) ?? []);

  const hasNextPage = isTrending
    ? trending.hasNextPage
    : feed.hasNextPage;

  const fetchNextPage = isTrending
    ? trending.fetchNextPage
    : feed.fetchNextPage;

  const isFetchingNextPage = isTrending
    ? trending.isFetchingNextPage
    : feed.isFetchingNextPage;

  const tabs: { label: string; value: "latest" | "following" | "trending" }[] =
    [
      { label: "Latest", value: "latest" },
      { label: "Trending", value: "trending" },
      { label: "Following", value: "following" },
    ];

  return (
    <AppLayout rightSidebar={<FeedRightSidebar />}>
      {/* Feed Header */}
      <header className="sticky top-0 z-50 bg-background/80 backdrop-blur-xl border-b border-outline h-16 flex items-center px-4">
        <div className="flex w-full justify-around text-xs uppercase tracking-widest font-mono">
          {tabs.map((tab) => (
            <button
              key={tab.value}
              onClick={() => setFeedType(tab.value)}
              className={
                feedType === tab.value
                  ? "text-primary border-b-2 border-primary pb-2 font-bold matrix-glow"
                  : "text-on-surface-variant/60 hover:text-primary transition-opacity pb-2"
              }
            >
              {tab.label}
            </button>
          ))}
        </div>
      </header>

      {/* Compose Box */}
      <div className="p-6 border-b border-outline bg-background">
        {isAuthenticated ? (
          <ComposeBox
            avatarKey={user?.avatar_key}
            onSubmit={async (body, attachments) => {
              await createPost.mutateAsync({
                body,
                attachments: attachments.length > 0 ? attachments : undefined,
              });
            }}
          />
        ) : (
          <div className="flex items-center h-12 py-2 ml-16">
            <p className="text-sm font-mono text-on-surface-variant/60">
              <Link
                href="/profile"
                className="text-primary hover:text-primary-glow transition-colors"
              >
                Verify your balance
              </Link>{" "}
              to post
            </p>
          </div>
        )}
      </div>

      {/* Feed Posts */}
      <div className="divide-y divide-outline/50">
        {activeFeed.isLoading && (
          <div className="p-12 text-center">
            <p className="text-sm font-mono text-on-surface-variant/60">
              Loading...
            </p>
          </div>
        )}

        {!activeFeed.isLoading && posts.length === 0 && (
          <div className="p-12 text-center">
            <Icon
              name="feed"
              className="text-4xl text-on-surface-variant/30 mb-4"
            />
            <p className="text-sm font-mono text-on-surface-variant/60">
              {feedType === "following"
                ? "Follow someone to see their posts here"
                : "No posts yet"}
            </p>
          </div>
        )}

        {posts.map((post) => (
          <PostItem key={post.id} post={post} />
        ))}
      </div>

      {/* Load More */}
      {hasNextPage && (
        <div className="p-6 text-center border-t border-outline">
          <button
            onClick={() => fetchNextPage()}
            disabled={isFetchingNextPage}
            className="px-8 py-2 border border-primary text-primary text-xs font-bold font-mono uppercase tracking-widest hover:bg-primary/10 transition-colors disabled:opacity-40"
          >
            {isFetchingNextPage ? "LOADING..." : "LOAD MORE"}
          </button>
        </div>
      )}
    </AppLayout>
  );
}

export default function Home() {
  return (
    <Suspense fallback={null}>
      <HomeInner />
    </Suspense>
  );
}
