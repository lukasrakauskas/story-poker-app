import {
  actionOwnerLabel,
  retroPublicRoomSchema,
  type RetroRoom,
} from "shared/retrospective";
import { publicRetro } from "./retro-history";
import { retroPriorities, priorityLabel } from "shared/retro-priorities";

function rankedLines(room: RetroRoom, markdown: boolean): string[] {
  const escape = markdown ? escapeMarkdown : (text: string) => text;
  const lines = [
    "",
    markdown ? "## Discussion priorities" : "Discussion priorities",
  ];
  for (const target of retroPriorities(room)) {
    const grouped =
      target.notes.length > 1
        ? ` · ${target.notes.length} grouped messages`
        : "";
    lines.push(
      "",
      `${markdown ? "### " : ""}${priorityLabel(target)} · ${target.voteCount ?? 0} votes${grouped}`,
      ...target.notes.map(
        (note) => `- ${escape(note.text)} — ${escape(note.authorName)}`
      )
    );
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
  const snapshot = retroPublicRoomSchema.parse(publicRetro(room, viewerId));
  const lines = [
    `# ${escapeMarkdown(snapshot.title)}`,
    "",
    `- Room: ${escapeMarkdown(snapshot.code)}`,
    `- Phase: ${escapeMarkdown(snapshot.phase)}`,
    `- Expires: ${new Date(snapshot.expiresAt).toISOString()}`,
    ...(snapshot.closedAt !== null
      ? [`- Completed: ${new Date(snapshot.closedAt).toISOString()}`]
      : []),
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
    for (const column of columns) {
      lines.push("", `## ${column.title}`);
      for (const note of snapshot.notes
        .filter((item) => item.column === column.id)
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
  const snapshot = retroPublicRoomSchema.parse(publicRetro(room, viewerId));
  const lines = [
    snapshot.title,
    `Room: ${snapshot.code} | Phase: ${snapshot.phase}`,
    `Expires: ${new Date(snapshot.expiresAt).toISOString()}`,
    ...(snapshot.closedAt !== null
      ? [`Completed: ${new Date(snapshot.closedAt).toISOString()}`]
      : []),
    "",
    "People",
    ...snapshot.members.map(
      (member) => `- ${member.name}${member.moderator ? " (moderator)" : ""}`
    ),
  ];
  if (snapshot.phase === "discuss" || snapshot.phase === "closed") {
    lines.push(...rankedLines(snapshot, false));
  } else {
    for (const column of columns) {
      lines.push("", column.title);
      for (const note of snapshot.notes
        .filter((item) => item.column === column.id)
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
