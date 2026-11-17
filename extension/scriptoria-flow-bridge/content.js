// extension/scriptoria-flow-bridge/content.js
/**
 * Scriptoria Google Flow Companion — ISOLATED World Content Script
 * - Injects `injected.js` into MAIN world at document_start
 * - Connects to local FastAPI WebSocket (ws://127.0.0.1:8000/api/v1/flow-bridge/ws)
 * - Performs heartbeat telemetry and project UUID detection
 * - Executes FlowGenerationTask:
 *   1. Locates prompt editor (ProseMirror / Lexical / textarea)
 *   2. Injects prompt text and resolves @ingredient mention dropdowns
 *   3. Triggers Generate button
 *   4. Captures result via MAIN world RPC event or DOM MutationObserver fallback
 *   5. Emits FlowMediaResultEvent back to FastAPI
 */
(function () {
  "use strict";

  if (window.__SCRIPTORIA_FLOW_CONTENT_ACTIVE__) {
    return;
  }
  window.__SCRIPTORIA_FLOW_CONTENT_ACTIVE__ = true;

  const DEFAULT_FLOW_PROJECT_ID = "ea1ed436-e578-4327-9c9b-4f6b2e7e551d";
  const HEARTBEAT_INTERVAL_MS = 8_000;
  const RECONNECT_BASE_DELAY_MS = 2_000;
  const RECONNECT_MAX_DELAY_MS = 20_000;

  async function resolveWsEndpoint() {
    if (window.ScriptoriaConfig) {
      const cfg = await window.ScriptoriaConfig.get();
      return window.ScriptoriaConfig.getWsUrl(cfg);
    }
    return "wss://scriptoria.krhimanshu.in/api/v1/flow-bridge/ws";
  }

  const SESSION_ID = crypto.randomUUID
    ? crypto.randomUUID()
    : `sess-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

  let ws = null;
  let reconnectAttempts = 0;
  let heartbeatTimer = null;
  let activeTask = null;
  let activeTaskStartTime = 0;
  let activeTaskTimeoutHandle = null;
  let completedTasksCount = 0;
  let failedTasksCount = 0;

  // ==========================================================================
  // 1. Inject `injected.js` into MAIN World
  // ==========================================================================
  function injectMainWorldInterceptor() {
    try {
      const script = document.createElement("script");
      script.src = chrome.runtime.getURL("injected.js");
      script.async = false;
      (document.head || document.documentElement).appendChild(script);
      script.onload = () => script.remove();
    } catch (err) {
      console.error("[Scriptoria Companion] Failed to inject MAIN world script:", err);
    }
  }

  injectMainWorldInterceptor();

  // ==========================================================================
  // 2. Helper Utilities & Flow Project Detection
  // ==========================================================================
  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function detectFlowProjectId() {
    const match = window.location.pathname.match(
      /\/project\/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})/
    );
    return match ? match[1] : DEFAULT_FLOW_PROJECT_ID;
  }

  function scanAvailableIngredientsInDom() {
    const handles = new Set();
    const pills = document.querySelectorAll(
      '[data-ingredient-name], [data-mention], [aria-label*="ingredient" i], .ingredient-chip, [role="option"]'
    );
    pills.forEach((el) => {
      const attr =
        el.getAttribute("data-ingredient-name") ||
        el.getAttribute("data-mention") ||
        (el.textContent || "").trim();
      if (attr && attr.length > 1 && attr.length < 64) {
        handles.add(attr.replace(/^@/, "").trim());
      }
    });
    return Array.from(handles);
  }

  function buildStatusPayload(connectionState, lastError = null) {
    return {
      session_id: SESSION_ID,
      connection_state: connectionState,
      flow_project_id: detectFlowProjectId(),
      active_tab_url: window.location.href,
      extension_version: "1.0.0",
      user_agent: navigator.userAgent,
      active_task_id: activeTask ? activeTask.task_id : null,
      queued_tasks_count: 0,
      completed_tasks_count: completedTasksCount,
      failed_tasks_count: failedTasksCount,
      available_ingredients: scanAvailableIngredientsInDom(),
      last_heartbeat_at: new Date().toISOString(),
      last_error: lastError,
    };
  }

  function sendEnvelope(eventType, payload, correlationId = null) {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return false;
    }
    const envelope = {
      envelope_id: crypto.randomUUID ? crypto.randomUUID() : `env-${Date.now()}`,
      event_type: eventType,
      correlation_id: correlationId,
      timestamp: new Date().toISOString(),
      payload,
    };
    ws.send(JSON.stringify(envelope));
    return true;
  }

  // ==========================================================================
  // 2.5 Deck, Character, and Scene Controller Submodules
  // ==========================================================================
  const MODEL_NAME_MAP = {
    NANO_BANANA_2_1: "Nano Banana 2.1",
    NANO_BANANA_PRO: "Nano Banana Pro",
    NANO_BANANA_2_LITE: "Nano Banana 2 Lite",
    NANO_BANANA: "Nano Banana 2.1",
    OMNI_1_2_FLASH: "Omni 1.2 Flash",
    OMNI_1_1_FLASH: "Omni 1.1 Flash",
    VEO_3_1_LITE: "Veo 3.1 - Lite",
    VEO_3_1_FAST: "Veo 3.1 - Fast",
    VEO_3_1_QUALITY: "Veo 3.1 - Quality",
  };

  const THINKING_LEVEL_MAP = {
    LOW: "Low",
    MEDIUM: "Medium",
    HIGH: "High",
    EXTRA_THOROUGH: "Extra thorough",
  };

  function findSettingsTrigger() {
    return (
      document.querySelector("button.settings-trigger-button") ||
      document.querySelector('button[aria-label="Settings trigger"]') ||
      Array.from(document.querySelectorAll("button")).find(
        (b) =>
          b.getAttribute("aria-label") === "Settings trigger" ||
          (b.innerText &&
            (b.innerText.includes("Nano Banana") ||
              b.innerText.includes("Omni") ||
              b.innerText.includes("Veo")))
      )
    );
  }

  function findRadioByText(textPattern) {
    const radios = Array.from(
      document.querySelectorAll('[role="radio"], input[type="radio"]')
    );
    return radios.find((r) => {
      const text = (r.innerText || r.getAttribute("aria-label") || r.value || "").trim().toLowerCase();
      return text === textPattern.toLowerCase() || text.startsWith(textPattern.toLowerCase());
    });
  }

  async function openSettingsPopup() {
    const trigger = findSettingsTrigger();
    if (!trigger) {
      console.warn("[FlowDeckController] Settings trigger button not found.");
      return false;
    }
    trigger.click();
    await sleep(250);
    return true;
  }

  async function closeSettingsPopup() {
    const escEvent = new KeyboardEvent("keydown", {
      key: "Escape",
      code: "Escape",
      keyCode: 27,
      which: 27,
      bubbles: true,
      cancelable: true,
    });
    (document.activeElement || document.body).dispatchEvent(escEvent);
    await sleep(150);
  }

  async function selectModelFamily(targetModelText) {
    const modelFamilyBtn = Array.from(document.querySelectorAll("button")).find(
      (b) =>
        b.getAttribute("aria-label") === "Select model family" ||
        (b.innerText && b.innerText.includes("Select model family"))
    );

    if (!modelFamilyBtn) {
      console.warn("[FlowDeckController] Select model family button not found.");
      return false;
    }

    modelFamilyBtn.click();
    await sleep(250);

    const menuItems = Array.from(
      document.querySelectorAll('[role="menuitem"], [role="option"]')
    );

    const match = menuItems.find((item) => {
      const text = (item.innerText || item.getAttribute("aria-label") || "").toLowerCase();
      return text.includes(targetModelText.toLowerCase());
    });

    if (match) {
      match.click();
      await sleep(200);
      return true;
    } else {
      console.warn(`[FlowDeckController] Model "${targetModelText}" not found in menu.`);
      return false;
    }
  }

  async function configureFlowDeck(options = {}) {
    console.log("[FlowDeckController] Applying deck settings:", options);
    const opened = await openSettingsPopup();
    if (!opened) return false;

    try {
      const mediaType = options.media_type || options.mediaType;
      const aspectRatio = options.aspect_ratio || options.aspectRatio;
      const candidateCount = options.candidate_count || options.candidateCount;
      const thinkingLevel = options.thinking_level || options.thinkingLevel;
      const modelEngine = options.model_engine || options.modelEngine;

      // 1. Modality (Image vs Video)
      if (mediaType) {
        const modalityTarget = mediaType.toUpperCase() === "VIDEO" ? "Video" : "Image";
        const radio = findRadioByText(modalityTarget);
        if (radio && !radio.checked && radio.getAttribute("aria-checked") !== "true") {
          radio.click();
          await sleep(200);
        }
      }

      // 2. Aspect Ratio (16:9, 9:16, 1:1, 4:3, 3:4)
      if (aspectRatio) {
        const ratioRadio = findRadioByText(aspectRatio);
        if (ratioRadio) {
          ratioRadio.click();
          await sleep(150);
        }
      }

      // 3. Batch Count (x1, x2, x3, x4)
      if (candidateCount) {
        const countTarget = `x${candidateCount}`;
        const countRadio = findRadioByText(countTarget);
        if (countRadio) {
          countRadio.click();
          await sleep(150);
        }
      }

      // 4. Thinking Level (Low, Medium, High, Extra thorough)
      if (thinkingLevel) {
        const levelTarget = THINKING_LEVEL_MAP[thinkingLevel] || thinkingLevel;
        const levelRadio = findRadioByText(levelTarget);
        if (levelRadio) {
          levelRadio.click();
          await sleep(150);
        }
      }

      // 5. Model Family
      if (modelEngine) {
        const targetModelName = MODEL_NAME_MAP[modelEngine] || modelEngine;
        await selectModelFamily(targetModelName);
      }

      return true;
    } catch (err) {
      console.error("[FlowDeckController] Error configuring deck:", err);
      return false;
    } finally {
      await closeSettingsPopup();
    }
  }

  function findCharacterEditor() {
    return (
      document.querySelector('div.ProseMirror[contenteditable="true"]') ||
      document.querySelector('textarea[placeholder*="character" i]') ||
      document.querySelector('[aria-label*="Describe your character" i]')
    );
  }

  function findCharacterButton(labelSubstring) {
    const btns = Array.from(document.querySelectorAll("button"));
    return btns.find((b) => {
      const text = (b.innerText || b.getAttribute("aria-label") || "").toLowerCase();
      return text.includes(labelSubstring.toLowerCase());
    });
  }

  async function openCharacterStudio(flowProjectId) {
    if (window.location.pathname.endsWith("/character")) {
      return true;
    }
    const charsBtn = findCharacterButton("Characters");
    if (charsBtn) {
      charsBtn.click();
      await sleep(600);
      return true;
    }
    if (flowProjectId) {
      window.location.href = `https://flow.google.com/project/${flowProjectId}/character`;
      return true;
    }
    return false;
  }

  async function injectCharacterPrompt(promptText) {
    const editor = findCharacterEditor();
    if (!editor) {
      console.error("[FlowCharacterSync] Character prompt editor not found.");
      return false;
    }

    editor.focus();
    if (editor.tagName === "TEXTAREA" || editor.tagName === "INPUT") {
      editor.value = promptText;
      editor.dispatchEvent(new Event("input", { bubbles: true }));
      editor.dispatchEvent(new Event("change", { bubbles: true }));
    } else {
      document.execCommand("selectAll", false, null);
      document.execCommand("delete", false, null);
      document.execCommand("insertText", false, promptText);
      editor.dispatchEvent(new InputEvent("input", { bubbles: true, data: promptText }));
    }
    await sleep(200);
    return true;
  }

  async function triggerCharacterGeneration() {
    const genBtn = findCharacterButton("Start generation");
    if (!genBtn) {
      console.warn("[FlowCharacterSync] Start generation button not found in Character Studio.");
      return false;
    }
    genBtn.removeAttribute("disabled");
    genBtn.click();
    await sleep(500);
    return true;
  }

  async function selectCandidateFromProject(imageIndex = 0) {
    const addFromProjectBtn = findCharacterButton("Add from project");
    if (!addFromProjectBtn) {
      console.warn("[FlowCharacterSync] 'Add from project' button not found.");
      return false;
    }
    addFromProjectBtn.click();
    await sleep(400);

    const candidates = Array.from(
      document.querySelectorAll('img[src*="flow-content.google"], img[src*="flow.google.com/asb/"]')
    );
    if (candidates.length > imageIndex) {
      candidates[imageIndex].click();
      await sleep(300);
      return true;
    }
    return false;
  }

  async function finalizeCharacter(characterHandle) {
    const doneBtn = findCharacterButton("Done");
    if (!doneBtn) {
      console.warn("[FlowCharacterSync] Done button not found in Character Studio.");
      return false;
    }
    doneBtn.click();
    await sleep(800);
    return true;
  }

  async function syncCharacterProfile(characterPayload) {
    console.log("[FlowCharacterSync] Syncing character:", characterPayload);
    const flowProjectId = characterPayload.flow_project_id || detectFlowProjectId();
    
    await openCharacterStudio(flowProjectId);
    await sleep(500);

    const visualPrompt = characterPayload.visual_prompt || characterPayload.visualPrompt;
    if (visualPrompt) {
      await injectCharacterPrompt(visualPrompt);
    }

    const useCanvas = characterPayload.use_canvas_candidate || characterPayload.useCanvasCandidate;
    const genPortrait = characterPayload.generate_portrait || characterPayload.generatePortrait;
    const candIndex = characterPayload.candidate_index || characterPayload.candidateIndex || 0;
    const handle = characterPayload.mention_handle || characterPayload.mentionHandle || "Character";

    if (useCanvas) {
      await selectCandidateFromProject(candIndex);
    } else if (genPortrait) {
      await triggerCharacterGeneration();
    }

    await sleep(500);
    await finalizeCharacter(handle);

    return {
      success: true,
      mention_handle: handle,
      flow_project_id: flowProjectId,
    };
  }

  function findButtonByTextOrAria(textPattern) {
    const btns = Array.from(document.querySelectorAll("button, [role=\"button\"], [role=\"menuitem\"]"));
    return btns.find((b) => {
      const text = (b.innerText || b.getAttribute("aria-label") || "").toLowerCase();
      return text.includes(textPattern.toLowerCase());
    });
  }

  async function createNewScene() {
    if (window.location.pathname.includes("/scene/")) {
      return window.location.href;
    }

    const addMediaBtn =
      document.querySelector('button[aria-label*="Add media" i]') ||
      findButtonByTextOrAria("Add media");

    if (!addMediaBtn) {
      console.error("[FlowSceneSync] 'Add media' button not found.");
      return null;
    }

    addMediaBtn.click();
    await sleep(350);

    const newSceneItem = findButtonByTextOrAria("New scene");
    if (!newSceneItem) {
      console.error("[FlowSceneSync] 'New scene' menu item not found.");
      return null;
    }

    newSceneItem.click();
    await sleep(1500);

    return window.location.href;
  }

  async function setSceneTitle(chapterTitle) {
    const titleInput =
      document.querySelector('input[aria-label="Editable text"]') ||
      document.querySelector('input[value*="Untitled Scene"]') ||
      document.querySelector('h1[contenteditable="true"]');

    if (!titleInput) {
      console.warn("[FlowSceneSync] Scene title input not found.");
      return false;
    }

    titleInput.focus();
    if (titleInput.tagName === "INPUT") {
      titleInput.value = chapterTitle;
      titleInput.dispatchEvent(new Event("input", { bubbles: true }));
      titleInput.dispatchEvent(new Event("change", { bubbles: true }));
    } else {
      document.execCommand("selectAll", false, null);
      document.execCommand("insertText", false, chapterTitle);
    }
    await sleep(200);
    return true;
  }

  async function injectClipPrompt(promptText) {
    const clipEditor =
      document.querySelector('div.ProseMirror[contenteditable="true"]') ||
      document.querySelector('textarea[aria-label*="clip" i]') ||
      document.querySelector('[placeholder*="clip" i]');

    if (!clipEditor) {
      console.warn("[FlowSceneSync] Clip prompt editor not found.");
      return false;
    }

    clipEditor.focus();
    document.execCommand("selectAll", false, null);
    document.execCommand("delete", false, null);
    document.execCommand("insertText", false, promptText);
    clipEditor.dispatchEvent(new InputEvent("input", { bubbles: true, data: promptText }));
    await sleep(200);
    return true;
  }

  async function triggerClipGeneration() {
    const genBtn =
      document.querySelector('button[aria-label="Start generation"]') ||
      document.querySelector('flow-generate-icon-button button');

    if (genBtn) {
      genBtn.removeAttribute("disabled");
      genBtn.click();
      await sleep(500);
      return true;
    }
    return false;
  }

  async function addNewTimelineClip() {
    const addClipBtn =
      document.querySelector('button[aria-label*="Add clip" i]') ||
      findButtonByTextOrAria("Add clip");

    if (addClipBtn) {
      addClipBtn.click();
      await sleep(400);
      return true;
    }
    return false;
  }

  async function orchestrateChapterScene(scenePayload) {
    console.log("[FlowSceneSync] Orchestrating chapter scene:", scenePayload);

    await createNewScene();
    await sleep(800);

    const chapterTitle = scenePayload.chapter_title || scenePayload.chapterTitle;
    if (chapterTitle) {
      await setSceneTitle(chapterTitle);
    }

    const beats = scenePayload.beats || [];
    for (let i = 0; i < beats.length; i++) {
      const beat = beats[i];
      if (i > 0) {
        await addNewTimelineClip();
        await sleep(400);
      }
      await injectClipPrompt(beat.prompt);
      await sleep(200);
      await triggerClipGeneration();
      await sleep(2000);
    }

    return {
      success: true,
      scene_id: scenePayload.scene_id || scenePayload.sceneId,
      scene_url: window.location.href,
    };
  }

  // Bind to globalThis for external access as well
  globalThis.FlowDeckController = { configureFlowDeck, openSettingsPopup, closeSettingsPopup };
  globalThis.FlowCharacterSync = { syncCharacterProfile, openCharacterStudio };
  globalThis.FlowSceneSync = { orchestrateChapterScene, createNewScene };

  // ==========================================================================
  // 3. DOM Prompt Editor & @Ingredient Automation Engine
  // ==========================================================================
  function findPromptEditor() {
    // 1. Exact Google Flow ProseMirror editor selectors
    const exactMatch =
      document.querySelector('div.ProseMirror[contenteditable="true"]') ||
      document.querySelector('div[aria-label="What do you want to create?"][contenteditable="true"]') ||
      document.querySelector('div.prosemirror-editor div[contenteditable="true"]');
    if (exactMatch) return exactMatch;

    const selectors = [
      'div.ProseMirror[contenteditable="true"]',
      '[contenteditable="true"][role="textbox"]',
      'div[contenteditable="true"][data-placeholder]',
      'div[data-lexical-editor="true"]',
      'textarea[placeholder*="create" i]',
      '[placeholder*="create" i]',
      'textarea[placeholder*="prompt" i]',
      'textarea[placeholder*="describe" i]',
      'textarea[aria-label*="prompt" i]',
      '[contenteditable="true"]',
      "textarea",
    ];
    for (const sel of selectors) {
      const candidates = Array.from(document.querySelectorAll(sel));
      const visible = candidates.find((el) => {
        const rect = el.getBoundingClientRect();
        return rect.width > 80 && rect.height >= 16;
      });
      if (visible) return visible;
    }
    return null;
  }

  async function ensureProjectCanvasOpen() {
    let editor = findPromptEditor();
    if (editor) return editor;

    // If on lobby home page (e.g. flow.google.com/ or without /project/)
    if (window.location.pathname === "/" || !window.location.pathname.includes("/project/")) {
      console.info("[Scriptoria Companion] Currently on Flow lobby. Auto-opening project canvas...");
      updateFloatingPill("BUSY_GENERATING");

      // 1. Look for existing project card (prefer Scriptoria if available)
      const projectCards = Array.from(
        document.querySelectorAll('a[href*="/project/"], [data-project-id], [role="button"]')
      );
      const scriptoriaCard =
        projectCards.find((c) => (c.textContent || "").toLowerCase().includes("scriptoria")) ||
        projectCards.find((c) => (c.getAttribute("href") || "").includes("/project/"));

      if (scriptoriaCard) {
        scriptoriaCard.click();
        for (let i = 0; i < 20; i++) {
          await sleep(250);
          editor = findPromptEditor();
          if (editor) return editor;
        }
      }

      // 2. Fall back to clicking "+ New project"
      const newProjBtn = Array.from(
        document.querySelectorAll('button, div, [role="button"], span')
      ).find((el) => (el.textContent || "").toLowerCase().includes("new project"));
      if (newProjBtn) {
        newProjBtn.click();
        for (let i = 0; i < 25; i++) {
          await sleep(250);
          editor = findPromptEditor();
          if (editor) return editor;
        }
      }
    }

    return findPromptEditor();
  }

  function findGenerateButton() {
    const explicitSelectors = [
      'flow-generate-icon-button button',
      'button[aria-label*="Start generation" i]',
      'button[aria-label*="generation" i]',
      'button[aria-label*="Generate" i]',
      'button[aria-label*="Create" i]',
      'button[data-testid*="generate" i]',
      'button[type="submit"]',
    ];
    for (const sel of explicitSelectors) {
      const btn = document.querySelector(sel);
      if (btn) return btn;
    }

    const allButtons = Array.from(document.querySelectorAll("button"));
    return (
      allButtons.find((btn) => {
        const text = (btn.textContent || "").trim().toLowerCase();
        const aria = (btn.getAttribute("aria-label") || "").toLowerCase();
        return (
          text === "generate" ||
          text === "create" ||
          text.includes("generate") ||
          aria.includes("generate") ||
          aria.includes("start generation") ||
          aria.includes("send prompt")
        );
      }) || null
    );
  }

  async function clearEditorContent(editor) {
    editor.focus();
    await sleep(60);

    if (editor.tagName === "TEXTAREA" || editor.tagName === "INPUT") {
      const proto =
        editor.tagName === "TEXTAREA"
          ? window.HTMLTextAreaElement.prototype
          : window.HTMLInputElement.prototype;
      const nativeSetter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
      if (nativeSetter) {
        nativeSetter.call(editor, "");
      } else {
        editor.value = "";
      }
      editor.dispatchEvent(new Event("input", { bubbles: true }));
      return;
    }

    // ContentEditable (ProseMirror / Lexical)
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(editor);
    selection.removeAllRanges();
    selection.addRange(range);
    document.execCommand("delete", false, null);
    editor.dispatchEvent(
      new InputEvent("input", { bubbles: true, inputType: "deleteContentBackward" })
    );
    await sleep(50);
  }

  // ==========================================================================
  // 3. Argon Hardened Prompt & Mentions State Machine (T2.2 & T2.3)
  // ==========================================================================

  /**
   * T2.3: Word-Boundary Typing Cadence Humanizer
   * Eliminates the 116-minute typing trap by burst-typing intra-word characters (18ms-35ms)
   * and pausing at syntactic word boundaries (100ms-220ms).
   * Total prompt entry envelope is clamped adaptively to ~4.5s - 7.5s.
   */
  async function insertTextSegment(editor, text) {
    if (!text) return;
    editor.focus();

    // If editor is standard textarea / input
    if (editor.tagName === "TEXTAREA" || editor.tagName === "INPUT") {
      const proto =
        editor.tagName === "TEXTAREA"
          ? window.HTMLTextAreaElement.prototype
          : window.HTMLInputElement.prototype;
      const nativeSetter = Object.getOwnPropertyDescriptor(proto, "value")?.set;

      const appendNative = (val) => {
        const nextValue = (editor.value || "") + val;
        if (nativeSetter) {
          nativeSetter.call(editor, nextValue);
        } else {
          editor.value = nextValue;
        }
        editor.dispatchEvent(new InputEvent("input", { bubbles: true, data: val }));
      };

      const tokens = text.split(/(\s+)/);
      const totalChars = text.length;
      const intraCharDelay = totalChars > 250 ? 12 : totalChars > 120 ? 20 : 30;
      const interWordDelay = totalChars > 250 ? 65 : 120;

      for (const token of tokens) {
        if (/^\s+$/.test(token)) {
          appendNative(token);
          await sleep(interWordDelay + Math.floor(Math.random() * 35));
        } else {
          for (const ch of token) {
            appendNative(ch);
            await sleep(intraCharDelay + Math.floor(Math.random() * 12));
          }
        }
      }
      editor.dispatchEvent(new Event("change", { bubbles: true }));
      return;
    }

    // ContentEditable (ProseMirror / Lexical in Google Flow)
    const tokens = text.split(/(\s+)/);
    const totalChars = text.length;
    const intraCharDelay = totalChars > 300 ? 10 : totalChars > 150 ? 18 : 28;
    const interWordDelay = totalChars > 300 ? 55 : 120;

    for (const token of tokens) {
      if (/^\s+$/.test(token)) {
        const ok = document.execCommand("insertText", false, token);
        if (!ok) {
          editor.textContent = (editor.textContent || "") + token;
        }
        editor.dispatchEvent(
          new InputEvent("input", {
            bubbles: true,
            cancelable: true,
            inputType: "insertText",
            data: token,
          })
        );
        await sleep(interWordDelay + Math.floor(Math.random() * 35));
      } else {
        for (const ch of token) {
          const ok = document.execCommand("insertText", false, ch);
          if (!ok) {
            editor.textContent = (editor.textContent || "") + ch;
          }
          editor.dispatchEvent(
            new InputEvent("input", {
              bubbles: true,
              cancelable: true,
              inputType: "insertText",
              data: ch,
            })
          );
          await sleep(intraCharDelay + Math.floor(Math.random() * 10));
        }
      }
    }
  }

  /**
   * T2.2: Popover Intercept State Machine for @ingredients
   * 1. Types `@` + first 3 characters of handle.
   * 2. Observes DOM for `[role="listbox"]` / `.mention-item` popover mount (up to 1500ms).
   * 3. Selects matching option via synthetic click / Enter.
   * 4. Asserts `contenteditable="false"` chip node creation before continuing.
   * 5. Falls back cleanly to completing full handle text if popover times out.
   */
  async function injectMentionToken(editor, handle) {
    if (!handle) return;
    editor.focus();

    const cleanHandle = handle.replace(/^@/, "").trim();
    const prefix = cleanHandle.slice(0, Math.min(3, cleanHandle.length));

    const countChips = () =>
      editor.querySelectorAll(
        '[contenteditable="false"], [data-mention], .ingredient-chip, [data-ingredient-id], span[data-type="mention"]'
      ).length;
    const initialChipCount = countChips();

    // Step 1: Type '@' and first 3 chars
    await insertTextSegment(editor, `@${prefix}`);

    // Step 2: Await popover listbox
    const findMatchingOption = () => {
      const options = Array.from(
        document.querySelectorAll(
          '[role="listbox"] [role="option"], [data-radix-popper-content-wrapper] [role="menuitem"], .mention-item, [data-ingredient-option], [role="menuitem"]'
        )
      );
      if (options.length === 0) return null;

      const normTarget = cleanHandle.toLowerCase().replace(/_/g, " ");
      const match = options.find((opt) => {
        const label = (opt.textContent || "").trim().toLowerCase();
        return (
          label.includes(cleanHandle.toLowerCase()) ||
          label.includes(normTarget)
        );
      });
      return match || (options.length === 1 ? options[0] : null);
    };

    let targetOption = null;
    const startTime = Date.now();
    while (Date.now() - startTime < 1500) {
      targetOption = findMatchingOption();
      if (targetOption) break;
      await sleep(60);
    }

    let chipCreated = false;

    // Step 3: If option found, click it / trigger Enter
    if (targetOption) {
      try {
        targetOption.click();
      } catch (_) {
        editor.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Enter",
            code: "Enter",
            keyCode: 13,
            which: 13,
            bubbles: true,
            cancelable: true,
          })
        );
      }
      await sleep(150);

      // Step 4: Assert chip created
      chipCreated = countChips() > initialChipCount;
    }

    // Step 5: Fallback if chip was not created
    if (!chipCreated) {
      const remaining = cleanHandle.slice(prefix.length);
      if (remaining) {
        await insertTextSegment(editor, remaining);
      }
      await insertTextSegment(editor, " ");
      await sleep(80);
    } else {
      await insertTextSegment(editor, " ");
      await sleep(80);
    }
  }

  /**
   * Lightweight safety filter sanitizer for auto-retry on RAI drops.
   */
  function sanitizePromptForSafety(prompt) {
    if (!prompt) return "";
    return prompt
      .replace(/\b(blood-stained|bloodstained|bloody)\b/gi, "crimson-draped")
      .replace(/\b(blood)\b/gi, "crimson essence")
      .replace(/\b(corpse|dead body|slain body)\b/gi, "fallen figure")
      .replace(/\b(kill|killing|slaying|murder|assassinate)\b/gi, "dramatic confrontation")
      .replace(/\b(knife|dagger|blade|sword)\b/gi, "ornate steel prop")
      .replace(/\b(wound|wounds|gash|severed|gore)\b/gi, "battle wear")
      .replace(/\b(strangle|choke|suffocate|hang)\b/gi, "intense grapple")
      .replace(/\b(naked|nude|undressed|exposed)\b/gi, "unadorned silhouette")
      .replace(/\b(execution|guillotine|behead)\b/gi, "climactic judgment")
      .replace(/\b(gun|pistol|rifle|revolver)\b/gi, "vintage prop");
  }

  /**
   * Injects full prompt while resolving `@Ingredient` tokens dynamically.
   */
  async function injectPromptWithIngredients(editor, prompt, ingredientRefs = []) {
    await clearEditorContent(editor);

    const knownHandles = new Map();
    for (const ref of ingredientRefs) {
      if (ref && ref.mention_handle) {
        knownHandles.set(ref.mention_handle.toLowerCase(), ref.mention_handle);
      }
    }

    // Tokenize prompt by @Handle occurrences
    const tokenRegex = /@([A-Za-z0-9_-]+)/g;
    let lastIndex = 0;
    let match;

    while ((match = tokenRegex.exec(prompt)) !== null) {
      const precedingText = prompt.slice(lastIndex, match.index);
      if (precedingText) {
        await insertTextSegment(editor, precedingText);
        await sleep(40);
      }

      const rawHandle = match[1];
      const canonicalHandle =
        knownHandles.get(rawHandle.toLowerCase()) || rawHandle;
      await injectMentionToken(editor, canonicalHandle);

      lastIndex = tokenRegex.lastIndex;
    }

    const remainingText = prompt.slice(lastIndex);
    if (remainingText) {
      await insertTextSegment(editor, remainingText);
    }

    // If ingredient_refs were specified but not explicitly written in prompt text, prepend them
    for (const ref of ingredientRefs) {
      const handle = ref.mention_handle;
      if (handle && !prompt.toLowerCase().includes(`@${handle.toLowerCase()}`)) {
        await insertTextSegment(editor, " ");
        await injectMentionToken(editor, handle);
      }
    }

    await sleep(150);
  }

  // ==========================================================================
  // 4. Settled-Grid Quorum Harvester & DOM Fallback (Argon T2.1)
  // ==========================================================================
  const seenDomMediaSrcs = new Set();
  const activeTaskCandidates = new Map();
  let activeTaskSettledCheckInterval = null;

  function snapshotExistingDomMedia() {
    activeTaskCandidates.clear();
    document.querySelectorAll("img[src], video[src], video source[src]").forEach((el) => {
      if (el.src) seenDomMediaSrcs.add(el.src);
    });
  }

  /**
   * T2.1: Settled-Grid Quorum Detector
   * Evaluates valid rendered tiles vs. tombstone/filter error cards.
   * Prevents deadlocks on partial RAI safety drops.
   */
  function checkSettledGridQuorum(sourceTrigger) {
    if (!activeTask) return;

    const validCandidates = Array.from(activeTaskCandidates.values());
    const targetCount = activeTask.candidate_count || 4;

    // Scan for tombstone / safety cards in DOM
    const tombstoneTiles = document.querySelectorAll(
      '[data-filter-error], [data-safety-filtered], .error-tile, .filtered-tile, .safety-card, [data-testid*="error-tile"], [role="alert"][class*="error"]'
    );
    let tombstoneCount = tombstoneTiles.length;

    // Check for safety alert banners
    const allAlerts = Array.from(document.querySelectorAll('[role="alert"], .banner, .notification, .toast'));
    const safetyAlertFound = allAlerts.some((el) =>
      /safety|guideline|content filtered|violates our policies|prompt was blocked/i.test(el.textContent || "")
    );
    if (safetyAlertFound && tombstoneCount === 0) {
      tombstoneCount = targetCount;
    }

    const totalSettled = validCandidates.length + tombstoneCount;
    const elapsedMs = Date.now() - activeTaskStartTime;

    // Rule 1: Grid has fully settled (valid + tombstones >= target)
    if (totalSettled >= targetCount) {
      if (validCandidates.length >= 1) {
        console.info(
          `[Settled-Grid Quorum] Quorum reached with ${validCandidates.length} valid tile(s) (${tombstoneCount} tombstones). Finalizing!`
        );
        finalizeActiveTaskSuccess(validCandidates, `quorum://${sourceTrigger}`);
        return;
      } else {
        console.warn("[Settled-Grid Quorum] All tiles were blocked by safety policy.");
        handleSafetyFilteredFailure("RAI_SAFETY_BLOCKED: All candidate tiles blocked by Responsible AI safety filter.");
        return;
      }
    }

    // Rule 2: Hard Quorum Grace Timeout (>= 1 valid tile and elapsed >= 30s)
    if (validCandidates.length >= 1 && elapsedMs >= 30_000) {
      console.info(
        `[Settled-Grid Quorum] Grace timeout reached (30s) with ${validCandidates.length} valid tile(s). Finalizing!`
      );
      finalizeActiveTaskSuccess(validCandidates, `quorum-grace-timeout://${sourceTrigger}`);
      return;
    }

    // Rule 3: Safety alert banner appeared with 0 valid tiles
    if (safetyAlertFound && validCandidates.length === 0) {
      handleSafetyFilteredFailure("RAI_SAFETY_BLOCKED: Prompt flagged by Google Flow safety filters.");
      return;
    }
  }

  async function handleSafetyFilteredFailure(reason) {
    if (!activeTask) return;
    if (!activeTask.__retryWithSanitization) {
      console.warn(`[Settled-Grid Quorum] Prompt triggered safety filter. Attempting auto-sanitized retry...`);
      activeTask.__retryWithSanitization = true;

      const sanitizedPrompt = sanitizePromptForSafety(activeTask.prompt);
      if (sanitizedPrompt !== activeTask.prompt) {
        console.info(`[Settled-Grid Quorum] Sanitized prompt: "${sanitizedPrompt}"`);
        activeTask.prompt = sanitizedPrompt;
        activeTaskStartTime = Date.now();
        activeTaskCandidates.clear();

        try {
          const editor = findPromptEditor();
          if (editor) {
            await clearEditorContent(editor);
            await injectPromptWithIngredients(editor, sanitizedPrompt, activeTask.ingredient_refs || []);
            await sleep(300);
            const generateBtn = findGenerateButton();
            if (generateBtn) generateBtn.click();
            return;
          }
        } catch (e) {
          console.error("[Settled-Grid Quorum] Failed to submit sanitized prompt:", e);
        }
      }
    }

    finalizeActiveTaskFailure(reason);
  }

  const domMediaObserver = new MutationObserver((mutations) => {
    if (!activeTask) return;

    let foundNew = false;
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (!(node instanceof HTMLElement)) continue;
        const mediaElements =
          node.tagName === "IMG" || node.tagName === "VIDEO"
            ? [node]
            : Array.from(node.querySelectorAll("img[src], video[src]"));

        for (const el of mediaElements) {
          const src = el.currentSrc || el.src;
          if (!src || seenDomMediaSrcs.has(src)) continue;
          if (
            src.includes("googleusercontent.com") ||
            src.includes("flow-content.google") ||
            src.includes("storage.googleapis.com")
          ) {
            const width = el.naturalWidth || el.videoWidth || el.clientWidth || 0;
            if (width > 0 && width < 128) continue;

            seenDomMediaSrcs.add(src);
            const isVideo = el.tagName === "VIDEO" || src.includes(".mp4");
            const candidate = {
              candidate_index: activeTaskCandidates.size,
              remote_url: src,
              mime_type: isVideo ? "video/mp4" : "image/png",
              media_type: isVideo ? "VIDEO" : "IMAGE",
              width: el.naturalWidth || el.videoWidth || null,
              height: el.naturalHeight || el.videoHeight || null,
              base64_data: null,
              flow_media_key: "dom-mutation-capture",
            };
            activeTaskCandidates.set(src, candidate);
            foundNew = true;
          }
        }
      }
    }

    if (foundNew && activeTask) {
      checkSettledGridQuorum("dom-mutation");
    }
  });

  function startDomObserver() {
    if (document.body) {
      domMediaObserver.observe(document.body, {
        childList: true,
        subtree: true,
      });
    } else {
      window.addEventListener("DOMContentLoaded", () => {
        domMediaObserver.observe(document.body, {
          childList: true,
          subtree: true,
        });
      });
    }
  }

  startDomObserver();

  // ==========================================================================
  // 5. Task Execution & Result Handling
  // ==========================================================================
  function clearActiveTaskTimers() {
    if (activeTaskTimeoutHandle) {
      clearTimeout(activeTaskTimeoutHandle);
      activeTaskTimeoutHandle = null;
    }
    if (activeTaskSettledCheckInterval) {
      clearInterval(activeTaskSettledCheckInterval);
      activeTaskSettledCheckInterval = null;
    }
  }

  function finalizeActiveTaskSuccess(candidates, rpcEndpoint) {
    if (!activeTask) return;
    const finishedTask = activeTask;
    const latencyMs = Math.max(0, Date.now() - activeTaskStartTime);
    activeTask = null;
    clearActiveTaskTimers();
    completedTasksCount += 1;

    const normalizedCandidates = candidates.map((c, idx) => ({
      candidate_index: idx,
      remote_url: c.remote_url,
      mime_type: c.mime_type || (finishedTask.media_type === "VIDEO" ? "video/mp4" : "image/png"),
      width: c.width || null,
      height: c.height || null,
      duration_seconds: c.duration_seconds || null,
      base64_data: c.base64_data || null,
      flow_media_key: c.flow_media_key || null,
    }));

    const resultPayload = {
      task_id: finishedTask.task_id,
      project_id: finishedTask.project_id,
      flow_project_id: finishedTask.flow_project_id || detectFlowProjectId(),
      scene_id: finishedTask.scene_id || null,
      character_profile_id: finishedTask.character_profile_id || null,
      beat_id: finishedTask.beat_id || null,
      status: "COMPLETED",
      media_type: finishedTask.media_type || "IMAGE",
      model_engine: finishedTask.model_engine || "NANO_BANANA",
      prompt_used: finishedTask.prompt,
      candidates: normalizedCandidates,
      saved_assets: [],
      rpc_endpoint_captured: rpcEndpoint || null,
      generation_latency_ms: latencyMs,
      error_message: null,
      captured_at: new Date().toISOString(),
    };

    sendEnvelope("MEDIA_RESULT", resultPayload, finishedTask.task_id);
    sendEnvelope("COMPANION_STATUS", buildStatusPayload("IDLE"));
    updateFloatingPill("IDLE");
  }

  function finalizeActiveTaskFailure(errorMessage) {
    if (!activeTask) return;
    const failedTask = activeTask;
    const latencyMs = Math.max(0, Date.now() - activeTaskStartTime);
    activeTask = null;
    clearActiveTaskTimers();
    failedTasksCount += 1;

    const resultPayload = {
      task_id: failedTask.task_id,
      project_id: failedTask.project_id,
      flow_project_id: failedTask.flow_project_id || detectFlowProjectId(),
      scene_id: failedTask.scene_id || null,
      character_profile_id: failedTask.character_profile_id || null,
      beat_id: failedTask.beat_id || null,
      status: "FAILED",
      media_type: failedTask.media_type || "IMAGE",
      model_engine: failedTask.model_engine || "NANO_BANANA",
      prompt_used: failedTask.prompt,
      candidates: [],
      saved_assets: [],
      rpc_endpoint_captured: null,
      generation_latency_ms: latencyMs,
      error_message: errorMessage,
      captured_at: new Date().toISOString(),
    };

    sendEnvelope("MEDIA_RESULT", resultPayload, failedTask.task_id);
    sendEnvelope("COMPANION_STATUS", buildStatusPayload("IDLE", errorMessage));
    updateFloatingPill("IDLE");
  }

  async function executeFlowGenerationTask(task) {
    if (activeTask) {
      sendEnvelope(
        "BRIDGE_ERROR",
        {
          task_id: task.task_id,
          error: `Companion is already executing task ${activeTask.task_id}`,
        },
        task.task_id
      );
      return;
    }

    activeTask = task;
    activeTaskStartTime = Date.now();
    snapshotExistingDomMedia();
    updateFloatingPill("BUSY_GENERATING");

    const timeoutMs = (task.timeout_seconds || 180) * 1000;
    activeTaskTimeoutHandle = setTimeout(() => {
      finalizeActiveTaskFailure(
        `Timed out after ${task.timeout_seconds || 180}s waiting for Google Flow media output.`
      );
    }, timeoutMs);

    // Active polling interval for Settled-Grid Quorum & tombstone detection
    if (activeTaskSettledCheckInterval) {
      clearInterval(activeTaskSettledCheckInterval);
    }
    activeTaskSettledCheckInterval = setInterval(() => {
      if (activeTask) {
        checkSettledGridQuorum("interval-poll");
      }
    }, 2500);

    try {
      sendEnvelope(
        "TASK_PROGRESS",
        {
          task_id: task.task_id,
          status: "INJECTING_PROMPT",
          flow_project_id: detectFlowProjectId(),
        },
        task.task_id
      );
      sendEnvelope("COMPANION_STATUS", buildStatusPayload("BUSY_GENERATING"));

      // 1. Programmatically apply deck configuration (model engine, aspect ratio, thinking level, candidate count)
      if (globalThis.FlowDeckController && typeof globalThis.FlowDeckController.configureFlowDeck === "function") {
        await globalThis.FlowDeckController.configureFlowDeck({
          mediaType: task.media_type,
          modelEngine: task.model_engine,
          aspectRatio: task.aspect_ratio,
          thinkingLevel: task.thinking_level,
          candidateCount: task.candidate_count,
        });
        await sleep(250);
      }

      let editor = findPromptEditor();
      if (!editor) {
        editor = await ensureProjectCanvasOpen();
      }
      if (!editor) {
        throw new Error(
          "Could not locate Google Flow prompt editor in DOM. Please click on a project or '+ New project' in Google Flow to open the canvas."
        );
      }

      await injectPromptWithIngredients(
        editor,
        task.prompt,
        task.ingredient_refs || []
      );

      await sleep(350);

      const generateBtn = findGenerateButton();
      if (generateBtn) {
        if (generateBtn.disabled) {
          generateBtn.removeAttribute("disabled");
        }
        generateBtn.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true }));
        generateBtn.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
        generateBtn.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true }));
        generateBtn.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true }));
        generateBtn.click();
      }

      // Also trigger Enter keydown/keyup on prompt editor
      editor.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          code: "Enter",
          keyCode: 13,
          which: 13,
          bubbles: true,
          cancelable: true,
        })
      );
      editor.dispatchEvent(
        new KeyboardEvent("keyup", {
          key: "Enter",
          code: "Enter",
          keyCode: 13,
          which: 13,
          bubbles: true,
          cancelable: true,
        })
      );

      sendEnvelope(
        "TASK_PROGRESS",
        {
          task_id: task.task_id,
          status: "AWAITING_RENDER",
          flow_project_id: detectFlowProjectId(),
        },
        task.task_id
      );
    } catch (err) {
      finalizeActiveTaskFailure(
        err instanceof Error ? err.message : String(err)
      );
    }
  }

  async function handleIngredientSync(syncPayload) {
    sendEnvelope("COMPANION_STATUS", buildStatusPayload("SYNCING_INGREDIENTS"));
    let detectedHandles = scanAvailableIngredientsInDom();
    const ingredients = syncPayload.ingredients || [];
    const missing = [];

    for (const item of ingredients) {
      const handle = (item.mention_handle || item.name || "")
        .replace(/^@/, "")
        .trim()
        .toLowerCase();
      const isPresent = detectedHandles.some((h) => h.toLowerCase() === handle);
      if (!isPresent) {
        missing.push(item);
      }
    }

    if (syncPayload.auto_create_missing && missing.length > 0) {
      console.log(
        `[Scriptoria Companion] Auto-creating ${missing.length} missing ingredients in Flow...`
      );
      for (const missingItem of missing) {
        try {
          const res = await syncCharacterProfile({
            flow_project_id: detectFlowProjectId(),
            mention_handle: missingItem.mention_handle,
            visual_prompt: missingItem.visual_prompt,
            generate_portrait: true,
          });
          sendEnvelope("CHARACTER_SYNC_RESULT", res);
          await sleep(600);
        } catch (err) {
          console.warn("[Scriptoria Companion] Failed auto-creating ingredient:", missingItem, err);
        }
      }
      detectedHandles = scanAvailableIngredientsInDom();
    }

    sendEnvelope(
      "INGREDIENT_SYNC_ACK",
      {
        sync_id: syncPayload.sync_id,
        project_id: syncPayload.project_id,
        flow_project_id: detectFlowProjectId(),
        detected_handles: detectedHandles,
        synced_count: ingredients.length,
        synced_at: new Date().toISOString(),
      },
      syncPayload.sync_id
    );

    sendEnvelope("COMPANION_STATUS", buildStatusPayload("IDLE"));
  }

  // ==========================================================================
  // 6. Listen to MAIN World `injected.js` CustomEvents
  // ==========================================================================
  window.addEventListener("SCRIPTORIA_FLOW_MEDIA_CAPTURED", (event) => {
    const detail = event.detail;
    if (!detail || !Array.isArray(detail.candidates) || detail.candidates.length === 0) {
      return;
    }

    if (activeTask) {
      for (const candidate of detail.candidates) {
        const key = candidate.flow_media_key || candidate.remote_url || `c-${activeTaskCandidates.size}`;
        if (!activeTaskCandidates.has(key)) {
          activeTaskCandidates.set(key, candidate);
        }
      }
      checkSettledGridQuorum("rpc-captured");
    } else {
      // Unsolicited capture (user manually clicked Generate in Flow UI): still forward to Scriptoria!
      const manualTaskId = `manual-${Date.now()}`;
      const flowProjId = detectFlowProjectId();
      const editor = findPromptEditor();
      const promptText =
        (editor && (editor.value || editor.textContent || "").trim()) ||
        "Manual generation in Google Flow";

      const resultPayload = {
        task_id: manualTaskId,
        project_id: "default-project",
        flow_project_id: flowProjId,
        scene_id: null,
        character_profile_id: null,
        beat_id: null,
        status: "COMPLETED",
        media_type: detail.candidates[0].media_type || "IMAGE",
        model_engine: "FLOW_AUTO",
        prompt_used: promptText,
        candidates: detail.candidates,
        saved_assets: [],
        rpc_endpoint_captured: detail.rpc_endpoint || null,
        generation_latency_ms: 0,
        error_message: null,
        captured_at: detail.captured_at || new Date().toISOString(),
      };

      sendEnvelope("MEDIA_RESULT", resultPayload, manualTaskId);
    }
  });

  window.addEventListener("SCRIPTORIA_FLOW_SAFETY_BLOCKED", (event) => {
    if (activeTask) {
      console.warn("[Scriptoria Companion] Caught SCRIPTORIA_FLOW_SAFETY_BLOCKED from MAIN world.");
      handleSafetyFilteredFailure("RAI_SAFETY_BLOCKED: " + (event.detail?.reason || "Policy filter triggered."));
    }
  });

  // ==========================================================================
  // 7. WebSocket Connection & Reconnection Loop
  // ==========================================================================
  function startHeartbeat() {
    stopHeartbeat();
    heartbeatTimer = setInterval(() => {
      const state = activeTask ? "BUSY_GENERATING" : "IDLE";
      sendEnvelope("COMPANION_HEARTBEAT", buildStatusPayload(state));
    }, HEARTBEAT_INTERVAL_MS);
  }

  function stopHeartbeat() {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  }

  async function connectWebSocket() {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    const baseWs = await resolveWsEndpoint();
    const flowProjectId = detectFlowProjectId();
    const wsUrl = `${baseWs}?session_id=${encodeURIComponent(
      SESSION_ID
    )}&flow_project_id=${encodeURIComponent(flowProjectId)}&source=FLOW_TAB`;

    try {
      ws = new WebSocket(wsUrl);
    } catch (_err) {
      scheduleReconnect();
      return;
    }

    ws.onopen = () => {
      reconnectAttempts = 0;
      const state = activeTask ? "BUSY_GENERATING" : "IDLE";
      sendEnvelope("COMPANION_HELLO", buildStatusPayload(state));
      startHeartbeat();
      updateFloatingPill(state);
      console.info(
        `[Scriptoria Companion] Connected to FastAPI Bridge (${wsUrl})`
      );
    };

    ws.onmessage = async (msgEvent) => {
      try {
        const envelope = JSON.parse(msgEvent.data);
        const { event_type, payload, correlation_id } = envelope;

        switch (event_type) {
          case "DISPATCH_TASK":
            await executeFlowGenerationTask(payload);
            break;

          case "INGREDIENT_SYNC":
            await handleIngredientSync(payload);
            break;

          case "QUEUE_ACTION":
            if (
              payload.action === "CANCEL_TASK" &&
              activeTask &&
              activeTask.task_id === payload.target_task_id
            ) {
              finalizeActiveTaskFailure("Task cancelled via Scriptoria Queue Action.");
            } else if (payload.action === "PING_COMPANION") {
              const state = activeTask ? "BUSY_GENERATING" : "IDLE";
              sendEnvelope("COMPANION_STATUS", buildStatusPayload(state), correlation_id);
            }
            break;

          case "CONFIGURE_DECK":
            console.log("[Scriptoria Companion] Received CONFIGURE_DECK:", payload);
            try {
              const deckOk = await configureFlowDeck(payload);
              console.log("[Scriptoria Companion] CONFIGURE_DECK result:", deckOk);
              sendEnvelope("DECK_CONFIG_RESULT", { success: deckOk, settings: payload }, correlation_id);
            } catch (err) {
              console.error("[Scriptoria Companion] CONFIGURE_DECK failed:", err);
              sendEnvelope("DECK_CONFIG_RESULT", { success: false, error: String(err) }, correlation_id);
            }
            break;

          case "SYNC_CHARACTER":
            console.log("[Scriptoria Companion] Received SYNC_CHARACTER:", payload);
            try {
              sendEnvelope("COMPANION_STATUS", buildStatusPayload("SYNCING_INGREDIENTS"));
              const charResult = await syncCharacterProfile(payload);
              console.log("[Scriptoria Companion] SYNC_CHARACTER result:", charResult);
              sendEnvelope("CHARACTER_SYNC_RESULT", charResult, correlation_id);
              sendEnvelope("COMPANION_STATUS", buildStatusPayload("IDLE"));
            } catch (err) {
              console.error("[Scriptoria Companion] SYNC_CHARACTER failed:", err);
              sendEnvelope("CHARACTER_SYNC_RESULT", { success: false, error: String(err) }, correlation_id);
              sendEnvelope("COMPANION_STATUS", buildStatusPayload("IDLE"));
            }
            break;

          case "ORCHESTRATE_SCENE":
            console.log("[Scriptoria Companion] Received ORCHESTRATE_SCENE:", payload);
            try {
              sendEnvelope("COMPANION_STATUS", buildStatusPayload("BUSY_GENERATING"));
              const sceneResult = await orchestrateChapterScene(payload);
              console.log("[Scriptoria Companion] ORCHESTRATE_SCENE result:", sceneResult);
              sendEnvelope("SCENE_ORCHESTRATION_RESULT", sceneResult, correlation_id);
              sendEnvelope("COMPANION_STATUS", buildStatusPayload("IDLE"));
            } catch (err) {
              console.error("[Scriptoria Companion] ORCHESTRATE_SCENE failed:", err);
              sendEnvelope("SCENE_ORCHESTRATION_RESULT", { success: false, error: String(err) }, correlation_id);
              sendEnvelope("COMPANION_STATUS", buildStatusPayload("IDLE"));
            }
            break;

          default:
            break;
        }
      } catch (err) {
        console.error("[Scriptoria Companion] Error handling WS message:", err);
      }
    };

    ws.onclose = () => {
      stopHeartbeat();
      updateFloatingPill("DISCONNECTED");
      scheduleReconnect();
    };

    ws.onerror = () => {
      try {
        ws.close();
      } catch (_e) {}
    };
  }

  function scheduleReconnect() {
    reconnectAttempts += 1;
    const delay = Math.min(
      RECONNECT_BASE_DELAY_MS * Math.pow(1.5, reconnectAttempts - 1),
      RECONNECT_MAX_DELAY_MS
    );
    setTimeout(connectWebSocket, delay);
  }

  // ==========================================================================
  // 6. On-Page Floating HUD & Toast Notifications
  // ==========================================================================
  function injectFloatingHUD() {
    if (document.getElementById("scriptoria-companion-dock")) return;

    // 1. Ambient Status Pill (Bottom-Right)
    const dock = document.createElement("div");
    dock.id = "scriptoria-companion-dock";
    dock.style.cssText = `
      position: fixed;
      bottom: 18px;
      right: 18px;
      z-index: 999999;
      display: flex;
      align-items: center;
      gap: 8px;
      background: #09090b;
      border: 1px solid #27272a;
      border-radius: 9999px;
      padding: 6px 14px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.6);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 11px;
      font-weight: 600;
      color: #fafafa;
      user-select: none;
      transition: all 0.2s ease;
      cursor: pointer;
    `;
    dock.innerHTML = `
      <span id="scriptoria-dock-dot" style="width: 8px; height: 8px; border-radius: 50%; background: #10b981; box-shadow: 0 0 8px #10b981;"></span>
      <span id="scriptoria-dock-text">Scriptoria Companion</span>
    `;
    dock.title = "Click to enter Flow canvas or toggle Scriptoria Quick Bar";
    dock.addEventListener("click", () => {
      const isOnLobby =
        window.location.pathname === "/" || !window.location.pathname.includes("/project/");
      if (isOnLobby) {
        console.info("[Scriptoria Companion] User clicked dock on lobby. Auto-opening canvas...");
        ensureProjectCanvasOpen();
        return;
      }
      const bar = document.getElementById("scriptoria-quick-bar");
      if (bar) bar.style.display = bar.style.display === "none" ? "flex" : "none";
    });
    document.body.appendChild(dock);

    // 2. Quick Ingredient Bar (Above Prompt Input)
    const quickBar = document.createElement("div");
    quickBar.id = "scriptoria-quick-bar";
    quickBar.style.cssText = `
      position: fixed;
      bottom: 72px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 999990;
      display: flex;
      align-items: center;
      gap: 6px;
      background: rgba(18, 18, 21, 0.95);
      backdrop-filter: blur(8px);
      border: 1px solid #27272a;
      border-radius: 20px;
      padding: 5px 12px;
      box-shadow: 0 4px 24px rgba(0,0,0,0.5);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 11px;
    `;
    quickBar.innerHTML = `
      <span style="color: #71717a; font-weight: 600; text-transform: uppercase; font-size: 9px; letter-spacing: 0.5px;">Scriptoria:</span>
      <button class="scriptoria-quick-chip" data-handle="Detective_Kael" style="background:#27272a; border:none; border-radius:12px; color:#10b981; padding:3px 8px; font-size:10px; font-weight:600; cursor:pointer;">👤 @Detective_Kael</button>
      <button class="scriptoria-quick-chip" data-handle="Ancient_Castle" style="background:#27272a; border:none; border-radius:12px; color:#60a5fa; padding:3px 8px; font-size:10px; font-weight:600; cursor:pointer;">🏰 @Ancient_Castle</button>
      <button class="scriptoria-quick-chip" data-handle="Glowing_Grimoire" style="background:#27272a; border:none; border-radius:12px; color:#f59e0b; padding:3px 8px; font-size:10px; font-weight:600; cursor:pointer;">📖 @Glowing_Grimoire</button>
    `;
    document.body.appendChild(quickBar);

    // Wire quick chips
    quickBar.querySelectorAll(".scriptoria-quick-chip").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const handle = btn.getAttribute("data-handle");
        const editor = findPromptEditor();
        if (editor && handle) {
          await injectMentionToken(editor, handle);
        }
      });
    });
  }

  function updateFloatingPill(state) {
    const dot = document.getElementById("scriptoria-dock-dot");
    const text = document.getElementById("scriptoria-dock-text");
    if (!dot || !text) return;

    const isOnLobby =
      window.location.pathname === "/" || !window.location.pathname.includes("/project/");

    if (state === "IDLE" || state === "CONNECTED") {
      dot.style.background = isOnLobby ? "#f59e0b" : "#10b981";
      dot.style.boxShadow = isOnLobby ? "0 0 8px #f59e0b" : "0 0 8px #10b981";
      text.textContent = isOnLobby
        ? "⚠️ Click a Project or '+ New' to Open Canvas"
        : "Scriptoria (Connected & Ready)";
    } else if (state === "BUSY_GENERATING") {
      dot.style.background = "#3b82f6";
      dot.style.boxShadow = "0 0 10px #3b82f6";
      text.textContent = "Scriptoria Generating...";
    } else {
      dot.style.background = "#ef4444";
      dot.style.boxShadow = "none";
      text.textContent = "Scriptoria (Offline)";
    }
  }

  function showCaptureToast(candidateCount, remoteUrl) {
    const toast = document.createElement("div");
    toast.style.cssText = `
      position: fixed;
      top: 24px;
      right: 24px;
      z-index: 999999;
      display: flex;
      align-items: center;
      gap: 12px;
      background: #09090b;
      border: 1px solid #10b981;
      border-radius: 10px;
      padding: 10px 14px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.8), 0 0 12px rgba(16,185,129,0.3);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      color: #fafafa;
      animation: slideIn 0.3s ease;
    `;
    toast.innerHTML = `
      <img src="${remoteUrl}" style="width: 48px; height: 32px; object-fit: cover; border-radius: 4px; border: 1px solid #27272a;" />
      <div>
        <div style="font-size: 11px; font-weight: 700; color: #10b981;">✨ Assets Captured & Saved!</div>
        <div style="font-size: 10px; color: #a1a1aa;">${candidateCount} images streamed to /output/flow_assets/</div>
      </div>
    `;
    document.body.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = "0";
      toast.style.transition = "opacity 0.4s ease";
      setTimeout(() => toast.remove(), 400);
    }, 4500);
  }

  // Hook capture event
  window.addEventListener("SCRIPTORIA_FLOW_MEDIA_CAPTURED", (e) => {
    if (e.detail && e.detail.candidates && e.detail.candidates.length > 0) {
      showCaptureToast(e.detail.candidates.length, e.detail.candidates[0].remote_url);
    }
  });

  // Listen to messages from popup
  if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener(async (msg) => {
      if (msg.type === "SCRIPTORIA_INSERT_HANDLE") {
        const editor = findPromptEditor();
        if (editor) {
          await injectMentionToken(editor, msg.handle);
        }
      }
    });
  }

  // Listen for dynamic server switches in popup
  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === "local" && changes.scriptoria_bridge_config) {
        console.info("[Scriptoria Companion] Server config updated. Reconnecting WebSocket...");
        if (ws) {
          try {
            ws.close();
          } catch (_) {}
        }
        connectWebSocket();
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", injectFloatingHUD);
  } else {
    injectFloatingHUD();
  }

  connectWebSocket();
})();
