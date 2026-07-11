import type { AttackType } from "shared";

export type WordlistMutation =
  | { type: "import"; filename: string }
  | { type: "toggle"; id: string }
  | { type: "attackTypes"; id: string; attackTypes: AttackType[] }
  | { type: "remove"; id: string }
  | { type: "clear" };
