"use client";

import React, { useEffect, useState, useCallback, useRef } from "react";
import AdminShell from "@/components/AdminShell";
import { getAveragedGps } from "@/lib/accurateGps";
import { adminFetch } from "@/lib/adminFetch";
import {
  MapPin,
  Save,
  Compass,
  CheckCircle2,
  AlertTriangle,
  Loader2,
} from "lucide-react";

export default function AdminSettingsPage() {
  const gpsAbort = useRef<AbortController | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [gpsBusy, setGpsBusy] = useState(false);
  useEffect(() => () => gpsAbort.current?.abort(), []);
  const [labLat, setLabLat] = useState<string>("24.8607");
  const [labLng, setLabLng] = useState<string>("67.0011");
  const [radiusMeters, setRadiusMeters] = useState<string>("100");
  const [savingSettings, setSavingSettings] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [successMsg, setSuccessMsg] = useState<string>("");

  const loadSettings = useCallback(async () => {
    try {
      const response = await adminFetch("/api/admin/settings");
      const data = await response.json();
      if (!response.ok || !data.settings) throw new Error(data.error || "Settings unavailable.");
      if (data.settings) {
        setLoaded(true);
        setLabLat(String(data.settings.lab_lat));
        setLabLng(String(data.settings.lab_lng));
        setRadiusMeters(String(data.settings.radius_meters));
      }
    } catch(error) { setErrorMsg(error instanceof Error ? error.message : "Settings unavailable."); }
  }, []);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingSettings(true);
    setErrorMsg("");
    setSuccessMsg("");

    try {
      const response = await adminFetch("/api/admin/settings", {
        method: "PUT",
        body: JSON.stringify({
          lab_lat: parseFloat(labLat),
          lab_lng: parseFloat(labLng),
          radius_meters: parseFloat(radiusMeters),
        }),
      });
      const result = await response.json();
      if (!response.ok) {
        setErrorMsg(result.error || "Failed to update settings.");
        return;
      }
      setSuccessMsg(
        result.message || "GPS Geofence settings saved successfully."
      );
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Error saving settings.";
      setErrorMsg(msg);
    } finally {
      setSavingSettings(false);
    }
  };

  const handleUseCurrentGps = async () => {
    setErrorMsg(""); setSuccessMsg("");
    gpsAbort.current?.abort(); gpsAbort.current = new AbortController(); setGpsBusy(true);
    try {
      const pos = await getAveragedGps(setSuccessMsg, gpsAbort.current.signal);
      setLabLat(pos.coords.latitude.toFixed(8));
      setLabLng(pos.coords.longitude.toFixed(8));
      setSuccessMsg("5 GPS readings averaged. Save GPS Settings to persist.");
    } catch (error) { setErrorMsg(error instanceof Error ? error.message : "GPS failed."); } finally { setGpsBusy(false); }
  };

  return (
    <AdminShell
      title="GPS Settings"
      subtitle="Set the exact workplace GPS radius (e.g., 1 meter, 10 meters, 100 meters) strictly enforced during QR scanning"
    >
      <div className="space-y-6">
        {errorMsg && (
          <div className="glass-panel rounded-2xl border-rose-400/50 p-4 text-rose-900 dark:text-rose-200 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
            <div className="text-xs font-medium">{errorMsg}</div>
          </div>
        )}

        {successMsg && (
          <div className="glass-panel rounded-2xl border-emerald-400/50 p-4 text-emerald-950 dark:text-emerald-200 flex items-start gap-3">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
            <div className="text-xs font-medium">{successMsg}</div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-12 glass-panel rounded-3xl p-6 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 rounded-2xl btn-3d-primary">
                    <MapPin className="w-5 h-5" />
                  </div>
                  <div>
                    <h2 className="text-base font-medium text-slate-800 dark:text-white">
                      Geofence Coordinates &amp; Radius
                    </h2>
                    <p className="text-xs font-medium text-slate-600 dark:text-slate-300">
                      Supports 1m, 10m, 100m, or any custom radius
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleUseCurrentGps}
                    disabled={gpsBusy}
                  className="btn-3d-glass rounded-xl px-3.5 py-2 text-xs font-medium inline-flex items-center gap-1.5"
                >
                  <Compass className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                  Use My Current GPS
                </button>
              </div>

              <form onSubmit={handleSaveSettings} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  <div>
                    <label className="block text-xs font-medium uppercase tracking-wider text-slate-700 dark:text-slate-200 mb-1.5">
                      Workplace Latitude
                    </label>
                    <input
                      type="number"
                      step="any"
                      required
                      value={labLat}
                      onChange={(e) => setLabLat(e.target.value)}
                      className="w-full rounded-2xl glass-input px-3.5 py-2.5 text-sm font-mono font-medium"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium uppercase tracking-wider text-slate-700 dark:text-slate-200 mb-1.5">
                      Workplace Longitude
                    </label>
                    <input
                      type="number"
                      step="any"
                      required
                      value={labLng}
                      onChange={(e) => setLabLng(e.target.value)}
                      className="w-full rounded-2xl glass-input px-3.5 py-2.5 text-sm font-mono font-medium"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  <div>
                    <label className="block text-xs font-medium uppercase tracking-wider text-slate-700 dark:text-slate-200 mb-1.5">
                      Allowed Radius (Meters)
                    </label>
                    <input
                      type="number"
                      step="any"
                      min={1}
                      max={10000}
                      required
                      value={radiusMeters}
                      onChange={(e) => setRadiusMeters(e.target.value)}
                      className="w-full rounded-2xl glass-input px-3.5 py-2.5 text-sm font-mono font-medium"
                    />
                    <div className="flex items-center gap-1.5 mt-2">
                      {["1", "10", "50", "100"].map((preset) => (
                        <button
                          key={preset}
                          type="button"
                          onClick={() => setRadiusMeters(preset)}
                          className="btn-3d-glass rounded-lg px-2.5 py-1 text-[11px] font-medium"
                        >
                          {preset}m
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={savingSettings || !loaded || gpsBusy}
                  className="w-full rounded-2xl btn-3d-primary py-3.5 text-sm font-medium disabled:opacity-60 flex items-center justify-center gap-2"
                >
                  {savingSettings ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Saving Settings...
                    </>
                  ) : (
                    <>
                      <Save className="w-4 h-4" />
                      Save GPS Settings
                    </>
                  )}
                </button>
              </form>
            </div>
          </div>


        </div>
      </div>
    </AdminShell>
  );
}
