import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Control Center",
  description: "A self-hosted dashboard for signals, mentions, newsletters, audience, reminders, and tasks.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
