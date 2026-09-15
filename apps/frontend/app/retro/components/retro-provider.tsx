"use client";

import { createContext, useContext } from "react";
import type { ReactNode } from "react";
import { useRetroSocket } from "../../../hooks/use-retro-socket";
import type { RetroSession } from "../../../hooks/use-retro-socket";

const Context = createContext<RetroSession | null>(null);

export function RetroProvider({
  children,
  initialCode,
}: {
  children: ReactNode;
  initialCode?: string;
}) {
  const session = useRetroSocket(initialCode);
  return <Context.Provider value={session}>{children}</Context.Provider>;
}

export function useRetro() {
  const session = useContext(Context);
  if (!session) throw new Error("Retrospective requires RetroProvider");
  return session;
}
