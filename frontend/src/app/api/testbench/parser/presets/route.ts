import { NextResponse, type NextRequest } from "next/server";

import { forwardToFastAPI } from "@/lib/bridge/server-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FALLBACK_PRESETS = {
  ok: true,
  default_profile_id: "fiction_standard",
  default_word_cap: 4500,
  default_token_cap: 6000,
  supported_extensions: [".epub", ".pdf", ".md", ".txt"],
  ligature_map: {
    "ﬀ": "ff",
    "ﬁ": "fi",
    "ﬂ": "fl",
    "ﬃ": "ffi",
    "ﬄ": "ffl",
    "ﬅ": "st",
    "ﬆ": "st",
  },
  profiles: [
    {
      id: "fiction_standard",
      label: "Fiction Standard",
      description:
        "Standard long-form fiction parser with typographic ligature normalization, chapter header splitting, and <SCENE_BREAK /> detection.",
      max_chunk_words: 4500,
      max_chunk_tokens: 6000,
      normalize_ligatures: true,
      scene_break_min_blank_lines: 2,
    },
    {
      id: "fiction_strict",
      label: "Fiction Strict (Local VRAM)",
      description:
        "Tighter chunk caps tailored for single-pass local 8B-14B extraction workers.",
      max_chunk_words: 3000,
      max_chunk_tokens: 4000,
      normalize_ligatures: true,
      scene_break_min_blank_lines: 2,
    },
    {
      id: "raw_passthrough",
      label: "Raw Offset Passthrough",
      description:
        "Preserves typographic ligatures to inspect raw Unicode vs UTF-16 span alignment.",
      max_chunk_words: 4500,
      max_chunk_tokens: 6000,
      normalize_ligatures: false,
      scene_break_min_blank_lines: 2,
    },
  ],
};

export async function GET(req: NextRequest): Promise<NextResponse> {
  const upstreamRes = await forwardToFastAPI({
    req,
    method: "GET",
    upstreamPath: "/api/v1/parser/presets",
  });

  if (upstreamRes.status < 500) {
    return upstreamRes;
  }

  const traceId = upstreamRes.headers.get("x-trace-id") || crypto.randomUUID();
  return NextResponse.json(
    {
      ...FALLBACK_PRESETS,
      trace_id: traceId,
      source: "nextjs_standalone_presets",
    },
    {
      status: 200,
      headers: {
        "X-Trace-ID": traceId,
        "Cache-Control": "no-store",
      },
    }
  );
}
