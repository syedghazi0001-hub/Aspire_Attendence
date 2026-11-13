"use client";

import React, { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

export default function ThemeToggle() {
  const [dark, setDark] = useState<boolean>(false);
  const [mounted, setMounted] = useState<boolean>(false);

  useEffect(() => {
    setMounted(true);
    const savedTheme = localStorage.getItem("portal_theme");
    const prefersDark =
      window.matchMedia &&
      window.matchMedia("(prefers-color-scheme: dark)").matches;
    const isDark = savedTheme ? savedTheme === "dark" : prefersDark;
    setDark(isDark);
    if (isDark) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }, []);

  const toggleTheme = () => {
    const nextDark = !dark;
    setDark(nextDark);
    if (nextDark) {
      document.documentElement.classList.add("dark");
      localStorage.setItem("portal_theme", "dark");
    } else {
      document.documentElement.classList.remove("dark");
      localStorage.setItem("portal_theme", "light");
    }
  };

  if (!mounted) {
    return <div className="w-9 h-9 rounded-xl btn-3d-glass" />;
  }

  return (
    <button
      type="button"
      onClick={toggleTheme}
      title={dark ? "Switch to Titanium Frost Mode" : "Switch to Keynote Stage Mode"}
      className="inline-flex items-center justify-center w-9 h-9 rounded-xl btn-3d-glass"
    >
      {dark ? (
        <Sun className="w-4 h-4 text-amber-400" />
      ) : (
        <Moon className="w-4 h-4 text-indigo-700" />
      )}
    </button>
  );
}
