// extension/scriptoria-flow-bridge/injected.js
/**
 * Scriptoria Google Flow Companion — MAIN World Network Interceptor
 * Sniffs window.fetch and XMLHttpRequest for Google Flow generation RPCs,
 * parses normal JSON and Google batchexecute `)]}'` envelopes, extracts
 * *.googleusercontent.com / storage.googleapis.com / data: media outputs,
 * converts cookie-gated or blob: assets into Base64 when helpful, and emits
 * CustomEvents to the ISOLATED content script.
 */
(function () {
  "use strict";

  if (window.__SCRIPTORIA_FLOW_INJECTED__) {
    return;
  }
  window.__SCRIPTORIA_FLOW_INJECTED__ = true;

  const EVENT_MEDIA_CAPTURED = "SCRIPTORIA_FLOW_MEDIA_CAPTURED";
  const EVENT_RPC_ACTIVITY = "SCRIPTORIA_FLOW_RPC_ACTIVITY";
  const EVENT_RPC_ERROR = "SCRIPTORIA_FLOW_RPC_ERROR";

  const MEDIA_URL_REGEX =
    /https:\/\/(?:[a-z0-9-]+\.)*(?:googleusercontent\.com|ggpht\.com|storage\.googleapis\.com|flow-content\.google)\/[^\s"'<>\\]+/gi;

  const DATA_URI_REGEX =
    /^data:(image\/(?:png|jpeg|webp|gif)|video\/(?:mp4|webm));base64,[A-Za-z0-9+/=]+$/i;

  const FLOW_RPC_PATTERNS = [
    /batchexecute/i,
    /GenerateImage/i,
    /GenerateVideo/i,
    /RunFlow/i,
    /CreateMedia/i,
    /aisandbox/i,
    / video/i,
    /v1(?:beta|alpha)?\/projects/i,
    /flow/i,
    /fx\/api/i,
    /trpc/i,
    /rpc/i,
  ];

  // Track recently emitted URLs so we don't emit duplicates for the same task
  const seenUrlCache = new Map();
  const CACHE_TTL_MS = 120_000;

  function pruneSeenCache() {
    const now = Date.now();
    for (const [key, timestamp] of seenUrlCache.entries()) {
      if (now - timestamp > CACHE_TTL_MS) {
        seenUrlCache.delete(key);
      }
    }
  }

  function decodeEscapedUrl(rawUrl) {
    if (typeof rawUrl !== "string") return "";
    return rawUrl
      .replace(/\\u003d/gi, "=")
      .replace(/\\u0026/gi, "&")
      .replace(/\\u002f/gi, "/")
      .replace(/\\\//g, "/")
      .replace(/["')\]\\]+$/g, "")
      .trim();
  }

  function isLikelyGeneratedAssetUrl(url) {
    if (!url || typeof url !== "string") return false;
    // Ignore tiny profile avatars (e.g., =s32-c, =s48-c, =s64-c, /a/ACg8oc...)
    if (/\/a\/ACg8oc/i.test(url)) return false;
    if (/=s(?:16|20|24|32|40|48|64|72|96)-c(?:-k|-no)?$/i.test(url)) return false;
    if (/favicon|avatar|profile_photo|branding|googlelogo/i.test(url)) return false;
    return true;
  }

  function inferMimeAndType(url) {
    const lower = url.toLowerCase();
    if (
      lower.includes(".mp4") ||
      lower.includes("video") ||
      lower.includes("mime=video") ||
      lower.includes("=m18") ||
      lower.includes("=m22") ||
      lower.includes("=m37")
    ) {
      return { mediaType: "VIDEO", mimeType: "video/mp4" };
    }
    if (lower.includes(".webp") || lower.includes("format=webp")) {
      return { mediaType: "IMAGE", mimeType: "image/webp" };
    }
    if (lower.includes(".jpg") || lower.includes(".jpeg")) {
      return { mediaType: "IMAGE", mimeType: "image/jpeg" };
    }
    return { mediaType: "IMAGE", mimeType: "image/png" };
  }

  /**
   * Attempts to fetch the asset inside the authenticated browser context and convert
   * it to Base64 if it is under 25MB, ensuring FastAPI can save it even when URLs
   * require Google session cookies.
   */
  async function tryFetchAsBase64(url, originalFetch) {
    try {
      const response = await originalFetch(url, {
        method: "GET",
        credentials: "include",
        mode: "cors",
      });
      if (!response.ok) return null;

      const contentType = response.headers.get("content-type") || "";
      if (
        !contentType.startsWith("image/") &&
        !contentType.startsWith("video/") &&
        !contentType.startsWith("application/octet-stream")
      ) {
        return null;
      }

      const blob = await response.blob();
      // Skip inline Base64 for very large videos (> 28 MB) to avoid IPC memory pressure
      if (blob.size > 28 * 1024 * 1024 || blob.size < 1024) {
        return null;
      }

      return await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          resolve({
            base64Data: typeof reader.result === "string" ? reader.result : null,
            mimeType: blob.type || contentType.split(";")[0] || "image/png",
            sizeBytes: blob.size,
          });
        };
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(blob);
      });
    } catch (_err) {
      return null;
    }
  }

  /**
   * Recursively walks arbitrary JSON / nested string structures to extract
   * generated media URLs and inline base64 payloads.
   */
  function extractCandidatesFromStructure(node, bucket = new Map(), depth = 0) {
    if (depth > 18 || node == null) return bucket;

    if (typeof node === "string") {
      const trimmed = node.trim();

      // Check if string is a data URI
      if (DATA_URI_REGEX.test(trimmed)) {
        const isVideo = trimmed.startsWith("data:video/");
        const mimeMatch = trimmed.match(/^data:([^;]+);base64,/i);
        const key = trimmed.slice(0, 128);
        if (!bucket.has(key)) {
          bucket.set(key, {
            remote_url: `data-uri://${Date.now()}-${bucket.size}`,
            mime_type: mimeMatch ? mimeMatch[1] : isVideo ? "video/mp4" : "image/png",
            media_type: isVideo ? "VIDEO" : "IMAGE",
            base64_data: trimmed,
          });
        }
        return bucket;
      }

      // Extract any googleusercontent / storage URLs embedded in string
      const matches = trimmed.match(MEDIA_URL_REGEX);
      if (matches) {
        for (const rawMatch of matches) {
          const cleanedUrl = decodeEscapedUrl(rawMatch);
          if (isLikelyGeneratedAssetUrl(cleanedUrl) && !bucket.has(cleanedUrl)) {
            const { mediaType, mimeType } = inferMimeAndType(cleanedUrl);
            bucket.set(cleanedUrl, {
              remote_url: cleanedUrl,
              mime_type: mimeType,
              media_type: mediaType,
              base64_data: null,
            });
          }
        }
      }

      // If the string looks like nested JSON or batchexecute array, parse it
      if (
        (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
        (trimmed.startsWith("[") && trimmed.endsWith("]")) ||
        trimmed.startsWith(")]}'")
      ) {
        const stripped = trimmed.replace(/^\)\]\}'\s*/, "");
        try {
          const parsed = JSON.parse(stripped);
          extractCandidatesFromStructure(parsed, bucket, depth + 1);
        } catch (_e) {
          // Multi-line batchexecute chunk parsing
          const lines = stripped.split("\n");
          for (const line of lines) {
            const l = line.trim();
            if ((l.startsWith("[") && l.endsWith("]")) || (l.startsWith("{") && l.endsWith("}"))) {
              try {
                extractCandidatesFromStructure(JSON.parse(l), bucket, depth + 1);
              } catch (_innerErr) {
                // Ignore non-JSON length lines
              }
            }
          }
        }
      }
      return bucket;
    }

    if (Array.isArray(node)) {
      for (const item of node) {
        extractCandidatesFromStructure(item, bucket, depth + 1);
      }
      return bucket;
    }

    if (typeof node === "object") {
      // Check for raw base64 bytes fields common in Vertex/Imagen/Veo RPCs
      const possibleB64 =
        node.bytesBase64Encoded ||
        node.imageBytes ||
        node.videoBytes ||
        node.encodedImage ||
        node.base64Data;
      if (typeof possibleB64 === "string" && possibleB64.length > 512) {
        const mime =
          node.mimeType ||
          node.contentType ||
          (node.videoBytes ? "video/mp4" : "image/png");
        const dataUri = possibleB64.startsWith("data:")
          ? possibleB64
          : `data:${mime};base64,${possibleB64}`;
        const key = dataUri.slice(0, 128);
        if (!bucket.has(key)) {
          bucket.set(key, {
            remote_url: `rpc-inline://${Date.now()}-${bucket.size}`,
            mime_type: mime,
            media_type: mime.startsWith("video/") ? "VIDEO" : "IMAGE",
            base64_data: dataUri,
          });
        }
      }

      for (const key of Object.keys(node)) {
        extractCandidatesFromStructure(node[key], bucket, depth + 1);
      }
    }

    return bucket;
  }

  async function processRawRpcPayload(endpointUrl, rawText, originalFetch) {
    if (!rawText || typeof rawText !== "string") return;

    pruneSeenCache();
    const bucket = extractCandidatesFromStructure(rawText);
    if (bucket.size === 0) return;

    const freshCandidates = [];
    let index = 0;

    for (const [key, item] of bucket.entries()) {
      if (seenUrlCache.has(key)) continue;
      seenUrlCache.set(key, Date.now());

      let base64Data = item.base64_data;
      let mimeType = item.mime_type;

      // Attempt in-browser fetch for googleusercontent URLs so cookie-bound assets are preserved
      if (!base64Data && item.remote_url.startsWith("https://")) {
        const fetched = await tryFetchAsBase64(item.remote_url, originalFetch);
        if (fetched && fetched.base64Data) {
          base64Data = fetched.base64Data;
          mimeType = fetched.mimeType || mimeType;
        }
      }

      freshCandidates.push({
        candidate_index: index++,
        remote_url: item.remote_url,
        mime_type: mimeType,
        media_type: item.media_type,
        base64_data: base64Data,
        flow_media_key: key.slice(0, 120),
      });
    }

    if (freshCandidates.length > 0) {
      window.dispatchEvent(
        new CustomEvent(EVENT_MEDIA_CAPTURED, {
          detail: {
            rpc_endpoint: endpointUrl,
            captured_at: new Date().toISOString(),
            candidates: freshCandidates,
          },
        })
      );
    }
  }

  function isRelevantRpcUrl(url) {
    if (!url || typeof url !== "string") return false;
    return FLOW_RPC_PATTERNS.some((pattern) => pattern.test(url));
  }

  // ==========================================================================
  // 1. Monkeypatch window.fetch
  // ==========================================================================
  const nativeFetch = window.fetch.bind(window);

  window.fetch = async function (...args) {
    const requestInfo = args[0];
    const url =
      typeof requestInfo === "string"
        ? requestInfo
        : requestInfo && typeof requestInfo.url === "string"
        ? requestInfo.url
        : "";

    const relevant = isRelevantRpcUrl(url);
    if (relevant) {
      window.dispatchEvent(
        new CustomEvent(EVENT_RPC_ACTIVITY, {
          detail: { phase: "REQUEST_START", url, timestamp: Date.now() },
        })
      );
    }

    try {
      const response = await nativeFetch(...args);

      if (relevant || MEDIA_URL_REGEX.test(url)) {
        const cloned = response.clone();
        cloned
          .text()
          .then((bodyText) => {
            processRawRpcPayload(url, bodyText, nativeFetch);
          })
          .catch(() => {});
      }

      return response;
    } catch (error) {
      if (relevant) {
        window.dispatchEvent(
          new CustomEvent(EVENT_RPC_ERROR, {
            detail: {
              url,
              error: error instanceof Error ? error.message : String(error),
              timestamp: Date.now(),
            },
          })
        );
      }
      throw error;
    }
  };

  // ==========================================================================
  // 2. Monkeypatch XMLHttpRequest (used by Google Closure / batchexecute)
  // ==========================================================================
  const XHRProto = XMLHttpRequest.prototype;
  const nativeOpen = XHRProto.open;
  const nativeSend = XHRProto.send;

  XHRProto.open = function (method, url, ...rest) {
    this.__scriptoriaUrl = typeof url === "string" ? url : String(url || "");
    this.__scriptoriaMethod = method;
    return nativeOpen.call(this, method, url, ...rest);
  };

  XHRProto.send = function (body) {
    const url = this.__scriptoriaUrl || "";
    if (isRelevantRpcUrl(url)) {
      this.addEventListener("load", function () {
        try {
          if (
            this.responseType === "" ||
            this.responseType === "text" ||
            this.responseType === "json"
          ) {
            const rawText =
              this.responseType === "json"
                ? JSON.stringify(this.response)
                : this.responseText;
            processRawRpcPayload(url, rawText, nativeFetch);
          }
        } catch (_err) {
          // Ignore non-text XHR responses
        }
      });
    }
    return nativeSend.call(this, body);
  };

  console.info(
    "[Scriptoria Flow Companion] MAIN world RPC & googleusercontent interceptor active."
  );
})();
