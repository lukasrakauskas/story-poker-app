import type { RetroRoom } from "shared/retrospective";
import { publicRetro } from "./retro-history";

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
  for (const column of columns) {
    lines.push("", `## ${column.title}`);
    for (const note of snapshot.notes
      .filter((item) => item.column === column.id)
      .sort((a, b) => b.voterIds.length - a.voterIds.length)) {
      const author =
        snapshot.members.find((member) => member.id === note.authorId)?.name ??
        "Former member";
      lines.push(
        `- **${note.voterIds.length} votes** · ${escapeMarkdown(note.text)} — ${escapeMarkdown(author)}`
      );
    }
  }
  lines.push(
    "",
    "## Action items",
    ...snapshot.actions.map(
      (action) =>
        `- [${action.done ? "x" : " "}] ${escapeMarkdown(action.text)} — Owner: ${escapeMarkdown(action.owner || "Unassigned")}`
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
  for (const column of columns) {
    lines.push("", column.title);
    for (const note of snapshot.notes
      .filter((item) => item.column === column.id)
      .sort((a, b) => b.voterIds.length - a.voterIds.length)) {
      const author =
        snapshot.members.find((member) => member.id === note.authorId)?.name ??
        "Former member";
      lines.push(`- [${note.voterIds.length} votes] ${note.text} — ${author}`);
    }
  }
  lines.push(
    "",
    "Action items",
    ...snapshot.actions.map(
      (action) =>
        `- [${action.done ? "x" : " "}] ${action.text} — ${action.owner || "Unassigned"}`
    )
  );
  return lines.join("\n");
}
