"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/",         label: "Dashboard" },
  { href: "/devices",  label: "Devices"   },
  { href: "/controls", label: "Controls"  },
  { href: "/settings", label: "Settings"  },
];

export default function NavBar() {
  const path = usePathname();
  return (
    <nav className="sticky top-0 z-10 bg-white border-b border-gray-200 px-6 py-3 flex items-center gap-6">
      <span className="font-bold text-gray-900 mr-4">🛡 Pi Monitor</span>
      {links.map(({ href, label }) => (
        <Link
          key={href}
          href={href}
          className={`text-sm font-medium transition-colors ${
            path === href
              ? "text-blue-600 border-b-2 border-blue-600 pb-0.5"
              : "text-gray-500 hover:text-gray-900"
          }`}
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}
