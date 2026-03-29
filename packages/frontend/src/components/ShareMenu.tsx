"use client";

import { useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";
import { useToast } from "@/providers/ToastProvider";
import { useAuth } from "@/hooks/useAuth";
import { useClickOutside } from "@/hooks/useClickOutside";

interface ShareMenuProps {
  url: string;
  text?: string;
  className?: string;
}

export function ShareMenu({ url, text = "", className }: ShareMenuProps) {
  const [open, setOpen] = useState(false);
  const [shareSubOpen, setShareSubOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const { toastSuccess } = useToast();
  const { isAuthenticated } = useAuth();
  const router = useRouter();

  const closeMenus = useCallback(() => { setOpen(false); setShareSubOpen(false); }, []);
  useClickOutside(menuRef, closeMenus, open);

  const fullUrl = typeof window !== "undefined" ? `${window.location.origin}${url}` : url;
  const encodedUrl = encodeURIComponent(fullUrl);
  const encodedText = encodeURIComponent(text);

  const handleCopy = () => {
    navigator.clipboard.writeText(fullUrl);
    toastSuccess("Link copied");
    setOpen(false);
  };

  const handleShareVia = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (typeof navigator !== "undefined" && navigator.share) {
      navigator.share({ url: fullUrl, text: text || undefined }).catch(() => {});
      setOpen(false);
    } else {
      setShareSubOpen(!shareSubOpen);
    }
  };

  const handleSendViaMessage = () => {
    navigator.clipboard.writeText(fullUrl);
    toastSuccess("Link copied — paste it in a message");
    setOpen(false);
    router.push("/conversations");
  };

  const externalTargets = [
    {
      label: "Share on X",
      icon: "open_in_new",
      href: `https://twitter.com/intent/tweet?url=${encodedUrl}&text=${encodedText}`,
    },
    {
      label: "Share on Telegram",
      icon: "send",
      href: `https://t.me/share/url?url=${encodedUrl}&text=${encodedText}`,
    },
    {
      label: "Share on Warpcast",
      icon: "hub",
      href: `https://warpcast.com/~/compose?text=${encodedText}&embeds[]=${encodedUrl}`,
    },
  ];

  return (
    <div className={`relative ${className ?? ""}`} ref={menuRef}>
      <button
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(!open); setShareSubOpen(false); }}
        className="flex items-center gap-2 hover:text-primary transition-colors"
      >
        <Icon name="upload" className="!text-[18px]" />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-40 bg-background border border-outline shadow-lg min-w-[200px]">
          <button
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleCopy(); }}
            className="w-full flex items-center gap-3 px-4 py-2.5 text-xs font-mono uppercase tracking-widest text-on-surface-variant hover:bg-primary/10 hover:text-primary transition-colors"
          >
            <Icon name="link" className="text-sm" />
            Copy Link
          </button>
          <div className="relative">
            <button
              onClick={handleShareVia}
              className="w-full flex items-center justify-between px-4 py-2.5 text-xs font-mono uppercase tracking-widest text-on-surface-variant hover:bg-primary/10 hover:text-primary transition-colors"
            >
              <span className="flex items-center gap-3">
                <Icon name="share" className="text-sm" />
                Share via
              </span>
              {!(typeof navigator !== "undefined" && navigator.share) && (
                <Icon name={shareSubOpen ? "expand_less" : "expand_more"} className="text-sm" />
              )}
            </button>
            {shareSubOpen && (
              <div className="border-t border-outline/50">
                {externalTargets.map((target) => (
                  <button
                    key={target.label}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      window.open(target.href, "_blank");
                      setOpen(false);
                      setShareSubOpen(false);
                    }}
                    className="w-full flex items-center gap-3 px-4 pl-11 py-2 text-[10px] font-mono uppercase tracking-widest text-on-surface-variant/80 hover:bg-primary/10 hover:text-primary transition-colors"
                  >
                    <Icon name={target.icon} className="text-xs" />
                    {target.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          {isAuthenticated && (
            <button
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleSendViaMessage(); }}
              className="w-full flex items-center gap-3 px-4 py-2.5 text-xs font-mono uppercase tracking-widest text-on-surface-variant hover:bg-primary/10 hover:text-primary transition-colors border-t border-outline/50"
            >
              <Icon name="mail" className="text-sm" />
              Send via Message
            </button>
          )}
        </div>
      )}
    </div>
  );
}
