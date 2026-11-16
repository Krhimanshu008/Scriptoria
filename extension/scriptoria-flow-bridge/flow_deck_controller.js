// extension/scriptoria-flow-bridge/flow_deck_controller.js
/**
 * Scriptoria Google Flow Deck & Model Controller
 * Programmatically controls Google Flow generation parameters:
 * - Modality (Image vs Video)
 * - Model Family (Nano Banana 2.1, Nano Banana Pro, Omni 1.2 Flash, Veo 3.1, etc.)
 * - Aspect Ratio (16:9, 9:16, 1:1, 4:3, 3:4)
 * - Thinking Level (Low, Medium, High, Extra thorough)
 * - Output Multiplier (x1, x2, x3, x4)
 */
(function (global) {
  "use strict";

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
          (b.innerText && (b.innerText.includes("Nano Banana") || b.innerText.includes("Omni") || b.innerText.includes("Veo")))
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
    document.activeElement?.dispatchEvent(escEvent) || document.body.dispatchEvent(escEvent);
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

  /**
   * Main API to configure deck settings prior to generation.
   * @param {Object} options
   * @param {"IMAGE"|"VIDEO"} [options.mediaType]
   * @param {string} [options.modelEngine]
   * @param {string} [options.aspectRatio]
   * @param {string} [options.thinkingLevel]
   * @param {number} [options.candidateCount]
   */
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

  // Export to window/module
  global.FlowDeckController = {
    configureFlowDeck,
    findSettingsTrigger,
    openSettingsPopup,
    closeSettingsPopup,
    MODEL_NAME_MAP,
    THINKING_LEVEL_MAP,
  };
})(typeof window !== "undefined" ? window : this);
