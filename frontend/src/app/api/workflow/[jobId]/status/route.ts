import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/session";
import { pollAndSyncWorkflowJob, type JobOutputFile } from "@/lib/workflow/job-status";

export type { JobOutputFile };

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const user = await getAuthUser(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { jobId } = await params;
    const result = await pollAndSyncWorkflowJob(user.userId, jobId);
    if (!result) {
      return NextResponse.json({ error: "Job not found." }, { status: 404 });
    }

    return NextResponse.json({
      jobId: result.jobId,
      status: result.status,
      outputs: result.outputs,
      errorMessage: result.errorMessage,
      executionTimeMs: result.executionTimeMs,
      elapsedMs: result.elapsedMs,
      queueRunning: result.queueRunning,
      queuePending: result.queuePending,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to poll job status";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
