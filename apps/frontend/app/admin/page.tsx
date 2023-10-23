import { Metadata } from "next";
import { AdminPanel } from "./admin-panel";

export const metadata: Metadata = {
  title: "Story Poker",
  description: "Create a planning room",
  robots: {
    index: false,
    follow: false,
  },
};

export default async function AdminPage() {
  return <AdminPanel />;
}
