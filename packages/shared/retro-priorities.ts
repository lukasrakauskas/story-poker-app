import type { RetroGroup, RetroNote, RetroRoom } from "./retrospective";

type Target = { id: string; voteCount: number | null } & (
  | { group: RetroGroup }
  | { note: RetroNote }
);

/**
 * The server appends notes in creation order and preserves that array order in
 * snapshots. A theme occupies its earliest constituent note's position. Random
 * IDs identify targets only; they never establish priority between equal votes.
 */
export function retroPriorities(
  room: Pick<RetroRoom, "notes" | "groups">
): (Target & { rank: number; tied: boolean })[] {
  const order = new Map(room.notes.map((note, index) => [note.id, index]));
  const groupOrder = new Map<string, number>();
  room.notes.forEach((note, index) => {
    if (note.groupId && !groupOrder.has(note.groupId))
      groupOrder.set(note.groupId, index);
  });
  const targets: Target[] = [
    ...room.groups.map((group) => ({
      id: group.id,
      voteCount: group.voteCount,
      group,
    })),
    ...room.notes
      .filter((note) => !note.groupId)
      .map((note) => ({ id: note.id, voteCount: note.voteCount, note })),
  ];
  const position = (target: Target) =>
    ("group" in target ? groupOrder.get(target.id) : order.get(target.id)) ??
    Infinity;
  targets.sort(
    (a, b) =>
      (b.voteCount ?? 0) - (a.voteCount ?? 0) || position(a) - position(b)
  );
  let rank = 1;
  return targets.map((target, index) => {
    const votes = target.voteCount ?? 0;
    const samePrevious =
      index > 0 && (targets[index - 1].voteCount ?? 0) === votes;
    const sameNext =
      index + 1 < targets.length &&
      (targets[index + 1].voteCount ?? 0) === votes;
    if (!samePrevious) rank = index + 1;
    return { ...target, rank, tied: samePrevious || sameNext };
  });
}

export function priorityLabel(target: { rank: number; tied: boolean }): string {
  return `Rank ${target.rank}${target.tied ? " (tied)" : ""}`;
}
