import { type ApiResult, error, ok } from "shared";

import { toErrorMessage } from "@/shared/utils/backend";

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
