import { prisma } from "../src/lib/db/prisma";

async function main() {
  const admin = await prisma.user.findFirst();
  if (!admin) {
    console.error("No user found");
    return;
  }
  await prisma.vmInstance.upsert({
    where: {
      userId_target: {
        userId: admin.id,
        target: "gpu2",
      },
    },
    update: {
      status: "ONLINE",
      workerProfile: "LLM_LIGHTWEIGHT_SWARM",
      publicUrl: "http://127.0.0.1:8188",
      gpuName: "Tesla T4 (Dual Swarm Mode)",
      vramTotalGb: 32,
      vramUsedGb: 14.1,
      lastHeartbeat: new Date(),
    },
    create: {
      userId: admin.id,
      target: "gpu2",
      accountAlias: "acc2",
      sessionGroup: "acc2",
      provider: "kaggle",
      status: "ONLINE",
      workerProfile: "LLM_LIGHTWEIGHT_SWARM",
      publicUrl: "http://127.0.0.1:8188",
      gpuName: "Tesla T4 (Dual Swarm Mode)",
      vramTotalGb: 32,
      vramUsedGb: 14.1,
      lastHeartbeat: new Date(),
    },
  });
  console.log("Registered local swarm simulator in database on target gpu2!");
}

main().catch(console.error).finally(() => prisma.$disconnect());
