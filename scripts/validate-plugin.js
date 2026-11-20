#!/usr/bin/env node
'use strict';

// better-code 插件仓库确定性结构与门禁自检脚本（零外部依赖）。
// 用法：
//   node scripts/validate-plugin.js
//
// 校验维度：
// 1. AGENTS.md 与 CLAUDE.md + 7 个宿主常驻规则副本是否零漂移；
// 2. 所有宿主插件清单 JSON 与 evals.json 是否合法，插件名/版本号是否一致；
// 3. skills/ 下全部 SKILL.md 的 YAML frontmatter 合法性、目录同名约束与常驻 description 字符预算；
// 4. 仓库 Markdown 文档（AGENTS.md、README.md、docs/、skills/）中的本地相对路径链接是否真实存在；
// 5. 仓库内全部 .js 脚本语法检查（node --check）。

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');

// Codex 对技能索引有 min(2% context, 8000 chars) 限制，本插件把安全预算控制在 4000 字符以内
const MAX_TOTAL_DESCRIPTION_CHARS = 4000;
const MAX_SINGLE_DESCRIPTION_CHARS = 500;

const VERSIONED_MANIFESTS = [
  '.claude-plugin/plugin.json',
  '.codex-plugin/plugin.json',
  '.devin-plugin/plugin.json',
  '.github/plugin/plugin.json',
  '.qoder-plugin/plugin.json',
  'gemini-extension.json',
];

const ALL_MANIFESTS = [
  ...VERSIONED_MANIFESTS,
  'plugin.json',
  '.claude-plugin/marketplace.json',
  '.agents/plugins/marketplace.json',
  '.github/plugin/marketplace.json',
  '.grok-plugin/marketplace.json',
  '.kimi-plugin/plugin.json',
  'hooks/hooks.json',
  'hooks/codex-hooks.json',
];

function walkFiles(dir, predicate, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkFiles(full, predicate, out);
    } else if (predicate(full)) {
      out.push(full);
    }
  }
  return out;
}

function rel(filePath) {
  return path.relative(ROOT, filePath).split(path.sep).join('/');
}

function parseFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) return null;
  const fields = {};
  for (const rawLine of match[1].split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    fields[key] = value;
  }
  return fields;
}

function stripFencedCodeBlocks(markdown) {
  return markdown.replace(/```[\s\S]*?```/g, '').replace(/~~~[\s\S]*?~~~/g, '');
}

