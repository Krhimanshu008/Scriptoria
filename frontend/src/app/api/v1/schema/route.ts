import { NextRequest, NextResponse } from "next/server";
import { getPublicOpenApiSchemaDoc } from "@/lib/batch/ingestion-spec";

export async function GET(req: NextRequest) {
  const origin = req.nextUrl.origin;
  return NextResponse.json(getPublicOpenApiSchemaDoc(origin));
}

