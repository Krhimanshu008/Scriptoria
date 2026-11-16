// extension/scriptoria-flow-bridge/background.js
/**
 * Scriptoria Flow Companion - Background Service Worker (Manifest V3)
 * - Maintains persistent background WebSocket to Scriptoria Cloud Bridge
 * - Handles CHAPTER_PACKAGE_SYNC events with automated tab launching
 * - Auto-opens / focuses Google Flow (flow.google) and Google AI Studio (aistudio.google.com)
 */
try {
  importScripts("config.js");
} catch (e) {
  console.warn("[Background] Failed to importScripts('config.js'):", e);
}

let ws = null;
let heartbeatTimer = null;
let reconnectTimer = null;

async function resolveWsEndpoint() {
  if (typeof ScriptoriaConfig !== "undefined") {
    const cfg = await ScriptoriaConfig.get();
    return ScriptoriaConfig.getWsUrl(cfg);
  }
  return "wss://scriptoria.krhimanshu.in/api/v1/flow-bridge/ws";
}

// ==============================================================================
// 1. Smart Tab Opener / Focus Manager
// ==============================================================================
async function ensureTabOpen(urlPattern, targetUrl) {
  try {
    const tabs = await chrome.tabs.query({});
    const existing = tabs.find((t) => t.url && t.url.includes(urlPattern));
    if (existing && existing.id) {
      // Bring tab to front
      await chrome.tabs.update(existing.id, { active: true });
      if (existing.windowId) {
        await chrome.windows.update(existing.windowId, { focused: true });
      }
      return existing;
    } else {
      // Open new tab
      return await chrome.tabs.create({ url: targetUrl, active: true });
    }
  } catch (err) {
    console.error("[Background] Failed to open/focus tab:", err);
  }
}

// ==============================================================================
// 2. Persistent WebSocket Connection
// ==============================================================================
async function connectWebSocket() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return;
  }

  const baseWs = await resolveWsEndpoint();
  const wsUrl = `${baseWs}?session_id=bg-worker-${Date.now()}&source=BG_SERVICE_WORKER`;

  try {
    ws = new WebSocket(wsUrl);
  } catch (err) {
    scheduleReconnect();
    return;
  }

  ws.onopen = () => {
    console.info(`[Background] Connected to Scriptoria Bridge (${wsUrl})`);
    startHeartbeat();
  };

  ws.onmessage = async (event) => {
    try {
      const envelope = JSON.parse(event.data);
      const { event_type, payload } = envelope;

      if (event_type === "CHAPTER_PACKAGE_SYNC" && payload) {
        console.info("[Background] Received CHAPTER_PACKAGE_SYNC:", payload.chapter_title);
        // Persist active chapter package to storage for popup and companion scripts
        await chrome.storage.local.set({
          scriptoria_active_chapter: payload,
          scriptoria_last_synced_at: new Date().toISOString(),
        });

        // Auto launch browser tabs if requested
        if (payload.auto_open_tabs !== false) {
          console.info("[Background] Auto-launching Google Flow and AI Studio tabs...");
          await ensureTabOpen("flow.google", "https://flow.google/");
          await ensureTabOpen("aistudio.google.com", "https://aistudio.google.com/");
        }
      }
    } catch (err) {
      console.error("[Background] Error handling message:", err);
    }
  };

  ws.onclose = () => {
    stopHeartbeat();
    scheduleReconnect();
  };

  ws.onerror = () => {
    try { ws.close(); } catch (_) {}
  };
}

function startHeartbeat() {
  stopHeartbeat();
  heartbeatTimer = setInterval(() => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        envelope_id: `hb-${Date.now()}`,
        event_type: "COMPANION_HEARTBEAT",
        payload: { source: "BG_SERVICE_WORKER", time: new Date().toISOString() },
      }));
    }
  }, 15000);
}

function stopHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

function scheduleReconnect() {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(connectWebSocket, 5000);
}

// Reconnect if server setting changes
if (chrome.storage && chrome.storage.onChanged) {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local" && changes.scriptoria_bridge_config) {
      if (ws) {
        try { ws.close(); } catch (_) {}
      }
      connectWebSocket();
    }
  });
}

// ==============================================================================
// 3. Message Routing for Popup & Web Pages
// ==============================================================================
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === "OPEN_FLOW_TAB") {
    ensureTabOpen("flow.google", "https://flow.google/").then(() => sendResponse({ ok: true }));
    return true;
  }
  if (msg.action === "OPEN_AISTUDIO_TAB") {
    ensureTabOpen("aistudio.google.com", "https://aistudio.google.com/").then(() => sendResponse({ ok: true }));
    return true;
  }
  if (msg.action === "OPEN_BOTH_TABS") {
    Promise.all([
      ensureTabOpen("flow.google", "https://flow.google/"),
      ensureTabOpen("aistudio.google.com", "https://aistudio.google.com/"),
    ]).then(() => sendResponse({ ok: true }));
    return true;
  }
});

// Boot up
connectWebSocket();
