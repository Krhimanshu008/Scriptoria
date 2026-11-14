import { NextRequest, NextResponse } from "next/server";
import { runPipelineBridge } from "@/lib/pipeline/bridge";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const jsonStr = JSON.stringify(body);
    const result = await runPipelineBridge("validate_contract", ["-"], jsonStr, 10000);
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json(
      { valid: false, errors: [{ msg: err.message || "Validation failed" }] },
      { status: 400 }
    );
  }
}
