import "./styles.css";
import path from "path";
import fs from "fs/promises";
import { Inter } from "next/font/google";
import Providers from "./providers";
import { SiteHeader } from "../components/site-header";

const inter = Inter({ subsets: ["latin"] });

export const metadata = {
  title: "Create Next App",
  description: "Generated by create next app",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const publicDir = path.join(process.cwd(), "public", "avatars");
  const avatars = await fs.readdir(publicDir);

  return (
    <html lang="en">
      <body className={inter.className}>
        <Providers avatars={avatars}>
          <SiteHeader />
          {children}
        </Providers>
      </body>
    </html>
  );
}
