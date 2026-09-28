import { useEffect, useState } from "react";
import { lanRequest, type Device, type DeviceStatus } from "./api";
export function useLanPeers() {
  const [peers, setPeers] = useState<Device[]>([]);
  useEffect(() => {
    const controller = new AbortController();
    let busy = false;
    const refresh = async () => {
      if (busy) return;
      busy = true;
      try {
        const status = await lanRequest<DeviceStatus>("/status", "GET", undefined, controller.signal);
        if (!controller.signal.aborted) setPeers(status.enabled ? status.peers : []);
      } catch { if (!controller.signal.aborted) setPeers([]); }
      finally { busy = false; }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 3000);
    return () => { controller.abort(); clearInterval(timer); };
  }, []);
  return peers;
}
