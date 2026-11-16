// frontend/src/app/api/flow/dispatch/route.ts
import { NextRequest, NextResponse } from "next/server";
import type {
  FlowCompanionStatus,
  FlowDispatchRequestBody,
  FlowGenerationTask,
} from "@/types/flow-contracts";

const FASTAPI_BASE_URL =
  process.env.SCRIPTORIA_BACKEND_URL?.replace(/\/$/, "") ||
  "http://127.0.0.1:8000";

const DEFAULT_FLOW_PROJECT_ID = "ea1ed436-e578-4327-9c9b-4f6b2e7e551d";

/**
 * GET /api/flow/dispatch
 * Proxies live Companion status & recent media events from the FastAPI Flow Bridge.
 */
export async function GET(): Promise<NextResponse> {
  try {
    const response = await fetch(
      `${FASTAPI_BASE_URL}/api/v1/flow-bridge/status`,
      {
        method: "GET",
        headers: { Accept: "application/json" },
        cache: "no-store",
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      return NextResponse.json(
        {
          error: "FastAPI Flow Bridge returned non-OK status",
          detail: errorText,
        },
        { status: response.status }
      );
    }

    const statusPayload = (await response.json()) as FlowCompanionStatus;
    return NextResponse.json(statusPayload, { status: 200 });
  } catch (error) {
    const fallbackStatus: FlowCompanionStatus = {
      session_id: "offline",
      connection_state: "DISCONNECTED",
      flow_project_id: DEFAULT_FLOW_PROJECT_ID,
      active_tab_url: null,
      extension_version: "1.0.0",
      user_agent: null,
      active_task_id: null,
      queued_tasks_count: 0,
      completed_tasks_count: 0,
      failed_tasks_count: 0,
      available_ingredients: [],
      last_heartbeat_at: new Date().toISOString(),
      last_error:
        error instanceof Error
          ? `FastAPI unreachable: ${error.message}`
          : "FastAPI backend unreachable",
    };
    return NextResponse.json(fallbackStatus, { status: 200 });
  }
}

/**
 * POST /api/flow/dispatch
 * Dispatches a FlowGenerationTask, FlowIngredientSync, or FlowQueueAction to FastAPI.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = (await request.json()) as
      | FlowDispatchRequestBody
      | FlowGenerationTask;

    // Support both discriminated union { kind, payload } and direct FlowGenerationTask payloads
    let endpoint = "/api/v1/flow-bridge/tasks";
    let upstreamPayload: unknown = body;

    if ("kind" in body && body.kind) {
      switch (body.kind) {
        case "GENERATION_TASK":
          endpoint = "/api/v1/flow-bridge/tasks";
          upstreamPayload = {
            flow_project_id: DEFAULT_FLOW_PROJECT_ID,
            media_type: "IMAGE",
            model_engine: "NANO_BANANA",
            aspect_ratio: "16:9",
            candidate_count: 1,
            priority: 5,
            timeout_seconds: 180,
            ...body.payload,
          };
          break;

        case "INGREDIENT_SYNC":
          endpoint = "/api/v1/flow-bridge/ingredients/sync";
          upstreamPayload = {
            flow_project_id: DEFAULT_FLOW_PROJECT_ID,
            direction: "RECONCILE",
            auto_create_missing: true,
            ...body.payload,
          };
          break;

        case "QUEUE_ACTION":
          endpoint = "/api/v1/flow-bridge/queue/action";
          upstreamPayload = body.payload;
          break;

        default:
          return NextResponse.json(
            { error: "Invalid dispatch kind specified." },
            { status: 400 }
          );
      }
    } else if ("prompt" in body && "project_id" in body) {
      upstreamPayload = {
        flow_project_id: DEFAULT_FLOW_PROJECT_ID,
        media_type: "IMAGE",
        model_engine: "NANO_BANANA",
        aspect_ratio: "16:9",
        candidate_count: 1,
        priority: 5,
        timeout_seconds: 180,
        ...body,
      };
    } else {
      return NextResponse.json(
        {
          error:
            "Request body must be a valid FlowDispatchRequestBody or FlowGenerationTask.",
        },
        { status: 400 }
      );
    }

    const upstreamRes = await fetch(`${FASTAPI_BASE_URL}${endpoint}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(upstreamPayload),
      cache: "no-store",
    });

    const data = await upstreamRes.json().catch(() => ({}));
    if (!upstreamRes.ok) {
      return NextResponse.json(
        {
          error: "Flow Bridge dispatch failed",
          detail: data,
        },
        { status: upstreamRes.status }
      );
    }

    return NextResponse.json(data, { status: upstreamRes.status });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Failed to process Flow dispatch request",
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
