// extension/scriptoria-flow-bridge/flow_character_sync.js
/**
 * Scriptoria Google Flow Character Ingestion & Sync Engine
 * Automates creating and locking character profiles into Google Flow:
 * 1. Navigates to `/project/{id}/character`
 * 2. Injects character prompt into "Describe your character…"
 * 3. Selects reference archetype or canvas candidate
 * 4. Triggers reference portrait generation or selects existing candidate
 * 5. Finalizes with "Done" and returns the locked @mention handle
 */
(function (global) {
  "use strict";

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
    // Fallback: direct navigation via history/pushState
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
      // Contenteditable ProseMirror
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

  /**
   * High-level workflow to sync a character profile from Scriptoria to Flow.
   */
  async function syncCharacterProfile(characterPayload) {
    console.log("[FlowCharacterSync] Syncing character:", characterPayload);
    const flowProjectId = characterPayload.flow_project_id || "ea1ed436-e578-4327-9c9b-4f6b2e7e551d";
    
    await openCharacterStudio(flowProjectId);
    await sleep(500);

    if (characterPayload.visual_prompt) {
      await injectCharacterPrompt(characterPayload.visual_prompt);
    }

    if (characterPayload.use_canvas_candidate) {
      await selectCandidateFromProject(characterPayload.candidate_index || 0);
    } else if (characterPayload.generate_portrait) {
      await triggerCharacterGeneration();
    }

    await sleep(500);
    await finalizeCharacter(characterPayload.mention_handle);

    return {
      success: true,
      mention_handle: characterPayload.mention_handle,
      flow_project_id: flowProjectId,
    };
  }

  global.FlowCharacterSync = {
    syncCharacterProfile,
    openCharacterStudio,
    injectCharacterPrompt,
    selectCandidateFromProject,
    finalizeCharacter,
  };
})(typeof window !== "undefined" ? window : this);
