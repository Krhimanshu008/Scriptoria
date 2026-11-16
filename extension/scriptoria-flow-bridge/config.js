// extension/scriptoria-flow-bridge/config.js
/**
 * Scriptoria Flow Companion - Shared Dynamic Configuration Store
 * Handles seamless switching between Production Cloud (scriptoria.krhimanshu.in)
 * and Localhost Development (127.0.0.1:8000), persisting state in chrome.storage.local.
 */
(function () {
  "use strict";

  const DEFAULT_CONFIG = {
    server_mode: "cloud", // "cloud" | "local" | "custom"
    cloud_url: "https://scriptoria.krhimanshu.in",
    cloud_ws: "wss://scriptoria.krhimanshu.in/api/v1/flow-bridge/ws",
    local_url: "http://127.0.0.1:8000",
    local_ws: "ws://127.0.0.1:8000/api/v1/flow-bridge/ws",
    custom_url: "",
    candidate_count: 4,
    gemini_api_key: "",
    tool_model: "gemini-3.5-flash-lite",
  };

  function toWsUrl(httpUrl) {
    if (!httpUrl) return "";
    let cleaned = httpUrl.trim().replace(/\/+$/, "");
    if (cleaned.startsWith("https://")) {
      cleaned = "wss://" + cleaned.slice(8);
    } else if (cleaned.startsWith("http://")) {
      cleaned = "ws://" + cleaned.slice(7);
    }
    return `${cleaned}/api/v1/flow-bridge/ws`;
  }

  const ScriptoriaConfig = {
    DEFAULT: DEFAULT_CONFIG,

    async get() {
      if (typeof chrome === "undefined" || !chrome.storage || !chrome.storage.local) {
        return { ...DEFAULT_CONFIG };
      }
      return new Promise((resolve) => {
        chrome.storage.local.get(["scriptoria_bridge_config"], (result) => {
          const saved = result && result.scriptoria_bridge_config ? result.scriptoria_bridge_config : {};
          resolve({ ...DEFAULT_CONFIG, ...saved });
        });
      });
    },

    async set(updates) {
      const current = await this.get();
      const updated = { ...current, ...updates };
      if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
        await new Promise((resolve) => {
          chrome.storage.local.set({ scriptoria_bridge_config: updated }, resolve);
        });
      }
      return updated;
    },

    getBaseUrl(config) {
      const cfg = config || DEFAULT_CONFIG;
      if (cfg.server_mode === "local") {
        return cfg.local_url || DEFAULT_CONFIG.local_url;
      }
      if (cfg.server_mode === "custom" && cfg.custom_url) {
        return cfg.custom_url.trim().replace(/\/+$/, "");
      }
      return cfg.cloud_url || DEFAULT_CONFIG.cloud_url;
    },

    getWsUrl(config) {
      const cfg = config || DEFAULT_CONFIG;
      if (cfg.server_mode === "local") {
        return cfg.local_ws || DEFAULT_CONFIG.local_ws;
      }
      if (cfg.server_mode === "custom" && cfg.custom_url) {
        return toWsUrl(cfg.custom_url);
      }
      return cfg.cloud_ws || DEFAULT_CONFIG.cloud_ws;
    },
  };

  if (typeof window !== "undefined") {
    window.ScriptoriaConfig = ScriptoriaConfig;
  }
  if (typeof module !== "undefined" && module.exports) {
    module.exports = ScriptoriaConfig;
  }
})();
