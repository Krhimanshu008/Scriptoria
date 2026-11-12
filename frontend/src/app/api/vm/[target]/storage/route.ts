import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getAuthUser } from "@/lib/auth/session";
import { VmGateway } from "@/lib/orchestrator/vm-gateway";
import {
  GDriveModelStreamer,
  sanitizeModelCategory,
  VmStoredModelItem,
} from "@/lib/orchestrator/rclone-client";

interface SidecarStorageResponse {
  disk?: {
    totalGb: number;
    usedGb: number;
    freeGb: number;
  };
  files?: VmStoredModelItem[];
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ target: string }> }
) {
  try {
    const user = await getAuthUser(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { target } = await params;
    const vm = await prisma.vmInstance.findUnique({
      where: { userId_target: { userId: user.userId, target } },
    });

    if (!vm || vm.status !== "ONLINE" || !vm.publicUrl) {
      return NextResponse.json({ error: `VM ${target} is offline.` }, { status: 400 });
    }

    // Strategy 1: Sidecar :9999 /storage (provides both /tmp disk usage and files)
    if (vm.useRouteLess) {
      try {
        const storage = await VmGateway.callJson<SidecarStorageResponse>(vm, "/storage", {
          method: "GET",
          targetPort: 9999,
          timeoutMs: 6000,
        });
        return NextResponse.json({
          target,
          disk: storage.disk ?? null,
          files: storage.files ?? [],
          source: "sidecar",
        });
      } catch {
        // Already-running older VM without /storage route -> fall through to Rclone :5572
      }
    }

    const files = await GDriveModelStreamer.listVmModelsViaRclone(vm);
    return NextResponse.json({
      target,
      disk: null,
      files,
      source: "rclone",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to inspect VM storage";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ target: string }> }
) {
  try {
    const user = await getAuthUser(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { target } = await params;
    const category = sanitizeModelCategory(req.nextUrl.searchParams.get("category") || "checkpoints");
    const name = (req.nextUrl.searchParams.get("name") || "").replace(/[/\\]/g, "");

    if (!name) {
      return NextResponse.json({ error: "Filename is required." }, { status: 400 });
    }

    const vm = await prisma.vmInstance.findUnique({
      where: { userId_target: { userId: user.userId, target } },
    });
    if (!vm || vm.status !== "ONLINE" || !vm.publicUrl) {
      return NextResponse.json({ error: `VM ${target} is offline.` }, { status: 400 });
    }

    if (vm.useRouteLess) {
      try {
        await VmGateway.callText(
          vm,
          `/storage?category=${encodeURIComponent(category)}&name=${encodeURIComponent(name)}`,
          { method: "DELETE", targetPort: 9999, timeoutMs: 8000 }
        );
        return NextResponse.json({ ok: true, deleted: `${category}/${name}` });
      } catch {
        // Fallback to Rclone deletefile
      }
    }

    await GDriveModelStreamer.deleteVmModelViaRclone(vm, category, name);
    return NextResponse.json({ ok: true, deleted: `${category}/${name}` });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to delete cached model";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

