import type { WordlistsMessage, WordlistsModel } from "./store.model";

export function update(
  model: WordlistsModel,
  message: WordlistsMessage,
): WordlistsModel {
  switch (message.type) {
    case "LOAD_REQUEST":
      return { ...model, loading: true, error: undefined };
    case "LOAD_SUCCESS":
      return { ...model, data: message.data, loading: false, error: undefined };
    case "LOAD_FAILURE":
      return { ...model, loading: false, error: message.error };
    case "MUTATION_REQUEST":
      return { ...model, mutation: message.mutation, error: undefined };
    case "MUTATION_SUCCESS":
      return {
        ...model,
        data: message.data,
        mutation: undefined,
        error: undefined,
      };
    case "MUTATION_FAILURE":
      return { ...model, mutation: undefined, error: message.error };
  }
}
