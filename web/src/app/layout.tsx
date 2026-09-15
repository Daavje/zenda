import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Zenda · Samen gepland",
  description: "Alle afspraken van je gezin op één plek.",
  manifest: "/manifest.webmanifest",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="nl">
      <body>{children}</body>
    </html>
  );
}
