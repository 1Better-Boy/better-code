/**
 * Debugger Server - 接收前端埋点 HTTP POST 请求并追加写入项目本地 .debug/logs/{sessionId}.log
 * pwd 通过请求体传递，单实例可服务任意项目
 * 监听地址: 127.0.0.1:9220（可用环境变量 DEBUG_PORT 覆盖）
 *
 * 启动: node debugger-server.js
 * 健康检查: curl http://127.0.0.1:9220/health
 */

import http from "node:http";
import path from "node:path";
import fs from "node:fs";

const HOST = "127.0.0.1";
const PORT = Number(process.env.DEBUG_PORT) || 9220;
const MAX_BODY_BYTES = 2 * 1024 * 1024; // 2MB

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    let bytes = 0;
    req.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes > MAX_BODY_BYTES) {
        req.destroy();
        reject(new Error("Payload too large"));
        return;
      }
      body += chunk.toString("utf8");
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

function setCorsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function isValidSessionId(sessionId) {
  return typeof sessionId === "string" && /^[a-zA-Z0-9._-]{1,128}$/.test(sessionId);
}

async function handleLogRequest(req, res) {
  setCorsHeaders(res);

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    return res.end();
  }

  const url = new URL(req.url, `http://${req.headers.host || `${HOST}:${PORT}`}`);
  const sessionId = url.searchParams.get("session_id");

  if (!isValidSessionId(sessionId)) {
    res.writeHead(400, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ error: "Missing or invalid session_id parameter" }));
  }

  try {
    const logData = await parseBody(req);
    const pwd = logData.pwd;

    if (!pwd || typeof pwd !== "string") {
      res.writeHead(400, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: "Missing pwd field in request body" }));
    }

    const resolvedPwd = path.resolve(pwd);
    const logsDir = path.join(resolvedPwd, ".debug", "logs");
    fs.mkdirSync(logsDir, { recursive: true });

    if (!logData.timestamp) {
      logData.timestamp = Date.now();
    }

    delete logData.pwd;

    const logFile = path.join(logsDir, `${sessionId}.log`);
    fs.appendFileSync(logFile, JSON.stringify(logData) + "\n", "utf8");

    const loc = logData.location || "";
    const msg = logData.message || "";
    if (loc) {
      console.log(`[debugger:${sessionId}] ${loc} ${msg}`);
    }

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "logged" }));
  } catch (err) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: `Bad request: ${err.message}` }));
  }
}

function handleHealthCheck(res) {
  setCorsHeaders(res);
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ status: "ok", service: "debugger-log", host: HOST, port: PORT }));
}

async function routeRequest(req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers.host || `${HOST}:${PORT}`}`);
    const pathname = url.pathname;

    switch (pathname) {
      case "/health":
        return handleHealthCheck(res);
      case "/debug/log":
        return await handleLogRequest(req, res);
      default:
        setCorsHeaders(res);
        res.writeHead(404, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ error: `Not found: ${pathname}` }));
    }
  } catch (err) {
    setCorsHeaders(res);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: `Internal error: ${err.message}` }));
  }
}

const server = http.createServer(routeRequest);

function shutdown(signal) {
  console.log(`\n[debugger] ${signal} received, shutting down...`);
  server.close(() => {
    console.log("[debugger] HTTP server closed");
    process.exit(0);
  });
  setTimeout(() => {
    process.exit(1);
  }, 3000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

server.on("error", (err) => {
  console.error(`[debugger] Server error: ${err.message}`);
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  console.log(`[debugger] Server started on http://${HOST}:${PORT}`);
});
