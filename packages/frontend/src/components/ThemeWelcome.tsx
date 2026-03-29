"use client";

import { useState, useEffect } from "react";
import { useTheme } from "@/providers/ThemeProvider";
import { THEMES } from "@/lib/themes";
import { Icon } from "./Icon";

const THEME_KEY = "ghostbalance-theme";

const DARK_THEMES = ["matrix", "cyan-m3", "synthwave", "art-deco-noir", "forest-organic", "brutalist"];
const LIGHT_THEMES = ["warm-coral", "clean-teal"];

export function ThemeWelcome() {
  const { themeId, setTheme } = useTheme();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!localStorage.getItem(THEME_KEY)) {
      setVisible(true);
    }
  }, []);

  const dismiss = () => {
    setVisible(false);
    // Persist current theme so the popup doesn't reappear
    setTheme(themeId);
  };

  if (!visible) return null;

  return (
    <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[100]">
      <div className="bg-surface border border-outline shadow-lg px-5 py-4 max-w-sm w-full">
        <div className="flex items-start justify-between gap-3 mb-3">
          <p className="text-xs font-mono text-on-surface-variant">
            We have some cool themes, choose for yourself
          </p>
          <button onClick={dismiss} className="text-on-surface-variant/50 hover:text-primary transition-colors shrink-0">
            <Icon name="close" className="text-sm" />
          </button>
        </div>

        <div className="space-y-2.5">
          <div className="flex items-center gap-3">
            <span className="text-[9px] font-mono uppercase tracking-widest text-on-surface-variant/50 w-8 shrink-0">Dark</span>
            <div className="flex gap-2">
              {DARK_THEMES.map((id) => {
                const t = THEMES[id];
                if (!t) return null;
                return (
                  <button
                    key={id}
                    onClick={() => setTheme(id)}
                    title={t.name}
                    className={`w-7 h-7 rounded-full border-2 transition-all hover:scale-110 ${
                      themeId === id ? "ring-2 ring-offset-1 ring-primary scale-110" : ""
                    }`}
                    style={{
                      backgroundColor: t.colors.primary,
                      borderColor: t.colors.background,
                    }}
                  />
                );
              })}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-[9px] font-mono uppercase tracking-widest text-on-surface-variant/50 w-8 shrink-0">Light</span>
            <div className="flex gap-2">
              {LIGHT_THEMES.map((id) => {
                const t = THEMES[id];
                if (!t) return null;
                return (
                  <button
                    key={id}
                    onClick={() => setTheme(id)}
                    title={t.name}
                    className={`w-7 h-7 rounded-full border-2 transition-all hover:scale-110 ${
                      themeId === id ? "ring-2 ring-offset-1 ring-primary scale-110" : ""
                    }`}
                    style={{
                      backgroundColor: t.colors.primary,
                      borderColor: t.colors.background,
                    }}
                  />
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
