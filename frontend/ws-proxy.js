// frontend/ws-proxy.js
/**
 * Zero-dependency WebSocket Reverse Proxy for Next.js Standalone
 * Transparently intercepts HTTP 'upgrade' requests for /api/v1/flow-bridge/ws
 * and pipes raw duplex streams to FastAPI (scriptoria-api:8000), preventing
 * Next.js router from terminating the socket with EOF.
 */
const http = require("http");
const net = require("net");

function handleWsUpgrade(req, clientSocket, head) {
  let targetHost = process.env.FASTAPI_HOST || "scriptoria-api";
  let targetPort = parseInt(process.env.FASTAPI_PORT || "8000", 10);

  if (process.env.SCRIPTORIA_FASTAPI_URL) {
    try {
      const parsed = new URL(process.env.SCRIPTORIA_FASTAPI_URL);
      targetHost = parsed.hostname || targetHost;
      if (parsed.port) targetPort = parseInt(parsed.port, 10);
    } catch (_) {}
  }

  const backendSocket = net.connect(targetPort, targetHost, () => {
    let rawReq = `${req.method} ${req.url} HTTP/${req.httpVersion}\r\n`;
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      rawReq += `${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}\r\n`;
    }
    rawReq += "\r\n";

    backendSocket.write(rawReq);
    if (head && head.length > 0) {
      backendSocket.write(head);
    }

    clientSocket.pipe(backendSocket);
    backendSocket.pipe(clientSocket);
  });

  backendSocket.on("error", (err) => {
    console.error("[WS Proxy Backend Error]", err.message);
    try {
      clientSocket.destroy();
    } catch {}
  });

  clientSocket.on("error", (err) => {
    try {
      backendSocket.destroy();
    } catch {}
  });
}

const originalCreateServer = http.createServer;

http.createServer = function (...args) {
  const server = originalCreateServer.apply(this, args);

  const originalOn = server.on.bind(server);
  const originalAddListener = server.addListener.bind(server);

  function wrapUpgrade(originalFn) {
    return function (event, listener) {
      if (event === "upgrade" && typeof listener === "function") {
        const wrappedListener = function (req, socket, head) {
          const url = req.url || "";
          if (url.startsWith("/api/v1/flow-bridge/ws")) {
            handleWsUpgrade(req, socket, head);
            return;
          }
          return listener.apply(this, arguments);
        };
        return originalFn(event, wrappedListener);
      }
      return originalFn.apply(this, arguments);
    };
  }

  server.on = wrapUpgrade(originalOn);
  server.addListener = wrapUpgrade(originalAddListener);

  return server;
};
