import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Story Poker",
  description: "Join a planning room",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
