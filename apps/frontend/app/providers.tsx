"use client";

import { ToastProvider } from "ui/components/toast";
import { PlanningProvider } from "../lib/planning-context";

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ToastProvider>
      <PlanningProvider>{children}</PlanningProvider>
    </ToastProvider>
  );
}
