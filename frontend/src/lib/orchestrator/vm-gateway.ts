export interface VmEndpointTarget {
  publicUrl: string;
  vmSecret?: string | null;
  internalPort: number;
  useRouteLess: boolean;
}

export interface VmGatewayRequestOptions extends RequestInit {
  targetPort?: number;
  timeoutMs?: number;
}

/**
 * Server-side gateway for communicating securely with remote GPU VMs.
 * Routes through Caddy port multiplexer (:8000) using X-VM-Secret + X-Target-Port
 * when useRouteLess is true, or falls back to direct legacy URLs.
 */
export class VmGateway {
  public static async call(
    vm: VmEndpointTarget,
    path: string,
    options: VmGatewayRequestOptions = {}
  ): Promise<Response> {
    if (!vm.publicUrl) {
      throw new Error("VM has no registered tunnel URL yet");
    }

    const baseUrl = vm.publicUrl.replace(/\/$/, "");
    const cleanPath = path.startsWith("/") ? path : `/${path}`;
    const port = options.targetPort ?? vm.internalPort ?? 8188;
    const timeoutMs = options.timeoutMs ?? 15000;

    const headers = new Headers(options.headers);
    if (vm.useRouteLess) {
      headers.set("X-Target-Port", String(port));
      if (vm.vmSecret) {
        headers.set("X-VM-Secret", vm.vmSecret);
      }
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(`${baseUrl}${cleanPath}`, {
        ...options,
        headers,
        cache: "no-store",
        signal: controller.signal,
      });
      return response;
    } finally {
      clearTimeout(timer);
    }
  }

  public static async callJson<T = unknown>(
    vm: VmEndpointTarget,
    path: string,
    options: VmGatewayRequestOptions = {}
  ): Promise<T> {
    const headers = new Headers(options.headers);
    if (options.body && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }

    const res = await this.call(vm, path, { ...options, headers });
    if (!res.ok) {
      const errText = await res.text().catch(() => res.statusText);
      throw new Error(`VM call ${path} (port ${options.targetPort ?? vm.internalPort}) failed (${res.status}): ${errText}`);
    }
    return res.json() as Promise<T>;
  }

  public static async callText(
    vm: VmEndpointTarget,
    path: string,
    options: VmGatewayRequestOptions = {}
  ): Promise<string> {
    const headers = new Headers(options.headers);
    if (options.body && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }

    const res = await this.call(vm, path, { ...options, headers });
    const bodyText = await res.text().catch(() => res.statusText);
    if (!res.ok) {
      throw new Error(`VM call ${path} (port ${options.targetPort ?? vm.internalPort}) failed (${res.status}): ${bodyText}`);
    }
    return bodyText;
  }

  /**
   * Sends termination signal to the VM's in-band sidecar on port 9999.
   */
  public static async killVm(vm: VmEndpointTarget): Promise<boolean> {
    try {
      const res = await this.call(vm, "/vm-kill", {
        method: "POST",
        targetPort: vm.useRouteLess ? 9999 : vm.internalPort,
        timeoutMs: 5000,
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * Sends hot-reload signal to the VM's in-band sidecar on port 9999.
   * Restarts child worker processes in <3s without terminating the container or re-downloading models.
   */
  public static async hotReloadWorker(
    vm: VmEndpointTarget,
    payload: { profile?: string } = {}
  ): Promise<{ ok: boolean; status?: string; message?: string }> {
    try {
      const res = await this.callJson<{ ok: boolean; status?: string; message?: string }>(
        vm,
        "/worker/restart",
        {
          method: "POST",
          targetPort: 9999,
          timeoutMs: 8000,
          body: JSON.stringify(payload),
        }
      );
      return res;
    } catch (e: any) {
      return { ok: false, message: e.message || String(e) };
    }
  }
}

