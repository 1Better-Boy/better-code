#!/usr/bin/env node
'use strict';

// 让各宿主的常驻规则文件与 AGENTS.md 保持同一份内容。
// 用法：
//   node scripts/agent-rule-copies.js           # 只检查，漂移时退出码 1
//   node scripts/agent-rule-copies.js --write   # 按 AGENTS.md 重新生成全部副本

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const canonicalPath = path.join(root, 'AGENTS.md');

const COPIES = [
  { relPath: 'CLAUDE.md', header: [] },
  {
    relPath: '.cursor/rules/better-code.mdc',
    header: ['---', 'description: better-code 工程约束：高内聚、职责明确、可验证的改动边界。', 'globs:', 'alwaysApply: true', '---', ''],
  },
  { relPath: '.windsurf/rules/better-code.md', header: [] },
  { relPath: '.clinerules/better-code.md', header: [] },
  {
    relPath: '.kiro/steering/better-code.md',
    header: ['---', 'title: better-code 工程约束', 'inclusion: always', '---', ''],
  },
  { relPath: '.qoder/rules/better-code.md', header: [] },
  { relPath: '.agents/rules/better-code.md', header: [] },
  { relPath: '.github/copilot-instructions.md', header: [] },
];

function normalize(text) {
  return text
    .replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n*/, '')
    .replace(/\r\n/g, '\n')
    .trim();
}

function readCanonical() {
  return normalize(fs.readFileSync(canonicalPath, 'utf8'));
}

function render(copy, body) {
  return [...copy.header, body, ''].join('\n');
}

function main() {
  const write = process.argv.includes('--write');
  const body = readCanonical();
  if (!body) {
    console.error('AGENTS.md 为空，没有可同步的内容。');
    process.exit(1);
  }

  let failed = false;
  for (const copy of COPIES) {
    const target = path.join(root, copy.relPath);
    if (write) {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, render(copy, body), 'utf8');
      console.log(`written ${copy.relPath}`);
      continue;
    }

    if (!fs.existsSync(target)) {
      console.error(`missing ${copy.relPath}`);
      failed = true;
      continue;
    }
    if (normalize(fs.readFileSync(target, 'utf8')) !== body) {
      console.error(`drifted ${copy.relPath}`);
      failed = true;
    }
  }

  if (failed) {
    console.error('副本与 AGENTS.md 不一致，运行 node scripts/agent-rule-copies.js --write 重新生成。');
    process.exit(1);
  }
  if (!write) {
    console.log(`AGENTS.md 与 ${COPIES.length} 个宿主规则副本一致。`);
  }
}

main();
