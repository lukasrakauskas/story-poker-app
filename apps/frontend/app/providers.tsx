"use client";

import { ThemeProvider } from "next-themes";
import { usePathname } from "next/navigation";
import { Toaster } from "ui/components/toaster";
import { PlanningProvider } from "../lib/planning-context";

export default function Providers({
  children,
  avatars,
}: {
  children: React.ReactNode;
  avatars: readonly string[];
}) {
  const pathname = usePathname();
  const isRetro = pathname === "/retro" || pathname.startsWith("/retro/");

  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      {isRetro ? (
        children
      ) : (
        <PlanningProvider avatars={avatars}>{children}</PlanningProvider>
      )}
      <Toaster />
    </ThemeProvider>
  );
}
