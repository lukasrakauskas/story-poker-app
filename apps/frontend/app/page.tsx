import { Metadata } from "next";
import { NameSelect } from "./components/name-select";

export const metadata: Metadata = {
  title: "Story Poker",
  description: "Create a planning room",
};

export default function Home() {
  return <NameSelect title="Create a planning room" action="Create room" />;
}
