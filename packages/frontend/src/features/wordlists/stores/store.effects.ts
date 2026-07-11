import {
  type ApiResult,
  type AttackType,
  error,
  ok,
  type Wordlist,
} from "shared";

import type { WordlistMutation, WordlistsMessage } from "./store.model";

import { toErrorMessage } from "@/shared/utils/backend";
import type { FrontendSDK } from "@/types";

const REMOTE_TIMEOUT_MS = 30_000;
const MAX_REMOTE_BYTES = 10 * 1024 * 1024;

export async function fetchRemoteWordlist(
  url: string,
  fetcher: typeof fetch = fetch,
): Promise<ApiResult<string>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REMOTE_TIMEOUT_MS);
  try {
    const response = await fetcher(url, { signal: controller.signal });
    if (!response.ok) {
      return error(`Failed to fetch ${url}: ${response.status}`, "IO");
    }
    const declaredSize = Number(response.headers.get("content-length") ?? 0);
    if (declaredSize > MAX_REMOTE_BYTES) {
      return error("Remote wordlist exceeds the 10 MiB limit.", "VALIDATION");
    }
    if (response.body === null) {
      const data = await response.arrayBuffer();
      if (data.byteLength > MAX_REMOTE_BYTES) {
        return error("Remote wordlist exceeds the 10 MiB limit.", "VALIDATION");
      }
      return ok(new TextDecoder().decode(data));
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let bytes = 0;
    let content = "";
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) {
        break;
      }
      bytes += chunk.value.byteLength;
      if (bytes > MAX_REMOTE_BYTES) {
        await reader.cancel();
        return error("Remote wordlist exceeds the 10 MiB limit.", "VALIDATION");
      }
      content += decoder.decode(chunk.value, { stream: true });
    }
    content += decoder.decode();
    return ok(content);
  } catch (err: unknown) {
    const message =
      err instanceof DOMException && err.name === "AbortError"
        ? "Remote wordlist download timed out after 30 seconds."
        : toErrorMessage(err);
    return error(message, "IO");
  } finally {
    clearTimeout(timeout);
  }
}

export const importTextWordlist = (
  sdk: FrontendSDK,
  filename: string,
  content: string,
) => sdk.backend.importWordlist(content, filename);

export async function importRemoteWordlist(
  sdk: FrontendSDK,
  filename: string,
  url: string,
) {
  const download = await fetchRemoteWordlist(url);
  return download.success
    ? sdk.backend.importWordlist(download.value, filename)
    : download;
}

export const setWordlistEnabled = (sdk: FrontendSDK, wordlist: Wordlist) =>
  sdk.backend.setWordlistEnabled(wordlist.path, !wordlist.enabled);

export const setWordlistAttackTypes = (
  sdk: FrontendSDK,
  path: string,
  attackTypes: AttackType[],
) => sdk.backend.setWordlistAttackTypes(path, attackTypes);

export const deleteWordlist = (sdk: FrontendSDK, path: string) =>
  sdk.backend.deleteWordlist(path);

export const clearWordlists = (sdk: FrontendSDK) =>
  sdk.backend.clearWordlists();

type Dispatch = (message: WordlistsMessage) => void;

export async function loadWordlists(
  sdk: FrontendSDK,
  dispatch: Dispatch,
): Promise<ApiResult<Wordlist[]>> {
  dispatch({ type: "LOAD_REQUEST" });
  try {
    const result = await sdk.backend.getWordlists();
    if (result.success) {
      dispatch({ type: "LOAD_SUCCESS", data: result.value });
    } else {
      dispatch({ type: "LOAD_FAILURE", error: result.error.message });
    }
    return result;
  } catch (cause: unknown) {
    const message = toErrorMessage(cause);
    dispatch({ type: "LOAD_FAILURE", error: message });
    return error(message);
  }
}

export async function runWordlistMutation(
  sdk: FrontendSDK,
  dispatch: Dispatch,
  mutation: WordlistMutation,
  request: () => Promise<ApiResult<unknown>>,
): Promise<ApiResult<void>> {
  dispatch({ type: "MUTATION_REQUEST", mutation });
  try {
    const result = await request();
    if (!result.success) {
      dispatch({ type: "MUTATION_FAILURE", error: result.error.message });
      return result;
    }
    const refreshed = await sdk.backend.getWordlists();
    if (!refreshed.success) {
      dispatch({ type: "MUTATION_FAILURE", error: refreshed.error.message });
      return refreshed;
    }
    dispatch({ type: "MUTATION_SUCCESS", data: refreshed.value });
    return ok(undefined);
  } catch (cause: unknown) {
    const message = toErrorMessage(cause);
    dispatch({ type: "MUTATION_FAILURE", error: message });
    return error(message);
  }
}
