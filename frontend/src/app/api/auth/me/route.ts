import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/session";

export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
  return NextResponse.json({
    user,
    publicRegistrationEnabled: process.env.ALLOW_PUBLIC_REGISTRATION === "true",
  });
}

