import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Agent Evaluation & Reliability Platform",
  description:
    "Test a candidate-review agent repeatedly, verify the final ranking, inspect failures, and catch reliability regressions.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
