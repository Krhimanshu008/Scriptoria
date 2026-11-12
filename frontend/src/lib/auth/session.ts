import jwt from "jsonwebtoken";
import { cookies } from "next/headers";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { ensureDbSchemaReady } from "@/lib/db/ensure-schema";

export const SESSION_COOKIE_NAME = "scriptoria_session";

export interface SessionUser {
  userId: string;
  email: string;
  role: string;
  name?: string | null;
}

export interface VmRegistrationPayload {
  userId: string;
  sessionGroup: string;
  targets: string[];
  vmSecret: string;
}

export interface DefaultVmSlotSpec {
  target: string;
  displayName: string;
  provider: "kaggle" | "colab";
  accountAlias: string;
  sessionGroup: string;
  workerProfile: string;
  internalPort: number;
}

export const DEFAULT_VM_SLOTS: DefaultVmSlotSpec[] = [
  {
    target: "gpu0",
    displayName: "Kaggle GPU 0 (CUDA:0)",
    provider: "kaggle",
    accountAlias: "acc1",
    sessionGroup: "kaggle-acc1",
    workerProfile: "BASE_COMFY",
    internalPort: 8188,
  },
  {
    target: "gpu1",
    displayName: "Kaggle GPU 1 (CUDA:1)",
    provider: "kaggle",
    accountAlias: "acc1",
    sessionGroup: "kaggle-acc1",
    workerProfile: "BASE_COMFY",
    internalPort: 8189,
  },
  {
    target: "gpu2",
    displayName: "Kaggle GPU 2 (CUDA:0, Acc 2)",
    provider: "kaggle",
    accountAlias: "acc2",
    sessionGroup: "kaggle-acc2",
    workerProfile: "IMAGE_GGUF_EDIT",
    internalPort: 8188,
  },
  {
    target: "gpu3",
    displayName: "Kaggle GPU 3 (CUDA:1, Acc 2)",
    provider: "kaggle",
    accountAlias: "acc2",
    sessionGroup: "kaggle-acc2",
    workerProfile: "VIDEO_MOTION",
    internalPort: 8189,
  },
  {
    target: "gcgpu",
    displayName: "Google Colab GPU 0 (T4)",
    provider: "colab",
    accountAlias: "acc1",
    sessionGroup: "colab-acc1",
    workerProfile: "AUDIO_LIPSYNC",
    internalPort: 8188,
  },
  {
    target: "gcgpu1",
    displayName: "Google Colab GPU 1 (T4, Acc 2)",
    provider: "colab",
    accountAlias: "acc2",
    sessionGroup: "colab-acc2",
    workerProfile: "AUDIO_LIPSYNC",
    internalPort: 8188,
  },
];

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET || process.env.ENCRYPTION_KEY;
  if (!secret) {
    throw new Error("JWT_SECRET or ENCRYPTION_KEY environment variable is not defined");
  }
  return secret;
}

export function signSessionToken(user: SessionUser): string {
  return jwt.sign(
    {
      userId: user.userId,
      email: user.email,
      role: user.role,
      name: user.name ?? null,
    },
    getJwtSecret(),
    { expiresIn: "7d" }
  );
}

export function verifySessionToken(token: string): SessionUser | null {
  try {
    const decoded = jwt.verify(token, getJwtSecret()) as SessionUser;
    if (!decoded?.userId || !decoded?.email) return null;
    return decoded;
  } catch {
    return null;
  }
}

export function signVmRegistrationToken(payload: VmRegistrationPayload): string {
  return jwt.sign(payload, getJwtSecret(), { expiresIn: "12h" });
}

export function verifyVmRegistrationToken(token: string): VmRegistrationPayload | null {
  try {
    const decoded = jwt.verify(token, getJwtSecret()) as VmRegistrationPayload;
    if (!decoded?.userId || !decoded?.sessionGroup || !Array.isArray(decoded?.targets)) {
      return null;
    }
    return decoded;
  } catch {
    return null;
  }
}

export async function getSessionUserFast(req?: NextRequest): Promise<SessionUser | null> {
  let token: string | undefined;
  if (req) {
    token = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  } else {
    const cookieStore = await cookies();
    token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  }

  if (!token) return null;
  return verifySessionToken(token);
}

/**
 * Extracts and verifies the authenticated user from cookies and ensures user exists in DB.
 */
export async function getAuthUser(req?: NextRequest): Promise<SessionUser | null> {
  let token: string | undefined;
  if (req) {
    token = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  } else {
    const cookieStore = await cookies();
    token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  }

  if (!token) return null;
  const parsed = verifySessionToken(token);
  if (!parsed) return null;

  await ensureDbSchemaReady();

  const user = await prisma.user.findUnique({
    where: { id: parsed.userId },
    select: { id: true, email: true, role: true, name: true },
  });

  if (!user) return null;
  return {
    userId: user.id,
    email: user.email,
    role: user.role,
    name: user.name,
  };
}

export function shouldUseSecureCookie(req: NextRequest): boolean {
  const proto = req.headers.get("x-forwarded-proto") || req.nextUrl.protocol;
  return proto.replace(/:$/, "") === "https";
}

/**
 * Provisions the 6 default GPU slots for a newly created user.
 */
export async function ensureUserVmSlots(userId: string): Promise<void> {
  await ensureDbSchemaReady();
  for (const slot of DEFAULT_VM_SLOTS) {
    await prisma.vmInstance.upsert({
      where: { userId_target: { userId, target: slot.target } },
      update: {},
      create: {
        userId,
        target: slot.target,
        displayName: slot.displayName,
        provider: slot.provider,
        accountAlias: slot.accountAlias,
        sessionGroup: slot.sessionGroup,
        workerProfile: slot.workerProfile,
        internalPort: slot.internalPort,
        publicUrl: "",
        status: "OFFLINE",
        stepProgress: 0,
      },
    });
  }
}

