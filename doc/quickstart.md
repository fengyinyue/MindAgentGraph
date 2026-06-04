# Quickstart

两条路：
- **A. 浏览器 dev 模式** — 不装 Rust，立即体验 MVP 闭环（推荐先走这条）
- **B. Tauri 桌面模式** — 完整体验，需要装 Rust

---

## A. 浏览器 dev 模式（无需 Rust）

适合：第一次跑、验证 MVP 闭环（一句话 → 节点树）。
Open/Save As 可用：浏览器 dev 模式会使用 Chrome/Edge 的目录选择授权读取或写入 `.mag` 工程目录；不支持该 API 的浏览器需要改用 Tauri 桌面模式。

### 一次性准备

```bash
# 前端依赖（已装过可跳过）
cd frontend
npm install

# 后端依赖（已装过可跳过）
cd ../backend
uv venv --python 3.13
uv pip install -e .
```

### 每次启动

**Windows 双击运行**：双击仓库根目录的 [start-dev.bat](../start-dev.bat)。
启动时会自动清理上次遗留在 1420/8765 端口的孤儿进程，所以可以放心地"上次直接关窗、这次再双击"。

**或终端**：
```bash
npm run dev
```

两种方式都会同时启动：
- 后端 FastAPI（`http://127.0.0.1:8765`，标签 `[backend]`）
- 前端 Vite（`http://localhost:1420`，标签 `[frontend]`）

两边都 ready 后自动打开默认浏览器。

**停止**：
- `Ctrl+C` —— 优雅停止，同时杀两个子进程（推荐）
- 直接关闭 cmd 窗口 —— 可能留下孤儿进程占着 1420/8765；下次双击 .bat 会自动清

```bash
npm run dev -- --no-open    # 不自动开浏览器
npm run dev:backend         # 只起后端（IDE 单独跑 Vite 时用）
npm run dev:frontend        # 只起前端
```

### 手动两终端模式（备选）

如果一键脚本出问题想隔离排查：

**终端 1 — 后端**：
```bash
cd backend
MAG_PORT=8765 ./.venv/Scripts/python.exe -m app.main
# Linux/macOS: MAG_PORT=8765 ./.venv/bin/python -m app.main
```

**终端 2 — 前端**：
```bash
cd frontend
npm run dev
```

### 验证

1. 浏览器打开 `http://localhost:1420`
2. 顶部输入框：`做一个 RPG 游戏的城市生成器`
3. 点 `Generate` → 画布出现 5 个节点连接（`root → design / data → impl → test`）
4. 点击节点 → 右侧面板显示 type / contextMode / fileScope / data

### 配置真实模型 Key（可选）

**最简单**：双击 [start-dev.bat](../start-dev.bat) 启动后，点工具栏右侧 **⚙ 齿轮**，在抽屉里填 key，Save 即可。
Key 仅保存在浏览器 localStorage（不进 .mag 工程文件、不上传），调用 /plan 时通过 `X-Provider-Key` header 一次性发给本地后端。

不配 key 时 [planner.py](../backend/app/services/planner.py) 自动 fallback 到离线 demo（5 节点示例图），UI 流程仍可演示。
key 错误（401/404 等认证失败）也会 fallback，并在后端日志里打 `[planner] provider=X fell back to offline demo: ...`。

如果不想用 UI、想用 env 变量也可以：

支持的 provider（前端输入框左侧的下拉选）：

| provider | 环境变量 | 默认 model | 说明 |
|---|---|---|---|
| `anthropic` | `ANTHROPIC_API_KEY` | `claude-sonnet-4-6` | 工具调用强约束 |
| `deepseek` | `DEEPSEEK_API_KEY` | `deepseek-v4-flash` | OpenAI 兼容端点，默认使用 V4 Flash |

```bash
# Windows PowerShell — 配置任意一个或两个
$env:ANTHROPIC_API_KEY = "sk-ant-..."
$env:DEEPSEEK_API_KEY  = "sk-..."
$env:MAG_PORT = "8765"
./.venv/Scripts/python.exe -m app.main

# bash
export ANTHROPIC_API_KEY="sk-ant-..."
export DEEPSEEK_API_KEY="sk-..."
MAG_PORT=8765 ./.venv/Scripts/python.exe -m app.main

# 也可以改默认 provider（前端不指定时用谁）
export MAG_PROVIDER=deepseek
```

请求体也可以覆盖默认：
```json
POST /plan  { "goal": "...", "provider": "deepseek", "model": "deepseek-v4-flash" }
```

---

## B. Tauri 桌面模式（完整体验）

需要装：**Rust + 平台 build deps**。

### 1. 装 Rust

Windows：
```powershell
# 下载 rustup-init.exe 并运行：https://win.rustup.rs/x86_64
# 或用 winget：
winget install Rustlang.Rustup
rustup default stable
```

Tauri 还需要 **Visual Studio Build Tools 2022 (Desktop development with C++)** —
体积约 6GB。装完重启终端，验证：
```bash
rustc --version
cargo --version
```

macOS：
```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
xcode-select --install
```

Linux (Ubuntu)：
```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
```

### 2. Tauri 图标占位

`src-tauri/icons/` 目前不存在。从 Tauri 官方仓库拷一份默认图标：
[tauri-apps/tauri/examples/api/src-tauri/icons](https://github.com/tauri-apps/tauri/tree/dev/examples/api/src-tauri/icons)
要的文件：`32x32.png`, `128x128.png`, `icon.ico`, `icon.icns`。

### 3. 启动

```bash
cd src-tauri
cargo tauri dev
```

第一次会编译 Rust 依赖，5–15 分钟。后续增量编译秒级。
Tauri 会自动 `npm run dev`（前端）+ 自动 spawn `python -m app.main`（后端，dev 回退路径），所以**只需一个终端**。

### 4. 打包发布

打包前先做 Python sidecar：

```bash
cd backend
uv pip install -e ".[dev]"   # 装 pyinstaller
pyinstaller build_sidecar.spec
# 产物：backend/dist/mag-backend.exe
```

按 Tauri 命名约定放进 `src-tauri/binaries/`：

| 平台 | 文件名 |
|---|---|
| Windows x64 | `mag-backend-x86_64-pc-windows-msvc.exe` |
| macOS Intel | `mag-backend-x86_64-apple-darwin` |
| macOS Apple Silicon | `mag-backend-aarch64-apple-darwin` |
| Linux x64 | `mag-backend-x86_64-unknown-linux-gnu` |

然后：
```bash
cd src-tauri
cargo tauri build
```

---

## 故障排查

**Vite 报 "Port 1420 is already in use"**：上次进程没退干净。
```bash
# Windows
netstat -ano | grep ":1420" | awk '{print $NF}' | sort -u | xargs -I{} taskkill //F //PID {}
```

**前端"等待后端启动…"卡死**：
- 浏览器 dev 模式：检查 `frontend/.env.development` 的 `VITE_BACKEND_PORT` 与后端 `MAG_PORT` 一致
- Tauri 模式：看 `cargo tauri dev` 终端的 `[backend]` 日志

**`/plan` 返回 500**：检查 `ANTHROPIC_API_KEY` 是否过期。不配 key 也应有 demo 数据，仍 500 看 stderr 异常栈。

**curl 测 /plan 用中文报 "error parsing the body"**：Windows 终端 cp936 把 UTF-8 字节搞乱了。改用浏览器或 Python 的 `urllib` 测，不是后端问题。

**画布显示空白**：F12 看 Network 面板的 `/plan` 响应。状态 200 但画布空 → 看 Console 报错；状态非 200 → 后端日志。
