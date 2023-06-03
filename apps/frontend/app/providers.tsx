"use client";

import { ThemeProvider } from "next-themes";
import { ToastProvider } from "ui/components/toast";
import { PlanningProvider } from "../lib/planning-context";

export default function Providers({
  children,
  avatars,
}: {
  children: React.ReactNode;
  avatars: string[];
}) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <ToastProvider>
        <PlanningProvider avatars={avatars}>{children}</PlanningProvider>
      </ToastProvider>
    </ThemeProvider>
  );
}
