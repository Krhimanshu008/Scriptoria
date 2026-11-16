// extension/scriptoria-flow-bridge/popup.js
(function () {
  "use strict";

  const BASE_URL = "http://127.0.0.1:8000";
  const STATUS_ENDPOINT = `${BASE_URL}/api/v1/flow-bridge/status`;
  const TASKS_ENDPOINT = `${BASE_URL}/api/v1/flow-bridge/tasks`;
  const ACTION_ENDPOINT = `${BASE_URL}/api/v1/flow-bridge/queue/action`;
  const EVENTS_ENDPOINT = `${BASE_URL}/api/v1/flow-bridge/events/recent`;

  let pollInterval = null;
  let activeProjectId = "ea1ed436-e578-4327-9c9b-4f6b2e7e551d";

  // Elements
  const elConnectionBadge = document.getElementById("connection-badge");
  const elConnectionText = document.getElementById("connection-text");
  const elProjectId = document.getElementById("info-project-id");
  const elHeartbeat = document.getElementById("info-heartbeat");
  const elQueueEmpty = document.getElementById("queue-empty-msg");
  const elActiveTaskCard = document.getElementById("active-task-container");
  const elTaskPrompt = document.getElementById("task-prompt-text");
  const elTaskModel = document.getElementById("task-model-pill");
  const elGalleryGrid = document.getElementById("gallery-grid");
  const elGalleryCount = document.getElementById("gallery-count");
  const elInputPrompt = document.getElementById("input-prompt");
  const elSelectModel = document.getElementById("select-model");
  const elSelectAspect = document.getElementById("select-aspect");
  const elSelectThinking = document.getElementById("select-thinking");
  const elSelectCandidates = document.getElementById("select-candidates");
  const elBtnDispatch = document.getElementById("btn-dispatch-prompt");
  const elBtnPause = document.getElementById("btn-pause-queue");
  const elBtnClear = document.getElementById("btn-clear-queue");
  const elBtnRefresh = document.getElementById("btn-refresh-status");

  // ==========================================================================
  // 1. Tab Switching
  // ==========================================================================
  document.querySelectorAll(".nav-tab").forEach((tabBtn) => {
    tabBtn.addEventListener("click", () => {
      document.querySelectorAll(".nav-tab").forEach((b) => b.classList.remove("active"));
      document.querySelectorAll(".tab-pane").forEach((p) => p.classList.remove("active"));

      tabBtn.classList.add("active");
      const targetId = tabBtn.getAttribute("data-tab");
      const targetPane = document.getElementById(targetId);
      if (targetPane) targetPane.classList.add("active");

      if (targetId === "tab-gallery") {
        fetchRecentCaptures();
      }
    });
  });

  // ==========================================================================
  // 2. Fetch Live Status
  // ==========================================================================
  async function fetchStatus() {
    try {
      const res = await fetch(STATUS_ENDPOINT, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      activeProjectId = data.flow_project_id || activeProjectId;
      if (elProjectId) {
        elProjectId.textContent = activeProjectId.slice(0, 18) + "...";
        elProjectId.title = activeProjectId;
      }

      if (elHeartbeat) {
        const d = new Date(data.last_heartbeat_at);
        elHeartbeat.textContent = d.toLocaleTimeString();
      }

      // Update Badge
      const state = data.connection_state || "DISCONNECTED";
      elConnectionBadge.className = "badge";
      if (state === "IDLE") {
        elConnectionBadge.classList.add("badge-connected");
        elConnectionText.textContent = "CONNECTED (IDLE)";
      } else if (state === "BUSY_GENERATING") {
        elConnectionBadge.classList.add("badge-busy");
        elConnectionText.textContent = "GENERATING";
      } else {
        elConnectionBadge.classList.add("badge-disconnected");
        elConnectionText.textContent = state;
      }

      // Update Task
      if (data.active_task_id) {
        elQueueEmpty.classList.add("hidden");
        elActiveTaskCard.classList.remove("hidden");
        elTaskPrompt.textContent = `Task: ${data.active_task_id.slice(0, 8)}...`;
      } else {
        elQueueEmpty.classList.remove("hidden");
        elActiveTaskCard.classList.add("hidden");
      }
    } catch (err) {
      elConnectionBadge.className = "badge badge-disconnected";
      elConnectionText.textContent = "BRIDGE OFFLINE";
      if (elProjectId) elProjectId.textContent = "FastAPI Disconnected";
    }
  }

  // ==========================================================================
  // 3. Fetch Recent Captures (Gallery)
  // ==========================================================================
  async function fetchRecentCaptures() {
    try {
      const res = await fetch(EVENTS_ENDPOINT, { cache: "no-store" });
      if (!res.ok) return;
      const events = await res.json();

      elGalleryGrid.innerHTML = "";
      const validCandidates = [];

      for (const ev of events) {
        if (ev.status === "COMPLETED" && ev.candidates) {
          for (const cand of ev.candidates) {
            validCandidates.push({
              url: cand.remote_url,
              time: ev.captured_at,
              prompt: ev.prompt_used,
            });
          }
        }
      }

      elGalleryCount.textContent = `${validCandidates.length} saved`;

      if (validCandidates.length === 0) {
        elGalleryGrid.innerHTML = `<div class="empty-state" style="grid-column: span 2;">No generated media captured yet.</div>`;
        return;
      }

      for (const item of validCandidates.slice(0, 6)) {
        const div = document.createElement("div");
        div.className = "gallery-item";
        div.innerHTML = `
          <img class="gallery-img" src="${item.url}" alt="Capture" loading="lazy" />
          <div class="gallery-overlay">
            <span>Flow Render</span>
            <a href="${item.url}" target="_blank" style="color: #60a5fa; text-decoration: none;">View ↗</a>
          </div>
        `;
        elGalleryGrid.appendChild(div);
      }
    } catch (err) {
      console.warn("[Popup] Could not fetch recent captures:", err);
    }
  }

  // ==========================================================================
  // 4. Manual Dispatch
  // ==========================================================================
  if (elBtnDispatch) {
    elBtnDispatch.addEventListener("click", async () => {
      const prompt = (elInputPrompt.value || "").trim();
      if (!prompt) {
        alert("Please enter a prompt text!");
        return;
      }

      elBtnDispatch.disabled = true;
      elBtnDispatch.textContent = "⚡ Dispatching...";

      try {
        const modelEngine = elSelectModel.value;
        const isVideo = modelEngine.includes("VEO") || modelEngine.includes("OMNI");
        const payload = {
          project_id: "manual_dispatch",
          flow_project_id: activeProjectId,
          prompt: prompt,
          media_type: isVideo ? "VIDEO" : "IMAGE",
          model_engine: modelEngine,
          aspect_ratio: elSelectAspect.value,
          thinking_level: elSelectThinking ? elSelectThinking.value : "HIGH",
          candidate_count: elSelectCandidates ? parseInt(elSelectCandidates.value, 10) : 4,
        };

        const res = await fetch(TASKS_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        elInputPrompt.value = "";
        // Switch to status tab
        document.querySelector('[data-tab="tab-status"]').click();
        await fetchStatus();
      } catch (err) {
        alert(`Failed to dispatch task: ${err.message}`);
      } finally {
        elBtnDispatch.disabled = false;
        elBtnDispatch.textContent = "⚡ Send to Google Flow";
      }
    });
  }

  // ==========================================================================
  // 5. Ingredient Chip Click Insertion
  // ==========================================================================
  document.querySelectorAll(".chip").forEach((chip) => {
    chip.addEventListener("click", async () => {
      const handle = chip.getAttribute("data-handle");
      if (!handle) return;

      // Append to popup textarea
      if (elInputPrompt) {
        const current = elInputPrompt.value;
        elInputPrompt.value = current ? `${current} @${handle}` : `@${handle} `;
      }

      // Also send message to active tab to insert into Google Flow directly
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab && tab.id) {
          chrome.tabs.sendMessage(tab.id, {
            type: "SCRIPTORIA_INSERT_HANDLE",
            handle: handle,
          });
        }
      } catch (e) {
        // Tab may not be flow.google.com
      }
    });
  });

  // ==========================================================================
  // 6. Queue Actions (Pause / Clear)
  // ==========================================================================
  if (elBtnPause) {
    elBtnPause.addEventListener("click", async () => {
      try {
        await fetch(ACTION_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "PAUSE" }),
        });
        await fetchStatus();
      } catch (e) {}
    });
  }

  if (elBtnClear) {
    elBtnClear.addEventListener("click", async () => {
      try {
        await fetch(ACTION_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "FLUSH_ALL" }),
        });
        await fetchStatus();
      } catch (e) {}
    });
  }

  if (elBtnRefresh) {
    elBtnRefresh.addEventListener("click", fetchStatus);
  }

  // ==========================================================================
  // 7. Gemini 3.8 Flash TTS Voice Studio Controls
  // ==========================================================================
  const elSelectAudioModel = document.getElementById("select-audio-model");
  const elSelectVoiceMode = document.getElementById("select-voice-mode");
  const elSelectNarratorVoice = document.getElementById("select-narrator-voice");
  const elSelectAudioLanguage = document.getElementById("select-audio-language");
  const elInputAudioText = document.getElementById("input-audio-text");
  const elBtnGenerateAudio = document.getElementById("btn-generate-audio");
  const elAudioBanner = document.getElementById("audio-notification-banner");
  const elAudioOutput = document.getElementById("audio-output-container");
  const elAudioPlayer = document.getElementById("audio-player");
  const elAudioDownload = document.getElementById("audio-download-link");
  const elAudioMeta = document.getElementById("audio-meta-info");

  function updateAudioBannerNotice() {
    if (!elAudioBanner || !elSelectVoiceMode || !elSelectNarratorVoice) return;
    const mode = elSelectVoiceMode.value;
    const voice = elSelectNarratorVoice.value;
    if (mode === "SINGLE_NARRATOR") {
      elAudioBanner.innerHTML = `📢 <strong>Default Mode:</strong> Single Narrator voice (<em>${voice}</em>). Multi-speaker voiceover is disabled unless configured below.`;
      elAudioBanner.style.borderColor = "rgba(59, 130, 246, 0.3)";
      elAudioBanner.style.background = "rgba(59, 130, 246, 0.12)";
    } else {
      elAudioBanner.innerHTML = `🎭 <strong>Smart Multi-Speaker Mode:</strong> Automatically parsing dialogue quotes for character acting with Narrator (<em>${voice}</em>).`;
      elAudioBanner.style.borderColor = "rgba(16, 185, 129, 0.3)";
      elAudioBanner.style.background = "rgba(16, 185, 129, 0.12)";
    }
  }

  if (elSelectVoiceMode) {
    elSelectVoiceMode.addEventListener("change", updateAudioBannerNotice);
  }
  if (elSelectNarratorVoice) {
    elSelectNarratorVoice.addEventListener("change", updateAudioBannerNotice);
  }

  // Quick Emotion Tag Insertion
  document.querySelectorAll(".btn-tag").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tag = btn.getAttribute("data-tag");
      if (!tag || !elInputAudioText) return;
      const start = elInputAudioText.selectionStart || elInputAudioText.value.length;
      const end = elInputAudioText.selectionEnd || elInputAudioText.value.length;
      const text = elInputAudioText.value;
      elInputAudioText.value = text.substring(0, start) + tag + text.substring(end);
      elInputAudioText.focus();
      elInputAudioText.selectionStart = elInputAudioText.selectionEnd = start + tag.length;
    });
  });

  if (elBtnGenerateAudio) {
    elBtnGenerateAudio.addEventListener("click", async () => {
      const text = (elInputAudioText?.value || "").trim();
      if (!text) {
        alert("Please enter chapter text or dialogue to synthesize.");
        return;
      }

      elBtnGenerateAudio.disabled = true;
      elBtnGenerateAudio.textContent = "⚡ Synthesizing 24kHz Studio Audio...";

      try {
        const payload = {
          project_id: "moby_dick",
          chapter_id: `ch_gen_${Date.now()}`,
          chapter_title: "Chapter Audio Generation",
          raw_text: text,
          config: {
            model_name: elSelectAudioModel?.value || "gemini-3.8-flash-tts",
            voice_mode: elSelectVoiceMode?.value || "SINGLE_NARRATOR",
            narrator_voice: elSelectNarratorVoice?.value || "Enzo",
            language: elSelectAudioLanguage?.value || "en",
            enable_emotion_tags: true,
            execution_mode: "AUTO",
          },
        };

        const res = await fetch(`${BASE_URL}/api/v1/flow-bridge/audio/generate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        if (!res.ok) {
          throw new Error(`HTTP ${res.status}: ${await res.text()}`);
        }

        const data = await res.json();
        if (data.status === "COMPLETED" && data.audio_path) {
          if (elAudioOutput) elAudioOutput.classList.remove("hidden");
          if (elAudioMeta) {
            elAudioMeta.textContent = `24kHz WAV (${data.duration_seconds}s) | ${data.voice_used} | ${data.language.toUpperCase()}`;
          }
          if (elAudioBanner) {
            elAudioBanner.innerHTML = `✅ <strong>Completed:</strong> ${data.user_notification}`;
          }
          if (elAudioPlayer) {
            // Serve via local endpoint or file
            elAudioPlayer.src = `http://127.0.0.1:8000/api/v1/flow-bridge/status`; // trigger load
          }
        } else {
          alert(`Audio generation error: ${data.error_message || "Unknown error"}`);
        }
      } catch (err) {
        console.error("Audio generation error:", err);
        alert(`Failed to synthesize audio: ${err.message}`);
      } finally {
        elBtnGenerateAudio.disabled = false;
        elBtnGenerateAudio.textContent = "⚡ Generate 24kHz Chapter Audio";
      }
    });
  }

  // Lifecycle
  fetchStatus();
  fetchRecentCaptures();
  pollInterval = setInterval(fetchStatus, 3000);

  window.addEventListener("unload", () => {
    if (pollInterval) clearInterval(pollInterval);
  });
})();
