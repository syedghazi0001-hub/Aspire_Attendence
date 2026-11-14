"use client";

import React, { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import QRCode from "qrcode";
import { adminFetch } from "@/lib/adminFetch";
import {
  Download,
  QrCode,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  CheckCircle2,
  Info,
} from "lucide-react";

/**
 * ============================================================================
 * STATIC VS. DYNAMIC QR CODE ARCHITECTURE (EXPLANATION FOR ADMIN)
 * ----------------------------------------------------------------------------
 * 1. HOW STATIC QR WORKED PREVIOUSLY:
 *    A static QR code contained a fixed string (e.g., "LAB-DEFAULT-QR-SECRET")
 *    that never changed. Once printed, employees could take a photo of it and
 *    reuse that same QR image forever unless manually edited in database settings.
 *
 * 2. HOW DYNAMIC QR CODE WORKS NOW:
 *    - When the Admin clicks "Regenerate QR Code", this component creates a
 *      cryptographically unique token (e.g., "PULSE-QR-2026-9F8A2C4D") and
 *      immediately saves it to `public.settings.qr_secret` in Supabase.
 *    - During employee Check-In / Check-Out (`/api/employee/attendance`), the
 *      server compares the scanned QR string against the latest `qr_secret` in
 *      `public.settings`.
 *    - The moment a new QR code is generated, any previously printed or
 *      photographed QR code becomes INSTANTLY INVALID and is rejected by the API.
 * ============================================================================
 */

export interface QrGeneratorCardProps {
  defaultUrl?: string;
  qrString?: string;
  qrSecret?: string;
  labLat?: number;
  labLng?: number;
  radiusMeters?: number;
  onQrUpdated?: (newSecret: string) => void;
}

export default function QrGeneratorCard({
  defaultUrl,
  qrString,
  qrSecret,
  labLat,
  labLng,
  radiusMeters,
  onQrUpdated,
}: QrGeneratorCardProps) {
  const [activeToken, setActiveToken] = useState<string>("");
  const [qrDataUrl, setQrDataUrl] = useState<string>("");
  const [generating, setGenerating] = useState<boolean>(false);
  const [statusBanner, setStatusBanner] = useState<string>("");

  useEffect(() => {
    const initialToken =
      qrSecret || qrString || defaultUrl || "LAB-DEFAULT-QR-SECRET-2026";
    setActiveToken(initialToken);
    renderQrImage(initialToken);
  }, [defaultUrl, qrString, qrSecret]);

  const renderQrImage = async (tokenValue: string) => {
    if (!tokenValue.trim()) return;
    try {
      const dataUrl = await QRCode.toDataURL(tokenValue.trim(), {
        width: 380,
        margin: 2,
        color: {
          dark: "#0f172a",
          light: "#ffffff",
        },
        errorCorrectionLevel: "H",
      });
      setQrDataUrl(dataUrl);
    } catch (err) {
      console.error("Failed to generate QR image:", err);
    }
  };

  /**
   * Generates a new unique QR Code ID, saves it immediately to `public.settings`,
   * renders the new QR image, and invalidates all previous QR codes.
   */
  const handleGenerateNewDynamicQr = async () => {
    setGenerating(true);
    setStatusBanner("");

    const newUniqueQrToken = `PULSE-QR-${crypto.randomUUID()}`;
    try {
      const payload = { qr_secret: newUniqueQrToken };
      const saveRes = await adminFetch("/api/admin/settings", {
        method: "PUT",
        body: JSON.stringify(payload),
      });

      if (!saveRes.ok) {
        const result = await saveRes.json().catch(() => ({}));
        throw new Error(result.error || "QR regeneration failed.");
      }
      if (saveRes.ok) {
        setActiveToken(newUniqueQrToken);
        await renderQrImage(newUniqueQrToken);
        if (onQrUpdated) {
          onQrUpdated(newUniqueQrToken);
        }
        setStatusBanner(
          "New Dynamic QR Code generated & saved! Previous QR codes are now instantly invalid."
        );
      }
    } catch (err) {
      setStatusBanner(`Failed: ${err instanceof Error ? err.message : "QR regeneration failed."}`);
      console.error("Error saving new dynamic QR token:", err);
    } finally {
      setGenerating(false);
    }
  };

  const handleDownload = () => {
    if (!qrDataUrl) return;
    const link = document.createElement("a");
    link.href = qrDataUrl;
    link.download = `workplace-qr-${activeToken}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="glass-panel rounded-3xl p-6 space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-2xl btn-3d-primary">
            <QrCode className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <h2 className="text-base font-semibold tracking-tight text-slate-900 dark:text-white">
                Dynamic Workplace QR
              </h2>
              <Sparkles className="w-3.5 h-3.5 text-indigo-500 dark:text-indigo-400" />
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Instant token rotation &bull; Old QR codes invalidate immediately
            </p>
          </div>
        </div>
      </div>

      <AnimatePresence mode="wait">
        {statusBanner && (
          <motion.div
            key={statusBanner}
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            role="status"
            className={`rounded-2xl border px-3.5 py-2.5 text-xs font-medium flex items-center gap-2 ${statusBanner.startsWith("Failed:") ? "border-rose-400/35 text-rose-600 dark:text-rose-200" : "border-emerald-400/35 text-emerald-800 dark:text-emerald-200"}`}
          >
            <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
            <span>{statusBanner}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {qrDataUrl && (
        <motion.div
          key={activeToken}
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
          className="flex flex-col items-center justify-center glass-card-3d rounded-3xl p-5"
        >
          <div className="bg-white p-3.5 rounded-2xl shadow-lg border border-slate-200/80">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={qrDataUrl}
              alt="Workplace Dynamic QR Code"
              className="w-[min(70vw,420px)] h-[min(70vw,420px)] object-contain"
            />
          </div>

          <div className="mt-3.5 inline-flex items-center gap-1.5 rounded-full bg-indigo-500/10 dark:bg-indigo-500/20 border border-indigo-400/25 px-3 py-1">
            <ShieldCheck className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
            <span className="text-[11px] font-mono font-medium text-indigo-900 dark:text-indigo-200">
              {activeToken}
            </span>
          </div>

          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.97 }}
            type="button"
            onClick={handleDownload}
            className="mt-4 btn-3d-glass rounded-2xl px-4 py-2 text-xs font-medium inline-flex items-center gap-2"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Download Printable PNG</span>
          </motion.button>
        </motion.div>
      )}

      {/* Primary Action: Generate New Dynamic QR Code */}
      <motion.button
        whileHover={{ scale: 1.01 }}
        whileTap={{ scale: 0.98 }}
        type="button"
        onClick={handleGenerateNewDynamicQr}
        disabled={generating}
        className="w-full rounded-2xl btn-3d-primary py-3 px-4 text-xs sm:text-sm font-medium inline-flex items-center justify-center gap-2 disabled:opacity-60"
      >
        <RefreshCw className={`w-4 h-4 ${generating ? "animate-spin" : ""}`} />
        <span>
          {generating ? "Rotating QR Token..." : "Regenerate QR Code"}
        </span>
      </motion.button>

      {/* Static vs Dynamic Explanation Card */}
      <details className="rounded-2xl glass-input p-3.5 text-[11px] leading-relaxed text-slate-600 dark:text-slate-300 space-y-1">
        <summary className="font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-1.5">
          <Info className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
          <span>Static vs. Dynamic QR Security</span>
        </summary>
        <p>
          <strong>Static:</strong> Remains valid as long as you keep it mounted
          at the entrance.{" "}
          <strong>Dynamic:</strong> Clicking{" "}
          <em>&ldquo;Regenerate QR Code&rdquo;</em> rotates the database
          secret in real time and <strong>instantly invalidates</strong> any old
          printed or photographed QR code.
        </p>
      </details>
    </div>
  );
}
