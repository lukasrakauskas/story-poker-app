import type { ReactNode } from "react";
import { createRetrospectiveMetadata } from "../../lib/site-metadata";

export const metadata = createRetrospectiveMetadata();

export default function RetroLayout({ children }: { children: ReactNode }) {
  return children;
}
