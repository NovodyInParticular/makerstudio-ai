// Control link to a real drone running MakerStudio's drone code: UDP packets with the sticks
// (16 bytes, see the drone's README) and JSON telemetry back. The computer must be on the
// drone's Wi-Fi. Sending stops with stop(); the drone cuts its motors 0.5 s after the last packet.

import dgram from "node:dgram";

/** climb (-1..1) and hold are used when the drone has a height sensor (height hold). */
export interface DroneSticks { throttle: number; roll: number; pitch: number; yaw: number; arm: boolean; climb?: number; hold?: boolean }
export interface DroneTelemetry { armed: boolean; roll: number; pitch: number; yaw: number; volts: number; loopHz: number; calibrated: boolean; height: number | null; holding: boolean; at: number }

let socket: dgram.Socket | null = null;
let target: { host: string; port: number } | null = null;
let seq = 0;

export function packet(s: DroneSticks, sequence: number): Buffer {
  const b = Buffer.alloc(16);
  b.write("MSD1", 0, "ascii");
  b.writeUInt16LE(sequence & 0xffff, 4);
  const i16 = (v: number, lo: number) => Math.round(Math.max(lo, Math.min(1, Number.isFinite(v) ? v : 0)) * 1000);
  b.writeInt16LE(i16(s.throttle, 0), 6);
  b.writeInt16LE(i16(s.roll, -1), 8);
  b.writeInt16LE(i16(s.pitch, -1), 10);
  b.writeInt16LE(i16(s.yaw, -1), 12);
  b.writeUInt8((s.arm ? 1 : 0) | (s.hold ? 2 : 0), 14);
  b.writeInt8(Math.round(Math.max(-1, Math.min(1, Number.isFinite(s.climb) ? s.climb! : 0)) * 100), 15);
  return b;
}

export function startLink(host: string, port: number, onTelemetry: (t: DroneTelemetry) => void): void {
  void stopLink();
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || port < 1 || port > 65535) throw new Error("Give the drone's IP address (192.168.4.1) and port (4210).");
  target = { host, port };
  socket = dgram.createSocket("udp4");
  socket.on("message", (msg) => {
    try {
      const t = JSON.parse(msg.toString("utf8"));
      onTelemetry({ armed: !!t.armed, roll: +t.roll || 0, pitch: +t.pitch || 0, yaw: +t.yaw || 0, volts: +t.volts || 0, loopHz: +t.loopHz || 0, calibrated: !!t.calibrated, height: typeof t.height === "number" && t.height >= 0 ? t.height : null, holding: !!t.hold, at: Date.now() });
    } catch { /* not telemetry */ }
  });
  socket.on("error", () => { void stopLink(); });
  socket.bind();
}

export function sendSticks(s: DroneSticks): void {
  if (!socket || !target) return;
  socket.send(packet(s, seq++), target.port, target.host);
}

export function stopLink(): Promise<void> {
  const s = socket, t = target;
  socket = null;
  target = null;
  if (!s) return Promise.resolve();
  const close = () => { try { s.close(); } catch { /* already closed */ } };
  if (!t) { close(); return Promise.resolve(); }
  // A last "disarmed" packet so the drone stops at once rather than after its timeout.
  // Sending is asynchronous: close only once it has gone (closing first would drop it).
  return new Promise((done) => {
    const fallback = setTimeout(() => { close(); done(); }, 200);
    try {
      s.send(packet({ throttle: 0, roll: 0, pitch: 0, yaw: 0, arm: false }, seq++), t.port, t.host, () => { clearTimeout(fallback); close(); done(); });
    } catch { clearTimeout(fallback); close(); done(); }
  });
}
