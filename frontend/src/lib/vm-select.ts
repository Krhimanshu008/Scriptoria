import type { PublicVmInstance } from "@/lib/orchestrator/vm-helpers";

/**
 * Resolves the active GPU target with Online-First priority (ONLINE -> BUSY -> STARTING).
 */
export function resolvePreferredVmTarget(
  vms: PublicVmInstance[],
  currentTarget: string,
  manualPinned = false
): string {
  if (!vms.length) return currentTarget || "gpu0";

  const currentVm = vms.find((v) => v.target === currentTarget);
  if (currentVm) {
    if (manualPinned) return currentTarget;
    if (
      currentVm.status === "ONLINE" ||
      currentVm.status === "BUSY" ||
      currentVm.status === "STARTING"
    ) {
      return currentTarget;
    }
  }

  const onlineVm = vms.find((v) => v.status === "ONLINE");
  if (onlineVm) return onlineVm.target;

  const busyVm = vms.find((v) => v.status === "BUSY");
  if (busyVm) return busyVm.target;

  const startingVm = vms.find((v) => v.status === "STARTING");
  if (startingVm) return startingVm.target;

  return currentVm ? currentTarget : vms[0].target;
}

