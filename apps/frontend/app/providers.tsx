"use client"

import { PlanningProvider } from "../lib/planning-context"

export default function Providers({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <PlanningProvider>
      {children}
    </PlanningProvider>
  )
}
