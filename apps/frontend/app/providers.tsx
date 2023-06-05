"use client";

import { ThemeProvider } from "next-themes";
import { Toaster } from "ui/components/toaster";
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
      <PlanningProvider avatars={avatars}>{children}</PlanningProvider>
      <Toaster />
    </ThemeProvider>
  );
}
