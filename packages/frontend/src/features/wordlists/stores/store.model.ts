import type { AttackType, Wordlist } from "shared";

export type WordlistMutation =
  | { type: "import"; filename: string }
  | { type: "toggle"; path: string }
  | { type: "attackTypes"; path: string; attackTypes: AttackType[] }
  | { type: "remove"; path: string }
  | { type: "clear" };

export type WordlistsModel = {
  data: Wordlist[];
  loading: boolean;
  error?: string;
  mutation?: WordlistMutation;
};

export const initialModel: WordlistsModel = {
  data: [],
  loading: false,
};

export type WordlistsMessage =
  | { type: "LOAD_REQUEST" }
  | { type: "LOAD_SUCCESS"; data: Wordlist[] }
  | { type: "LOAD_FAILURE"; error: string }
  | { type: "MUTATION_REQUEST"; mutation: WordlistMutation }
  | { type: "MUTATION_SUCCESS"; data: Wordlist[] }
  | { type: "MUTATION_FAILURE"; error: string };
