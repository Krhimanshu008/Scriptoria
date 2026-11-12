export interface KaggleCredentials {
  username: string;
  key: string;
  authType: "bearer" | "basic";
}

export interface PushKernelParams {
  credentials: KaggleCredentials;
  kernelSlug: string;
  pythonCode: string;
  datasetDataSources?: string[];
}

export interface KernelStatusResult {
  status: string;
  failureMessage?: string;
}

export interface KaggleQuotaInfo {
  usedSeconds: number;
  reservedSeconds: number;
  totalAllowedSeconds: number;
  remainingSeconds: number;
  resetAt: string | null;
}

/**
 * Pure HTTP REST Kaggle orchestrator using SaveKernel endpoint (serverless-safe).
 */
export class KaggleOrchestrator {
  private static KAGGLE_BASE_URL = "https://api.kaggle.com/v1";

  private static getHeaders(creds: KaggleCredentials): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (creds.authType === "bearer" || creds.key.startsWith("KGAT_")) {
      headers["Authorization"] = `Bearer ${creds.key}`;
    } else {
      const basicToken = Buffer.from(`${creds.username}:${creds.key}`).toString("base64");
      headers["Authorization"] = `Basic ${basicToken}`;
    }

    return headers;
  }

  /**
   * Packages a Python bootstrap string into a single-cell Jupyter notebook JSON.
   */
  public static wrapPythonAsNotebookJson(pythonCode: string) {
    return {
      cells: [
        {
          cell_type: "markdown",
          metadata: {},
          source: ["# Scriptoria Dynamic GPU Worker\n", "Managed by Scriptoria Control Plane.\n"],
        },
        {
          cell_type: "code",
          execution_count: null,
          metadata: {},
          outputs: [],
          source: pythonCode,
        },
      ],
      metadata: {
        kernelspec: { display_name: "Python 3", language: "python", name: "python3" },
        language_info: { name: "python", version: "3.10.12" },
      },
      nbformat: 4,
      nbformat_minor: 4,
    };
  }

  /**
   * Synchronously pushes and triggers the Kaggle kernel via SaveKernel REST API.
   * Must be awaited inside serverless handlers so Vercel doesn't freeze mid-flight.
   */
  public static async pushKernel(
    params: PushKernelParams
  ): Promise<{ status: string; url: string; kernelSessionId?: number }> {
    const { credentials, kernelSlug, pythonCode, datasetDataSources = [] } = params;
    const notebookJson = this.wrapPythonAsNotebookJson(pythonCode);
    const fullSlug = `${credentials.username}/${kernelSlug}`;

    const payload = {
      slug: fullSlug,
      newTitle: kernelSlug,
      text: JSON.stringify(notebookJson),
      language: "python",
      kernelType: "notebook",
      isPrivate: true,
      enableGpu: true,
      enableTpu: false,
      enableInternet: true,
      machineShape: "NvidiaTeslaT4",
      datasetDataSources, // Empty by default to avoid cross-user 409 conflicts
      competitionDataSources: [],
      kernelDataSources: [],
      modelDataSources: [],
      categoryIds: [],
    };

    const res = await fetch(`${this.KAGGLE_BASE_URL}/kernels.KernelsApiService/SaveKernel`, {
      method: "POST",
      headers: this.getHeaders(credentials),
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`Kaggle SaveKernel failed (${res.status}): ${errBody}`);
    }

    const data = (await res.json().catch(() => ({}))) as {
      url?: string;
      error?: string;
      versionNumber?: number;
      kernelId?: number;
      kernelSessionId?: number;
    };
    if (data.error) {
      throw new Error(`Kaggle SaveKernel error: ${data.error}`);
    }
    return {
      status: "QUEUED",
      url: data.url || `https://www.kaggle.com/code/${fullSlug}`,
      kernelSessionId: typeof data.kernelSessionId === "number" ? data.kernelSessionId : undefined,
    };
  }

  /**
   * Attempts to cancel an active Kaggle kernel session via REST API.
   */
  public static async cancelKernelSession(
    credentials: KaggleCredentials,
    kernelSessionId: number
  ): Promise<{ ok: boolean; errorMessage?: string }> {
    try {
      const res = await fetch(
        `${this.KAGGLE_BASE_URL}/kernels.KernelsApiService/CancelKernelSession`,
        {
          method: "POST",
          headers: this.getHeaders(credentials),
          body: JSON.stringify({ kernelSessionId }),
        }
      );
      if (!res.ok) {
        const txt = await res.text().catch(() => res.statusText);
        return { ok: false, errorMessage: `HTTP ${res.status}: ${txt}` };
      }
      const data = (await res.json().catch(() => ({}))) as { errorMessage?: string };
      return {
        ok: !data.errorMessage,
        errorMessage: data.errorMessage || undefined,
      };
    } catch (err) {
      return {
        ok: false,
        errorMessage: err instanceof Error ? err.message : "Cancel request failed",
      };
    }
  }

  /**
   * Reads redacted stdout/stderr kernel log lines from Kaggle `/kernels/output`.
   */
  public static async getKernelOutput(
    credentials: KaggleCredentials,
    kernelSlug: string
  ): Promise<string[]> {
    const url = `${this.KAGGLE_BASE_URL}/kernels/output?userName=${encodeURIComponent(
      credentials.username
    )}&kernelSlug=${encodeURIComponent(kernelSlug)}`;

    const res = await fetch(url, {
      method: "GET",
      headers: this.getHeaders(credentials),
      cache: "no-store",
    });

    if (!res.ok) {
      return [];
    }

    const data = (await res.json().catch(() => ({}))) as { logNullable?: string };
    if (!data.logNullable) return [];

    try {
      const entries = JSON.parse(data.logNullable) as Array<{
        stream_name?: string;
        time?: number;
        data?: string;
      }>;
      return entries
        .map((e) => String(e.data || "").trim())
        .filter(
          (line) =>
            line.length > 0 &&
            !/token|secret|client_id|refresh_token|REG_JWT|VM_SECRET/i.test(line)
        );
    } catch {
      return [];
    }
  }

  /**
   * Queries Kaggle kernel execution status.
   */
  public static async getKernelStatus(
    credentials: KaggleCredentials,
    kernelSlug: string
  ): Promise<KernelStatusResult> {
    const url = `${this.KAGGLE_BASE_URL}/kernels/status?userName=${encodeURIComponent(
      credentials.username
    )}&kernelSlug=${encodeURIComponent(kernelSlug)}`;

    const res = await fetch(url, {
      method: "GET",
      headers: this.getHeaders(credentials),
      cache: "no-store",
    });

    if (!res.ok) {
      throw new Error(`Kaggle status check failed (${res.status})`);
    }
    return res.json();
  }

  /**
   * Fetches remaining weekly GPU quota statistics from Kaggle REST API.
   */
  public static async getQuota(credentials: KaggleCredentials): Promise<KaggleQuotaInfo> {
    const res = await fetch(`${this.KAGGLE_BASE_URL}/kernels/quota`, {
      method: "GET",
      headers: this.getHeaders(credentials),
      cache: "no-store",
    });

    if (!res.ok) {
      throw new Error(`Kaggle quota check failed (${res.status})`);
    }

    const data = (await res.json()) as {
      quotaRefreshTime?: string;
      gpuQuota?: {
        timeUsed?: { seconds?: number };
        timeReserved?: { seconds?: number };
        totalTimeAllowed?: { seconds?: number };
      };
    };

    const usedSeconds = Number(data.gpuQuota?.timeUsed?.seconds || 0);
    const reservedSeconds = Number(data.gpuQuota?.timeReserved?.seconds || 0);
    const totalAllowedSeconds = Number(data.gpuQuota?.totalTimeAllowed?.seconds || 108000);
    const remainingSeconds = Math.max(0, totalAllowedSeconds - usedSeconds - reservedSeconds);

    return {
      usedSeconds,
      reservedSeconds,
      totalAllowedSeconds,
      remainingSeconds,
      resetAt: data.quotaRefreshTime ?? null,
    };
  }
}

