import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Lab QR & GPS Attendance System",
  description:
    "Online Employee Attendance Portal with QR Verification, 100m GPS Geofencing, and Admin Session Control powered by Next.js & Supabase.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-50 text-slate-900">
        {children}
      </body>
    </html>
  );
}
