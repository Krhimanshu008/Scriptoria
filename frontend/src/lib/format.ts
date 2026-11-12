export function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return "0 MB";
  const gb = bytes / 1024 ** 3;
  if (gb >= 1) return `${gb.toFixed(2)} GB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

export function formatEta(seconds: number | null | undefined): string {
  if (seconds == null || seconds < 0) return "";
  if (seconds < 60) return `ETA ${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const rem = seconds % 60;
  return `ETA ${mins}m ${rem}s`;
}

export function formatStreamSummary(params: {
  speedMbps: number;
  bytesDone: number;
  totalBytes: number;
  etaSeconds: number | null;
}): string {
  const parts: string[] = [];
  if (params.speedMbps > 0) parts.push(`${params.speedMbps.toFixed(1)} MB/s`);
  if (params.totalBytes > 0) {
    parts.push(`${formatBytes(params.bytesDone)} / ${formatBytes(params.totalBytes)}`);
  }
  const eta = formatEta(params.etaSeconds);
  if (eta) parts.push(eta);
  return parts.length > 0 ? parts.join(" · ") : "Transferring...";
}

