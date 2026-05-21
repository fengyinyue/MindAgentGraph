# ProjectExplorer 左侧面板任务

## 目标

把左侧占位面板升级为可用的项目浏览器，使用户能从结构上理解当前 DAG、文件范围和 Agent 类型节点。

## 子任务

- [x] `[new]` 创建 `frontend/src/components/ProjectExplorer.tsx`
  - 验收：包含节点树、文件范围、Agent 三个 Tab。
  - 验收：无节点时显示空态，不报错。

- [x] `[modify]` 将 `LeftPanel.tsx` 改为承载 `ProjectExplorer`
  - 验收：保留折叠/展开行为。
  - 验收：面板关闭后仍有恢复入口。

- [x] `[new]` 实现 DAG 到树列表的纯函数
  - 验收：支持多根节点、孤立节点、循环标记。
  - 验收：函数可单独测试，不依赖 React。

- [x] `[modify]` 接入 `graphStore.selectNode`
  - 验收：点击树节点后右侧检查器切换到对应节点。
  - 验收：当前选中节点在树中高亮。

- [x] `[new]` 实现 FileScope 摘要视图
  - 验收：按节点展示 allow/deny 数量和路径摘要。
  - 验收：空 FileScope 显示为“未限制”。

- [x] `[new]` 实现 Agent 列表视图
  - 验收：筛选 `type === "agent"` 的节点。
  - 验收：MVP 标注为“普通节点执行”，不暴露未实现的 Agent runtime 操作。

## 测试要求

- 节点树生成函数覆盖单根、多根、孤立节点、循环。
- 手测节点选择联动 Canvas / NodeInspector。
- 运行 `npm --prefix frontend run lint`。
