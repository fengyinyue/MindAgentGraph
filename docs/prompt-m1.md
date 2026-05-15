# Vibe Coding 执行 Prompt — M1: App 布局重构

> 目标：将 MindAgentGraph 项目的前端从 2 列固定 Grid 布局升级为 4 区可拖拽面板布局。
> 
> 使用时机：将此 Prompt 交给主 Agent，主 Agent 将自动完成全部子任务。

---

## 给主 Agent 的指令

你的任务是完成 MindAgentGraph 项目的 **M1: App 布局重构**。这是整个项目 Phase 1 的第一个模块，不依赖任何其他模块。

### 你的角色

你是**主 Agent**，负责：
1. 按顺序执行下面的子任务
2. 每完成一个子任务，更新 `docs/tasks/app-layout-refactor.md` 中对应的 checkbox 为 `[x]`
3. 更新 `docs/tasks/progress.md` 中 M1 的状态
4. 全部完成后做最终集成验证

由于 M1 范围较小，所有子任务由你直接执行，无需派生子 Agent。

### 重要约束

- 整个过程**不需要人工参与**，遇到问题自行决策
- 使用 `npm` 管理前端依赖（不要用 `uv`，那是 Python 后端用的）
- 项目根目录运行前端：`npm run dev`（在 `frontend/` 子目录中）
- TypeScript 编译检查：`npx tsc --noEmit`
- 代码风格：遵循项目现有模式（Tailwind 暗色主题、React 函数组件、Zustand store）

---

## 项目背景

```
MindAgentGraph/
├── frontend/         ← 工作目录（本次全部改动在此）
│   ├── src/
│   │   ├── App.tsx               ← [修改] 布局重构
│   │   ├── components/
│   │   │   ├── Canvas.tsx         ← [不改] ReactFlow 画布
│   │   │   ├── NodeInspector.tsx  ← [不改] 右侧面板
│   │   │   ├── PlanInput.tsx      ← [不改] 顶部输入栏
│   │   │   ├── Toolbar.tsx        ← [修改] 添加面板切换按钮
│   │   │   └── SettingsPanel.tsx  ← [不改]
│   │   ├── store/
│   │   │   ├── graphStore.ts      ← [不改] 已有状态管理
│   │   │   ├── providerStore.ts   ← [不改]
│   │   │   └── panelStore.ts      ← [新增] 面板状态管理
│   │   ├── api/                   ← [不改]
│   │   └── hooks/                 ← [不改]
│   ├── package.json               ← [修改] 添加 react-resizable-panels
│   └── vite.config.ts             ← [不改]
├── backend/                       ← [不动]
├── shared/                        ← [不动]
└── docs/tasks/
    ├── app-layout-refactor.md     ← [更新] checkbox
    └── progress.md                ← [更新] 状态
```

### 现有前端技术栈

- React 18 + TypeScript + Vite
- Tailwind CSS 3（暗色主题：bg-canvas=#0b0d12, bg-panel=#12151c, accent=#6c8eef）
- @xyflow/react v12（ReactFlow 节点画布）
- Zustand v5（状态管理）
- 路径别名：`@/` → `frontend/src/`, `@shared/` → `shared/`

### 现有 App.tsx 布局（改造前）

```tsx
<div className="h-full grid grid-rows-[auto_auto_1fr] grid-cols-[1fr_320px]">
  <div className="col-span-2"><Toolbar /></div>
  <div className="col-span-2"><PlanInput /></div>
  <div className="bg-canvas relative">
    {/* 后端健康检查轮询 + Canvas */}
  </div>
  <div className="bg-panel border-l border-zinc-800 overflow-hidden">
    <NodeInspector />
  </div>
</div>
```

### 现有 Toolbar.tsx 结构（第 57-113 行）

```tsx
<div className="flex gap-2 items-center px-3 py-1.5 border-b border-zinc-800 bg-canvas text-xs">
  <span className="font-semibold text-accent">MindAgentGraph</span>
  <span className="text-zinc-600">|</span>
  <button>Open</button>
  <button>Save As</button>
  <span className="text-zinc-600">|</span>
  <button>+ Node</button>
  <button>Run DAG</button>
  <span className="text-zinc-600">|</span>
  <button>📁 Project Dir</button>
  <span className="ml-auto">projectPath</span>
  <button>⚙</button>
</div>
```

---

## 子任务 1：安装 react-resizable-panels 依赖

```bash
cd frontend && npm install react-resizable-panels
```

在 `frontend/package.json` 中应看到：
```json
"react-resizable-panels": "^2.x"
```

**完成后：** 在 `docs/tasks/app-layout-refactor.md` 中勾选 1.1。

---

## 子任务 2：创建 panelStore

