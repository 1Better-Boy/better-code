#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

function usage() {
  console.error("Usage: node cleanup-debug-blocks.js --session-id <id> --files <file...> [--log-file <path>] [--dry-run]");
}

function parseArgs(argv) {
  const args = { files: [], dryRun: false, logFile: undefined, sessionId: undefined };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--session-id") {
      args.sessionId = argv[++i];
    } else if (arg === "--files") {
      while (argv[i + 1] && !argv[i + 1].startsWith("--")) {
        args.files.push(argv[++i]);
      }
    } else if (arg === "--log-file") {
      args.logFile = argv[++i];
    } else if (arg === "--dry-run") {
      args.dryRun = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!args.sessionId || args.files.length === 0) {
    usage();
    process.exit(2);
  }

  return args;
}

function removeDebugBlocks(content, sessionId) {
  const lineEnding = content.includes("\r\n") ? "\r\n" : "\n";
  const lines = content.split(/\r?\n/);
  const kept = [];
  let removedBlocks = 0;
  let insideTargetBlock = false;

  for (const line of lines) {
    const isDebugStart = line.includes("#region DEBUG") && line.includes(`sessionId: ${sessionId}`);
    const isDebugEnd = line.includes("#endregion DEBUG");

    if (insideTargetBlock) {
      if (isDebugEnd) {
        insideTargetBlock = false;
      }
      continue;
    }

    if (isDebugStart) {
      insideTargetBlock = true;
      removedBlocks += 1;
      if (isDebugEnd) {
        insideTargetBlock = false;
      }
      continue;
    }

    kept.push(line);
  }

  return { content: kept.join(lineEnding), removedBlocks };
}

function cleanupFile(filePath, sessionId, dryRun) {
  const absolutePath = path.resolve(filePath);
  const original = fs.readFileSync(absolutePath, "utf8");
  const result = removeDebugBlocks(original, sessionId);

  if (!dryRun && result.removedBlocks > 0) {
    fs.writeFileSync(absolutePath, result.content, "utf8");
  }

  return {
    file: absolutePath,
    removedBlocks: result.removedBlocks,
    changed: result.removedBlocks > 0,
  };
}

function removeEmptyDebugDirs(logFilePath) {
  const logsDir = path.dirname(path.resolve(logFilePath));
  const debugDir = path.dirname(logsDir);

  try {
    if (path.basename(logsDir) === "logs" && fs.existsSync(logsDir) && fs.readdirSync(logsDir).length === 0) {
      fs.rmdirSync(logsDir);
    }
    if (path.basename(debugDir) === ".debug" && fs.existsSync(debugDir) && fs.readdirSync(debugDir).length === 0) {
      fs.rmdirSync(debugDir);
    }
  } catch {
    // Ignore directory cleanup errors
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const files = args.files.map((file) => cleanupFile(file, args.sessionId, args.dryRun));
  let deletedLog = false;

  const logFile = args.logFile || path.join(".debug", "logs", `${args.sessionId}.log`);
  if (fs.existsSync(logFile) && !args.dryRun) {
    fs.unlinkSync(logFile);
    deletedLog = true;
    removeEmptyDebugDirs(logFile);
  }

  console.log(JSON.stringify({ dryRun: args.dryRun, sessionId: args.sessionId, files, deletedLog }, null, 2));
}

main();
