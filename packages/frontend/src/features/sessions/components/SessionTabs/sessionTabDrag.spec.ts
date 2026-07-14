import { describe, expect, it } from "vitest";

import {
  findSessionTabDropTarget,
  type SessionTabBounds,
} from "./sessionTabDrag";

const tabs: SessionTabBounds[] = [
  { sessionId: "first", left: 0, right: 100, top: 0, bottom: 30 },
  { sessionId: "second", left: 110, right: 210, top: 0, bottom: 30 },
];

describe("session tab drag targeting", () => {
  it("targets the end from empty space while ignoring the dragged tab", () => {
    expect(
      findSessionTabDropTarget(tabs, "first", { x: 1_000, y: 15 }),
    ).toEqual({ kind: "after", sessionId: "second" });
  });

  it("targets the start from empty space before the tabs", () => {
    expect(
      findSessionTabDropTarget(tabs, "second", { x: -100, y: 15 }),
    ).toEqual({ kind: "before", sessionId: "first" });
  });
});
