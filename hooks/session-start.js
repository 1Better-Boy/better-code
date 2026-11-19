#!/usr/bin/env node
'use strict';

// 把插件根目录的 AGENTS.md 注入会话上下文。
// 供 hooks/hooks.json 的 SessionStart 钩子调用；任何异常都静默退出，不阻塞会话。

const fs = require('node:fs');
const path = require('node:path');

const pluginRoot = path.resolve(__dirname, '..');
const instructionsPath = path.join(pluginRoot, 'AGENTS.md');

function realOrNull(target) {
  try {
    return fs.realpathSync(target);
  } catch {
    return null;
  }
}

function main() {
  // 在插件仓库自身里工作时，CLAUDE.md 已经加载同一份内容，跳过以免重复占用上下文。
  const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const projectReal = realOrNull(projectDir);
  if (projectReal !== null && projectReal === realOrNull(pluginRoot)) {
    return;
  }

  let body;
  try {
    body = fs.readFileSync(instructionsPath, 'utf8');
  } catch {
    return;
  }
  if (!body.trim()) {
    return;
  }

  const additionalContext = [
    '以下是 better-code 插件附带的工程约束（来源：插件的 AGENTS.md），在本会话中持续适用。',
    '',
    body.trim(),
  ].join('\n');

  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext,
      },
    })
  );
}

main();
