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
    target: "gpu4",
    displayName: "Kaggle GPU 4 (CUDA:0, Acc 3)",
    provider: "kaggle",
    accountAlias: "acc3",
    sessionGroup: "kaggle-acc3",
    workerProfile: "BASE_COMFY",
    internalPort: 8188,
  },
  {
    target: "gpu5",
    displayName: "Kaggle GPU 5 (CUDA:1, Acc 3)",
    provider: "kaggle",
    accountAlias: "acc3",
    sessionGroup: "kaggle-acc3",
    workerProfile: "BASE_COMFY",
    internalPort: 8189,
  },
  {
    target: "gpu6",
    displayName: "Kaggle GPU 6 (CUDA:0, Acc 4)",
    provider: "kaggle",
    accountAlias: "acc4",
    sessionGroup: "kaggle-acc4",
    workerProfile: "BASE_COMFY",
    internalPort: 8188,
  },
  {
    target: "gpu7",
    displayName: "Kaggle GPU 7 (CUDA:1, Acc 4)",
    provider: "kaggle",
    accountAlias: "acc4",
    sessionGroup: "kaggle-acc4",
    workerProfile: "BASE_COMFY",
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
  {
    target: "tpu0",
    displayName: "Kaggle TPU 0 (v5e-8 · Acc 1)",
    provider: "kaggle",
    accountAlias: "acc1",
    sessionGroup: "kaggle-tpu-acc1",
    workerProfile: "TPU_QWEN27B_V5E",
    internalPort: 8000,
  },
  {
    target: "tpu1",
    displayName: "Kaggle TPU 1 (v5e-8 · Acc 2)",
    provider: "kaggle",
    accountAlias: "acc2",
    sessionGroup: "kaggle-tpu-acc2",
    workerProfile: "TPU_QWEN27B_V5E",
    internalPort: 8000,
  },
  {
    target: "tpu2",
    displayName: "Kaggle TPU 2 (v5e-8 · Acc 3)",
    provider: "kaggle",
    accountAlias: "acc3",
    sessionGroup: "kaggle-tpu-acc3",
    workerProfile: "TPU_QWEN27B_V5E",
    internalPort: 8000,
  },
  {
    target: "tpu3",
    displayName: "Kaggle TPU 3 (v5e-8 · Acc 4)",
    provider: "kaggle",
    accountAlias: "acc4",
    sessionGroup: "kaggle-tpu-acc4",
    workerProfile: "TPU_QWEN27B_V5E",
    internalPort: 8000,
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

const authUserCache = new Map<string, { user: SessionUser; expiresAt: number }>();
const AUTH_CACHE_TTL_MS = 60_000;

/**
 * Extracts and verifies the authenticated user from cookies and ensures user exists in DB.
 * Uses an in-memory TTL cache to avoid redundant database roundtrips on rapid dashboard polls.
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

  const now = Date.now();
  const cached = authUserCache.get(parsed.userId);
  if (cached && cached.expiresAt > now) {
    return cached.user;
  }

  await ensureDbSchemaReady();

  const user = await prisma.user.findUnique({
    where: { id: parsed.userId },
    select: { id: true, email: true, role: true, name: true },
  });

  if (!user) return null;
  const sessionUser: SessionUser = {
    userId: user.id,
    email: user.email,
    role: user.role,
    name: user.name,
  };

  authUserCache.set(user.id, {
    user: sessionUser,
    expiresAt: now + AUTH_CACHE_TTL_MS,
  });

  return sessionUser;
}

export function shouldUseSecureCookie(req: NextRequest): boolean {
  const proto = req.headers.get("x-forwarded-proto") || req.nextUrl.protocol;
  return proto.replace(/:$/, "") === "https";
}

const userSlotsProvisioned = new Set<string>();

/**
 * Provisions default GPU slots for a user.
 * Optimizes network roundtrips by checking in-memory status and inserting missing slots in parallel.
 */
export async function ensureUserVmSlots(userId: string): Promise<void> {
  if (userSlotsProvisioned.has(userId)) {
    return;
  }

  await ensureDbSchemaReady();

  const existing = await prisma.vmInstance.findMany({
    where: { userId },
    select: { target: true },
  });

  const existingTargets = new Set(existing.map((e) => e.target));
  const missingSlots = DEFAULT_VM_SLOTS.filter((s) => !existingTargets.has(s.target));

  if (missingSlots.length > 0) {
    await Promise.all(
      missingSlots.map((slot) =>
        prisma.vmInstance.create({
          data: {
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
        })
      )
    );
  }

  userSlotsProvisioned.add(userId);
}

