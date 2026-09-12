"use client";

import { useEffect, useRef, useState } from "react";
import type { RetroRoom } from "shared/retrospective";
import { Button } from "ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "ui/components/card";
import { Input } from "ui/components/input";
import { Label } from "ui/components/label";
import { columns } from "./note-board";

export function RoomDetails({
  room,
  selfId,
}: {
  room: RetroRoom;
  selfId: string | null;
}) {
  const [origin, setOrigin] = useState("");
  const [copyStatus, setCopyStatus] = useState("");
  const [exportStatus, setExportStatus] = useState("");
  const mounted = useRef(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined
  );
  const download = useRef<{
    url: string;
    timer: ReturnType<typeof setTimeout>;
  } | null>(null);
  const link = `${origin}/retro/${encodeURIComponent(room.code)}`;

  useEffect(() => {
    mounted.current = true;
    // Synchronize a browser-only origin after hydration (SSR must use the same initial value).
    // oxlint-disable-next-line react/set-state-in-effect
    setOrigin(window.location.origin);
    return () => {
      mounted.current = false;
      clearTimeout(copyTimer.current);
      if (download.current) {
        clearTimeout(download.current.timer);
        URL.revokeObjectURL(download.current.url);
      }
    };
  }, []);

  async function copyLink() {
    clearTimeout(copyTimer.current);
    try {
      if (!navigator.clipboard) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(link);
      if (!mounted.current) return;
      setCopyStatus("Link copied.");
      copyTimer.current = setTimeout(() => setCopyStatus(""), 3000);
    } catch {
      if (mounted.current)
        setCopyStatus(
          "Could not copy. Select the link above and copy it manually."
        );
    }
  }

  function exportRoom(format: "json" | "txt") {
    setExportStatus("");
    try {
      // Export only the public room, never the self/resume credentials.
      const content =
        format === "json" ? JSON.stringify(room, null, 2) : roomAsText(room);
      const blob = new Blob([content], {
        type:
          format === "json" ? "application/json" : "text/plain;charset=utf-8",
      });
      if (download.current) {
        clearTimeout(download.current.timer);
        URL.revokeObjectURL(download.current.url);
      }
      const url = URL.createObjectURL(blob);
      download.current = {
        url,
        timer: setTimeout(() => {
          URL.revokeObjectURL(url);
          download.current = null;
        }, 1000),
      };
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `retrospective-${room.code.replace(/[^a-zA-Z0-9_-]/g, "_")}.${format}`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setExportStatus(
        "Download requested. Keep the file somewhere safe; it includes the team’s public notes and names."
      );
    } catch {
      setExportStatus(
        "Export failed. Try again, or copy the notes manually before leaving."
      );
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Invite your team</CardTitle>
          <CardDescription>
            Anyone with the link can join and read all notes. This is not an
            anonymous board.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="retro-invite">Room link</Label>
            <div className="flex gap-2">
              <Input
                id="retro-invite"
                readOnly
                value={link}
                onFocus={(event) => event.target.select()}
              />
              <Button
                variant="secondary"
                onClick={() => void copyLink()}
                disabled={!origin}
              >
                Copy
              </Button>
            </div>
            <output className="block text-xs text-muted-foreground">
              {copyStatus}
            </output>
          </div>
          <div className="space-y-3 border-t pt-4">
            <h2 className="text-sm font-semibold">
              People ·{" "}
              {room.members.filter((member) => member.connected).length} online
              / {room.members.length}
            </h2>
            <ul className="space-y-3">
              {room.members.map((member) => (
                <li
                  key={member.id}
                  className="flex items-start justify-between gap-3 text-sm"
                >
                  <div className="min-w-0">
                    <p className="break-words font-medium">
                      {member.name}
                      {member.id === selfId && " (you)"}
                    </p>
                    {member.moderator && (
                      <p className="text-xs text-muted-foreground">Moderator</p>
                    )}
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {member.connected ? "Online" : "Offline"}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Keep the takeaways</CardTitle>
          <CardDescription>
            Export the latest snapshot at any time, including while offline.
            Nothing is saved automatically.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => exportRoom("txt")}>
              Export text
            </Button>
            <Button variant="outline" onClick={() => exportRoom("json")}>
              Export JSON
            </Button>
          </div>
          <output className="block text-xs text-muted-foreground">
            {exportStatus}
          </output>
        </CardContent>
      </Card>
    </div>
  );
}

function roomAsText(room: RetroRoom) {
  const lines = [
    room.title,
    `Room: ${room.code} | Phase: ${room.phase}`,
    `Expires: ${new Date(room.expiresAt).toISOString()}`,
    "",
    "People",
    ...room.members.map(
      (member) => `- ${member.name}${member.moderator ? " (moderator)" : ""}`
    ),
  ];
  for (const column of columns) {
    lines.push("", column.title);
    for (const note of room.notes
      .filter((item) => item.column === column.id)
      .sort((a, b) => b.voterIds.length - a.voterIds.length)) {
      const author =
        room.members.find((member) => member.id === note.authorId)?.name ??
        "Former member";
      lines.push(`- [${note.voterIds.length} votes] ${note.text} — ${author}`);
    }
  }
  lines.push(
    "",
    "Action items",
    ...room.actions.map(
      (action) =>
        `- [${action.done ? "x" : " "}] ${action.text} — ${action.owner || "Unassigned"}`
    )
  );
  return lines.join("\n");
}
