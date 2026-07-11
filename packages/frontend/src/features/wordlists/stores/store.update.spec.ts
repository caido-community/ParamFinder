import type { Wordlist } from "shared";
import { describe, expect, it } from "vitest";

import { initialModel } from "./store.model";
import { update } from "./store.update";

const wordlist: Wordlist = {
  path: "/params.txt",
  enabled: true,
  attackTypes: ["query"],
};

describe("wordlists update", () => {
  it("publishes refreshed rows only after a mutation succeeds", () => {
    const pending = update(initialModel, {
      type: "MUTATION_REQUEST",
      mutation: { type: "toggle", path: wordlist.path },
    });
    expect(pending.mutation).toBeDefined();

    const complete = update(pending, {
      type: "MUTATION_SUCCESS",
      data: [{ ...wordlist, enabled: false }],
    });
    expect(complete.data[0]?.enabled).toBe(false);
    expect(complete.mutation).toBeUndefined();
  });
});
