import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getAuthContext } from "@/lib/auth/api-token";
import { ensureDbSchemaReady } from "@/lib/db/ensure-schema";
import {
  dispatchLlmChat,
  type LlmChatMode,
  type LlmReasoningEffort,
  type LlmTargetService,
} from "@/lib/llm/dispatch-llm";
import { parseBootMetadata } from "@/lib/orchestrator/vm-helpers";
import type { LlmWorkflowStep } from "@/app/api/llm-studio/workflows/route";

interface EvalCaseInput {
  id?: string;
  prompt: string;
  expectedContains?: string;
  requiredKeys?: string[];
}

function interpolateTemplate(
  template: string,
  vars: { input: string; prevOutput: string; stepOutputs: Record<string, string> }
): string {
  let out = template
    .replace(/\{\{\s*input\s*\}\}/g, vars.input)
    .replace(/\{\{\s*prev\.output\s*\}\}/g, vars.prevOutput);
  for (const [k, v] of Object.entries(vars.stepOutputs)) {
    out = out.replace(new RegExp(`\\{\\{\\s*${k}\\.output\\s*\\}\\}`, "g"), v);
  }
  return out;
}

function evaluateAssertions(
  answer: string,
  mode: LlmChatMode,
  jsonValidation: { isValidJson: boolean; missingKeys: string[]; parseError?: string } | null,
  expectedContains?: string,
  requiredKeys?: string[]
): { passed: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (mode === "json" && jsonValidation && !jsonValidation.isValidJson) {
    reasons.push(
      jsonValidation.parseError
        ? `Invalid JSON: ${jsonValidation.parseError}`
        : `Missing keys: ${jsonValidation.missingKeys.join(", ")}`
    );
  }
  if (requiredKeys && requiredKeys.length > 0) {
    try {
      const cleaned = answer.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();
      const obj = JSON.parse(cleaned) as Record<string, unknown>;
      const missing = requiredKeys.filter((k) => !(k in obj));
      if (missing.length > 0) {
        reasons.push(`Missing keys: ${missing.join(", ")}`);
      }
    } catch {
      reasons.push("Response is not valid JSON for requiredKeys check");
    }
  }
  if (expectedContains?.trim()) {
    const needle = expectedContains.trim();
    if (!answer.toLowerCase().includes(needle.toLowerCase())) {
      reasons.push(`Expected text '${needle}' not found`);
    }
  }
  return { passed: reasons.length === 0, reasons };
}

