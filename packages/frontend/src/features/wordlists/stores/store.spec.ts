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

describe("wordlist mutation queue", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("serializes mutations and coalesces their refresh", async () => {
    const first = deferred<ReturnType<typeof ok<void>>>();
    const setWordlistEnabled = vi
      .fn((_id: string, _enabled: boolean) => first.promise)
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValueOnce(ok(undefined));
    const getWordlists = vi.fn(async () => ok<Wordlist[]>([]));
    sdkHolder.current = {
      backend: { setWordlistEnabled, getWordlists },
    } as unknown as FrontendSDK;
    const store = useWordlistsStore();
    const one: Wordlist = {
      id: "one",
      name: "one.txt",
      enabled: true,
      attackTypes: ["query"],
      status: "active",
    };
    const two: Wordlist = { ...one, id: "two", name: "two.txt" };

    const firstMutation = store.toggle(one);
    const secondMutation = store.toggle(two);
    expect(setWordlistEnabled).toHaveBeenCalledTimes(1);

    first.resolve(ok(undefined));
    await Promise.all([firstMutation, secondMutation]);

    expect(setWordlistEnabled).toHaveBeenCalledTimes(2);
    expect(getWordlists).toHaveBeenCalledTimes(1);
  });
});
