你是一个资深 AI 工程师 + 产品架构师，请帮我开发一个：

“节点式 AI 创作规划工具（AI Node Planning System）”

目标：  
不是传统聊天 AI，而是一个用于“辅助 AI 长期规划复杂项目”的可视化节点系统。

核心理念：

- 节点不是执行代码，而是 AI 的“思维结构”
    
- 每个节点代表一个独立任务、模块、Agent 或系统
    
- AI 在节点范围内工作，而不是污染整个工程
    
- 用节点管理 AI 的上下文、记忆、目标、文件范围、依赖关系
    

产品定位：  
类似：

- Unreal Blueprint
    
- Houdini
    
- ComfyUI
    
- Notion
    
- AI Agent  
    的融合体。
    

# 核心功能

## 1. 节点系统

支持：

- 创建节点
    
- 节点连接
    
- 拖拽
    
- 分组
    
- 注释
    
- 折叠
    
- 子图（SubGraph）
    
- 无限画布
    

节点类型：

- Prompt节点
    
- Planning节点
    
- Memory节点
    
- File Scope节点
    
- Code节点
    
- API节点
    
- Asset节点
    
- Agent节点
    
- Task节点
    
- Semantic节点
    

---

## 2. AI上下文管理（核心）

每个节点拥有：

- 独立 Prompt
    
- 独立 Memory
    
- 独立 Rules
    
- 独立文件范围
    
- 独立资源访问权限
    

例如：

RoadGenerator:  
可访问：  
/Road/*  
/PCG/*

禁止访问：  
/NPC/*  
/UI/*

AI 只能在当前节点上下文工作。

---

## 3. Agent系统

支持：

- 一个节点 = 一个Agent
    
- 多Agent协作
    
- 总控Agent调度
    
- Agent消息通信
    
- Agent任务分发
    

例如：

- 路网Agent
    
- 建筑Agent
    
- NPC Agent
    
- 剧情Agent
    
- 音频Agent
    

---

## 4. AI规划能力

AI 不直接生成代码。

而是：

- 先生成系统结构
    
- 再拆分节点
    
- 再生成子任务
    
- 再生成代码
    

例如：

CityGenerator  
├── Terrain  
├── Road  
├── Plot  
├── Building  
├── NPC  
└── Traffic

---

## 5. 多模态资源管理

节点支持绑定：

- 图片
    
- 视频
    
- 音频
    
- 文档
    
- Prompt
    
- 参考资料
    
- 3D资源
    

---

## 6. 游戏开发支持（重点）

重点支持：

- Unreal Engine
    
- Houdini
    
- PCG
    
- Blueprint
    
- Behavior Tree
    
- State Machine
    

未来支持：

- 自动生成 Blueprint
    
- 自动生成 PCG Graph
    
- 自动生成行为树
    

---

# UI设计

布局：

左侧：

- 节点树
    
- 项目结构
    
- Agent列表
    

中间：

- 无限画布
    
- 节点编辑区
    
- AI工作流
    

右侧：

- 当前节点上下文
    
- Memory
    
- Prompt
    
- 文件范围
    
- AI推理过程
    
- 资源管理
    

底部：

- AI日志
    
- Agent通信
    
- Token使用情况
    

风格：

- 黑色科技感
    
- 类似 UE Blueprint + Notion + Figma
    
- 节点连接线有动态流动效果
    

---

# 技术架构建议

前端：

- React
    
- TypeScript
    
- Tailwind
    
- React Flow（节点系统）
    
- Zustand（状态管理）
    

后端：

- Python FastAPI  
    或
    
- Node.js
    

AI：  
支持：

- Claude
    
- OpenAI
    
- DeepSeek
    
- Gemini
    

支持：

- 多模型切换
    
- Agent路由
    
- Prompt编排
    

---

# 高级功能（未来）

- Semantic Map
    
- 长期记忆系统
    
- 自动项目拆分
    
- AI自我反思
    
- 节点自动生成
    
- 自动上下文压缩
    
- MCP工具系统
    
- Git工程理解
    
- 自动代码修复
    
- AI任务队列
    

---

# 目标体验

用户不是“聊天”。

而是在：

- 搭建 AI 思维结构
    
- 管理 AI 工作流
    
- 控制 AI Agent
    
- 组织大型创作项目
    

让整个系统像：

“AI 时代的 Unreal Blueprint + Notion + Agent OS”

请先：

1. 设计整体架构
    
2. 设计节点数据结构
    
3. 设计 AI Context System
    
4. 设计 Agent Communication
    
5. 设计前后端目录结构
    
6. 给出 MVP 版本
    
7. 给出后续可扩展方向
    
8. 生成技术实现方案
    
9. 生成 UI 页面结构
    
10. 生成开发优先级路线图