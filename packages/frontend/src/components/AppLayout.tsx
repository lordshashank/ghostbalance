"use client";

import { Sidebar } from "./Sidebar";
import { MobileNav } from "./MobileNav";
import { ThemeWelcome } from "./ThemeWelcome";

interface AppLayoutProps {
  children: React.ReactNode;
  rightSidebar?: React.ReactNode;
}

export function AppLayout({ children, rightSidebar }: AppLayoutProps) {
  return (
    <div className="xl:max-w-[1280px] mx-auto flex min-h-screen">
      <Sidebar />
      <main className="flex-1 flex min-w-0">
        <div className="relative w-full xl:w-[600px] xl:shrink-0 border-r border-outline min-h-screen bg-background pb-[72px] md:pb-0">
          <ThemeWelcome />
          {children}
        </div>
        {rightSidebar && (
          <aside className="hidden xl:block w-[350px] sticky top-0 h-screen p-6 overflow-y-auto no-scrollbar space-y-6 bg-background border-l border-outline">
            {rightSidebar}
          </aside>
        )}
      </main>
      <MobileNav />
    </div>
  );
}
