import "./styles.css";
import { Inter } from "next/font/google";
import { Analytics } from "@vercel/analytics/react";
import Providers from "./providers";
import { SiteHeader } from "../components/site-header";
import { AVATARS } from "../lib/avatars";
import { createRootMetadata, getSiteOrigin } from "../lib/site-metadata";

const inter = Inter({ subsets: ["latin"] });

export const metadata = createRootMetadata(getSiteOrigin());

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${inter.className} flex h-dvh flex-col overflow-hidden`}
      >
        <Providers avatars={AVATARS}>
          <SiteHeader />
          <div id="app-content" className="min-h-0 flex-1 overflow-auto">
            {children}
          </div>
        </Providers>
        <Analytics />
      </body>
    </html>
  );
}
