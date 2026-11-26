import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { verifyVmRegistrationToken } from "@/lib/auth/session";
import { prepareWorkerModel, fetchSessionKey } from "@/lib/catalog/worker-model";

export async function POST(req: NextRequest) {
  const auth = req.headers.get("authorization") || "";
  const session = auth.startsWith("VmToken ") && verifyVmRegistrationToken(auth.slice(8));
  if (!session || !session.vmSecret) return NextResponse.json({ error: "Missing worker session." }, { status: 401 });
  const sessionKey = fetchSessionKey(session.vmSecret);
  const vms = await prisma.vmInstance.findMany({ where: {
    userId: session.userId, sessionGroup: session.sessionGroup, target: { in: session.targets },
    vmSecret: session.vmSecret, status: { in: ["STARTING", "ONLINE", "BUSY"] },
  }, select: { id: true, provider: true } });
  if (!vms.length) return NextResponse.json({ error: "Worker session ended." }, { status: 410 });
  const scope = { vmId: { in: vms.map((v) => v.id) }, sessionKey };
  const body = await req.json();
  const acknowledged: string[] = [];
  const reports = Array.isArray(body.reports) ? body.reports.slice(0, 32) : [];
  for (const report of reports) {
    if (!report || typeof report.id !== "string" || !["downloading", "completed", "failed"].includes(report.status)) continue;
    const number = (value: unknown) => Math.max(0, Number(value) || 0);
    const progressJson = JSON.stringify({
      bytesDone: number(report.bytesDone), totalBytes: number(report.totalBytes),
      percentage: Math.min(100, number(report.percentage)), speedMbps: number(report.speedMbps),
      error: typeof report.error === "string" ? report.error.slice(0, 350) : null,
    });
    await prisma.modelFetch.updateMany({ where: { ...scope, id: report.id, status: { in: ["queued", "downloading"] } },
      data: { status: report.status, progressJson } });
    if (report.status !== "downloading") acknowledged.push(report.id);
  }
  const job = await prisma.modelFetch.findFirst({ where: { ...scope, status: "queued" }, orderBy: { createdAt: "asc" } });
  if (!job) return NextResponse.json({ acknowledged });
  try {
    const asset = await prisma.modelAsset.findFirstOrThrow({ where: { id: job.assetId, userId: session.userId } });
    const request = await prepareWorkerModel(session.userId, vms[0].provider, asset, {
      sourceMode: job.sourceMode, hasDrive: body.driveReady === true, backup: job.backup,
    });
    return NextResponse.json({ acknowledged, command: { id: job.id, request } }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not resolve catalog file.";
    await prisma.modelFetch.updateMany({ where: { ...scope, id: job.id, status: "queued" },
      data: { status: "failed", progressJson: JSON.stringify({ error: message }) } });
    return NextResponse.json({ acknowledged });
  }
}
