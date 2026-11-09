// Upload: talk to a real board over USB. Flash a firmware image, upload a PlatformIO project
// (like the code Display / Robotics Studio export), and read the board's serial output.

import { useEffect, useRef, useState } from "react";
import type { DeviceEvent, DevicePort } from "../../shared/ipc";
import { useUi } from "../state";

const BAUDS = [9600, 57600, 115200, 230400, 460800, 921600];
let listening = false;
const listeners = new Set<(e: DeviceEvent) => void>();

export function DevicePage() {
  const [ports, setPorts] = useState<DevicePort[] | null>(null);
  const [port, setPort] = useState<string>("");
  const [tools, setTools] = useState<{ pio: string | null; esptool: string | null; python: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [log, setLog] = useState<{ job: string; text: string }[]>([]);
  const [monitor, setMonitor] = useState(false);
  const [baud, setBaud] = useState(115200);
  const [address, setAddress] = useState("0x0");
  const [send, setSend] = useState("");
  const end = useRef<HTMLDivElement>(null);

  const refresh = async () => {
    const r = await window.makerstudio.devicePorts();
    if (!r.ok) { setError(r.error); setPorts([]); return; }
    setError(null);
    setPorts(r.value);
    if (!r.value.some((p) => p.port === port)) setPort(r.value[0]?.port ?? "");
  };
  useEffect(() => {
    void window.makerstudio.deviceTools().then((r) => r.ok && setTools(r.value));
    void refresh();
    const t = setInterval(() => void refresh(), 3000);
    if (!listening) { listening = true; window.makerstudio.onDeviceEvent((e) => listeners.forEach((l) => l(e))); }
    const onEvent = (e: DeviceEvent) => {
      if (e.kind === "line") setLog((l) => [...l.slice(-1500), { job: e.job, text: e.text }]);
      else {
        setLog((l) => [...l, { job: e.job, text: e.ok ? `✔ ${e.message}` : `✘ ${e.message}` }]);
        if (e.job === "monitor") setMonitor(false); else setBusy(null);
        if (e.job !== "monitor") useUi.getState().notify(e.ok ? "success" : "error", e.ok ? `${e.job === "flash" ? "Flashing" : "Upload"} finished.` : `${e.job === "flash" ? "Flashing" : "Upload"} failed: ${e.message} See the log.`);
      }
    };
    listeners.add(onEvent);
    return () => { clearInterval(t); listeners.delete(onEvent); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [log]);

  const act = async (job: "flash" | "upload", fn: () => Promise<{ ok: boolean; value?: string | null; error?: string }>) => {
    if (monitor) { window.makerstudio.deviceStop("monitor"); setMonitor(false); } // the port can only be used by one program
    setBusy(job);
    const r = await fn();
    if (!r.ok) { setBusy(null); useUi.getState().notify("error", r.error ?? "Failed."); return; }
    if (r.value === null) { setBusy(null); return; } // cancelled
    setLog((l) => [...l, { job, text: `— ${job === "flash" ? "Flashing" : "Building and uploading"} ${r.value} —` }]);
  };

  const missing = tools && (!tools.pio || !tools.esptool);
  return (
    <div className="page device-page">
      <header className="page-header">
        <h1>Upload</h1>
        <p className="muted">Plug a board in with a USB data cable. Flash a firmware image, upload code you exported, and read what the board prints.</p>
      </header>
      <div className="grid-2">
        <section className="card" data-testid="device-board">
          <h2>Board</h2>
          {ports === null ? <p className="muted small">Looking for boards…</p> : ports.length === 0 ? (
            <p className="small" data-testid="device-none">
              No board found. Plug it in with a <b>data</b> cable (some cables only charge). On ESP32 boards, hold <b>BOOT</b> while plugging in if it does not show up.
              On Linux your user needs access to serial ports (group <code>uucp</code> on Arch / Omarchy, <code>dialout</code> on Debian/Ubuntu).
            </p>
          ) : (
            <label className="field"><span>Port</span>
              <select value={port} onChange={(e) => setPort(e.target.value)} data-testid="device-port">
                {ports.map((p) => <option key={p.port} value={p.port}>{p.port} · {p.description}</option>)}
              </select>
            </label>
          )}
          {error && <p className="warn small">{error}</p>}
          {missing && <p className="warn small">PlatformIO{tools?.esptool ? "" : " and its esptool"} not found. Install PlatformIO and build any ESP32 project once; MakerStudio uses its tools.</p>}
          <h3>Flash a firmware image</h3>
          <p className="muted small">A ready-made .img / .bin (for example retro-go for the Doom handheld). It replaces everything on the board.</p>
          <div className="button-row">
            <label className="field inline"><span>Address</span><input value={address} onChange={(e) => setAddress(e.target.value)} style={{ width: 90 }} data-testid="device-address" /></label>
            <button className="btn primary" disabled={!port || !!busy} onClick={() => void act("flash", () => window.makerstudio.deviceFlash(port, address))} data-testid="device-flash">Flash image…</button>
          </div>
          <h3>Upload code</h3>
          <p className="muted small">A PlatformIO project folder, like the code Display Studio and Robotics Studio export. It is built, then uploaded.</p>
          <button className="btn primary" disabled={!!busy || (ports !== null && ports.length === 0)} onClick={() => void act("upload", () => window.makerstudio.deviceUpload(port || null))} data-testid="device-upload">Build and upload…</button>
          {busy && (
            <div className="button-row">
              <span className="small">{busy === "flash" ? "Flashing…" : "Building and uploading…"} (do not unplug)</span>
              <button className="btn plain small" onClick={() => window.makerstudio.deviceStop(busy as "flash" | "upload")}>Stop</button>
            </div>
          )}
        </section>
        <section className="card" data-testid="device-monitor">
          <h2>Serial monitor</h2>
          <div className="button-row">
            <select value={baud} onChange={(e) => setBaud(Number(e.target.value))} data-testid="device-baud">{BAUDS.map((b) => <option key={b} value={b}>{b} baud</option>)}</select>
            {monitor
              ? <button className="btn plain" onClick={() => window.makerstudio.deviceStop("monitor")} data-testid="device-monitor-stop">Stop</button>
              : <button className="btn primary" disabled={!port || !!busy} onClick={async () => { const r = await window.makerstudio.deviceMonitor(port, baud); if (r.ok) { setMonitor(true); setLog((l) => [...l, { job: "monitor", text: `— Listening on ${port} at ${baud} baud —` }]); } else useUi.getState().notify("error", r.error); }} data-testid="device-monitor-start">Start</button>}
            <button className="btn plain small" onClick={() => setLog([])}>Clear</button>
          </div>
          <div className="device-log" data-testid="device-log">
            {log.length === 0 && <span className="muted">Output from flashing, uploading and the board appears here.</span>}
            {log.map((l, i) => <div key={i} className={`log-${l.job}`}>{l.text}</div>)}
            <div ref={end} />
          </div>
          {monitor && (
            <form className="button-row" onSubmit={(e) => { e.preventDefault(); if (send) void window.makerstudio.deviceSend(send).then(() => setSend("")); }}>
              <input value={send} onChange={(e) => setSend(e.target.value)} placeholder="Send to the board (e.g. 1 to play animation 1)" style={{ flex: 1 }} />
              <button className="btn plain small" type="submit">Send</button>
            </form>
          )}
          <p className="muted small">Your exported robot faces listen here too: type 0-9 to play an animation, i for idle life.</p>
        </section>
      </div>
    </div>
  );
}
