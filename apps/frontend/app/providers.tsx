"use client";

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
    <ToastProvider>
      <PlanningProvider avatars={avatars}>{children}</PlanningProvider>
    </ToastProvider>
  );
}
