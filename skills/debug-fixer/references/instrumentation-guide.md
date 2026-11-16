# 埋点注入指南与多语言模板（Instrumentation Guide）

当静态分析无法百分百确认根因，或需要验证并发时序、跨模块数据流与 CSS 布局偏差时，按本指南注入标准静默埋点，采集 `.debug/logs/<session_id>.log` 运行时证据。

---

## 1. 运行环境判定与通道选择

不要仅凭文件后缀（如 `.tsx`）猜测运行环境（例如 Next.js Server Component、Ink 终端 UI 虽然是 `.tsx`，但运行在 Node 服务端）。按实际执行环境选择双通道之一：

| 实际运行环境 | 识别特征 | 埋点通道与模板 |
| :--- | :--- | :--- |
| **Node.js 服务端 / CLI / 主进程 / 测试进程** | Node 脚本、API 路由、Next.js Server Component、Electron `ipcMain`、VS Code 插件、Vitest/Jest/Node Test | **本地文件写入**（Node.js 通用模板） |
| **浏览器客户端 / 渲染进程** | 含 DOM API、`'use client'`、浏览器端 React/Vue/Svelte、Electron `ipcRenderer` | **本地 HTTP 服务**（客户端 `fetch` / 视觉快照模板 → `:9220`） |
| **Python / Go / Java / Rust / PHP / Ruby** | 对应后端服务、脚本或测试进程 | **本地文件写入**（对应语言模板） |

> **不确定环境时**：优先使用本地文件写入（不依赖本地 HTTP 端口与 CORS/CSP 限制）。

---

## 2. 埋点安全铁律（防崩与零残留）

1. **必须包裹 `#region DEBUG` 标记**：所有埋点严格以 `// #region DEBUG [sessionId: {{DEBUG_SESSION_ID}}]` 开头、`// #endregion DEBUG` 结尾（Python/Ruby 使用 `# #region DEBUG ...`），以便 `cleanup-debug-blocks.js` 精确清理。
2. **绝对静默（Fail Silently）**：所有文件写入与网络请求必须包含异常兜底（`try-catch` 或 `.catch(() => {})`），且使用独立作用域（IIFE 或代码块 `{}`）避免变量名污染，**绝不允许因埋点失败、循环引用或端口未启动导致宿主程序报错崩溃**。
3. **只读不写业务状态**：埋点内严禁调用带有副作用的业务方法（如 `arr.pop()`、`stream.read()`），只记录关键标量与精简快照。
4. **作用域合法性**：只能在函数体、方法体或可执行代码块内注入，严禁注入到接口声明、类型定义或类属性声明之间。

---

## 3. 客户端 HTTP 调试服务启动流程（仅浏览器端需要）

当目标代码运行在浏览器环境时，埋点通过 `http://127.0.0.1:9220/debug/log` 落盘到本地文件：

1. **健康检查**：请求 `http://127.0.0.1:9220/health`。
   - 返回 `200 OK`（`{"status":"ok"}`）→ 服务已就绪，直接注入埋点。
   - 连接拒绝或超时 → 执行第 2 步启动服务。
2. **启动本地日志服务**：
   - 在后台启动 `node <skill目录>/scripts/debugger-server.js`（或运行 `node <skill目录>/scripts/launch-debugger.js`），再次检查 `http://127.0.0.1:9220/health` 确认返回 `200 OK`。
3. **路径传递**：客户端模板中的 `{{PROJECT_ROOT}}` 替换为当前项目根目录绝对路径（正斜杠 `/` 转义），服务端会自动将日志写入 `{{PROJECT_ROOT}}/.debug/logs/{{DEBUG_SESSION_ID}}.log`。

---

## 4. 标准埋点模板

