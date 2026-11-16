// frontend/ws-proxy.js
/**
 * Zero-dependency WebSocket Reverse Proxy for Next.js Standalone
 * Transparently intercepts HTTP 'upgrade' requests for /api/v1/flow-bridge/ws
 * and pipes raw duplex streams to FastAPI (scriptoria-api:8000).
 */
const http = require("http");
const net = require("net");

const originalCreateServer = http.createServer;

http.createServer = function (...args) {
  const server = originalCreateServer.apply(this, args);

  server.on("upgrade", (req, clientSocket, head) => {
    const url = req.url || "";
    if (url.startsWith("/api/v1/flow-bridge/ws")) {
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
  });

  return server;
};
