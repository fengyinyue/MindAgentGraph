# M1：App 布局重构

## 概述

将当前 2 列固定 Grid 布局升级为 4 区可拖拽调整的面板布局。使用 `react-resizable-panels` 实现，左侧面板和底部面板初始为占位组件，后续由 M2/M3 填充内容。

## 状态

- **依赖：** 无
- **影响范围：** [frontend/src/App.tsx](frontend/src/App.tsx) `[修改]`、新增 3 个文件、修改 package.json
- **验收标准：**
  - 4 个面板均可通过拖拽边框调整大小
  - 左侧面板和底部面板可折叠/展开
  - 所有现有功能正常（Toolbar、PlanInput、Canvas 节点操作、NodeInspector 编辑、执行流）
  - 面板折叠/展开状态在会话内保持
  - 浏览器 dev 模式 `npm run dev` 正常运行

---

## 子任务清单

### 1.1 `[新增]` 安装 react-resizable-panels 依赖

- [x] 在 `frontend/` 下执行 `npm install react-resizable-panels`
- [x] 验证 `frontend/package.json` 中已添加依赖（v4.11.1）

**验收：** `npm run dev` 正常启动，无编译错误

---

### 1.2 `[新增]` 创建 panelStore 状态管理

- [x] 新建 `frontend/src/store/panelStore.ts`
- [x] 包含状态字段：
  - `leftOpen: boolean` (默认 true)
  - `leftWidth: number` (默认 280)
  - `rightOpen: boolean` (默认 true)
  - `rightWidth: number` (默认 320)
  - `bottomOpen: boolean` (默认 false，初始折叠)
  - `bottomHeight: number` (默认 200)
- [x] 包含 actions：
  - `toggleLeft()` / `toggleRight()` / `toggleBottom()`
  - `setLeftWidth()` / `setRightWidth()` / `setBottomHeight()`

**验收：** TypeScript 编译通过

---

### 1.3 `[新增]` 创建 LeftPanel 占位组件

- [x] 新建 `frontend/src/components/LeftPanel.tsx`
- [x] 渲染可折叠的左侧面板外壳：
  - 标题栏：显示 "项目浏览器" + 折叠/展开按钮（◀/▶ 图标）
  - 内容区：显示占位文字 "节点树 / 文件 / Agent 列表（即将实现）"
- [x] 接受 props（通过 usePanelStore 读取状态）
- [x] 折叠时：面板收缩为一条竖边 + 展开按钮

**验收：** 面板可折叠/展开

---

### 1.4 `[新增]` 创建 BottomPanel 占位组件

- [x] 新建 `frontend/src/components/BottomPanel.tsx`
- [x] 渲染可折叠的底部面板外壳：
  - 标题栏：显示 Tab 切换（日志 / Agent 通信 / Token），折叠/展开按钮（▲/▼ 图标）
  - 内容区：显示占位文字 "AI 日志 / Agent 通信记录 / Token 统计（即将实现）"
- [x] 接受 props（通过 usePanelStore 读取状态）

**验收：** 面板可折叠/展开，Tab 可点击切换（纯 UI）

---

### 1.5 `[修改]` 重构 App.tsx 布局

- [x] 替换为 `react-resizable-panels` v4 的 `Group` + `Panel` + `Separator` 结构
- [x] 通过 `Panel` 的 `defaultSize` / `minSize` / `maxSize` 控制尺寸：
  - 左侧：minSize=3.5%, defaultSize=20%, maxSize=30%
  - 右侧：minSize=18%, defaultSize=22%, maxSize=40%
  - 底部：minSize=0, defaultSize=0（默认折叠）, maxSize=35%
- [x] `Separator` 样式：hover 高亮(`bg-accent/60`)、active(`bg-accent`)、过渡动画(`transition-colors`)
- [x] 保持 ErrorBoundary 包裹右侧面板
- [x] 保持后端健康检查轮询逻辑不变

**验收：**
- 所有面板可通过拖拽边框调整大小
- 折叠/展开按钮功能正常
- Toolbar、PlanInput、Canvas、NodeInspector 全部正常工作
- 后端健康轮询正常（黄色 "等待后端启动…" 提示可显示）

---

### 1.6 `[修改]` 调整 Toolbar 增加面板切换按钮

- [x] 在 `Toolbar.tsx` 中新增两个切换按钮：
  - "左侧面板" 切换按钮（☰ 图标）
  - "底部面板" 切换按钮（⬡ 图标）
- [x] 按钮调用 `panelStore.toggleLeft()` / `panelStore.toggleBottom()`
- [x] 面板开启时按钮高亮（`text-accent`），关闭时灰色（`text-zinc-500`）

**验收：** 点击按钮可切换面板开关，按钮状态正确反映面板状态

---

### 1.7 集成测试 & 视觉验证

- [x] `npm run dev` 编译通过
- [x] `npx tsc --noEmit` 类型检查通过（零错误）
- [x] `npx vite build` 构建通过
- [x] 验证全流程：前端启动 → 后端健康检查 → 面板折叠/展开

**验收：** 全部通过

---

## 涉及文件清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `frontend/package.json` | 修改 | 添加 react-resizable-panels v4.11.1 |
| `frontend/src/store/panelStore.ts` | 新增 | 面板状态管理 |
| `frontend/src/components/LeftPanel.tsx` | 新增 | 左侧占位面板 |
| `frontend/src/components/BottomPanel.tsx` | 新增 | 底部占位面板 |
| `frontend/src/App.tsx` | 修改 | 布局重构（Grid → react-resizable-panels v4） |
| `frontend/src/components/Toolbar.tsx` | 修改 | 添加面板切换按钮 |

## 技术备注

- 使用的 react-resizable-panels 版本为 v4.11.1（API: `Group`/`Panel`/`Separator`，非 v3 的 `PanelGroup`/`PanelResizeHandle`）
- v4 `Group` 使用 `orientation` 而非 `direction`
- v4 `Panel` 无 `order` prop
- 面板折叠/展开通过 panelStore 控制，LeftPanel 和 BottomPanel 各自读取自己的开闭状态
