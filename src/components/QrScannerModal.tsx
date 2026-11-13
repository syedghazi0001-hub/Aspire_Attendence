"use client";

import React, { useEffect, useRef, useState } from "react";
import type { Html5Qrcode } from "html5-qrcode";
import { Camera, ImageUp, X, AlertCircle } from "lucide-react";

interface QrScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onScanSuccess: (decodedText: string) => void;
}

export default function QrScannerModal({
  isOpen,
  onClose,
  onScanSuccess,
}: QrScannerModalProps) {
  const [cameraError, setCameraError] = useState<string>("");
  const [scanningFile, setScanningFile] = useState<boolean>(false);
  const hasScannedRef = useRef<boolean>(false);

  useEffect(() => {
    if (!isOpen) return;
    hasScannedRef.current = false;
    setCameraError("");

    let html5QrCodeInstance: Html5Qrcode | null = null;

    const startCamera = async () => {
      try {
        const { Html5Qrcode: Html5QrcodeClass } = await import("html5-qrcode");
        const instance = new Html5QrcodeClass("qr-reader-viewport");
        html5QrCodeInstance = instance;

        await instance.start(
          { facingMode: "environment" },
          {
            fps: 10,
            qrbox: { width: 240, height: 240 },
          },
          (decodedText: string) => {
            if (hasScannedRef.current) return;
            hasScannedRef.current = true;
            instance
              .stop()
              .catch(() => {})
              .finally(() => {
                onScanSuccess(decodedText);
              });
          },
          () => {
            // Frame scan error ignored while searching for QR
          }
        );
      } catch (err: unknown) {
        const msg =
          err instanceof Error
            ? err.message
            : "Camera access denied or unavailable.";
        setCameraError(
          `Live camera stream unavailable (${msg}). You can also capture/select the QR image below.`
        );
      }
    };

    const timer = setTimeout(startCamera, 150);

    return () => {
      clearTimeout(timer);
      if (html5QrCodeInstance) {
        try {
          html5QrCodeInstance
            .stop()
            .then(() => html5QrCodeInstance?.clear())
            .catch(() => {});
        } catch {
          // Ignore stop errors if camera never started
        }
      }
    };
  }, [isOpen, onScanSuccess]);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setScanningFile(true);
    setCameraError("");
    try {
      const { Html5Qrcode: Html5QrcodeClass } = await import("html5-qrcode");
      const fileScanner = new Html5QrcodeClass("qr-file-fallback");
      const decodedText = await fileScanner.scanFile(file, true);
      if (!hasScannedRef.current) {
        hasScannedRef.current = true;
        onScanSuccess(decodedText);
      }
    } catch {
      setCameraError(
        "Could not detect a valid QR Code in the selected image. Please try again."
      );
    } finally {
      setScanningFile(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-md p-4 animate-keynote-in">
      <div className="w-full max-w-md rounded-3xl glass-panel overflow-hidden">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/40 dark:border-slate-700/60">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl btn-3d-primary">
              <Camera className="w-4 h-4" />
            </div>
            <span className="font-extrabold text-base text-slate-800 dark:text-white">
              Scan Workplace QR Code
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="btn-3d-glass rounded-xl p-1.5"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Camera Viewport */}
        <div className="p-5 space-y-4">
          <p className="text-xs font-medium text-slate-600 dark:text-slate-300 text-center">
            Point your mobile camera at the official QR Code. Immediately after
            scanning, your live GPS location will be verified against the
            configured workplace radius.
          </p>

          <div className="relative overflow-hidden rounded-2xl bg-slate-900 min-h-[260px] flex items-center justify-center border border-white/30">
            <div id="qr-reader-viewport" className="w-full" />
            <div id="qr-file-fallback" className="hidden" />
          </div>

          {cameraError && (
            <div className="flex items-start gap-2 rounded-2xl glass-card-3d p-3 text-xs font-semibold text-amber-800 dark:text-amber-200">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-amber-600" />
              <span>{cameraError}</span>
            </div>
          )}

          {/* Camera Snapshot / Image QR Fallback */}
          <div className="pt-1">
            <label className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-2xl btn-3d-glass px-4 py-3 text-xs font-bold">
              <ImageUp className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
              <span>
                {scanningFile
                  ? "Reading QR Code..."
                  : "Or Capture / Upload QR Code Image"}
              </span>
              <input
                type="file"
                accept="image/*"
                capture="environment"
                onChange={handleFileChange}
                className="hidden"
              />
            </label>
          </div>
        </div>
      </div>
    </div>
  );
}
