"use client";

import { useEffect, useState } from "react";

interface NetworkInformationLike {
  saveData?: boolean;
  effectiveType?: string;
}

/**
 * True when the visitor has asked for reduced data (Save-Data / Lite mode) or
 * is on a 2G-class connection. Video slots fall back to stills in that case —
 * much of the audience browses on metered mobile data.
 */
export function useSaveData(): boolean {
  const [saveData, setSaveData] = useState(false);

  useEffect(() => {
    const connection = (navigator as Navigator & { connection?: NetworkInformationLike })
      .connection;
    if (!connection) return;
    const slow = connection.effectiveType === "slow-2g" || connection.effectiveType === "2g";
    setSaveData(Boolean(connection.saveData) || slow);
  }, []);

  return saveData;
}
