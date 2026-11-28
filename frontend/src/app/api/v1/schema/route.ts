import { NextRequest, NextResponse } from "next/server";
import { getPublicOpenApiSchemaDoc } from "@/lib/batch/ingestion-spec";
import { resolveRequestOrigin } from "@/lib/gdrive/oauth-config";

export async function GET(req: NextRequest) {
  const origin = resolveRequestOrigin(req);
  return NextResponse.json(getPublicOpenApiSchemaDoc(origin));
}

