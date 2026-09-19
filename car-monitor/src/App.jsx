import { useEffect, useState } from "react";
import MapPanel from "@/components/MapPanel";
import BatteryPanel from "@/components/BatteryPanel";
import OdometerPanel from "@/components/OdometerPanel";
import TruckSelector from "@/components/TruckSelector";

// Where the Go backend lives. REST for the initial load, WebSocket for live pushes.
const API_URL = "";
const WS_URL = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;

const TABS = ["Overview", "Battery", "Trips", "Alerts"];

export default function App() {
  const [fleet, setFleet] = useState([]); // starts empty; filled by the backend
  const [selectedId, setSelectedId] = useState("CMT-01");
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    // 1) One-shot fetch so the page has data immediately.
    fetch(`${API_URL}/api/trucks`)
      .then((r) => r.json())
      .then(setFleet)
      .catch((err) => console.error("initial fetch failed:", err));

    // 2) Open the WebSocket. Every message is a full fleet snapshot in the
    //    exact same shape as the mock — so setFleet is all we need.
    const ws = new WebSocket(WS_URL);
    ws.onopen = () => setConnected(true);
    ws.onclose = () => setConnected(false);
    ws.onmessage = (e) => setFleet(JSON.parse(e.data));

    return () => ws.close(); // cleanup when the component unmounts
  }, []);

  const truck = fleet.find((t) => t.id === selectedId) ?? fleet[0];

  // Nothing yet (backend not reached, or first message still in flight).
  if (!truck) {
    return (
      <div className="flex h-screen items-center justify-center text-muted-foreground">
        Connecting to backend at {API_URL}…
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col gap-3.5 p-3.5">
      <header className="flex items-center gap-6 rounded-2xl border bg-card px-4 py-2.5">
        <div className="flex items-center gap-2.5 font-semibold">
          <span className="size-3.5 rounded-full bg-primary shadow-[0_0_12px_var(--primary)]" />
          <span>Cement Truck Monitor</span>
        </div>
        <nav className="flex gap-1.5">
          {TABS.map((t, i) => (
            <span
              key={t}
              className={
                "cursor-pointer rounded-lg px-3 py-1.5 text-sm " +
                (i === 0
                  ? "bg-secondary text-foreground"
                  : "text-muted-foreground hover:text-foreground")
              }
            >
              {t}
            </span>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-3">
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className={"size-2 rounded-full " + (connected ? "bg-ok" : "bg-bad")} />
            {connected ? "live" : "disconnected"}
          </span>
          <TruckSelector fleet={fleet} selectedId={selectedId} onSelect={setSelectedId} />
        </div>
      </header>

      <main className="grid min-h-0 flex-1 grid-cols-1 gap-3.5 md:grid-cols-[1.4fr_1fr] md:grid-rows-[1.4fr_1fr]">
        <MapPanel truck={truck} className="md:col-start-1 md:row-start-1" />
        <OdometerPanel truck={truck} className="md:col-start-1 md:row-start-2" />
        <BatteryPanel truck={truck} className="md:col-start-2 md:row-start-1 md:row-span-2" />
      </main>
    </div>
  );
}
