import { createPinia, setActivePinia } from "pinia";
import { ok, type Wordlist } from "shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useWordlistsStore } from "./store";

import type { FrontendSDK } from "@/types";

const sdkHolder = vi.hoisted(() => ({
  current: undefined as FrontendSDK | undefined,
}));

vi.mock("@/plugins/sdk", () => ({
  useSDK: () => sdkHolder.current,
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

describe("wordlist mutations", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("rejects a concurrent mutation instead of queuing stale input", async () => {
    const first = deferred<ReturnType<typeof ok<void>>>();
    const setWordlistEnabled = vi
      .fn((_id: string, _enabled: boolean) => first.promise)
      .mockImplementationOnce(() => first.promise);
    const getWordlists = vi.fn(async () => ok<Wordlist[]>([]));
    sdkHolder.current = {
      backend: { setWordlistEnabled, getWordlists },
    } as unknown as FrontendSDK;
    const store = useWordlistsStore();
    const one: Wordlist = {
      path: "/one.txt",
      enabled: true,
      attackTypes: ["query"],
    };
    const two: Wordlist = { ...one, path: "/two.txt" };

    const firstMutation = store.toggle(one);
    const secondMutation = await store.toggle(two);
    expect(setWordlistEnabled).toHaveBeenCalledTimes(1);
    expect(secondMutation).toMatchObject({
      success: false,
      error: { code: "CONFLICT" },
    });

    first.resolve(ok(undefined));
    await firstMutation;

    expect(setWordlistEnabled).toHaveBeenCalledTimes(1);
    expect(getWordlists).toHaveBeenCalledTimes(1);
  });
});
