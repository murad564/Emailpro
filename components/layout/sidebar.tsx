"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Users, Filter, Send, BarChart2, Mail, Settings } from "lucide-react";
import { cn } from "@/lib/utils";

const nav = [
  { href: "/",          label: "Dashboard", icon: LayoutDashboard },
  { href: "/contacts",  label: "Contacts",  icon: Users },
  { href: "/segments",  label: "Segments",  icon: Filter },
  { href: "/campaigns", label: "Campaigns", icon: Send },
  { href: "/analytics", label: "Analytics", icon: BarChart2 },
  { href: "/settings",  label: "Settings",  icon: Settings },
];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="flex flex-col w-60 min-h-screen bg-gray-900 text-white">
      <div className="flex items-center gap-2 px-6 py-5 border-b border-gray-700">
        <div className="w-8 h-8 bg-brand-500 rounded-lg flex items-center justify-center">
          <Mail className="w-4 h-4 text-white" />
        </div>
        <span className="text-lg font-bold tracking-tight">EmailPro</span>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-0.5">
        {nav.map(({ href, label, icon: Icon }) => {
          const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors",
                active
                  ? "bg-brand-600 text-white"
                  : "text-gray-300 hover:bg-gray-800 hover:text-white",
              )}
            >
              <Icon className="w-4 h-4" />
              {label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
