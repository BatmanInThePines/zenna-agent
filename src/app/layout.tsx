import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Zenna | Anthony West Inc",
  description: "Zenna - Voice-first AI assistant with persistent memory",
  icons: {
    icon: "/favicon.ico",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