新建 `frontend/src/store/panelStore.ts`：

```typescript
import { create } from "zustand";

interface PanelState {
  leftOpen: boolean;
  leftWidth: number;
  rightOpen: boolean;
  rightWidth: number;
  bottomOpen: boolean;
  bottomHeight: number;

  toggleLeft: () => void;
  toggleRight: () => void;
  toggleBottom: () => void;
  setLeftWidth: (w: number) => void;
  setRightWidth: (w: number) => void;
  setBottomHeight: (h: number) => void;
}

export const usePanelStore = create<PanelState>((set) => ({
  leftOpen: true,
  leftWidth: 280,
  rightOpen: true,
  rightWidth: 320,
  bottomOpen: false,  // 初始折叠
  bottomHeight: 200,

  toggleLeft: () => set((s) => ({ leftOpen: !s.leftOpen })),
  toggleRight: () => set((s) => ({ rightOpen: !s.rightOpen })),
  toggleBottom: () => set((s) => ({ bottomOpen: !s.bottomOpen })),
  setLeftWidth: (w) => set({ leftWidth: w }),
  setRightWidth: (w) => set({ rightWidth: w }),
  setBottomHeight: (h) => set({ bottomHeight: h }),
}));
```

**验收要点：**
- 文件名 `panelStore.ts`
- 导出的 hook 名为 `usePanelStore`
- 所有 toggle 函数和 setter 函数存在

**完成后：** 勾选 1.2。

---

## 子任务 3：创建 LeftPanel 占位组件

新建 `frontend/src/components/LeftPanel.tsx`：

```tsx
import { usePanelStore } from "@/store/panelStore";

export default function LeftPanel() {
  const leftOpen = usePanelStore((s) => s.leftOpen);
  const toggleLeft = usePanelStore((s) => s.toggleLeft);

  if (!leftOpen) {
    return (
      <div className="bg-panel border-r border-zinc-800 flex flex-col items-center py-2" style={{ width: 32 }}>
        <button
          className="text-zinc-500 hover:text-accent text-sm leading-none"
          onClick={toggleLeft}
          title="展开左侧面板"
        >
          &#9654;
        </button>
      </div>
    );
  }

  return (
    <div className="bg-panel border-r border-zinc-800 flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-zinc-800 text-xs">
        <span className="font-semibold text-zinc-300">项目浏览器</span>
        <button
          className="text-zinc-500 hover:text-accent"
          onClick={toggleLeft}
          title="折叠左侧面板"
        >
          &#9664;
        </button>
      </div>
      <div className="flex-1 flex items-center justify-center text-xs text-zinc-500 p-4">
        节点树 / 文件 / Agent 列表（即将实现）
      </div>
    </div>
  );
}
```

**设计要点：**
- 折叠时显示 32px 宽的竖条 + 展开按钮 ▶
- 展开时显示标题栏 "项目浏览器" + 折叠按钮 ◄
- 使用项目现有的 `bg-panel` / `border-zinc-800` / `text-zinc-*` / `text-accent` 色彩体系
- 占位文字居中灰色显示

**完成后：** 勾选 1.3。

---

## 子任务 4：创建 BottomPanel 占位组件

新建 `frontend/src/components/BottomPanel.tsx`：

```tsx
import { useState } from "react";
import { usePanelStore } from "@/store/panelStore";

type Tab = "logs" | "comm" | "tokens";

export default function BottomPanel() {
  const bottomOpen = usePanelStore((s) => s.bottomOpen);
  const toggleBottom = usePanelStore((s) => s.toggleBottom);
  const [activeTab, setActiveTab] = useState<Tab>("logs");

  const tabs: { key: Tab; label: string }[] = [
    { key: "logs", label: "AI 日志" },
    { key: "comm", label: "Agent 通信" },
    { key: "tokens", label: "Token 使用" },
  ];

  if (!bottomOpen) {
    return (
      <div className="bg-panel border-t border-zinc-800 flex items-center justify-center" style={{ height: 28 }}>
        <button
          className="text-zinc-500 hover:text-accent text-xs"
          onClick={toggleBottom}
          title="展开底部面板"
        >
          &#9650;
        </button>
      </div>
    );
  }

  return (
    <div className="bg-panel border-t border-zinc-800 flex flex-col h-full">
      <div className="flex items-center px-3 py-1 border-b border-zinc-800 text-xs">
        {tabs.map((t) => (
          <button
            key={t.key}
            className={`px-2 py-0.5 rounded ${
              activeTab === t.key
                ? "bg-accent/20 text-accent"
                : "text-zinc-500 hover:text-zinc-300"
            }`}
            onClick={() => setActiveTab(t.key)}
          >
            {t.label}
          </button>
        ))}
        <button
          className="ml-auto text-zinc-500 hover:text-accent"
          onClick={toggleBottom}
          title="折叠底部面板"
        >
          &#9660;
        </button>
      </div>
      <div className="flex-1 flex items-center justify-center text-xs text-zinc-500">
        {activeTab === "logs" && "AI 日志（即将实现）"}
        {activeTab === "comm" && "Agent 通信记录（即将实现）"}
        {activeTab === "tokens" && "Token 统计（即将实现）"}
      </div>
    </div>
  );
}
```