function stripInlineCode(line) {
  return line.replace(/`[^`]*`/g, '');
}

function checkRuleCopies(errors) {
  try {
    execFileSync(process.execPath, [path.join(ROOT, 'scripts/agent-rule-copies.js')], {
      cwd: ROOT,
      stdio: 'pipe',
    });
  } catch (err) {
    const stderr = err.stderr ? err.stderr.toString('utf8').trim() : err.message;
    errors.push(`[规则副本漂移] ${stderr}`);
  }
}

function checkJsonAndManifests(errors) {
  const parsedManifests = new Map();

  for (const manifestRel of ALL_MANIFESTS) {
    const full = path.join(ROOT, manifestRel);
    if (!fs.existsSync(full)) {
      errors.push(`[清单缺失] 缺少多宿主清单文件: ${manifestRel}`);
      continue;
    }
    try {
      const data = JSON.parse(fs.readFileSync(full, 'utf8'));
      parsedManifests.set(manifestRel, data);
      if (data.name && data.name !== 'better-code') {
        errors.push(`[清单名称不一致] ${manifestRel} 的 name 为 "${data.name}"，期望 "better-code"`);
      }
    } catch (err) {
      errors.push(`[JSON 语法错误] ${manifestRel}: ${err.message}`);
    }
  }

  const versions = new Map();
  for (const manifestRel of VERSIONED_MANIFESTS) {
    const data = parsedManifests.get(manifestRel);
    if (!data) continue;
    if (!data.version) {
      errors.push(`[版本号缺失] ${manifestRel} 缺少 version 字段`);
    } else {
      versions.set(manifestRel, data.version);
    }
  }

  const claudeMarket = parsedManifests.get('.claude-plugin/marketplace.json');
  if (claudeMarket?.metadata?.version) {
    versions.set('.claude-plugin/marketplace.json#metadata', claudeMarket.metadata.version);
  }
  if (claudeMarket?.plugins?.[0]?.version) {
    versions.set('.claude-plugin/marketplace.json#plugins[0]', claudeMarket.plugins[0].version);
  }

  const uniqueVersions = [...new Set(versions.values())];
  if (uniqueVersions.length > 1) {
    const detail = [...versions.entries()].map(([k, v]) => `${k}=${v}`).join(', ');
    errors.push(`[版本号不一致] 各宿主 manifest 版本未对齐: ${detail}`);
  }

  const evalFiles = walkFiles(path.join(ROOT, 'skills'), (f) => f.endsWith('.json'));
  for (const evalFile of evalFiles) {
    try {
      JSON.parse(fs.readFileSync(evalFile, 'utf8'));
    } catch (err) {
      errors.push(`[评测 JSON 语法错误] ${rel(evalFile)}: ${err.message}`);
    }
  }

  return { manifestCount: ALL_MANIFESTS.length, evalJsonCount: evalFiles.length, version: uniqueVersions[0] || 'unknown' };
}

function checkSkills(errors) {
  const skillsRoot = path.join(ROOT, 'skills');
  const skillDirs = fs
    .readdirSync(skillsRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();

  if (skillDirs.length === 0) {
    errors.push('[技能目录为空] skills/ 下未找到任何子目录');
    return { skillCount: 0, totalDescChars: 0 };
  }

  let totalDescChars = 0;
  for (const dirName of skillDirs) {
    const skillMd = path.join(skillsRoot, dirName, 'SKILL.md');
    if (!fs.existsSync(skillMd)) {
      errors.push(`[SKILL.md 缺失] skills/${dirName}/SKILL.md 不存在`);
      continue;
    }
    const content = fs.readFileSync(skillMd, 'utf8');
    const fm = parseFrontmatter(content);
    if (!fm) {
      errors.push(`[Frontmatter 缺失] skills/${dirName}/SKILL.md 缺少顶部 YAML frontmatter`);
      continue;
    }
    if (fm.name !== dirName) {
      errors.push(`[技能名不匹配] skills/${dirName}/SKILL.md 的 name="${fm.name || ''}" 与目录名 "${dirName}" 不一致`);
    }
    if (!fm.description || fm.description.length < 10) {
      errors.push(`[描述缺失或过短] skills/${dirName}/SKILL.md 缺少有效 description`);
      continue;
    }
    if (fm.description.length > MAX_SINGLE_DESCRIPTION_CHARS) {
      errors.push(
        `[单技能描述超长] skills/${dirName}/SKILL.md description 长度 ${fm.description.length} > ${MAX_SINGLE_DESCRIPTION_CHARS}`
      );
    }
    totalDescChars += fm.description.length;
  }

  if (totalDescChars > MAX_TOTAL_DESCRIPTION_CHARS) {
    errors.push(
      `[常驻描述总预算超标] 全部 SKILL description 合计 ${totalDescChars} 字符，超过安全上限 ${MAX_TOTAL_DESCRIPTION_CHARS}`
    );
  }

  const claudePlugin = path.join(ROOT, '.claude-plugin/plugin.json');
  if (fs.existsSync(claudePlugin)) {
    const keywords = JSON.parse(fs.readFileSync(claudePlugin, 'utf8')).keywords || [];
    for (const dirName of skillDirs) {
      if (!keywords.includes(dirName)) {
        errors.push(`[插件索引遗漏] .claude-plugin/plugin.json keywords 未包含技能 "${dirName}"`);
      }
    }
  }

  return { skillCount: skillDirs.length, totalDescChars };
}

function checkMarkdownRelativeLinks(errors) {
  const mdFiles = [
    path.join(ROOT, 'AGENTS.md'),
    path.join(ROOT, 'README.md'),
    ...walkFiles(path.join(ROOT, 'docs'), (f) => f.endsWith('.md')),
    ...walkFiles(path.join(ROOT, 'skills'), (f) => f.endsWith('.md')),
  ].filter((f) => fs.existsSync(f));

  const linkRegex = /!?\[[^\]]*\]\(([^)]+)\)/g;
  let checkedLinks = 0;

  for (const mdFile of mdFiles) {
    const raw = fs.readFileSync(mdFile, 'utf8');
    const stripped = stripFencedCodeBlocks(raw)
      .split(/\r?\n/)
      .map(stripInlineCode)
      .join('\n');

    let match;
    while ((match = linkRegex.exec(stripped)) !== null) {
      const targetRaw = match[1].trim().split(/\s+/)[0];
      if (
        !targetRaw ||
        targetRaw.startsWith('#') ||
        /^(https?:|mailto:|mdc:|file:|data:)/i.test(targetRaw) ||
        targetRaw.includes('<') ||
        targetRaw.includes('>') ||
        targetRaw.includes('{')
      ) {
        continue;
      }
      const cleanTarget = targetRaw.split('#')[0].split('?')[0];
      if (!cleanTarget) continue;

      const resolved = path.resolve(path.dirname(mdFile), cleanTarget);
      checkedLinks += 1;
      if (!fs.existsSync(resolved)) {
        errors.push(`[Markdown 死链] ${rel(mdFile)} 引用了不存在的路径 "${targetRaw}"`);
      }
    }
  }

  return { mdFileCount: mdFiles.length, checkedLinks };
}

function checkJsSyntax(errors) {
  const jsFiles = [
    ...walkFiles(path.join(ROOT, 'scripts'), (f) => f.endsWith('.js')),
    ...walkFiles(path.join(ROOT, 'hooks'), (f) => f.endsWith('.js')),
    ...walkFiles(path.join(ROOT, 'skills'), (f) => f.endsWith('.js')),
  ];

  for (const jsFile of jsFiles) {
    try {
      execFileSync(process.execPath, ['--check', jsFile], { cwd: ROOT, stdio: 'pipe' });
    } catch (err) {
      const stderr = err.stderr ? err.stderr.toString('utf8').trim() : err.message;
      errors.push(`[JS 语法错误] ${rel(jsFile)}: ${stderr}`);
    }
  }

  return { jsFileCount: jsFiles.length };
}

function main() {
  const errors = [];

  checkRuleCopies(errors);
  const manifestStats = checkJsonAndManifests(errors);
  const skillStats = checkSkills(errors);
  const linkStats = checkMarkdownRelativeLinks(errors);
  const jsStats = checkJsSyntax(errors);

  if (errors.length > 0) {
    console.error(`better-code 插件自检未通过（共 ${errors.length} 项问题）：`);
    for (const err of errors) {
      console.error(`  - ${err}`);
    }
    process.exit(1);
  }

  console.log(
    [
      `better-code 插件自检全部通过（version ${manifestStats.version}）：`,
      `  - 规则副本：AGENTS.md 与 CLAUDE.md + 7 个宿主规则文件一致`,
      `  - 清单与评测：${manifestStats.manifestCount} 份宿主/Hook JSON + ${manifestStats.evalJsonCount} 份评测 JSON 合法且版本对齐`,
      `  - 技能预算：${skillStats.skillCount} 个 SKILL frontmatter 合法，常驻 description 合计 ${skillStats.totalDescChars}/${MAX_TOTAL_DESCRIPTION_CHARS} 字符`,
      `  - 文档链接：扫描 ${linkStats.mdFileCount} 份 Markdown，核实 ${linkStats.checkedLinks} 处相对引用无死链`,
      `  - 脚本语法：${jsStats.jsFileCount} 个 Node 脚本通过语法检查`,
    ].join('\n')
  );
}

main();
