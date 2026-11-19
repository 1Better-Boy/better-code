# 安装到不同 Agent

`skills/` 是核心内容，各宿主的适配文件只是让它在对应环境里能被发现和加载。宿主不在下表时，把 `AGENTS.md` 放进项目根目录即可获得常驻约束。

| Agent | 适配文件 | 安装方式 | 常驻约束来源 |
| --- | --- | --- | --- |
| Claude Code | `.claude-plugin/`、`hooks/hooks.json`、`skills/` | `/plugin marketplace add bb-boy680/better-code`，再 `/plugin install better-code@better-code` | `SessionStart` hook 注入 `AGENTS.md` |
| Codex CLI / IDE 扩展 | `.codex-plugin/plugin.json`、`hooks/codex-hooks.json`、`skills/` | `codex plugin marketplace add bb-boy680/better-code`，再 `codex plugin add better-code@better-code` | 插件 hook 注入 `AGENTS.md`；不在插件内时，Codex 读项目根 `AGENTS.md` |
| Cursor | `.cursor/rules/better-code.mdc` | 把规则文件复制到目标项目的 `.cursor/rules/` | `.mdc` 中 `alwaysApply: true` |
| Windsurf | `.windsurf/rules/better-code.md` | 复制到目标项目 `.windsurf/rules/` | 规则文件 |
| Cline | `.clinerules/better-code.md`、`skills/`、`AGENTS.md` | 复制规则文件到 `.clinerules/` 或 `~/.cline/rules/`；技能目录复制到 `.agents/skills/` | 规则文件或项目 `AGENTS.md` |
| GitHub Copilot（仓库） | `.github/copilot-instructions.md` | 复制到目标项目 `.github/` | 仓库指令文件 |
| GitHub Copilot CLI | `.github/plugin/`、`skills/` | `copilot plugin marketplace add bb-boy680/better-code`，再 `copilot plugin install better-code@better-code` | 仓库指令文件或 `AGENTS.md` |
| Gemini CLI / Qwen Code | `gemini-extension.json`、`AGENTS.md`、`skills/` | 以扩展方式安装，`contextFileName` 指向 `AGENTS.md` | 扩展上下文文件 |
| Kimi Code | `.kimi-plugin/plugin.json`、`AGENTS.md`、`skills/` | `/plugins install https://github.com/bb-boy680/better-code` | `systemPromptPath` |
| Devin CLI | `.devin-plugin/plugin.json`、`skills/` | `devin plugins install bb-boy680/better-code` | 手动复制 `AGENTS.md` |
| Qoder | `.qoder-plugin/plugin.json`、`.qoder/rules/`、`skills/` | 以插件安装；规则也可直接复制到项目 `.qoder/rules/` | 项目 `AGENTS.md` 或 `.qoder/rules/` |
| Grok Build | `plugin.json`、`.grok-plugin/marketplace.json`、`skills/` | `grok plugin install bb-boy680/better-code --trust` | 手动复制 `AGENTS.md` |
| Goose / 通用 agents marketplace | `plugin.json`、`.agents/plugins/marketplace.json` | 走宿主自己的 marketplace 命令 | 项目 `AGENTS.md` 或 `~/.agents/rules/` |
| Zed / Jules / Amp / Junie / Factory Droid / CodeWhale 等 | `AGENTS.md`、`skills/` | 把 `AGENTS.md` 放进项目根；技能复制到宿主的 skills 目录 | 项目 `AGENTS.md` |

## 规则副本如何保持同步

`.cursor/`、`.windsurf/`、`.clinerules/`、`.kiro/`、`.qoder/rules/`、`.agents/rules/`、`.github/copilot-instructions.md` 里的内容都由 `AGENTS.md` 生成，不要手改：

```bash
node scripts/agent-rule-copies.js           # 检查是否漂移
node scripts/agent-rule-copies.js --write   # 按 AGENTS.md 重新生成
```

## 能力差异

- **技能**：9 个技能都走 `skills/<name>/SKILL.md`，支持该格式的宿主可直接读取；不支持技能的宿主只加载常驻规则。
- **Hook**：目前只有 Claude Code 和 Codex 有生命周期 hook 注入；其他宿主依赖各自的规则文件机制，不需要 `node`。
- **验证状态**：Claude Code 的插件清单、hook 与技能枚举已在本机实际验证；Codex CLI 能识别 `.agents/plugins/marketplace.json` 并把 `better-code` 列为可安装插件，但插件安装和 hook 触发未在本机验证。其余宿主按各自公开的目录与 manifest 格式提供，未在本机逐一安装验证。
