# MindAgentGraph

节点式 AI 创作规划工具 — 把节点作为 AI 的"思维单元"，让 AI 在节点边界内工作而不污染全局上下文。

定位：**AI 时代的项目规划脚手架**（Unreal Blueprint × Notion × Agent OS）。

## 架构

- **Tauri 2.x** 桌面壳（Rust）
- **React + @xyflow/react + Zustand + Tailwind** 前端
- **FastAPI** Python 后端（PyInstaller 打包为 Tauri sidecar）
- **Anthropic Claude** AI 引擎（Sonnet 4.6 / Opus 4.7）
- **`.mag` 工程文件夹** 本地存储，Git 友好

## 目录

- [src-tauri/](src-tauri/) — Tauri Rust 主进程
- [frontend/](frontend/) — React 前端
- [backend/](backend/) — FastAPI 后端
- [shared/](shared/) — 跨语言 JSON Schema 与 TS 类型
- [docs/](docs/) — 设计文档

## MVP 目标

输入一句话 → AI 自动生成节点树/DAG → 在节点内继续展开工作。

## 快速开始

详见 [docs/quickstart.md](docs/quickstart.md)（开发中）。
