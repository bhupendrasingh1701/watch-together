// client/src/socket.js
import { io } from "socket.io-client";

/*
  Choose server URL in this order:
    1) import.meta.env.VITE_SERVER_URL (baked at build time by Cloudflare Pages)
    2) import.meta.env.VITE_API_URL (optional alternative)
    3) page origin (useful if serving client+server from same origin)
    4) fallback to http://localhost:3000 (local dev only)
*/

function normalizeForSocketIo(raw) {
  if (!raw) return null;
  raw = raw.replace(/\/$/, ""); // strip trailing slash
  // If already ws/wss, convert to http(s) for socket.io-client
  if (raw.startsWith("wss:")) return raw.replace(/^wss:/, "https:");
  if (raw.startsWith("ws:")) return raw.replace(/^ws:/, "http:");
  return raw;
}

const envVite = import.meta.env?.VITE_SERVER_URL || null;
const envApi = import.meta.env?.VITE_API_URL || null;

let chosen = envVite || envApi || null;

try {
  if (!chosen && typeof window !== "undefined" && window.location && window.location.hostname) {
    // try same origin (useful when serving frontend + backend same origin)
    const proto = window.location.protocol === "https:" ? "https:" : "http:";
    chosen = `${proto}//${window.location.host}`;
  }
} catch (e) {
  // ignore
}

if (!chosen) {
  chosen = "http://localhost:3000"; // local dev fallback
}

const finalUrl = normalizeForSocketIo(chosen);

console.log("CLIENT will connect to server URL:", finalUrl);

export const socket = io(finalUrl, {
  autoConnect: true,
  transports: ["websocket", "polling"]
});
