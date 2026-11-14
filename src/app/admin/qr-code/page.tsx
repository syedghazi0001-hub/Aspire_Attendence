"use client";
import { useEffect, useState } from "react";
import AdminShell from "@/components/AdminShell";
import QrGeneratorCard from "@/components/QrGeneratorCard";
import { adminFetch } from "@/lib/adminFetch";
export default function QrCodePage() {
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  useEffect(() => { adminFetch("/api/admin/settings").then(async r => {
    const d = await r.json(); if (!r.ok || !d.settings?.qr_secret) throw new Error(d.error || "QR settings unavailable.");
    setToken(d.settings.qr_secret);
  }).catch(e => setError(e.message)); }, []);
  return <AdminShell title="QR Code" subtitle="Display this page at the workplace. Regenerating invalidates the previous code.">
    <div className="max-w-3xl mx-auto">{error ? <p role="alert">{error}</p> : token ? <QrGeneratorCard qrSecret={token} onQrUpdated={setToken} /> : <p>Loading QR code…</p>}</div>
  </AdminShell>;
}
