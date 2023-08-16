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
  openGraph: {
    type: "website",
    url: "https://story-poker.rake.lt",
    title: "Story Poker",
    siteName: "Story Poker",
    images: [
      {
        url: "/og",
      },
    ],
  },
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
