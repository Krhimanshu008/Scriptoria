import crypto from "crypto";
import { NextResponse, type NextRequest } from "next/server";

import { forwardToFastAPI } from "@/lib/bridge/server-client";
import type {
  DocumentNode,
  ParsedChunk,
  ParseDiagnostic,
  ParseInspectRequest,
  ParseInspectResponse,
  SpanRange,
} from "@/types/testbench-contracts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LIGATURE_MAP: Record<string, string> = {
  "\ufb00": "ff",
  "\ufb01": "fi",
  "\ufb02": "fl",
  "\ufb03": "ffi",
  "\ufb04": "ffl",
  "\ufb05": "st",
  "\ufb06": "st",
};

function computeSpan(rawText: string, cpStart: number, cpEnd: number): SpanRange {
  const chars = Array.from(rawText);
  const clampedStart = Math.max(0, Math.min(chars.length, cpStart));
  const clampedEnd = Math.max(clampedStart, Math.min(chars.length, cpEnd));

  const utf16Start = chars.slice(0, clampedStart).join("").length;
  const utf16End = chars.slice(0, clampedEnd).join("").length;

  return {
    codepoint_start: clampedStart,
    codepoint_end: clampedEnd,
    utf16_start: utf16Start,
    utf16_end: utf16End,
  };
}

function runFallbackParser(req: ParseInspectRequest, traceId: string): ParseInspectResponse {
  const raw = req.raw_text || "";
  const lfRaw = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const normalizeLigatures = req.normalize_ligatures ?? true;

  let normalized = lfRaw;
  if (normalizeLigatures) {
    for (const [lig, rep] of Object.entries(LIGATURE_MAP)) {
      normalized = normalized.replaceAll(lig, rep);
    }
  }

  const rawCodepoints = Array.from(lfRaw).length;
  const rawUtf16 = lfRaw.length;
  const normCodepoints = Array.from(normalized).length;
  const normUtf16 = normalized.length;

  // Split into lines to extract chapters and scenes
  const lines = normalized.split("\n");
  const chapters: DocumentNode[] = [];
  const diagnostics: ParseDiagnostic[] = [];

  let currentChapter: DocumentNode = {
    node_id: "ch_001",
    node_type: "chapter",
    title: "Chapter 1",
    order_index: 1,
    span: computeSpan(normalized, 0, normCodepoints),
    children: [],
  };

  let currentScene: DocumentNode = {
    node_id: "sc_001",
    node_type: "scene",
    title: "Scene 1",
    order_index: 1,
    span: computeSpan(normalized, 0, normCodepoints),
    children: [],
  };

  let charOffset = 0;
  let chIndex = 1;
  let scIndex = 1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineCpLen = Array.from(line).length;
    const lineSpan = computeSpan(normalized, charOffset, charOffset + lineCpLen);

    if (line.startsWith("# ") || line.startsWith("## ")) {
      const title = line.replace(/^#+\s*/, "").trim();
      chIndex += 1;
      scIndex = 1;

      currentChapter = {
        node_id: `ch_${String(chIndex).padStart(3, "0")}`,
        node_type: "chapter",
        title: title || `Chapter ${chIndex}`,
        order_index: chIndex,
        span: lineSpan,
        children: [],
      };
      chapters.push(currentChapter);

      currentScene = {
        node_id: `sc_${String(scIndex).padStart(3, "0")}`,
        node_type: "scene",
        title: `Scene ${scIndex}`,
        order_index: scIndex,
        span: lineSpan,
        children: [],
      };
      currentChapter.children.push(currentScene);
    } else if (line.includes("<SCENE_BREAK") || line.trim() === "***" || line.trim() === "---") {
      scIndex += 1;
      currentScene = {
        node_id: `sc_${String(scIndex).padStart(3, "0")}`,
        node_type: "scene",
        title: `Scene ${scIndex}`,
        order_index: scIndex,
        span: lineSpan,
        children: [],
      };
      currentChapter.children.push(currentScene);
    } else if (line.trim().length > 0) {
      currentScene.children.push({
        node_id: `p_${currentScene.children.length + 1}`,
        node_type: "paragraph",
        title: null,
        order_index: currentScene.children.length + 1,
        span: lineSpan,
        children: [],
      });
    }

    charOffset += lineCpLen + 1; // +1 for newline
  }

  if (chapters.length === 0) {
    currentChapter.children.push(currentScene);
    chapters.push(currentChapter);
  }

  const documentTree: DocumentNode = {
    node_id: "doc_root",
    node_type: "document",
    title: req.source_name || "novel.md",
    order_index: 0,
    span: computeSpan(normalized, 0, normCodepoints),
    children: chapters,
  };

  // Build chunks
  const chunks: ParsedChunk[] = [];
  let chunkIdx = 1;
  const words = normalized.split(/\s+/).filter(Boolean);
  const wordsPerChunk = 4500;

  for (let w = 0; w < words.length; w += wordsPerChunk) {
    const chunkWords = words.slice(w, w + wordsPerChunk).join(" ");
    const sha = crypto.createHash("sha256").update(chunkWords).digest("hex");
    const cSpan = computeSpan(normalized, 0, Math.min(normCodepoints, chunkWords.length));

    chunks.push({
      chunk_id: `chunk_${String(chunkIdx).padStart(3, "0")}`,
      chapter_index: 1,
      scene_index: 1,
      chunk_index: chunkIdx,
      raw_text: chunkWords,
      normalized_text: chunkWords,
      span: cSpan,
      codepoint_length: Array.from(chunkWords).length,
      utf16_length: chunkWords.length,
      sha256: sha,
    });
    chunkIdx += 1;
  }

  if (chunks.length === 0) {
    const sha = crypto.createHash("sha256").update(normalized).digest("hex");
    chunks.push({
      chunk_id: "chunk_001",
      chapter_index: 1,
      scene_index: 1,
      chunk_index: 1,
      raw_text: normalized,
      normalized_text: normalized,
      span: computeSpan(normalized, 0, normCodepoints),
      codepoint_length: normCodepoints,
      utf16_length: normUtf16,
      sha256: sha,
    });
  }

  return {
    ok: true,
    trace_id: traceId,
    source_name: req.source_name || "novel.md",
    normalized_markdown: normalized,
    raw_codepoint_length: rawCodepoints,
    raw_utf16_length: rawUtf16,
    normalized_codepoint_length: normCodepoints,
    normalized_utf16_length: normUtf16,
    chapter_count: chapters.length,
    scene_count: Math.max(1, scIndex),
    document_tree: documentTree,
    chunks,
    diagnostics,
  };
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const clonedReq = req.clone();
  const upstreamRes = await forwardToFastAPI({
    req,
    method: "POST",
    upstreamPath: "/api/v1/parser/inspect",
    timeoutMs: 30_000,
  });

  // If live FastAPI responds, return it directly
  if (upstreamRes.status < 500) {
    return upstreamRes;
  }

  // Graceful standalone fallback when FastAPI backend is offline (e.g. serverless Vercel preview)
  try {
    const body: ParseInspectRequest = await clonedReq.json();
    const traceId = upstreamRes.headers.get("x-trace-id") || crypto.randomUUID();
    const result = runFallbackParser(body, traceId);

    return NextResponse.json(result, {
      status: 200,
      headers: {
        "X-Trace-ID": traceId,
        "Cache-Control": "no-store",
      },
    });
  } catch (err: any) {
    return upstreamRes;
  }
}