**设计要点：**
- 折叠时显示 28px 高的横条 + 展开按钮 ▲
- 展开时顶部 Tab 切换栏 + 折叠按钮 ▼
- 三个 Tab：AI 日志 / Agent 通信 / Token 使用
- 选中 Tab 有 `bg-accent/20 text-accent` 高亮

**完成后：** 勾选 1.4。

---

## 子任务 5：重构 App.tsx

修改 `frontend/src/App.tsx`，将旧的 Grid 布局替换为 react-resizable-panels。

**5.1 新增 import：**
```tsx
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import LeftPanel from "./components/LeftPanel";
import BottomPanel from "./components/BottomPanel";
```

**5.2 完整 JSX 结构（替换 return 内全部内容）：**

```tsx
<div className="h-full">
  <PanelGroup direction="horizontal">
    {/* ===== 左侧面板 ===== */}
    <Panel defaultSize={20} minSize={3.5} maxSize={30} order={1}>
      <LeftPanel />
    </Panel>

    {/* 只在左侧面板展开时显示拖拽手柄 */}
    <PanelResizeHandle className="w-1 bg-zinc-800 hover:bg-accent/60 active:bg-accent transition-colors cursor-col-resize" />

    {/* ===== 中间 + 底部 ===== */}
    <Panel order={2}>

      <PanelGroup direction="vertical">
        {/* ===== 中间主区域（Toolbar + PlanInput + Canvas）===== */}
        <Panel defaultSize={100} minSize={50} order={1}>
          <div className="h-full flex flex-col">
            <Toolbar />
            <PlanInput />
            <div className="flex-1 bg-canvas relative">
              {!backendReady && (
                <div className="absolute top-2 left-2 z-10 bg-yellow-900/80 text-yellow-200 text-xs px-3 py-1.5 rounded">
                  等待后端启动…
                </div>
              )}
              <ReactFlowProvider>
                <Canvas />
              </ReactFlowProvider>
            </div>
          </div>
        </Panel>

        {/* 底部面板拖拽手柄 */}
        <PanelResizeHandle className="h-1 bg-zinc-800 hover:bg-accent/60 active:bg-accent transition-colors cursor-row-resize" />

        {/* ===== 底部面板 ===== */}
        <Panel defaultSize={0} minSize={0} maxSize={35} order={2}>
          <BottomPanel />
        </Panel>
      </PanelGroup>

    </Panel>

    {/* 右侧面板拖拽手柄 */}
    <PanelResizeHandle className="w-1 bg-zinc-800 hover:bg-accent/60 active:bg-accent transition-colors cursor-col-resize" />

    {/* ===== 右侧面板 ===== */}
    <Panel defaultSize={22} minSize={18} maxSize={40} order={3}>
      <div className="bg-panel border-l border-zinc-800 overflow-hidden h-full">
        <ErrorBoundary>
          <NodeInspector />
        </ErrorBoundary>
      </div>
    </Panel>
  </PanelGroup>
</div>
```

**5.3 关键说明：**

- **不要改动以下已有逻辑：**
  - `useState(false)` 的 `backendReady` 状态
  - `useEffect` 中的健康检查轮询（30 次、500ms 间隔）
  - `ErrorBoundary` 类组件的定义
- **不再需要 `usePanelStore` hook 调用**（面板折叠由 LeftPanel/BottomPanel 自己管理，通过它们各自读取 panelStore）
- **PanelResizeHandle 必须以独立元素放在 Panel 之间，不能放在 Panel 内部**
- **Panel 的 `order` 属性用于键盘无障碍访问，必须唯一**
- **defaultSize 的单位是百分比**：20→约 280px@1400px, 22→约 320px, 0→底部初始折叠
- **RightPanel 不用 LeftPanel 的可折叠模式**（右侧面板始终可见，通过 resize handle 拖拽调整宽度）
- **底部面板 `defaultSize={0}`** 表示默认折叠；当 `bottomOpen=true` 时，用户通过 toggle 展开，实际高度由用户拖拽决定

