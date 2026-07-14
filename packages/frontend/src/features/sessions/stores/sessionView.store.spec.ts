import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";

import { useSessionViewStore } from "./sessionView.store";

describe("session view store", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("clears request-local state when the active selection changes", () => {
    const store = useSessionViewStore();
    store.setActiveSession("session");
    store.setSelectedFinding("request", "finding");
    store.startRequestDetail("request");

    store.setSelectedRequest("other-request");

    expect(store.activeSessionId).toBe("session");
    expect(store.selectedRequestId).toBe("other-request");
    expect(store.selectedFindingKey).toBeUndefined();
    expect(store.requestDetails).toEqual({});
  });

  it("moves session tabs before and after drop targets", () => {
    const store = useSessionViewStore();

    store.moveSessionTab(["a", "b", "c"], "a", "c", "after");
    expect(store.sessionTabOrder).toEqual(["b", "c", "a"]);

    store.moveSessionTab(store.sessionTabOrder, "a", "b", "before");
    expect(store.sessionTabOrder).toEqual(["a", "b", "c"]);
  });
});
