// extension/scriptoria-flow-bridge/aistudio_companion.js
/**
 * Scriptoria Google AI Studio Audio Companion
 * Injected on `https://aistudio.google.com/*`
 * Connects to local or remote Scriptoria FastAPI Bridge via WebSocket.
 *
 * ZERO API KEYS REQUIRED:
 * Runs directly in Google AI Studio Playground session with native access to:
 * - Gemini 3.8 Flash TTS / 3.8 Flash-Lite TTS
 * - Screenplay-style multi-speaker transcript blocks ([Speaker: Narrator], [Speaker: Character])
 * - Expressive emotion markers (<breath/>, <gasp>, <whisper>, <shout>)
 * - Direct DOM audio stream capture and automated sync with Scriptoria AV Theater
 */
(function () {
  "use strict";

  if (window.__SCRIPTORIA_AISTUDIO_ACTIVE__) {
    return;
  }
  window.__SCRIPTORIA_AISTUDIO_ACTIVE__ = true;

  async function resolveWsEndpoint() {
    if (window.ScriptoriaConfig) {
      const cfg = await window.ScriptoriaConfig.get();
      return window.ScriptoriaConfig.getWsUrl(cfg);
    }
    return "wss://scriptoria.krhimanshu.in/api/v1/flow-bridge/ws";
  }

  let ws = null;
  let reconnectTimer = null;
  let heartbeatTimer = null;
  let lastDispatchedTask = null;
  let lastCapturedAudioSrc = null;

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // ==========================================================================
  // 1. UI Overlay: Floating Scriptoria AI Studio Audio Dock
  // ==========================================================================
  function injectAudioDock() {
    if (document.getElementById("scriptoria-audio-dock")) {
      return;
    }
    const dock = document.createElement("div");
    dock.id = "scriptoria-audio-dock";
    dock.style.cssText = `
      position: fixed;
      bottom: 24px;
      right: 24px;
      z-index: 999999;
      background: rgba(15, 17, 23, 0.95);
      border: 1px solid rgba(245, 158, 11, 0.5);
      border-radius: 16px;
      padding: 10px 16px;
      color: #f3f4f6;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 12px;
      display: flex;
      flex-direction: column;
      gap: 8px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.6);
      backdrop-filter: blur(12px);
      transition: all 0.2s ease;
      min-width: 260px;
    `;

    dock.innerHTML = `
      <div style="display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 6px;">
        <div style="display: flex; align-items: center; gap: 6px;">
          <span id="scriptoria-audio-dot" style="width: 8px; height: 8px; border-radius: 50%; background: #eab308;"></span>
          <span id="scriptoria-audio-title" style="font-weight: 700; color: #fbbf24; letter-spacing: 0.5px;">Scriptoria 3.8 TTS</span>
        </div>
        <span style="font-size: 10px; padding: 2px 6px; border-radius: 8px; background: rgba(245,158,11,0.2); color: #fde68a;">Playground Mode</span>
      </div>

      <div id="scriptoria-audio-status" style="font-size: 11px; color: #9ca3af; min-height: 16px;">
        Connecting to Scriptoria Bridge...
      </div>

      <div style="display: flex; gap: 6px; margin-top: 2px;">
        <button id="btn-inject-screenplay" style="flex: 1; background: #27272a; hover: #3f3f46; color: #e4e4e7; border: 1px solid #52525b; border-radius: 6px; padding: 4px 8px; font-size: 11px; font-weight: 600; cursor: pointer;">
          📋 Paste Script
        </button>
        <button id="btn-run-tts" style="flex: 1; background: #d97706; color: #000; border: none; border-radius: 6px; padding: 4px 8px; font-size: 11px; font-weight: 700; cursor: pointer;">
          ▶️ Run
        </button>
        <button id="btn-capture-audio" style="flex: 1.2; background: #15803d; color: #fff; border: none; border-radius: 6px; padding: 4px 8px; font-size: 11px; font-weight: 600; cursor: pointer;">
          📤 Sync Audio
        </button>
      </div>
    `;

    document.body.appendChild(dock);

    // Bind dock button events
    document.getElementById("btn-inject-screenplay")?.addEventListener("click", async () => {
      let script = lastDispatchedTask && (lastDispatchedTask.raw_text || lastDispatchedTask.screenplay_transcript);
      if (!script && typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
        const res = await new Promise((resolve) => chrome.storage.local.get(["scriptoria_active_chapter"], resolve));
        script = res?.scriptoria_active_chapter?.screenplay_transcript;
      }
      if (script) {
        injectScreenplay(script);
        updateDockStatus("Screenplay Injected into Playground!", "#34a853");
      } else {
        updateDockStatus("No screenplay queued from Scriptoria yet", "#f59e0b");
      }
    });

    if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(["scriptoria_active_chapter"], (res) => {
        const pkg = res?.scriptoria_active_chapter;
        if (pkg && pkg.chapter_title) {
          updateDockStatus(`${pkg.chapter_title} (${pkg.total_words || 2206}w) ready`, "#fbbf24");
        }
      });
    }

    document.getElementById("btn-run-tts")?.addEventListener("click", () => {
      const genBtn = findGenerateButton();
      if (genBtn) {
        genBtn.click();
        updateDockStatus("Generating 3.8 TTS Speech in AI Studio...", "#3b82f6");
      } else {
        updateDockStatus("Run button not found in active tab", "#ef4444");
      }
    });

    document.getElementById("btn-capture-audio")?.addEventListener("click", () => {
      captureAndSendAudio();
    });
  }

  function updateDockStatus(stateText, dotColor = "#34a853") {
    const dot = document.getElementById("scriptoria-audio-dot");
    const status = document.getElementById("scriptoria-audio-status");
    if (dot) dot.style.background = dotColor;
    if (status) status.innerText = stateText;
  }

  // ==========================================================================
  // 2. DOM Automation for Google AI Studio Playground Prompt Editor
  // ==========================================================================
  function findTranscriptEditor() {
    return (
      document.querySelector('textarea[aria-label*="prompt" i]') ||
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
        text.includes("run") ||
        text.includes("generate") ||
        text.includes("play speech") ||
        b.getAttribute("data-test-id") === "generate-speech" ||
        b.getAttribute("aria-label")?.toLowerCase().includes("run")
      );
    });
  }

  async function injectScreenplay(formattedText) {
    const editor = findTranscriptEditor();
    if (!editor) {
      console.warn("[Scriptoria AI Studio] Prompt/Transcript editor not found in DOM.");
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
  // 3. Audio Detection, Extraction & Synchronization
  // ==========================================================================
  async function captureAndSendAudio() {
    // Find all audio elements or source tags in the page
    const audioElements = Array.from(document.querySelectorAll("audio"));
    let targetAudio = null;

    for (const el of audioElements) {
      if (el.src || el.currentSrc) {
        targetAudio = el;
        break;
      }
    }

    if (!targetAudio) {
      updateDockStatus("No active audio player found in Playground", "#f59e0b");
      return;
    }

    const srcUrl = targetAudio.src || targetAudio.currentSrc;
    if (!srcUrl) {
      updateDockStatus("Audio element has no source URL yet", "#f59e0b");
      return;
    }

    try {
      updateDockStatus("Extracting generated 3.8 TTS audio...", "#3b82f6");
      const resp = await fetch(srcUrl);
      const blob = await resp.blob();

      const reader = new FileReader();
      reader.onloadend = () => {
        const base64data = (reader.result || "").toString().split(",")[1];
        if (!base64data) {
          updateDockStatus("Failed to encode audio data", "#ef4444");
          return;
        }

        const payload = {
          task_id: lastDispatchedTask?.task_id || `tts-${Date.now()}`,
          project_id: lastDispatchedTask?.book_id || "book-active",
          chapter_id: `ch_${String(lastDispatchedTask?.chapter_index || 1).padStart(3, "0")}`,
          chapter_title: lastDispatchedTask?.chapter_title || "Chapter",
          audio_base64: base64data,
          mime_type: blob.type || "audio/wav",
          duration_seconds: targetAudio.duration || 0.0,
          source: "AI_STUDIO_PLAYGROUND_3.8_TTS",
        };

        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(
            JSON.stringify({
              envelope_id: crypto.randomUUID ? crypto.randomUUID() : `audio-${Date.now()}`,
              event_type: "AUDIO_RESULT",
              payload: payload,
            })
          );
          lastCapturedAudioSrc = srcUrl;
          updateDockStatus("Audio Synced with Scriptoria AV Theater!", "#22c55e");
        } else {
          updateDockStatus("Bridge WS offline; could not sync audio", "#ef4444");
        }
      };
      reader.readAsDataURL(blob);
    } catch (err) {
      console.error("[Scriptoria AI Studio] Error extracting audio blob:", err);
      updateDockStatus("Audio extraction failed: " + err.message, "#ef4444");
    }
  }

  // Observe DOM for automatically created <audio> elements after Run
  function setupAudioObserver() {
    const observer = new MutationObserver(() => {
      const audios = document.querySelectorAll("audio");
      for (const a of audios) {
        const src = a.src || a.currentSrc;
        if (src && src !== lastCapturedAudioSrc && (src.startsWith("blob:") || src.startsWith("data:") || src.includes("audio"))) {
          lastCapturedAudioSrc = src;
          console.info("[Scriptoria AI Studio] New audio element detected in Playground:", src);
          updateDockStatus("Audio Detected! Click 'Sync Audio' or auto-syncing...", "#3b82f6");
          // Give browser 500ms to buffer metadata
          setTimeout(() => captureAndSendAudio(), 600);
          break;
        }
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["src"],
    });
  }

  // ==========================================================================
  // 4. WebSocket Connection to Scriptoria FastAPI Bridge
  // ==========================================================================
  async function connectWebSocket() {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    const baseWs = await resolveWsEndpoint();
    try {
      ws = new WebSocket(`${baseWs}?session_id=aistudio-${Date.now()}&source=AI_STUDIO`);
    } catch (err) {
      console.warn("[Scriptoria AI Studio] Could not initiate WS connection:", err);
      scheduleReconnect();
      return;
    }

    ws.onopen = () => {
      console.info("[Scriptoria AI Studio] Connected to Scriptoria Bridge.");
      updateDockStatus("Connected to Scriptoria Bridge (Ready)", "#22c55e");
      startHeartbeat();
    };

    ws.onmessage = async (event) => {
      try {
        const envelope = JSON.parse(event.data);
        const { event_type, payload } = envelope;

        if (event_type === "DISPATCH_AUDIO_TASK") {
          lastDispatchedTask = payload;
          updateDockStatus(`Received 3.8 TTS task for ${payload.chapter_title || "Chapter"}`, "#eab308");
          const success = await injectScreenplay(payload.raw_text || "");
          if (success) {
            updateDockStatus("Screenplay Injected! Ready to Run.", "#22c55e");
            const genBtn = findGenerateButton();
            if (genBtn) {
              updateDockStatus("Clicking Run in AI Studio...", "#3b82f6");
              genBtn.click();
            }
          }
        }
      } catch (err) {
        console.error("[Scriptoria AI Studio] Error handling WS message:", err);
      }
    };

    ws.onclose = () => {
      updateDockStatus("Scriptoria Bridge Offline", "#ef4444");
      stopHeartbeat();
      scheduleReconnect();
    };

    ws.onerror = () => {
      updateDockStatus("Bridge Connection Error", "#ef4444");
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

  // Reconnect if server mode changes
  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === "local" && changes.scriptoria_bridge_config) {
        console.info("[Scriptoria AI Studio] Bridge config changed. Reconnecting WS...");
        if (ws) {
          try { ws.close(); } catch (_) {}
        }
        connectWebSocket();
      }
    });
  }

  // Initialize on page load
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      injectAudioDock();
      connectWebSocket();
      setupAudioObserver();
    });
  } else {
    injectAudioDock();
    connectWebSocket();
    setupAudioObserver();
  }
})();
