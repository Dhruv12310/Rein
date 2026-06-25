import type { Metadata } from "next";
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
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
