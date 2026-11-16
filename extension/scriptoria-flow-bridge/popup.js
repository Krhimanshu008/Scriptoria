// extension/scriptoria-flow-bridge/popup.js
(function () {
  "use strict";

  let currentConfig = window.ScriptoriaConfig ? window.ScriptoriaConfig.DEFAULT : {
    server_mode: "cloud",
    cloud_url: "https://scriptoria.krhimanshu.in",
    cloud_ws: "wss://scriptoria.krhimanshu.in/api/v1/flow-bridge/ws",
    local_url: "http://127.0.0.1:8000",
    local_ws: "ws://127.0.0.1:8000/api/v1/flow-bridge/ws",
  };

  function getBaseUrl() {
    return window.ScriptoriaConfig
      ? window.ScriptoriaConfig.getBaseUrl(currentConfig)
      : "https://scriptoria.krhimanshu.in";
  }

  function getWsUrl() {
    return window.ScriptoriaConfig
      ? window.ScriptoriaConfig.getWsUrl(currentConfig)
      : "wss://scriptoria.krhimanshu.in/api/v1/flow-bridge/ws";
  }

  function getStatusEndpoint() { return `${getBaseUrl()}/api/v1/flow-bridge/status`; }
  function getTasksEndpoint() { return `${getBaseUrl()}/api/v1/flow-bridge/tasks`; }
  function getActionEndpoint() { return `${getBaseUrl()}/api/v1/flow-bridge/queue/action`; }
  function getEventsEndpoint() { return `${getBaseUrl()}/api/v1/flow-bridge/events/recent`; }

  let pollInterval = null;
  let activeProjectId = "ea1ed436-e578-4327-9c9b-4f6b2e7e551d";

  // Elements
  const elConnectionBadge = document.getElementById("connection-badge");
  const elConnectionText = document.getElementById("connection-text");
  const elSelectServerMode = document.getElementById("select-server-mode");
  const elCustomServerRow = document.getElementById("custom-server-row");
  const elInputCustomUrl = document.getElementById("input-custom-url");
  const elBtnTestConnection = document.getElementById("btn-test-connection");
  const elBtnSwitchServer = document.getElementById("btn-switch-server");
  const elPingIndicator = document.getElementById("ping-indicator");
  const elInfoWsStatus = document.getElementById("info-ws-status");

  const elInfoChapterTitle = document.getElementById("info-chapter-title");
  const elInfoChapterMeta = document.getElementById("info-chapter-meta");
  const elBadgeChapterWords = document.getElementById("badge-chapter-words");
  const elBtnLaunchFlow = document.getElementById("btn-launch-flow");
  const elBtnLaunchAiStudio = document.getElementById("btn-launch-aistudio");
  const elBtnLaunchBoth = document.getElementById("btn-launch-both");

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
  // 0. Configuration Management
  // ==========================================================================
  async function initConfig() {
    if (window.ScriptoriaConfig) {
      currentConfig = await window.ScriptoriaConfig.get();
    }
    if (elSelectServerMode) {
      elSelectServerMode.value = currentConfig.server_mode || "cloud";
    }
    if (elInputCustomUrl && currentConfig.custom_url) {
      elInputCustomUrl.value = currentConfig.custom_url;
    }
    if (elCustomServerRow) {
      if (currentConfig.server_mode === "custom") {
        elCustomServerRow.classList.remove("hidden");
      } else {
        elCustomServerRow.classList.add("hidden");
      }
    }
    if (elInfoWsStatus) {
      elInfoWsStatus.textContent = getWsUrl();
      elInfoWsStatus.title = getWsUrl();
    }
  }

  if (elSelectServerMode) {
    elSelectServerMode.addEventListener("change", () => {
      const mode = elSelectServerMode.value;
      if (mode === "custom") {
        elCustomServerRow?.classList.remove("hidden");
      } else {
        elCustomServerRow?.classList.add("hidden");
      }
    });
  }

  if (elBtnSwitchServer) {
    elBtnSwitchServer.addEventListener("click", async () => {
      const mode = elSelectServerMode?.value || "cloud";
      const customUrl = (elInputCustomUrl?.value || "").trim();
      if (window.ScriptoriaConfig) {
        currentConfig = await window.ScriptoriaConfig.set({
          server_mode: mode,
          custom_url: customUrl,
        });
      }
      if (elInfoWsStatus) {
        elInfoWsStatus.textContent = getWsUrl();
        elInfoWsStatus.title = getWsUrl();
      }
      await fetchStatus();
    });
  }

  if (elBtnTestConnection) {
    elBtnTestConnection.addEventListener("click", async () => {
      if (elPingIndicator) elPingIndicator.textContent = "pinging...";
      const t0 = performance.now();
      try {
        const res = await fetch(getStatusEndpoint(), { cache: "no-store" });
        const latency = Math.round(performance.now() - t0);
        if (res.ok) {
          if (elPingIndicator) elPingIndicator.textContent = `${latency}ms OK`;
        } else {
          if (elPingIndicator) elPingIndicator.textContent = `HTTP ${res.status}`;
        }
      } catch (err) {
        if (elPingIndicator) elPingIndicator.textContent = "ERR (Offline)";
      }
      await fetchStatus();
    });
  }

  // ==========================================================================
  // 0.1 Chapter Context Sync & Auto-Population
  // ==========================================================================
  async function initChapterContext() {
    let pkg = null;
    if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
      const res = await new Promise((resolve) => chrome.storage.local.get(["scriptoria_active_chapter"], resolve));
      pkg = res && res.scriptoria_active_chapter;
    }

    if (!pkg) {
      try {
        const res = await fetch(`${getBaseUrl()}/api/v1/flow-bridge/chapter/package`, { cache: "no-store" });
        if (res.ok) {
          pkg = await res.json();
        }
      } catch (_) {}
    }

    if (pkg && pkg.chapter_title) {
      if (elInfoChapterTitle) elInfoChapterTitle.textContent = pkg.chapter_title;
      if (elBadgeChapterWords) elBadgeChapterWords.textContent = `${pkg.total_words || 2206} words`;
      if (elInfoChapterMeta) {
        const estMin = Math.round((pkg.estimated_audio_duration_sec || 946) / 60);
        elInfoChapterMeta.textContent = `${pkg.total_frames || 90} Frames • Est. Runtime ~${estMin} min • Voice: ${pkg.narrator_voice || "Enzo"}`;
      }
      if (elInputAudioText && (!elInputAudioText.value || elInputAudioText.value.trim().length === 0)) {
        if (pkg.screenplay_transcript) {
          elInputAudioText.value = pkg.screenplay_transcript;
        }
      }
    }

    const charsToRender = (pkg && pkg.characters && pkg.characters.length > 0)
      ? pkg.characters
      : [
          {
            name: "Ishmael",
            mention_handle: "Ishmael",
            archetype: "Narrator & 19th-century sailor",
            visual_prompt: "A gaunt contemplative 28-year-old 19th-century American sailor, dark unruly curls under a navy knit fisherman watch cap, patched indigo wool pea coat with bone buttons, weather-beaten fair skin, hollowed melancholic eyes, cinematic chiaroscuro rim lighting, 50mm portrait prime photograph",
          },
          {
            name: "Captain Ahab",
            mention_handle: "Ahab",
            archetype: "Monomaniacal captain of the Pequod",
            visual_prompt: "A grim, weather-hardened sea captain in his late 50s, stark white lightning-streak scar running down one side of his face into his collar, standing on a carved whalebone ivory leg, fierce burning obsidian eyes, dark wool naval frock coat whipped by sea gale, 85mm prime telephoto, dramatic low-key rim lighting",
          },
        ];
    renderIngredientsList(charsToRender);
  }

  function renderIngredientsList(characters) {
    const listEl = document.getElementById("ingredients-list");
    if (!listEl) return;
    listEl.innerHTML = "";

    characters.forEach((char) => {
      const card = document.createElement("div");
      card.style.cssText = "display: flex; align-items: center; justify-content: space-between; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: 8px; padding: 6px 10px;";

      const left = document.createElement("div");
      left.style.cssText = "display: flex; flex-direction: column; gap: 2px;";

      const chip = document.createElement("button");
      chip.className = "chip";
      chip.setAttribute("data-handle", char.mention_handle);
      chip.textContent = `👤 @${char.mention_handle}`;
      chip.title = "Click to insert into prompt box";
      chip.addEventListener("click", async () => {
        if (elInputPrompt) {
          const current = elInputPrompt.value;
          elInputPrompt.value = current ? `${current} @${char.mention_handle} ` : `@${char.mention_handle} `;
        }
        try {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (tab && tab.id) {
            chrome.tabs.sendMessage(tab.id, {
              type: "SCRIPTORIA_INSERT_HANDLE",
              handle: char.mention_handle,
            });
          }
        } catch (_) {}
      });

      const desc = document.createElement("span");
      desc.style.cssText = "font-size: 10px; color: #9ca3af; max-width: 170px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;";
      desc.textContent = char.archetype || char.name;

      left.appendChild(chip);
      left.appendChild(desc);

      const syncBtn = document.createElement("button");
      syncBtn.className = "btn btn-secondary btn-xs";
      syncBtn.textContent = "➕ Register in Flow";
      syncBtn.title = "Create character identity in Google Flow Character Studio";
      syncBtn.addEventListener("click", async () => {
        syncBtn.disabled = true;
        syncBtn.textContent = "⏳ Syncing...";
        try {
          const res = await fetch(`${getBaseUrl()}/api/v1/flow-bridge/character/sync`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              flow_project_id: activeProjectId,
              mention_handle: char.mention_handle,
              visual_prompt: char.visual_prompt,
              generate_portrait: true,
            }),
          });
          if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            throw new Error(errData.detail || `HTTP ${res.status}`);
          }
          syncBtn.textContent = "✅ Synced";
          alert(`Character @${char.mention_handle} dispatched to Flow! The Flow tab will open Character Studio and register the portrait.`);
        } catch (err) {
          alert(`Flow Character Sync error: ${err.message}. Ensure Google Flow tab is open!`);
          syncBtn.textContent = "➕ Register in Flow";
          syncBtn.disabled = false;
        }
      });

      card.appendChild(left);
      card.appendChild(syncBtn);
      listEl.appendChild(card);
    });
  }

  const btnSyncIngredients = document.getElementById("btn-sync-ingredients");
  if (btnSyncIngredients) {
    btnSyncIngredients.addEventListener("click", () => {
      initChapterContext();
    });
  }

  const btnOpenAiStudio = document.getElementById("btn-open-aistudio");
  if (btnOpenAiStudio) {
    btnOpenAiStudio.addEventListener("click", () => {
      if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage({ action: "OPEN_AISTUDIO_TAB" });
      } else {
        window.open("https://aistudio.google.com/", "_blank");
      }
    });
  }

  if (elBtnLaunchFlow) {
    elBtnLaunchFlow.addEventListener("click", () => {
      chrome.runtime.sendMessage({ action: "OPEN_FLOW_TAB" });
    });
  }
  if (elBtnLaunchAiStudio) {
    elBtnLaunchAiStudio.addEventListener("click", () => {
      chrome.runtime.sendMessage({ action: "OPEN_AISTUDIO_TAB" });
    });
  }
  if (elBtnLaunchBoth) {
    elBtnLaunchBoth.addEventListener("click", () => {
      chrome.runtime.sendMessage({ action: "OPEN_BOTH_TABS" });
    });
  }

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
      const res = await fetch(getStatusEndpoint(), { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      activeProjectId = data.flow_project_id || activeProjectId;
      if (elProjectId) {
        elProjectId.textContent = activeProjectId.slice(0, 18) + "...";
        elProjectId.title = activeProjectId;
      }

      if (elHeartbeat && data.last_heartbeat_at) {
        const d = new Date(data.last_heartbeat_at);
        elHeartbeat.textContent = d.toLocaleTimeString();
      }

      // Update Badge
      const state = data.connection_state || "IDLE";
      elConnectionBadge.className = "badge";
      if (state === "IDLE") {
        elConnectionBadge.classList.add("badge-connected");
        const modeLabel = currentConfig.server_mode === "local" ? "LOCAL" : "CLOUD";
        elConnectionText.textContent = `CONNECTED (${modeLabel})`;
      } else if (state === "BUSY_GENERATING") {
        elConnectionBadge.classList.add("badge-busy");
        elConnectionText.textContent = "GENERATING";
      } else if (state === "DISCONNECTED") {
        elConnectionBadge.classList.add("badge-busy");
        elConnectionText.textContent = "WAITING FOR FLOW TAB";
      } else {
        elConnectionBadge.classList.add("badge-disconnected");
        elConnectionText.textContent = state;
      }

      // Update Task / Queue Status
      if (data.active_task_id) {
        elQueueEmpty.classList.add("hidden");
        elActiveTaskCard.classList.remove("hidden");
        elTaskPrompt.textContent = `Active Task: ${data.active_task_id.slice(0, 8)}...`;
      } else {
        elActiveTaskCard.classList.add("hidden");
        elQueueEmpty.classList.remove("hidden");
        if (data.queued_tasks_count > 0) {
          elQueueEmpty.textContent = `📋 ${data.queued_tasks_count} tasks queued on server`;
        } else {
          elQueueEmpty.textContent = "No pending tasks in queue";
        }
      }
    } catch (err) {
      elConnectionBadge.className = "badge badge-disconnected";
      elConnectionText.textContent = "BRIDGE OFFLINE";
      if (elProjectId) elProjectId.textContent = "Unreachable";
    }
  }

  // ==========================================================================
  // 3. Fetch Recent Captures (Gallery)
  // ==========================================================================
  async function fetchRecentCaptures() {
    try {
      const res = await fetch(getEventsEndpoint(), { cache: "no-store" });
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

        const res = await fetch(getTasksEndpoint(), {
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
        await fetch(getActionEndpoint(), {
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
        await fetch(getActionEndpoint(), {
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

        const res = await fetch(`${getBaseUrl()}/api/v1/flow-bridge/audio/generate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        if (!res.ok) {
          const errText = await res.text();
          let cleanMsg = `HTTP ${res.status}`;
          if (res.status === 504) {
            cleanMsg = "Cloud synthesis timed out (HTTP 504). Tip: Click '🎙️ Open Google AI Studio' below for instant, free 24kHz audio synthesis directly in the Google AI Studio tab!";
          } else {
            try {
              const parsed = JSON.parse(errText);
              cleanMsg = parsed.detail || (parsed.error && parsed.error.message) || cleanMsg;
            } catch (_) {
              cleanMsg = errText.slice(0, 160);
            }
          }
          throw new Error(cleanMsg);
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
            // Serve via dynamic status endpoint
            elAudioPlayer.src = `${getBaseUrl()}/api/v1/flow-bridge/status`;
          }
        } else {
          alert(`Audio generation error: ${data.error_message || "Unknown error"}`);
        }
      } catch (err) {
        console.error("Audio generation error:", err);
        alert(`Audio Synthesis Notice:\n\n${err.message}`);
      } finally {
        elBtnGenerateAudio.disabled = false;
        elBtnGenerateAudio.textContent = "⚡ Generate 24kHz Chapter Audio";
      }
    });
  }

  // Lifecycle
  (async function init() {
    await initConfig();
    await initChapterContext();
    await fetchStatus();
    await fetchRecentCaptures();
    pollInterval = setInterval(fetchStatus, 3000);
  })();

  window.addEventListener("unload", () => {
    if (pollInterval) clearInterval(pollInterval);
  });
})();
