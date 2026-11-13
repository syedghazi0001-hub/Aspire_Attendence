"use client";

import React, { useEffect, useState } from "react";
import QRCode from "qrcode";
import { Download, QrCode, RefreshCw } from "lucide-react";

export interface QrGeneratorCardProps {
  defaultUrl?: string;
  qrString?: string;
  qrSecret?: string;
  labLat?: number;
  labLng?: number;
  radiusMeters?: number;
}

export default function QrGeneratorCard({
  defaultUrl,
  qrString,
  qrSecret,
}: QrGeneratorCardProps) {
  const [portalUrl, setPortalUrl] = useState<string>("");
  const [qrDataUrl, setQrDataUrl] = useState<string>("");
  const [generating, setGenerating] = useState<boolean>(false);

  useEffect(() => {
    const origin =
      typeof window !== "undefined"
        ? window.location.origin
        : "http://localhost:3000";
    const initialUrl = defaultUrl || qrString || qrSecret || `${origin}/employee`;
    setPortalUrl(initialUrl);
    generateQrCode(initialUrl);
  }, [defaultUrl, qrString, qrSecret]);

  const generateQrCode = async (targetUrl: string) => {
    if (!targetUrl.trim()) return;
    setGenerating(true);
    try {
      const dataUrl = await QRCode.toDataURL(targetUrl.trim(), {
        width: 360,
        margin: 2,
        color: {
          dark: "#1e293b",
          light: "#ffffff",
        },
        errorCorrectionLevel: "H",
      });
      setQrDataUrl(dataUrl);
    } catch (err) {
      console.error("Failed to generate QR code:", err);
    } finally {
      setGenerating(false);
    }
  };

  const handleDownload = () => {
    if (!qrDataUrl) return;
    const link = document.createElement("a");
    link.href = qrDataUrl;
    link.download = "workplace-attendance-qr.png";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="glass-panel rounded-3xl p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-2xl btn-3d-primary">
            <QrCode className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-extrabold text-slate-800 dark:text-white">
              Static QR Code Generator
            </h2>
            <p className="text-xs font-medium text-slate-600 dark:text-slate-300">
              Print and mount at the workplace entrance for Clock In / Clock Out
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <div>
          <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-200 mb-1.5">
            QR Code Payload / Target URL
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={portalUrl}
              onChange={(e) => setPortalUrl(e.target.value)}
              placeholder="LAB_QR_STATIC_01 or https://your-domain.com/employee"
              className="flex-1 rounded-2xl glass-input px-3.5 py-2.5 text-sm font-mono font-bold"
            />
            <button
              type="button"
              onClick={() => generateQrCode(portalUrl)}
              disabled={generating}
              className="btn-3d-glass rounded-2xl px-4 py-2.5 text-xs font-bold inline-flex items-center gap-1.5"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${generating ? "animate-spin" : ""}`}
              />
              Generate
            </button>
          </div>
        </div>

        {qrDataUrl && (
          <div className="flex flex-col items-center justify-center glass-card-3d rounded-3xl p-6">
            <div className="bg-white p-3.5 rounded-2xl shadow-md">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={qrDataUrl}
                alt="Workplace Static QR Code"
                className="w-52 h-52 object-contain"
              />
            </div>
            <p className="mt-3 text-xs font-mono font-bold text-slate-600 dark:text-slate-300 break-all text-center max-w-xs">
              {portalUrl}
            </p>
            <button
              type="button"
              onClick={handleDownload}
              className="mt-4 btn-3d-primary rounded-2xl px-5 py-2.5 text-xs font-extrabold inline-flex items-center gap-2"
            >
              <Download className="w-4 h-4" />
              Download Static QR Code (PNG)
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
