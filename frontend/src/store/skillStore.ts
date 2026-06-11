import { create } from "zustand";
import type { ToolStep } from "@/api/backend";

// 一个"技能" = 一个固定形状的 tool 子图（steps + 绑定）+ 它的参数。
// 参数来自子图里的 value 常量节点：调用技能时用实参覆盖这些 value。
// 这是 skill-as-tool 飞轮的固定形状版（无控制流、无 LLM 动态调度）。

export interface SkillParam {
  stepId: string;       // 对应 value 步骤的 id
  name: string;         // 展示名（取自 value 节点标题）
  default: unknown;     // 捕获时的默认值
}

export interface SkillDef {
  id: string;
  name: string;
  createdAt: string;
  steps: ToolStep[];    // 冻结的子图（含 bindings）
  params: SkillParam[];
}

const LS_KEY = "mag.skills";

function load(): SkillDef[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persist(skills: SkillDef[]): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(skills));
  } catch {
    /* localStorage 不可用时静默 */
  }
}

interface SkillState {
  skills: SkillDef[];
  saveSkill: (def: SkillDef) => void;
  removeSkill: (id: string) => void;
}

export const useSkillStore = create<SkillState>((set) => ({
  skills: load(),
  saveSkill: (def) =>
    set((s) => {
      const skills = [...s.skills.filter((k) => k.id !== def.id), def];
      persist(skills);
      return { skills };
    }),
  removeSkill: (id) =>
    set((s) => {
      const skills = s.skills.filter((k) => k.id !== id);
      persist(skills);
      return { skills };
    }),
}));
