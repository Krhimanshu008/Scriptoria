import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json({
    error: "Standalone Kaggle mirroring has been retired. Fetch a model from the catalog on your worker to use optional Drive backup.",
  }, { status: 410 });
}