**5.4 PanelResizeHandle 交互效果（CSS 已内联）：**
- 默认：`bg-zinc-800`（与面板边框一致）
- Hover：`bg-accent/60`（半透明蓝色）
- 拖拽中：`bg-accent`（全亮蓝色）
- 水平手柄：`w-1 cursor-col-resize`
- 垂直手柄：`h-1 cursor-row-resize`
- `transition-colors` 平滑过渡

**5.5 与 LeftPanel/BottomPanel 的展开/折叠联动：**

LeftPanel 和 BottomPanel 各自通过 `usePanelStore` 读取 `leftOpen`/`bottomOpen` 状态并自行渲染展开/折叠 UI。因此 App.tsx 不需要额外条件渲染——LeftPanel 和 BottomPanel 组件始终挂载，自己决定显示什么。

PanelResizeHandle **始终渲染**（即使面板折叠也可拖拽）。这是 react-resizable-panels 的行为：即使 Panel 的 defaultSize=0，ResizeHandle 仍可被拖拽来展开它。

**完成后：** 勾选 1.5。

---

## 子任务 6：修改 Toolbar 添加面板切换按钮

修改 `frontend/src/components/Toolbar.tsx`：

**6.1 新增 import：**
```tsx
import { usePanelStore } from "@/store/panelStore";
```

**6.2 在组件内部新增 hook 调用：**
```tsx
const toggleLeftPanel = usePanelStore((s) => s.toggleLeft);
const toggleBottomPanel = usePanelStore((s) => s.toggleBottom);
const leftOpen = usePanelStore((s) => s.leftOpen);
const bottomOpen = usePanelStore((s) => s.bottomOpen);
```

**6.3 在 Settings 按钮之前（即 projectPath span 之后, ⚙ 按钮之前）新增两个按钮：**
```tsx
<span className="text-zinc-600">|</span>
<button
  className={`text-xs ${leftOpen ? "text-accent" : "text-zinc-500"} hover:text-accent`}
  onClick={toggleLeftPanel}
  title={leftOpen ? "折叠左侧面板" : "展开左侧面板"}
>
  ☰
</button>
<button
  className={`text-xs ${bottomOpen ? "text-accent" : "text-zinc-500"} hover:text-accent`}
  onClick={toggleBottomPanel}
  title={bottomOpen ? "折叠底部面板" : "展开底部面板"}
>
  ⬡
</button>
```

**交互说明：**
- 面板打开时按钮高亮（`text-accent`），关闭时灰色（`text-zinc-500`）
- Hover 时变为 `text-accent`
- 插入位置：projectPath 显示与 ⚙ 设置按钮之间

**完成后：** 勾选 1.6。

---

## 子任务 7：集成验证

依次执行以下检查项：

### 7.1 编译检查
```bash
cd frontend && npx tsc --noEmit
```
所有错误修复完毕（包括新的 tsx 文件类型检查无遗漏）。

### 7.2 启动验证
```bash
# 终端 1：启动后端
cd backend && MAG_PORT=8765 python -m app.main

# 终端 2：启动前端
cd frontend && npm run dev
```
浏览器打开 http://localhost:5173 无白屏。健康检查通过（"等待后端启动…" 提示消失）。

### 7.3 功能回归验证
在浏览器中逐一验证：
- [ ] Toolbar 上新增的 ☰ 和 ⬡ 按钮可见
- [ ] 点击 ☰ → 左侧面板折叠/展开
- [ ] 点击 ⬡ → 底部面板展开/折叠
- [ ] 按钮高亮状态与面板开闭一致
- [ ] 拖拽左侧面板边框 → 面板宽度变化，Canvas 自适应
- [ ] 拖拽右侧面板边框 → 面板宽度变化
- [ ] 拖拽底部面板上边框 → 面板高度变化
- [ ] 折叠所有面板 → Canvas 占据全部空间
- [ ] 节点操作正常：+Node 添加节点、右键菜单、连线拖拽、删除
- [ ] AI 规划正常：输入目标 → 生成节点树
- [ ] 节点执行正常：Explain 和 Code 按钮功能
- [ ] Settings 面板正常弹出和关闭
- [ ] Open/Save 按钮正常（浏览器模式会提示不可用，属预期行为）

### 7.4 最终更新
更新 `docs/tasks/app-layout-refactor.md` 全部 checkbox 为 `[x]`。
更新 `docs/tasks/progress.md` M1 完成状态为 `✅ 已完成`，并填写完成日期。

---

## 最终验收标准

| 项 | 标准 |
|----|------|
| TypeScript | `npx tsc --noEmit` 零错误 |
| 布局 | 4 区面板均可拖拽调整 |
| 折叠 | 左/下面板可独立折叠展开 |
| 回归 | Toolbar/PlanInput/Canvas/NodeInspector 全部功能正常 |
| 代码 | 无 console.log/console.error 残留 |
