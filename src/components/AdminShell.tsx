"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { supabase, isSupabaseConfigured } from "@/lib/supabaseClient";
import ThemeToggle from "@/components/ThemeToggle";
import {
  LayoutDashboard,
  UserPlus,
  Users,
  CalendarClock,
  Settings,
  LogOut,
  AlertTriangle,
  Sparkles,
} from "lucide-react";

interface AdminShellProps {
  children: React.ReactNode;
  title?: string;
  subtitle?: string;
}

export default function AdminShell({
  children,
  title,
  subtitle,
}: AdminShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [adminEmail, setAdminEmail] = useState<string>("Admin");
  const [checkingAuth, setCheckingAuth] = useState<boolean>(true);

  useEffect(() => {
    const checkSession = async () => {
      if (!isSupabaseConfigured) {
        setCheckingAuth(false);
        return;
      }

      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        router.replace("/");
        return;
      }

      setAdminEmail(session.user.email || "Administrator");
      setCheckingAuth(false);
    };

    checkSession();
  }, [router]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.replace("/");
  };

  const navItems = [
    {
      label: "Dashboard",
      href: "/admin",
      icon: LayoutDashboard,
    },
    {
      label: "Add Employee",
      href: "/admin/add-employee",
      icon: UserPlus,
    },
    {
      label: "Employees & Salary",
      href: "/admin/employees",
      icon: Users,
    },
    {
      label: "Leave Management",
      href: "/admin/leaves",
      icon: CalendarClock,
    },
    {
      label: "GPS & QR Settings",
      href: "/admin/settings",
      icon: Settings,
    },
  ];

  if (checkingAuth) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <motion.div
          initial={{ opacity: 0, scale: 0.94 }}
          animate={{ opacity: 1, scale: 1 }}
          className="glass-panel rounded-3xl px-8 py-6 flex items-center gap-3.5 text-sm font-semibold text-slate-700 dark:text-slate-200"
        >
          <span className="h-4 w-4 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin" />
          <span>Initializing Keynote Workspace...</span>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen flex flex-col md:flex-row overflow-x-hidden">
      {/* Ambient 3D Keynote Floating Light Orbs */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-0 overflow-hidden"
      >
        <div className="animate-orb-slow absolute -top-24 -left-24 w-96 h-96 rounded-full bg-indigo-400/20 dark:bg-indigo-500/15 blur-3xl" />
        <div className="animate-orb-reverse absolute top-1/3 -right-24 w-[28rem] h-[28rem] rounded-full bg-sky-400/20 dark:bg-sky-500/15 blur-3xl" />
        <div className="animate-orb-slow absolute -bottom-28 left-1/3 w-96 h-96 rounded-full bg-emerald-400/15 dark:bg-emerald-500/10 blur-3xl" />
      </div>

      {/* Sidebar Navigation (3D Frosted Glass Dock) */}
      <aside className="relative z-20 w-full md:w-72 md:p-4 shrink-0 flex flex-col">
        <div className="glass-panel md:rounded-3xl flex-1 flex flex-col justify-between overflow-hidden">
          <div>
            {/* Brand Header */}
            <div className="p-5 border-b border-white/40 dark:border-slate-600/40 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3.5">
                <div className="relative p-1.5 rounded-2xl glass-card-3d shrink-0">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src="/logo-placeholder.svg"
                    alt="Company Logo"
                    className="w-9 h-9 rounded-xl object-contain"
                  />
                </div>
                <div>
                  <div className="flex items-center gap-1.5">
                    <h1 className="font-medium text-sm tracking-tight text-slate-800 dark:text-white leading-tight">
                      PulseHR Cloud
                    </h1>
                    <Sparkles className="w-3.5 h-3.5 text-indigo-500 dark:text-indigo-400" />
                  </div>
                  <p className="text-[11px] font-medium text-slate-500 dark:text-slate-300">
                    3D Attendance &amp; Payroll
                  </p>
                </div>
              </div>
              <ThemeToggle />
            </div>

            {/* Navigation Links */}
            <nav className="p-3.5 flex md:flex-col gap-2 overflow-x-auto">
              {navItems.map((item) => {
                const Icon = item.icon;
                const active = pathname === item.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`flex items-center gap-3 px-4 py-3 rounded-2xl text-xs sm:text-sm font-semibold transition-all whitespace-nowrap ${
                      active
                        ? "btn-3d-primary"
                        : "text-slate-700 dark:text-slate-200 hover:bg-white/45 dark:hover:bg-slate-700/45"
                    }`}
                  >
                    <Icon
                      className={`w-4 h-4 shrink-0 ${
                        active
                          ? "text-white"
                          : "text-indigo-600 dark:text-indigo-300"
                      }`}
                    />
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </nav>
          </div>

          {/* Admin Account Footer */}
          <div className="p-4 border-t border-white/40 dark:border-slate-600/40 hidden md:block">
            <div className="glass-card-3d rounded-2xl p-3 mb-3">
              <div className="text-[10px] uppercase tracking-wider font-medium text-indigo-600 dark:text-indigo-300">
                Multi-Device Admin
              </div>
              <div className="text-xs text-slate-700 dark:text-slate-200 font-semibold truncate mt-0.5">
                {adminEmail}
              </div>
            </div>
            <button
              onClick={handleLogout}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-2xl text-xs font-medium btn-3d-rose"
            >
              <LogOut className="w-4 h-4" />
              <span>Sign Out</span>
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content Area with Framer Motion 3D Slide-Up */}
      <div className="relative z-10 flex-1 flex flex-col min-w-0">
        {!isSupabaseConfigured && (
          <div className="mx-4 mt-4 rounded-2xl glass-panel px-4 py-3 text-xs text-amber-900 dark:text-amber-200 flex items-center gap-2.5">
            <AlertTriangle className="w-4 h-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <span>
              <strong>Supabase Configuration Notice:</strong> Set{" "}
              <code className="font-mono bg-white/50 dark:bg-slate-800/60 px-1.5 py-0.5 rounded">
                NEXT_PUBLIC_SUPABASE_URL
              </code>
              ,{" "}
              <code className="font-mono bg-white/50 dark:bg-slate-800/60 px-1.5 py-0.5 rounded">
                NEXT_PUBLIC_SUPABASE_ANON_KEY
              </code>
              , and{" "}
              <code className="font-mono bg-white/50 dark:bg-slate-800/60 px-1.5 py-0.5 rounded">
                SUPABASE_SERVICE_ROLE_KEY
              </code>{" "}
              in{" "}
              <code className="font-mono bg-white/50 dark:bg-slate-800/60 px-1.5 py-0.5 rounded">
                .env.local
              </code>{" "}
              or Cloudflare Worker Variables.
            </span>
          </div>
        )}

        {(title || subtitle) && (
          <header className="px-4 sm:px-6 lg:px-8 pt-4 sm:pt-6">
            <div className="max-w-7xl mx-auto glass-panel rounded-3xl px-6 py-4 flex items-center justify-between gap-4">
              <div>
                {title && (
                  <h2 className="text-lg sm:text-xl font-medium text-slate-800 dark:text-white tracking-tight">
                    {title}
                  </h2>
                )}
                {subtitle && (
                  <p className="text-xs sm:text-sm font-medium text-slate-600 dark:text-slate-300 mt-0.5">
                    {subtitle}
                  </p>
                )}
              </div>
              <button
                onClick={handleLogout}
                className="md:hidden inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-medium btn-3d-rose shrink-0"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Sign Out</span>
              </button>
            </div>
          </header>
        )}

        <motion.main
          key={pathname}
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
          className="flex-1 p-4 sm:p-6 lg:p-8 max-w-7xl w-full mx-auto"
        >
          {children}
        </motion.main>
      </div>
    </div>
  );
}
