import type { RetroNote, RetroRoom } from "./retrospective.js";

type Target = {
  id: string;
  voteCount: number | null;
  note: RetroNote;
  notes: RetroNote[];
};

/** Keep unnamed stacks together as one discussion target. */
function discussionTargets(room: Pick<RetroRoom, "notes">): Target[] {
  const seen = new Set<string>();
  const targets: Target[] = [];
  for (const note of room.notes) {
    if (!note.stackId) {
      targets.push({
        id: note.id,
        voteCount: note.voteCount,
        note,
        notes: [note],
      });
      continue;
    }
    if (seen.has(note.stackId)) continue;
    seen.add(note.stackId);
    const notes = room.notes.filter(
      (candidate) => candidate.stackId === note.stackId
    );
    targets.push({
      id: note.id,
      voteCount: notes.some((candidate) => candidate.voteCount === null)
        ? null
        : notes.reduce(
            (total, candidate) => total + (candidate.voteCount ?? 0),
            0
          ),
      note,
      notes,
    });
  }
  return targets;
}

/**
 * Notes and unnamed stacks retain the moderator's lane order. Aggregated vote
 * totals determine discussion ranking; ties keep that authoritative order.
 */
export function retroPriorities(
  room: Pick<RetroRoom, "notes">
): (Target & { rank: number; tied: boolean })[] {
  const targets = discussionTargets(room);
  const order = new Map(room.notes.map((note, index) => [note.id, index]));
  targets.sort(
    (a, b) =>
      (b.voteCount ?? 0) - (a.voteCount ?? 0) ||
      (order.get(a.id) ?? Infinity) - (order.get(b.id) ?? Infinity)
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
