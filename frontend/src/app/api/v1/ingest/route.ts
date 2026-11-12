import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth/api-token";
import { normalizeExternalPayload } from "@/lib/batch/ingestion-spec";
import { createBatchFromSpec, tickBatchScheduler } from "@/lib/batch/scheduler";

export async function POST(req: NextRequest) {
  try {
    const auth = await getAuthContext(req);
    if (!auth) {
      return NextResponse.json(
        { error: "Unauthorized. Provide a dashboard session or Bearer sk_scriptoria_... API key." },
        { status: 401 }
      );
    }
    if (!auth.scopes.includes("ingest") && !auth.scopes.includes("admin")) {
      return NextResponse.json({ error: "API token lacks 'ingest' scope." }, { status: 403 });
    }

    const dryRun = req.nextUrl.searchParams.get("dryRun") === "true";
    const body = (await req.json()) as Record<string, unknown>;

    const spec = await normalizeExternalPayload(auth.userId, body);
    const plan = await createBatchFromSpec({
      userId: auth.userId,
      spec,
      dryRun,
    });

    if (dryRun || !plan.batchId) {
      return NextResponse.json({
        ok: true,
        dryRun: true,
        normalizedBy: spec.normalizedBy,
        adapterNotes: spec.adapterNotes,
        spec,
        ...plan,
      });
    }

    // Trigger initial affinity scheduler tick immediately
    const tick = await tickBatchScheduler(auth.userId, plan.batchId).catch(() => null);

    return NextResponse.json({
      ok: true,
      dryRun: false,
      batchId: plan.batchId,
      reusedExisting: plan.reusedExisting,
      normalizedBy: spec.normalizedBy,
      adapterNotes: spec.adapterNotes,
      coalesceSummary: plan.coalesceSummary,
      dispatchedOnFirstTick: tick?.dispatched ?? [],
      statusUrl: `/api/v1/batch/${plan.batchId}`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to ingest batch payload";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

