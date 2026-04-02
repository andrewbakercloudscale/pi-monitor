import type { Metadata } from "next";
import { Inter, Geist } from "next/font/google";
import "./globals.css";
import Sidebar from "@/components/Sidebar";
import MobileNav from "@/components/MobileNav";
import { cn } from "@/lib/utils";

const geist = Geist({subsets:['latin'],variable:'--font-sans'});

const inter = Inter({ subsets: ["latin"], display: "swap" });

export const metadata: Metadata = {
  title: "Pi Monitor",
  description: "Pi-hole parental controls dashboard",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={cn(inter.className, "font-sans", geist.variable)}>
      <body className="bg-slate-50 text-slate-900 min-h-screen">
        {/* Desktop sidebar */}
        <Sidebar />
        {/* Main content — offset for sidebar on md+ */}
        <div className="lg:pl-64 flex flex-col min-h-screen pt-14 lg:pt-0">
          <main className="flex-1 p-4 md:p-8 max-w-6xl w-full mx-auto">
            {children}
          </main>
        </div>
        {/* Mobile bottom nav */}
        <MobileNav />
      </body>
    </html>
  );
}
