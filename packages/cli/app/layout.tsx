import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Agent Action Inspector",
  description: "Local trajectory viewer and approval gate for LangGraph agents",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
