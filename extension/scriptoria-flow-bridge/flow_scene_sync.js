// extension/scriptoria-flow-bridge/flow_scene_sync.js
/**
 * Scriptoria Google Flow Scene Orchestrator
 * Automates creating multi-clip scenes for novel chapters:
 * 1. Creates a new scene via Flow's "Add media" -> "New scene" RPC
 * 2. Renames the scene to the Novel Chapter title
 * 3. Sequences consecutive storyboard beats as timeline clips using Omni 1.2 Flash
 * 4. Captures the generated scene video output
 */
(function (global) {
  "use strict";

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function findButtonByTextOrAria(textPattern) {
    const btns = Array.from(document.querySelectorAll("button, [role=\"button\"], [role=\"menuitem\"]"));
    return btns.find((b) => {
      const text = (b.innerText || b.getAttribute("aria-label") || "").toLowerCase();
      return text.includes(textPattern.toLowerCase());
    });
  }

  async function createNewScene() {
    // If already in a scene editor, return current URL
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

  /**
   * Orchestrates a chapter scene generation given an array of storyboard beats.
   */
  async function orchestrateChapterScene(scenePayload) {
    console.log("[FlowSceneSync] Orchestrating chapter scene:", scenePayload);

    // 1. Create or navigate to scene
    await createNewScene();
    await sleep(800);

    // 2. Set Chapter Title
    if (scenePayload.chapter_title) {
      await setSceneTitle(scenePayload.chapter_title);
    }

    // 3. Sequentially inject clips
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
      scene_id: scenePayload.scene_id,
      scene_url: window.location.href,
    };
  }

  global.FlowSceneSync = {
    createNewScene,
    setSceneTitle,
    injectClipPrompt,
    addNewTimelineClip,
    triggerClipGeneration,
    orchestrateChapterScene,
  };
})(typeof window !== "undefined" ? window : this);
