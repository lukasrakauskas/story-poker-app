import { actionOwnerLabel, type RetroRoom } from "shared/retrospective";
import { publicRetro } from "./retro-history";
import { retroPriorities, priorityLabel } from "shared/retro-priorities";

function rankedLines(room: RetroRoom, markdown: boolean): string[] {
  const escape = markdown ? escapeMarkdown : (text: string) => text;
  const lines = [
    "",
    markdown ? "## Discussion priorities" : "Discussion priorities",
  ];
  for (const target of retroPriorities(room)) {
    lines.push(
      "",
      `${markdown ? "### " : ""}${"group" in target ? escape(target.group.title) : priorityLabel(target)} · ${target.voteCount ?? 0} votes`
    );
    if ("group" in target) lines.push(priorityLabel(target));
    const notes =
      "group" in target
        ? room.notes.filter((note) => note.groupId === target.id)
        : [target.note];
    for (const note of notes)
      lines.push(`- ${escape(note.text)} — ${escape(note.authorName)}`);
  }
  return lines;
}

const columns = [
  { id: "went-well", title: "Went well" },
  { id: "improve", title: "To improve" },
  { id: "ideas", title: "Ideas" },
] as const;

function escapeMarkdown(value: string): string {
  // Escape syntax before adding our own HTML line breaks. User HTML and entities
  // remain literal text; newlines cannot create headings, lists, or code blocks.
  return value
    .replace(/[\\`*_{}[\]()#+\-.!|~]/g, "\\$&")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/\r\n?|\n/g, "<br>");
}

export function roomAsMarkdown(
  room: RetroRoom,
  viewerId?: string | null
): string {
  const snapshot = publicRetro(room, viewerId);
  const lines = [
    `# ${escapeMarkdown(snapshot.title)}`,
    "",
    `- Room: ${escapeMarkdown(snapshot.code)}`,
    `- Phase: ${escapeMarkdown(snapshot.phase)}`,
    `- Expires: ${new Date(snapshot.expiresAt).toISOString()}`,
    "",
    "## Participants",
    ...snapshot.members.map(
      (member) =>
        `- ${escapeMarkdown(member.name)}${member.moderator ? " (moderator)" : ""}`
    ),
  ];
  if (snapshot.phase === "discuss" || snapshot.phase === "closed") {
    lines.push(...rankedLines(snapshot, true));
  } else {
    if (snapshot.groups.length) {
      lines.push("", "## Themes");
      for (const group of [...snapshot.groups].sort(
        (a, b) => (b.voteCount ?? -1) - (a.voteCount ?? -1)
      )) {
        const votes =
          group.voteCount === null ? "" : ` · ${group.voteCount} votes`;
        lines.push("", `### ${escapeMarkdown(group.title)}${votes}`);
        for (const note of snapshot.notes.filter(
          (item) => item.groupId === group.id
        ))
          lines.push(
            `- ${escapeMarkdown(note.text)} — ${escapeMarkdown(note.authorName)}`
          );
      }
    }
    for (const column of columns) {
      lines.push("", `## ${column.title}`);
      for (const note of snapshot.notes
        .filter((item) => !item.groupId && item.column === column.id)
        .sort((a, b) => (b.voteCount ?? -1) - (a.voteCount ?? -1))) {
        const author = note.authorName;
        const votes =
          note.voteCount === null ? "" : `**${note.voteCount} votes** · `;
        lines.push(
          `- ${votes}${escapeMarkdown(note.text)} — ${escapeMarkdown(author)}`
        );
      }
    }
  }
  lines.push(
    "",
    "## Action items",
    ...snapshot.actions.map(
      (action) =>
        `- [${action.done ? "x" : " "}] ${escapeMarkdown(action.text)} — Owner: ${escapeMarkdown(actionOwnerLabel(action.owner))}`
    )
  );
  return `${lines.join("\n")}\n`;
}

export function roomAsText(room: RetroRoom, viewerId?: string | null): string {
  const snapshot = publicRetro(room, viewerId);
  const lines = [
    snapshot.title,
    `Room: ${snapshot.code} | Phase: ${snapshot.phase}`,
    `Expires: ${new Date(snapshot.expiresAt).toISOString()}`,
    "",
    "People",
    ...snapshot.members.map(
      (member) => `- ${member.name}${member.moderator ? " (moderator)" : ""}`
    ),
  ];
  if (snapshot.phase === "discuss" || snapshot.phase === "closed") {
    lines.push(...rankedLines(snapshot, false));
  } else {
    if (snapshot.groups.length) {
      lines.push("", "Themes");
      for (const group of [...snapshot.groups].sort(
        (a, b) => (b.voteCount ?? -1) - (a.voteCount ?? -1)
      )) {
        const votes =
          group.voteCount === null ? "" : ` [${group.voteCount} votes]`;
        lines.push("", `${group.title}${votes}`);
        for (const note of snapshot.notes.filter(
          (item) => item.groupId === group.id
        ))
          lines.push(`- ${note.text} — ${note.authorName}`);
      }
    }
    for (const column of columns) {
      lines.push("", column.title);
      for (const note of snapshot.notes
        .filter((item) => !item.groupId && item.column === column.id)
        .sort((a, b) => (b.voteCount ?? -1) - (a.voteCount ?? -1))) {
        const author = note.authorName;
        const votes =
          note.voteCount === null ? "" : `[${note.voteCount} votes] `;
        lines.push(`- ${votes}${note.text} — ${author}`);
      }
    }
  }
  lines.push(
    "",
    "Action items",
    ...snapshot.actions.map(
      (action) =>
        `- [${action.done ? "x" : " "}] ${action.text} — ${actionOwnerLabel(action.owner)}`
    )
  );
  return lines.join("\n");
}
