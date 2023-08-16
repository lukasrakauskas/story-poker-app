import "./styles.css";
import { Inter } from "next/font/google";
import { Analytics } from "@vercel/analytics/react"
import Providers from "./providers";
import { SiteHeader } from "../components/site-header";
import avatars from "./avatars.json";
import { Metadata } from "next";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Story Poker",
  description: "Create a planning room",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={inter.className}>
        <Providers avatars={avatars}>
          <SiteHeader />
          {children}
        </Providers>
        <Analytics />
      </body>
    </html>
  );
}
