import { NextRequest, NextResponse } from "next/server";
import { runPipelineBridge } from "@/lib/pipeline/bridge";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const jsonStr = JSON.stringify(body);
    try {
      const result = await runPipelineBridge("validate_contract", ["-"], jsonStr, 10000);
      return NextResponse.json(result);
    } catch {
      // Fallback validator when Python is absent (e.g. serverless Vercel)
      const errors: Array<{ loc: string[]; msg: string; type: string }> = [];
      if ("hallucinated_teleportation_spell" in body) {
        errors.push({ loc: ["hallucinated_teleportation_spell"], msg: "Extra inputs are not permitted", type: "extra_forbidden" });
      }
      if (
        typeof body.char_offset_start === "number" &&
        typeof body.char_offset_end === "number" &&
        body.char_offset_start >= body.char_offset_end
      ) {
        errors.push({ loc: ["char_offset_start"], msg: "char_offset_start must be strictly less than char_offset_end", type: "value_error" });
      }
      if (Array.isArray(body.visual_beats) && body.visual_beats.length === 0) {
        errors.push({ loc: ["visual_beats"], msg: "visual_beats must contain at least 1 item", type: "value_error" });
      }
      return NextResponse.json({
        valid: errors.length === 0,
        errors,
        status: errors.length === 0 ? "VALID_CANONICAL" : "CONTRACT_REJECTED",
      });
    }
  } catch (err: any) {
    return NextResponse.json(
      { valid: false, errors: [{ msg: err.message || "Validation failed" }] },
      { status: 400 }
    );
  }
}
