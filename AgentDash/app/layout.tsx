import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "TeamIntel - Sports Agency Dashboard",
  description: "Manage athletes, contracts, and CreatorIQ insights",
  icons: { icon: "/favicon.png", apple: "/favicon.png" },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="app-body antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
