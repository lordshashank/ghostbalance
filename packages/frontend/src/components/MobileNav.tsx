"use client";

import { useState, useRef, useCallback } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "./Icon";
import { useUnreadCount } from "@/hooks/useNotifications";
import { useUnreadConversationsCount } from "@/hooks/useConversations";
import { useClickOutside } from "@/hooks/useClickOutside";

const MOBILE_NAV_ITEMS = [
  { href: "/", icon: "home", label: "Home" },
  { href: "/notifications", icon: "notifications", label: "Alerts" },
  { href: "/conversations", icon: "chat", label: "Messages" },
  { href: "/profile", icon: "person", label: "Profile" },
];

const MORE_ITEMS = [
  { href: "/leaderboard", icon: "leaderboard", label: "Leaderboard" },
  { href: "/bookmarks", icon: "bookmark", label: "Bookmarks" },
  { href: "/settings", icon: "settings", label: "Settings" },
];

export function MobileNav() {
  const pathname = usePathname();
  const { data: unread } = useUnreadCount();
  const { data: unreadConversations } = useUnreadConversationsCount();
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);
  const closeMore = useCallback(() => setMoreOpen(false), []);
  useClickOutside(moreRef, closeMore, moreOpen);

  return (
    <>
      {/* More menu popup */}
      {moreOpen && (
        <div
          ref={moreRef}
          className="fixed bottom-[72px] right-4 z-70 bg-background border border-outline py-2 md:hidden safe-bottom"
        >
          {MORE_ITEMS.map((item) => {
            const isActive = pathname.startsWith(item.href) && item.href !== "/";
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMoreOpen(false)}
                className={`flex items-center gap-3 px-5 py-3 text-sm font-mono ${
                  isActive
                    ? "text-primary font-bold"
                    : "text-on-surface-variant hover:text-primary"
                }`}
              >
                <Icon name={item.icon} filled={isActive} className="text-lg" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </div>
      )}

      {/* Bottom nav bar */}
      <nav className="fixed bottom-0 left-0 right-0 z-60 bg-background border-t border-outline h-[72px] flex items-center justify-around px-2 md:hidden safe-bottom">
        {MOBILE_NAV_ITEMS.map((item) => {
          const isActive =
            item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          const isNotifications = item.href === "/notifications";
          const isMessages = item.href === "/conversations";

          return (
            <Link
              key={item.href}
              href={item.href}
              className={`relative flex flex-col items-center justify-center gap-0.5 py-2 px-3 ${
                isActive ? "text-primary" : "text-on-surface-variant"
              }`}
            >
              {isActive && (
                <span className="absolute top-0 left-1/2 -translate-x-1/2 w-4 h-0.5 bg-primary" />
              )}
              <span className="relative">
                <Icon name={item.icon} filled={isActive} className="text-2xl" />
                {isNotifications && unread && unread.count > 0 && (
                  <span className="absolute -top-1 -right-1.5 w-2.5 h-2.5 bg-primary rounded-full" />
                )}
                {isMessages && unreadConversations && unreadConversations.count > 0 && (
                  <span className="absolute -top-1 -right-1.5 w-2.5 h-2.5 bg-primary rounded-full" />
                )}
              </span>
              <span className="text-[9px] font-mono uppercase tracking-wider">
                {item.label}
              </span>
            </Link>
          );
        })}

        {/* More button */}
        <button
          onClick={() => setMoreOpen((v) => !v)}
          className={`relative flex flex-col items-center justify-center gap-0.5 py-2 px-3 ${
            moreOpen ? "text-primary" : "text-on-surface-variant"
          }`}
        >
          <Icon name="more_horiz" className="text-2xl" />
          <span className="text-[9px] font-mono uppercase tracking-wider">
            More
          </span>
        </button>
      </nav>

      {/* FAB for New Proof */}
      <Link href="/setup" className="fab-new-proof">
        <Icon name="add" className="text-2xl" />
      </Link>
    </>
  );
}