export async function POST(req: NextRequest) {
  try {
    const auth = await getAuthContext(req);
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    await ensureDbSchemaReady();

    const body = (await req.json()) as {
      action?: "run_batch_eval" | "run_workflow";
      title?: string;
      targetVm?: string;
      targetService?: LlmTargetService;
      mode?: LlmChatMode;
      systemPrompt?: string;
      jsonSchema?: string;
      reasoningEffort?: LlmReasoningEffort;
      enableThinking?: boolean;
      cachePrompt?: boolean;
      temperature?: number;
      maxTokens?: number;
      fallbackToVault?: boolean;
      cases?: EvalCaseInput[];
      // Workflow chain fields
      steps?: LlmWorkflowStep[];
      workflowInput?: string;
    };

    const action = body.action || "run_batch_eval";

    if (action === "run_workflow") {
      const steps = Array.isArray(body.steps) ? body.steps : [];
      const workflowInput = String(body.workflowInput || "").trim();
      if (steps.length === 0 || !workflowInput) {
        return NextResponse.json(
          { error: "steps and workflowInput are required." },
          { status: 400 }
        );
      }

      const stepResults: Array<{
        stepId: string;
        stepName: string;
        targetUsed: string | null;
        model: string;
        answer: string;
        thinking: string | null;
        latencyMs: number;
        tokPerSec: number | null;
        validJson: boolean | null;
      }> = [];

      let prevOutput = workflowInput;
      const stepOutputs: Record<string, string> = {};

      for (let idx = 0; idx < steps.length; idx++) {
        const s = steps[idx];
        const compiledPrompt = interpolateTemplate(s.promptTemplate || "{{prev.output}}", {
          input: workflowInput,
          prevOutput,
          stepOutputs,
        });
        const res = await dispatchLlmChat({
          userId: auth.userId,
          messages: [{ role: "user", content: compiledPrompt }],
          systemPrompt: s.systemPrompt,
          mode: s.mode || "chat",
          jsonSchema: s.jsonSchema,
          enableThinking: typeof body.enableThinking === "boolean" ? body.enableThinking : undefined,
          cachePrompt: typeof body.cachePrompt === "boolean" ? body.cachePrompt : undefined,
          temperature: s.temperature ?? 0.2,
          maxTokens: s.maxTokens ?? 2048,
          targetVm: s.targetVm || body.targetVm || "auto",
          targetService: s.targetService || "default",
          fallbackToVault: body.fallbackToVault !== false,
        });
        prevOutput = res.answer;
        stepOutputs[`step_${idx + 1}`] = res.answer;
        stepResults.push({
          stepId: s.id,
          stepName: s.name,
          targetUsed: res.target,
          model: res.model,
          answer: res.answer,
          thinking: res.thinking,
          latencyMs: res.latencyMs,
          tokPerSec: res.tokPerSec,
          validJson: res.jsonValidation ? res.jsonValidation.isValidJson : null,
        });
      }

      const totalLatencyMs = stepResults.reduce((acc, s) => acc + s.latencyMs, 0);
      return NextResponse.json({
        ok: true,
        action: "run_workflow",
        totalLatencyMs,
        finalOutput: prevOutput,
        stepResults,
      });
    }

    // action === "run_batch_eval"
    const cases = (Array.isArray(body.cases) ? body.cases : []).slice(0, 50);
    if (cases.length === 0) {
      return NextResponse.json({ error: "At least 1 test case is required." }, { status: 400 });
    }

    const mode = body.mode || "chat";
    const targetVm = body.targetVm || "auto";

    // Detect if selected or active Kaggle VM is running Dual Replica / A-B Arena to parallelize 2x!
    const vms = await prisma.vmInstance.findMany({
      where: { userId: auth.userId, status: "ONLINE" },
    });
    const matchedVm =
      targetVm !== "auto" && !targetVm.startsWith("vault:")
        ? vms.find((v) => v.target === targetVm)
        : vms.find((v) => parseBootMetadata(v.bootMetadataJson)?.llmTopologyMode === "llm_dual_replica") || vms[0];
    const isDualReplica =
      parseBootMetadata(matchedVm?.bootMetadataJson)?.llmTopologyMode === "llm_dual_replica";
    const concurrency = isDualReplica ? 2 : 1;

    const results: Array<{
      index: number;
      prompt: string;
      answer: string;
      passed: boolean;
      failureReasons: string[];
      latencyMs: number;
      tokPerSec: number | null;
      rawDecodeTokPerSec: number | null;
      prefillTokPerSec: number | null;
      relayOverheadMs: number | null;
      thinkingTokens: number;
      answerTokens: number;
      cacheN: number | null;
      mtpStats: {
        draftN: number;
        draftNAccepted: number;
        acceptancePct: number | null;
        meanTokensPerStep: number | null;
      } | null;
      executionRoute: string;
      target: string | null;
      model: string;
      error?: string;
    }> = new Array(cases.length);

    let cursor = 0;
    const workers = Array.from({ length: concurrency }, (_, laneIdx) =>
      (async () => {
        while (true) {
          const i = cursor++;
          if (i >= cases.length) break;
          const tc = cases[i];
          const laneService: LlmTargetService =
            isDualReplica && (!body.targetService || body.targetService === "default")
              ? laneIdx === 0
                ? "replica0"
                : "replica1"
              : body.targetService || "default";

          try {
            const res = await dispatchLlmChat({
              userId: auth.userId,
              messages: [{ role: "user", content: tc.prompt }],
              systemPrompt: body.systemPrompt,
              mode,
              jsonSchema: body.jsonSchema,
              reasoningEffort: body.reasoningEffort || "none",
              enableThinking: typeof body.enableThinking === "boolean" ? body.enableThinking : undefined,
              cachePrompt: typeof body.cachePrompt === "boolean" ? body.cachePrompt : undefined,
              temperature: body.temperature ?? 0.2,
              maxTokens: body.maxTokens ?? 1024,
              fallbackToVault: body.fallbackToVault !== false,
              targetVm,
              targetService: laneService,
            });
            const assertion = evaluateAssertions(
              res.answer,
              mode,
              res.jsonValidation,
              tc.expectedContains,
              tc.requiredKeys
            );
            results[i] = {
              index: i,
              prompt: tc.prompt,
              answer: res.answer,
              passed: assertion.passed,
              failureReasons: assertion.reasons,
              latencyMs: res.latencyMs,
              tokPerSec: res.tokPerSec,
              rawDecodeTokPerSec: res.rawDecodeTokPerSec,
              prefillTokPerSec: res.prefillTokPerSec,
              relayOverheadMs: res.relayOverheadMs,
              thinkingTokens: res.thinkingTokens,
              answerTokens: res.answerTokens,
              cacheN: res.cacheN,
              mtpStats: res.mtpStats,
              executionRoute: res.executionRoute,
              target: res.target,
              model: res.model,
            };
          } catch (err) {
            results[i] = {
              index: i,
              prompt: tc.prompt,
              answer: "",
              passed: false,
              failureReasons: [err instanceof Error ? err.message : "Failed"],
              latencyMs: 0,
              tokPerSec: null,
              rawDecodeTokPerSec: null,
              prefillTokPerSec: null,
              relayOverheadMs: null,
              thinkingTokens: 0,
              answerTokens: 0,
              cacheN: null,
              mtpStats: null,
              executionRoute: "error",
              target: null,
              model: "error",
              error: err instanceof Error ? err.message : "Failed",
            };
          }
        }
      })()
    );

    await Promise.all(workers);

    const passedCount = results.filter((r) => r.passed).length;
    const validLatencies = results.filter((r) => r.latencyMs > 0).map((r) => r.latencyMs);
    const validTps = results.filter((r) => typeof r.tokPerSec === "number").map((r) => r.tokPerSec!);

    return NextResponse.json({
      ok: true,
      title: body.title || "LLM Batch Eval",
      totalCases: results.length,
      passedCount,
      failedCount: results.length - passedCount,
      passRatePct: Math.round((passedCount / results.length) * 100),
      avgLatencyMs: validLatencies.length
        ? Math.round(validLatencies.reduce((a, b) => a + b, 0) / validLatencies.length)
        : 0,
      avgTokPerSec: validTps.length
        ? Number((validTps.reduce((a, b) => a + b, 0) / validTps.length).toFixed(1))
        : null,
      dualReplicaParallelized: isDualReplica,
      results,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "LLM evaluation error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
