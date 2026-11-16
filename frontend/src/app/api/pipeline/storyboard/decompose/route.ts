import { NextResponse, type NextRequest } from "next/server";
import { forwardToFastAPI } from "@/lib/bridge/server-client";
import { prisma } from "@/lib/db/prisma";
import { getAuthUser } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const extraHeaders: Record<string, string> = {};

  try {
    const user = await getAuthUser(req);
    let vms = user
      ? await prisma.vmInstance.findMany({
          where: {
            userId: user.userId,
            status: { in: ["ONLINE", "BUSY"] },
          },
        })
      : [];

    if (!vms || vms.length === 0) {
      vms = await prisma.vmInstance.findMany({
        where: {
          status: { in: ["ONLINE", "BUSY"] },
        },
      });
    }

      const acc1 = vms.find((v) => v.accountAlias === "acc1" && v.publicUrl);
      const acc2 = vms.find((v) => v.accountAlias === "acc2" && v.publicUrl);

      // Acc 2 (Qwen 27B Turbo) is primary Director Brain
      if (acc2?.publicUrl) {
        extraHeaders["X-Director-Tunnel-Url"] = acc2.publicUrl;
        if (acc2.vmSecret) extraHeaders["X-Director-VM-Secret"] = acc2.vmSecret;
      } else if (acc1?.publicUrl) {
        extraHeaders["X-Director-Tunnel-Url"] = acc1.publicUrl;
        if (acc1.vmSecret) extraHeaders["X-Director-VM-Secret"] = acc1.vmSecret;
      }

      // Acc 1 (5M-SWARM) is primary Cinematographer & QC Brain
      if (acc1?.publicUrl) {
        extraHeaders["X-Cinematographer-Tunnel-Url"] = acc1.publicUrl;
        if (acc1.vmSecret) extraHeaders["X-Cinematographer-VM-Secret"] = acc1.vmSecret;
      }
    }
  } catch {
    // Non-fatal: fall back to default tunnel resolution in FastAPI
  }

  return forwardToFastAPI({
    req,
    method: "POST",
    upstreamPath: "/api/v1/storyboard/decompose",
    timeoutMs: 180_000,
    extraHeaders,
  });
}
