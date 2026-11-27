import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/session";
import ch214Data from "@/lib/test-kits/lotm_ch214_data.json";
import type { LlmWorkflowStep } from "@/app/api/llm-studio/workflows/route";

export interface Ch214ShotSpec {
  frame: number;
  shotId: string;
  beatIndex: number;
  beatName: string;
  sceneId: string;
  paragraphs: string;
  paragraphNumbers: number[];
  paragraphText: string;
  brief: string;
  role: string;
  isAnchor: boolean;
  anchorShotId: string | null;
  refIds: string[];
  refBindings: Array<{ slot: number; id: string; title: string; refUri: string }>;
  defaultPrompt: string;
}

export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const shots = ch214Data.shots as Ch214ShotSpec[];
  const shotByFrame = new Map(shots.map((s) => [s.frame, s]));

  const buildStudioItem = (
    shot: Ch214ShotSpec,
    mode: "qwen21" | "qwen_edit",
    dependsOnAnchor = false
  ) => {
    const refs = shot.refBindings.map((b) => ({
      mode: "qwen21_ref_strength" as const,
      refImagePath: b.refUri,
      weight: 0.78,
    }));

    const anchorImg = dependsOnAnchor && shot.anchorShotId ? "__ANCHOR_OUTPUT_IMAGE__" : undefined;
    const isEdit = mode === "qwen_edit" || Boolean(anchorImg);

    return {
      sceneKey: shot.shotId,
      title: `${shot.shotId} · ${shot.beatName} (#${shot.frame} ${shot.role})`,
      prompt: shot.defaultPrompt,
      pipeline: isEdit ? ("qwen_edit" as const) : ("qwen21_edit" as const),
      architecture: isEdit ? ("qwen_edit" as const) : ("qwen21" as const),
      baseModel: isEdit
        ? "qwen-image-edit-2511-Q4_K_M.gguf"
        : "qwen_image_2.1_turbo_int8_convrot.safetensors",
      width: 1344,
      height: 768,
      refImagePath: anchorImg || refs[0]?.refImagePath,
      useEmptyLatent: !anchorImg && isEdit,
      ipConnectors: anchorImg ? refs.slice(0, 2) : refs.slice(0, 3),
      dependsOnSceneKeys:
        dependsOnAnchor && shot.anchorShotId && !shot.isAnchor ? [shot.anchorShotId] : undefined,
    };
  };

  const anchor5 = shotByFrame.get(5);
  const abAnchor5 = anchor5
    ? [
        {
          ...buildStudioItem(anchor5, "qwen21", false),
          sceneKey: "V2-214-005-QWEN21-TURBO",
          title: "A/B Anchor #5 · Qwen-Image 2.1 Turbo (Dual-T4)",
        },
        {
          ...buildStudioItem(anchor5, "qwen_edit", false),
          sceneKey: "V2-214-005-QWEN-EDIT",
          title: "A/B Anchor #5 · Qwen-Image-Edit 2511 (Dual-T4)",
        },
      ]
    : [];

  const anchorShots = ch214Data.anchorFrames
    .map((f) => shotByFrame.get(f))
    .filter((s): s is Ch214ShotSpec => Boolean(s));

  const cov6 = shotByFrame.get(6);
  const cov78 = shotByFrame.get(78);

  const anchors8Qwen21 = anchorShots.map((s) => buildStudioItem(s, "qwen21", false));
  const anchors8Edit = anchorShots.map((s) => buildStudioItem(s, "qwen_edit", false));
  const pilot10Qwen21AnchorsPlusEditCov = [
    ...anchors8Qwen21,
    ...(cov6 ? [buildStudioItem(cov6, "qwen_edit", true)] : []),
    ...(cov78 ? [buildStudioItem(cov78, "qwen_edit", true)] : []),
  ];

  // Phase 1 LLM Eval & Workflow Fixtures for Acc2
  const expectedKeywordsByBeat: Record<number, string[]> = {
    1: ["Klein", "top hat", "bag"],
    2: ["watch", "6:39"],
    3: ["smog", "Backlund"],
    4: ["15 Minsk Street", "Cherwood"],
    5: ["ticket", "metro"],
    6: ["train", "platform"],
    7: ["carriage", "second"],
    8: ["red", "boy"],
  };

  const llmEvalCases = ch214Data.beats.map((b) => ({
    prompt: `Analyze LOTM Chapter 214 Beat ${b.beatIndex} (${b.beatName}, ¶${b.paragraphRange}):\n\n${b.beatText}\n\nExtract present characters/clothing, location, key props/text details, and subjective perceptions as JSON.`,
    expectedContains: (expectedKeywordsByBeat[b.beatIndex] || [""])[0],
    requiredKeys: ["beat_name", "location", "present_subjects", "key_props_and_facts"],
  }));

  const llmWorkflowSteps: LlmWorkflowStep[] = [
    {
      id: "ch214-step-extract",
      name: "1. Ch.214 Source & Continuity Extractor",
      targetVm: "auto",
      targetService: "default",
      mode: "json",
      systemPrompt:
        "You are the Source & Continuity Editor for Lord of the Mysteries Ch. 214. Extract ONLY explicit text facts: physical clothing (half top hat, tuxedo, clean-shaven Klein, oversized bag, cane), exact timestamps (6:39 watch), exact written text ('15 Minsk Street, Cherwood Borough'), weather/smog, and character physical traits (boy's naturally red eyes vs subjective Spirit Vision).",
      promptTemplate: "Source Chapter Passage:\n\n{{input}}",
      jsonSchema: JSON.stringify({
        required: ["subjects", "locations", "props_and_text", "subjective_or_power_notes"],
      }),
      temperature: 0.1,
      maxTokens: 1536,
    },
    {
      id: "ch214-step-direct",
      name: "2. Beat & Camera Director",
      targetVm: "auto",
      targetService: "default",
      mode: "json",
      systemPrompt:
        "You are the Film Director. Turn the extracted continuity facts into a beat scene card and 1–3 ordered camera shots (Anchor shot first, then Coverage shots preserving screen direction and eyelines).",
      promptTemplate:
        "Source passage:\n{{input}}\n\nExtracted Continuity JSON:\n{{prev.output}}\n\nReturn scene_card and ordered shots JSON.",
      jsonSchema: JSON.stringify({ required: ["scene_card", "shots"] }),
      temperature: 0.2,
      maxTokens: 1536,
    },
    {
      id: "ch214-step-bind",
      name: "3. Qwen-Image Reference Binder JSON",
      targetVm: "auto",
      targetService: "default",
      mode: "json",
      systemPrompt:
        "Bind candidate reference plates (KLEIN, ARRIVAL, BAG, CANE, WATCH, WATCH-0639, PAPERS, STATION, SMOG, STREET, METRO, METROTRAIN, CARRIAGE, BOY, PURSUERS, CASHIER, CONDUCTOR, TICKET, THIEF) and draft 16:9 naturalistic Victorian oil-and-gouache prompts for Qwen-Image 2.1 / Qwen-Image-Edit 2511.",
      promptTemplate:
        "Continuity:\n{{step_1.output}}\n\nDirector Plan:\n{{prev.output}}\n\nEmit strict JSON array `render_jobs` with fields `shot_id`, `role`, `ref_ids`, `renderer` (`qwen21` or `qwen_edit`), and `prompt`.",
      jsonSchema: JSON.stringify({ required: ["render_jobs"] }),
      temperature: 0.15,
      maxTokens: 1536,
    },
  ];

  return NextResponse.json({
    kitId: ch214Data.kitId,
    title: ch214Data.title,
    paragraphCount: ch214Data.paragraphCount,
    totalShots: ch214Data.totalShots,
    anchorFrames: ch214Data.anchorFrames,
    pilotFrames: ch214Data.pilotFrames,
    beats: ch214Data.beats,
    references: ch214Data.references,
    shots,
    llmEvalCases,
    llmWorkflowSteps,
    studioBatchPresets: {
      abAnchor5,
      anchors8Qwen21,
      anchors8Edit,
      pilot10Qwen21AnchorsPlusEditCov,
    },
  });
}
