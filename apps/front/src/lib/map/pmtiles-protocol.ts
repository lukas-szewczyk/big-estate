import maplibregl from "maplibre-gl";
import { Protocol } from "pmtiles";

let protocolInstance: Protocol | null = null;
let protocolRefCount = 0;

export function acquirePmtilesProtocol(): void {
  if (typeof window === "undefined") {
    return;
  }

  if (!protocolInstance) {
    protocolInstance = new Protocol();
    maplibregl.addProtocol("pmtiles", protocolInstance.tile);
  }

  protocolRefCount += 1;
}

export function releasePmtilesProtocol(): void {
  if (typeof window === "undefined" || protocolRefCount === 0) {
    return;
  }

  protocolRefCount -= 1;

  if (protocolRefCount === 0) {
    maplibregl.removeProtocol("pmtiles");
    protocolInstance = null;
  }
}
