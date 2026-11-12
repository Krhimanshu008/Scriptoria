import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getAuthUser } from "@/lib/auth/session";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ target: string }> }
) {
  const user = await getAuthUser(req);
  if (!user) {
    return NextResponse.redirect(new URL("/login", req.nextUrl.origin));
  }

  const { target } = await params;
  const vm = await prisma.vmInstance.findUnique({
    where: { userId_target: { userId: user.userId, target } },
  });

  if (!vm || vm.status !== "ONLINE" || !vm.publicUrl) {
    return NextResponse.json(
      { error: `GPU ${target} is not online yet.` },
      { status: 400 }
    );
  }

  const base = vm.publicUrl.replace(/\/$/, "");
  if (vm.useRouteLess && vm.vmSecret) {
    const authUrl = new URL(`${base}/scriptoria-auth`);
    authUrl.searchParams.set("token", vm.vmSecret);
    authUrl.searchParams.set("port", String(vm.internalPort || 8188));
    return NextResponse.redirect(authUrl.toString());
  }

  return NextResponse.redirect(base);
}

