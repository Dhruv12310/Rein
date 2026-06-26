import type { Metadata } from "next";
import { Nav } from "@/components/nav";
import "./globals.css";

export const metadata: Metadata = {
  title: "Rein",
  description:
    "A spending-control layer for AI agents. Every agent gets a corporate card with a real limit.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full">
        <Nav />
        <main className="mx-auto max-w-5xl px-5 py-10">{children}</main>
      </body>
    </html>
  );
}
