import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "X Bookmark Viewer",
  description: "A quiet local viewer for X bookmarks only."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
