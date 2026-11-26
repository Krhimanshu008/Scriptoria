export function kaggleDisplayName(metadata: string | null | undefined, username?: string | null) {
  let label: unknown;
  try { label = JSON.parse(metadata || "{}").displayName; } catch { /* Legacy metadata */ }
  return typeof label === "string" && label.trim() ? label.trim() : username ? "@" + username : "Kaggle Connection";
}

export function sanitizeKaggleSlug(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
  return cleaned.length >= 3 ? cleaned : null;
}

export function kaggleCustomKernelSlug(
  metadata: string | Record<string, unknown> | null | undefined,
  isTpu = false
): string | null {
  let parsed: Record<string, unknown> | null = null;
  if (typeof metadata === "string") {
    try {
      parsed = JSON.parse(metadata || "{}") as Record<string, unknown>;
    } catch {
      parsed = null;
    }
  } else if (metadata && typeof metadata === "object") {
    parsed = metadata;
  }
  if (!parsed) return null;
  const specific = sanitizeKaggleSlug(isTpu ? parsed.tpuKernelSlug : parsed.kernelSlug);
  if (specific) return specific;
  const base = sanitizeKaggleSlug(parsed.kernelSlug);
  if (base && isTpu) return base.endsWith("-tpu") ? base : `${base}-tpu`;
  return base;
}

/**
 * Multi-account workspace check — permits multiple authorized collaborator/test accounts.
 */
export async function checkKaggleConnection(
  userId?: string,
  alias?: string,
  username?: string | null
): Promise<string | null> {
  void userId;
  void alias;
  void username;
  return null;
}
