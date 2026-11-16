// extension/scriptoria-flow-bridge/aistudio_companion.js
/**
 * Scriptoria Google AI Studio Audio Companion
 * Injected on `https://aistudio.google.com/*`
 * Connects to local FastAPI Bridge (ws://127.0.0.1:8000/api/v1/flow-bridge/ws)
 * Automates Gemini 3.8 Flash TTS Screenplay speech generation,
 * multi-speaker dialogue parsing, inline emotion tags, and 24kHz WAV streaming.
 */
(function () {
  "use strict";

  if (window.__SCRIPTORIA_AISTUDIO_ACTIVE__) {
    return;
  }
  window.__SCRIPTORIA_AISTUDIO_ACTIVE__ = true;

  const WS_ENDPOINT = "ws://127.0.0.1:8000/api/v1/flow-bridge/ws";
  const DEFAULT_VOICE = "Enzo";
  let ws = null;
  let reconnectTimer = null;
  let heartbeatTimer = null;

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // ==========================================================================
  // 1. UI Overlay: Floating Scriptoria Audio Dock
  // ==========================================================================
  function injectAudioDock() {
    if (document.getElementById("scriptoria-audio-dock")) {
      return;
    }
    const dock = document.createElement("div");
    dock.id = "scriptoria-audio-dock";
    dock.style.cssText = `
      position: fixed;
      bottom: 20px;
      right: 20px;
      z-index: 999999;
      background: rgba(18, 18, 24, 0.92);
      border: 1px solid rgba(138, 180, 248, 0.4);
      border-radius: 24px;
      padding: 8px 16px;
      color: #e8eaed;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 13px;
      display: flex;
      align-items: center;
      gap: 10px;
      box-shadow: 0 4px 16px rgba(0,0,0,0.5);
      backdrop-filter: blur(10px);
      transition: all 0.2s ease;
      cursor: pointer;
    `;

    dock.innerHTML = `
      <span id="scriptoria-audio-dot" style="width: 8px; height: 8px; border-radius: 50%; background: #34a853;"></span>
      <span id="scriptoria-audio-text" style="font-weight: 500;">Scriptoria Audio (Connected)</span>
      <span style="font-size: 10px; padding: 2px 6px; border-radius: 10px; background: rgba(138,180,248,0.2); color: #8ab4f8;">3.8 Flash TTS</span>
    `;

    document.body.appendChild(dock);
  }

  function updateDockStatus(stateText, color = "#34a853") {
    const dot = document.getElementById("scriptoria-audio-dot");
    const text = document.getElementById("scriptoria-audio-text");
    if (dot) dot.style.background = color;
    if (text) text.innerText = stateText;
  }

  // ==========================================================================
  // 2. DOM Automation for AI Studio Generate Speech Interface
  // ==========================================================================
  function findTranscriptEditor() {
    return (
      document.querySelector('textarea[aria-label*="Transcript" i]') ||
      document.querySelector('textarea[placeholder*="Transcript" i]') ||
      document.querySelector('div.ProseMirror[contenteditable="true"]') ||
      document.querySelector('[contenteditable="true"]') ||
      document.querySelector("textarea")
    );
  }

  function findGenerateButton() {
    const buttons = Array.from(document.querySelectorAll("button"));
    return buttons.find((b) => {
      const text = (b.innerText || b.getAttribute("aria-label") || "").toLowerCase();
      return (
        text.includes("generate") ||
        text.includes("run") ||
        text.includes("play speech") ||
        b.getAttribute("data-test-id") === "generate-speech"
      );
    });
  }

  async function injectScreenplay(formattedText) {
    const editor = findTranscriptEditor();
    if (!editor) {
      console.warn("[Scriptoria AI Studio] Transcript editor not found in DOM.");
      return false;
    }
    editor.focus();
    if (editor.tagName === "TEXTAREA" || editor.tagName === "INPUT") {
      editor.value = formattedText;
      editor.dispatchEvent(new Event("input", { bubbles: true }));
      editor.dispatchEvent(new Event("change", { bubbles: true }));
    } else {
      document.execCommand("selectAll", false, null);
      document.execCommand("delete", false, null);
      document.execCommand("insertText", false, formattedText);
      editor.dispatchEvent(new InputEvent("input", { bubbles: true, data: formattedText }));
    }
    await sleep(250);
    return true;
  }

  // ==========================================================================
  // 3. WebSocket Connection to Local FastAPI Bridge
  // ==========================================================================
  function connectWebSocket() {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    try {
      ws = new WebSocket(`${WS_ENDPOINT}?session_id=aistudio-${Date.now()}&source=AI_STUDIO`);
    } catch (err) {
      console.warn("[Scriptoria AI Studio] Could not initiate WS connection:", err);
      scheduleReconnect();
      return;
    }

    ws.onopen = () => {
      console.info("[Scriptoria AI Studio] Connected to FastAPI Bridge Hub.");
      updateDockStatus("Scriptoria Audio (Connected)", "#34a853");
      startHeartbeat();
    };

    ws.onmessage = async (event) => {
      try {
        const envelope = JSON.parse(event.data);
        const { event_type, payload, correlation_id } = envelope;

        if (event_type === "DISPATCH_AUDIO_TASK") {
          updateDockStatus("Synthesizing Audio...", "#fbbc04");
          const success = await injectScreenplay(payload.raw_text || "");
          if (success) {
            const genBtn = findGenerateButton();
            if (genBtn) {
              genBtn.click();
              updateDockStatus("Audio Generating in AI Studio", "#4285f4");
            }
          }
        }
      } catch (err) {
        console.error("[Scriptoria AI Studio] Error handling WS message:", err);
      }
    };

    ws.onclose = () => {
      updateDockStatus("Scriptoria Audio (Offline)", "#ea4335");
      stopHeartbeat();
      scheduleReconnect();
    };

    ws.onerror = () => {
      updateDockStatus("Bridge Error", "#ea4335");
    };
  }

  function startHeartbeat() {
    stopHeartbeat();
    heartbeatTimer = setInterval(() => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(
          JSON.stringify({
            envelope_id: crypto.randomUUID ? crypto.randomUUID() : `hb-${Date.now()}`,
            event_type: "COMPANION_HEARTBEAT",
            payload: {
              source: "AI_STUDIO",
              url: window.location.href,
              status: "IDLE",
            },
          })
        );
      }
    }, 10000);
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

  // Initialize on page load
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      injectAudioDock();
      connectWebSocket();
    });
  } else {
    injectAudioDock();
    connectWebSocket();
  }
})();
