import { VmInstance } from "@prisma/client";

export interface PublicVmInstance {
  id: string;
  target: string;
  displayName: string;
  provider: string;
  accountAlias: string;
  sessionGroup: string;
  internalPort: number;
  publicUrl: string;
  useRouteLess: boolean;
  status: string;
  stepProgress: number;
  lastHeartbeat: string | null;
  onlineSince: string | null;
  latencyMs: number | null;
  vramTotalGb: number | null;
  vramUsedGb: number | null;
  gpuName: string | null;
  lastError: string | null;
  uptimeSeconds: number;
}

const TARGET_ORDER = ["gpu0", "gpu1", "gpu2", "gpu3", "gcgpu", "gcgpu1"];

export function sortVmsByCanonicalTarget(vms: VmInstance[]): VmInstance[] {
  return [...vms].sort((a, b) => {
    const ia = TARGET_ORDER.indexOf(a.target);
    const ib = TARGET_ORDER.indexOf(b.target);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });
}

export function sanitizeVmForClient(vm: VmInstance): PublicVmInstance {
  let uptimeSeconds = 0;
  if (vm.onlineSince && (vm.status === "ONLINE" || vm.status === "BUSY")) {
    uptimeSeconds = Math.max(0, Math.floor((Date.now() - vm.onlineSince.getTime()) / 1000));
  }

  return {
    id: vm.id,
    target: vm.target,
    displayName: vm.displayName || vm.target.toUpperCase(),
    provider: vm.provider,
    accountAlias: vm.accountAlias,
    sessionGroup: vm.sessionGroup,
    internalPort: vm.internalPort,
    publicUrl: vm.publicUrl,
    useRouteLess: vm.useRouteLess,
    status: vm.status,
    stepProgress: vm.stepProgress,
    lastHeartbeat: vm.lastHeartbeat ? vm.lastHeartbeat.toISOString() : null,
    onlineSince: vm.onlineSince ? vm.onlineSince.toISOString() : null,
    latencyMs: vm.latencyMs,
    vramTotalGb: vm.vramTotalGb,
    vramUsedGb: vm.vramUsedGb,
    gpuName: vm.gpuName,
    lastError: vm.lastError,
    uptimeSeconds,
  };
}

