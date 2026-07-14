import type { Settings } from "shared";

export type SettingsModel = {
  data?: Settings;
  path: string;
  loading: boolean;
  saving: boolean;
  error?: string;
};

export const initialModel: SettingsModel = {
  path: "",
  loading: false,
  saving: false,
};

export type SettingsMessage =
  | { type: "LOAD_REQUEST" }
  | { type: "LOAD_SUCCESS"; data: Settings; path: string }
  | { type: "LOAD_FAILURE"; error: string }
  | { type: "SAVE_REQUEST" }
  | { type: "SAVE_SUCCESS"; data: Settings }
  | { type: "SAVE_FAILURE"; error: string };
