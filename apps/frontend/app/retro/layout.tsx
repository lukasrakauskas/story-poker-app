import type { Metadata } from "next";
import type { ReactNode } from "react";
import { RetroProvider } from "./components/retro-provider";

export const metadata: Metadata = {
  title: "Retrospective | Story Poker",
  description:
    "Reflect together, choose priorities, and leave with clear actions. Rooms expire after two hours.",
};

export default function RetroLayout({ children }: { children: ReactNode }) {
  return <RetroProvider>{children}</RetroProvider>;
}
