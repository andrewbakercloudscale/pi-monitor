import type { Metadata } from "next";
import "./globals.css";
import NavBar from "@/components/NavBar";

export const metadata: Metadata = {
  title: "Pi Monitor",
  description: "Pi-hole parental controls dashboard",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-gray-50 text-gray-900">
        <NavBar />
        <main className="flex-1 p-6 max-w-6xl mx-auto w-full">{children}</main>
      </body>
    </html>
  );
}
