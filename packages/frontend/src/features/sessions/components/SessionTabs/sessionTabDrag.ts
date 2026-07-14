export type SessionTabDropTarget =
  | { kind: "before"; sessionId: string }
  | { kind: "after"; sessionId: string };

export type SessionTabBounds = {
  sessionId: string;
  left: number;
  right: number;
  top: number;
  bottom: number;
};

const distanceFromRange = (value: number, start: number, end: number) => {
  if (value < start) return start - value;
  if (value > end) return value - end;
  return 0;
};

export function findSessionTabDropTarget(
  tabs: SessionTabBounds[],
  draggedSessionId: string,
  pointer: { x: number; y: number },
): SessionTabDropTarget | undefined {
  let nearest: SessionTabBounds | undefined;
  let nearestDistance = Number.POSITIVE_INFINITY;

  for (const tab of tabs) {
    if (tab.sessionId === draggedSessionId) continue;

    const horizontalDistance = distanceFromRange(
      pointer.x,
      tab.left,
      tab.right,
    );
    const verticalDistance = distanceFromRange(pointer.y, tab.top, tab.bottom);
    const distance = horizontalDistance ** 2 + verticalDistance ** 2;
    if (distance < nearestDistance) {
      nearest = tab;
      nearestDistance = distance;
    }
  }

  if (nearest === undefined) return undefined;

  return {
    kind: pointer.x < (nearest.left + nearest.right) / 2 ? "before" : "after",
    sessionId: nearest.sessionId,
  };
}
