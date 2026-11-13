"use client";

/**
 * Generates a deterministic hardware + browser fingerprint that remains
 * identical across normal tabs AND Incognito / Private browsing windows
 * on the same device & browser.
 */
export async function generateDeviceFingerprint(): Promise<{
  fingerprint: string;
  deviceSummary: string;
}> {
  if (typeof window === "undefined") {
    return { fingerprint: "server-env", deviceSummary: "Server" };
  }

  const components: string[] = [];

  // 1. Platform, CPU cores, Touch points, Screen metrics, Pixel Ratio
  const nav = window.navigator;
  const scr = window.screen;
  components.push(`platform:${nav.platform || "unknown"}`);
  components.push(`cores:${nav.hardwareConcurrency || 0}`);
  components.push(`touch:${nav.maxTouchPoints || 0}`);
  components.push(
    `screen:${scr.width}x${scr.height}x${scr.colorDepth}@${window.devicePixelRatio || 1}`
  );
  components.push(`lang:${nav.language || "en"}`);
  components.push(`ua:${nav.userAgent || ""}`);

  // 2. WebGL GPU Vendor & Renderer (Hardware-bound, identical in Incognito)
  try {
    const canvas = document.createElement("canvas");
    const gl =
      canvas.getContext("webgl") ||
      (canvas.getContext("experimental-webgl") as WebGLRenderingContext | null);
    if (gl) {
      const debugInfo = gl.getExtension("WEBGL_debug_renderer_info");
      if (debugInfo) {
        const vendor = gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) || "";
        const renderer =
          gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) || "";
        components.push(`gpu:${vendor}|${renderer}`);
      }
    }
  } catch {
    components.push("gpu:unavailable");
  }

  // 3. Canvas 2D rendering signature (Engine + OS font rasterization)
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 220;
    canvas.height = 45;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.textBaseline = "top";
      ctx.font = "14px 'Arial'";
      ctx.fillStyle = "#1e3a8a";
      ctx.fillRect(10, 5, 100, 25);
      ctx.fillStyle = "#0f172a";
      ctx.fillText("PKT-GeoLock-v2", 12, 10);
      components.push(`canvas:${canvas.toDataURL().slice(-80)}`);
    }
  } catch {
    components.push("canvas:unavailable");
  }

  const rawString = components.join("||");

  // Hash using SHA-256
  let hashHex = "";
  try {
    const encoder = new TextEncoder();
    const data = encoder.encode(rawString);
    const hashBuffer = await window.crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    hashHex = hashArray
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
      .slice(0, 24)
      .toUpperCase();
  } catch {
    // Fallback hash if crypto.subtle is unavailable on non-HTTPS local IP
    let h = 2166136261;
    for (let i = 0; i < rawString.length; i++) {
      h ^= rawString.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    hashHex = Math.abs(h).toString(16).toUpperCase().padStart(12, "0");
  }

  // Readable device summary for Admin Dashboard
  const isMobile = /Mobile|Android|iPhone|iPad/i.test(nav.userAgent);
  const browserName = /Edg/i.test(nav.userAgent)
    ? "Edge"
    : /Chrome/i.test(nav.userAgent)
    ? "Chrome"
    : /Safari/i.test(nav.userAgent)
    ? "Safari"
    : /Firefox/i.test(nav.userAgent)
    ? "Firefox"
    : "Browser";

  const deviceSummary = `${isMobile ? "Mobile" : "Desktop"} (${browserName}, ${scr.width}x${scr.height}) [ID:${hashHex.slice(0, 8)}]`;

  return {
    fingerprint: `FP-${hashHex}`,
    deviceSummary,
  };
}