> **占位符说明**：
> - `{{DEBUG_SESSION_ID}}`：本次调试会话 ID（如 `debug_20261116-203000-a1b2`）
> - `{{ABSOLUTE_PROJECT_PATH}}` / `{{PROJECT_ROOT}}`：项目根目录绝对路径（Windows 路径请将 `\` 转为 `/` 以免字符串转义错误，如 `D:/work-space/app`）
> - `{{FILE}}:{{LINE}}`：当前文件名与行号
> - `{{MESSAGE}}`：简短阶段标识，如 `[enter]`、`[branch]`、`[state_change]`、`[return]`
> - `{{DATA_SNAPSHOT}}`：需要观测的关键变量对象字面量（如 `{ userId, count, isReady }`）

### 4.1 浏览器客户端（JavaScript / TypeScript `fetch`）

使用 `.catch(() => {})` 与 `try-catch` 双重保护，同步/异步函数内均可直接插入：

```javascript
// #region DEBUG [sessionId: {{DEBUG_SESSION_ID}}]
try {
  fetch("http://127.0.0.1:9220/debug/log?session_id={{DEBUG_SESSION_ID}}", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "logic",
      location: "{{FILE}}:{{LINE}}",
      message: "{{MESSAGE}}",
      pwd: "{{PROJECT_ROOT}}",
      data: {{DATA_SNAPSHOT}},
      timestamp: Date.now()
    }),
    keepalive: true
  }).catch(() => {});
} catch {}
// #endregion DEBUG
```

### 4.2 浏览器视觉与布局快照（Visual Snapshot）

当排查 UI 错位、尺寸不对、点击无响应时使用。**同时记录 JS 预期计算值与 DOM 实际渲染值（`boundingClientRect` + `getComputedStyle`），二者的差值就是根因线索**：

```javascript
// #region DEBUG [sessionId: {{DEBUG_SESSION_ID}}]
try {
  const __el = document.querySelector("{{TARGET_SELECTOR}}");
  if (__el) {
    const __rect = __el.getBoundingClientRect();
    const __styles = getComputedStyle(__el);
    fetch("http://127.0.0.1:9220/debug/log?session_id={{DEBUG_SESSION_ID}}", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "visual",
        location: "{{FILE}}:{{LINE}}",
        message: "[visual_snapshot] {{MESSAGE}}",
        pwd: "{{PROJECT_ROOT}}",
        data: {
          expected: {{DATA_SNAPSHOT}},
          boundingClientRect: { x: __rect.x, y: __rect.y, width: __rect.width, height: __rect.height },
          computedStyles: {
            display: __styles.display,
            visibility: __styles.visibility,
            position: __styles.position,
            zIndex: __styles.zIndex,
            pointerEvents: __styles.pointerEvents,
            opacity: __styles.opacity,
            transform: __styles.transform,
            overflow: __styles.overflow
          },
          classList: Array.from(__el.classList),
          viewport: { width: window.innerWidth, height: window.innerHeight }
        },
        timestamp: Date.now()
      }),
      keepalive: true
    }).catch(() => {});
  }
} catch {}
// #endregion DEBUG
```

### 4.3 Node.js 服务端（ESM 与 CommonJS 通用，同步/异步函数均安全）

无需顶层 `await`，利用 `process.getBuiltinModule`（Node 20.16+/22+）或 `require` 降级，自动创建 `.debug/logs` 目录并同步追加写入：

```javascript
// #region DEBUG [sessionId: {{DEBUG_SESSION_ID}}]
try {
  const __fs = typeof process.getBuiltinModule === "function" ? process.getBuiltinModule("node:fs") : require("node:fs");
  const __dir = "{{ABSOLUTE_PROJECT_PATH}}/.debug/logs";
  __fs.mkdirSync(__dir, { recursive: true });
  __fs.appendFileSync(
    __dir + "/{{DEBUG_SESSION_ID}}.log",
    JSON.stringify({
      type: "logic",
      location: "{{FILE}}:{{LINE}}",
      message: "{{MESSAGE}}",
      data: {{DATA_SNAPSHOT}},
      timestamp: Date.now()
    }) + "\n"
  );
} catch {}
// #endregion DEBUG
```

### 4.4 Python 服务端

```python
# #region DEBUG [sessionId: {{DEBUG_SESSION_ID}}]
try:
    import json as __json, os as __os, time as __time
    __log_dir = __os.path.join("{{ABSOLUTE_PROJECT_PATH}}", ".debug", "logs")
    __os.makedirs(__log_dir, exist_ok=True)
    with open(__os.path.join(__log_dir, "{{DEBUG_SESSION_ID}}.log"), "a", encoding="utf-8") as __f:
        __f.write(__json.dumps({
            "type": "logic",
            "location": "{{FILE}}:{{LINE}}",
            "message": "{{MESSAGE}}",
            "data": {{DATA_SNAPSHOT}},
            "timestamp": int(__time.time() * 1000)
        }, default=str, ensure_ascii=False) + "\n")
except Exception:
    pass
# #endregion DEBUG
```

### 4.5 其他语言模板（按需读取）
- **Go**：`<skill目录>/references/templates/go.md`
- **Java**：`<skill目录>/references/templates/java.md`
- **Rust**：`<skill目录>/references/templates/rust.md`
- **PHP**：`<skill目录>/references/templates/php.md`
- **Ruby**：`<skill目录>/references/templates/ruby.md`

---

## 5. 日志分析与盲区自检表

当读取 `.debug/logs/<session_id>.log` 分析偏离，或连续 2 轮未抓到异常时，按此表排查盲区：

| 观察到的现象 | 根因诊断与下一步动作 |
| :--- | :--- |
| **入参正常，当前函数输出/状态错误** | **当前函数即为偏离源头**。停止加埋点，直接在此处修复。 |
| **入参进入当前函数时就已经错误** | 源头在**上游**（如 API 响应 `normalize`、Store 初始化、事件派发方），向上游中点二分迁移埋点。 |
| **埋点日志完全没打印出来** | 实际执行根本没走这条调用链（路由/事件绑定指错了函数、前置条件提前 `return`、或跑在另一个进程/缓存命中）。去更顶层入口打 1 个点确认真实分支。 |
| **逻辑日志数据完全正常，但前端显示/交互依然错误** | 根因不在 JS 逻辑，而在 **CSS 布局或 DOM 层级**（如父容器 `flex/grid` 挤压、`overflow: hidden` 裁剪、`pointer-events` 遮挡、`height: auto` 覆盖）。切换为 `4.2 视觉快照模板`。 |
| **注入埋点后偶发/竞态 Bug 突然不复现了（Heisenbug）** | 埋点 I/O 微小耗时改变了异步交错顺序。说明该处存在**未受控的并发竞态**（两个异步任务争抢写同一状态）。无需继续加埋点，直接检查该区域的 `Promise` / `await` / 事件回调，补齐请求序号校验、`AbortController` 取消令牌或串行锁。 |
| **修好 A 处却导致 B 处报错，或多处都在改同一状态** | **属于架构/模块边界缺陷，而非简单 Bug**。立即运行 `cleanup-debug-blocks.js` 清理埋点，转入 `create-plan` 规划单一数据源与模块重构。 |
