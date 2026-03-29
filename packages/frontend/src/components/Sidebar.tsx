"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "./Icon";
import { useAuth } from "@/hooks/useAuth";
import { useUnreadCount } from "@/hooks/useNotifications";
import { useUnreadConversationsCount } from "@/hooks/useConversations";
import { formatBalance, weiToEth } from "@/lib/format";
import { getTierName } from "@/lib/tiers";

const NAV_ITEMS = [
  { href: "/", icon: "home", label: "Home" },
  { href: "/notifications", icon: "notifications", label: "Notifications" },
  { href: "/conversations", icon: "chat", label: "Messages" },
  { href: "/profile", icon: "person", label: "Profile" },
  { href: "/leaderboard", icon: "leaderboard", label: "Leaderboard" },
  { href: "/bookmarks", icon: "bookmark", label: "Bookmarks" },
  { href: "/about", icon: "info", label: "About" },
  { href: "/settings", icon: "settings", label: "Settings" },
];

export function Sidebar() {
  const pathname = usePathname();
  const { user, isAuthenticated } = useAuth();
  const { data: unread } = useUnreadCount();
  const { data: unreadConversations } = useUnreadConversationsCount();

  return (
    <aside className="hidden md:flex md:w-[72px] lg:w-[280px] h-screen sticky top-0 border-r border-outline flex-col py-8 md:px-2 lg:px-6 md:items-center lg:items-stretch bg-background z-50 shrink-0">
      {/* Logo */}
      <Link href="/" className="flex items-center gap-2 mb-10 md:justify-center lg:justify-start">
        <Icon name="terminal" filled className="text-primary text-3xl" />
        <span className="hidden lg:inline text-2xl font-bold tracking-tighter text-primary matrix-glow">
          GhostBalance
        </span>
      </Link>

      {/* Navigation */}
      <nav className="flex-1 space-y-1">
        {NAV_ITEMS.map((item) => {
          const isActive = item.href === "/"
            ? pathname === "/"
            : pathname.startsWith(item.href);

          const badgeCount =
            item.href === "/notifications" ? unread?.count :
            item.href === "/conversations" ? unreadConversations?.count :
            0;

          return (
            <Link
              key={item.href}
              href={item.href}
              data-tooltip={item.label}
              className={`relative sidebar-tooltip ${
                isActive
                  ? "flex items-center gap-4 py-3 text-primary font-bold lg:border-r-2 lg:border-primary lg:pr-4 md:justify-center lg:justify-start md:bg-primary/10 lg:bg-transparent transition-all"
                  : "flex items-center gap-4 py-3 text-on-surface-variant hover:text-primary hover:bg-primary/5 md:justify-center lg:justify-start transition-all duration-300"
              }`}
            >
              <Icon name={item.icon} filled={isActive} />
              <span className="hidden lg:inline font-medium">{item.label}</span>

              {badgeCount != null && badgeCount > 0 && (
                <>
                  <span className="hidden lg:inline ml-auto bg-primary text-black text-[10px] font-bold px-1.5 py-0.5 min-w-[20px] text-center">
                    {badgeCount}
                  </span>
                  <span className="hidden md:block lg:hidden absolute top-2 right-2 w-2.5 h-2.5 bg-primary rounded-full" />
                </>
              )}
            </Link>
          );
        })}
      </nav>

      {/* User info — hidden in icon-only mode */}
      {isAuthenticated && user && (
        <div className="hidden lg:block px-6 py-4 border-t border-outline">
          <p className="text-sm font-bold text-primary matrix-glow">
            {formatBalance(user.public_balance)}
          </p>
          <p className="text-[10px] text-on-surface-variant/60 font-mono uppercase">
            {getTierName(weiToEth(user.public_balance))}
          </p>
        </div>
      )}

      {/* New Proof CTA */}
      <div className="mt-auto pt-6">
        <Link
          href="/setup"
          data-tooltip="New Profile"
          className="sidebar-tooltip w-full bg-primary/10 border border-primary text-primary font-bold py-3 px-4 flex items-center justify-center gap-2 active:scale-95 transition-all hover:bg-primary/20"
        >
          <Icon name="add_circle" className="text-sm md:text-xl lg:text-sm" />
          <span className="hidden lg:inline">New Profile</span>
        </Link>
      </div>
    </aside>
  );
}
