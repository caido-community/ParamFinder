import type { SettingsMessage, SettingsModel } from "./store.model";

export function update(
  model: SettingsModel,
  message: SettingsMessage,
): SettingsModel {
  switch (message.type) {
    case "LOAD_REQUEST":
      return { ...model, loading: true, error: undefined };
    case "LOAD_SUCCESS":
      return {
        ...model,
        data: message.data,
        path: message.path,
        loading: false,
        error: undefined,
      };
    case "LOAD_FAILURE":
      return { ...model, loading: false, error: message.error };
    case "SAVE_REQUEST":
      return { ...model, saving: true, error: undefined };
    case "SAVE_SUCCESS":
      return {
        ...model,
        data: message.data,
        saving: false,
        error: undefined,
      };
    case "SAVE_FAILURE":
      return { ...model, saving: false, error: message.error };
  }
}
