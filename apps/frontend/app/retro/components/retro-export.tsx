"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { RetroRoom } from "shared/retrospective";
import { Button } from "ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "ui/components/card";
import { Label } from "ui/components/label";
import { Textarea } from "ui/components/textarea";
import { roomAsMarkdown, roomAsText } from "../../../lib/retro-export";
import { publicRetro } from "../../../lib/retro-history";

type Download = { url: string; timer: ReturnType<typeof setTimeout> };

function releaseDownload(download: Download | null) {
  if (!download) return;
  clearTimeout(download.timer);
  URL.revokeObjectURL(download.url);
}

export function RetroExport({
  room,
  selfId,
}: {
  room: RetroRoom;
  selfId?: string | null;
}) {
  const [status, setStatus] = useState("");
  const [manualMarkdown, setManualMarkdown] = useState<string | null>(null);
  const mounted = useRef(false);
  const copyRequest = useRef(0);
  const download = useRef<Download | null>(null);
  const manualId = useId();

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      copyRequest.current += 1;
      releaseDownload(download.current);
      download.current = null;
    };
  }, []);

  async function copyMarkdown() {
    const request = ++copyRequest.current;
    setStatus("");
    setManualMarkdown(null);
    let markdown: string;
    try {
      markdown = roomAsMarkdown(room, selfId);
    } catch {
      setStatus(
        "This snapshot could not be exported. Try another saved snapshot."
      );
      return;
    }
    try {
      if (!navigator.clipboard) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(markdown);
      if (!mounted.current || request !== copyRequest.current) return;
      setStatus("Markdown copied.");
    } catch {
      if (!mounted.current || request !== copyRequest.current) return;
      setManualMarkdown(markdown);
      setStatus(
        "Could not copy. Select the Markdown below and copy it manually."
      );
    }
  }

  function exportRoom(format: "json" | "txt" | "md") {
    // A pending clipboard request must not overwrite download feedback.
    copyRequest.current += 1;
    setStatus("");
    let anchor: HTMLAnchorElement | null = null;
    try {
      const snapshot = publicRetro(room, selfId);
      const content =
        format === "json"
          ? JSON.stringify(snapshot, null, 2)
          : format === "md"
            ? roomAsMarkdown(snapshot, selfId)
            : roomAsText(snapshot, selfId);
      const blob = new Blob([content], {
        type:
          format === "json"
            ? "application/json"
            : format === "md"
              ? "text/markdown;charset=utf-8"
              : "text/plain;charset=utf-8",
      });
      releaseDownload(download.current);
      download.current = null;
      const url = URL.createObjectURL(blob);
      download.current = {
        url,
        timer: setTimeout(() => {
          URL.revokeObjectURL(url);
          download.current = null;
        }, 1000),
      };
      anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `retrospective-${snapshot.code.replace(/[^a-zA-Z0-9_-]/g, "_")}.${format}`;
      document.body.appendChild(anchor);
      anchor.click();
      setStatus(
        room.phase === "write"
          ? "Download requested. It contains only the private notes currently visible to you."
          : "Download requested. Keep the file somewhere safe; it includes the team’s revealed notes and names."
      );
    } catch {
      releaseDownload(download.current);
      download.current = null;
      setStatus(
        "Export failed. Try again, or use Copy Markdown before leaving."
      );
    } finally {
      anchor?.remove();
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Keep the takeaways</CardTitle>
        <CardDescription>
          {room.phase === "write"
            ? "This browser-local snapshot contains only your private writing. The complete board becomes available when arranging starts."
            : room.phase === "closed"
              ? "This final snapshot is saved only in this browser and is not a durable backup. Export a file to keep elsewhere before browser data is cleared or unavailable."
              : "This browser-local snapshot contains the revealed board but may not be the final outcome. Export it at any time, including while offline."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => void copyMarkdown()}>
            Copy Markdown
          </Button>
          <Button variant="outline" onClick={() => exportRoom("md")}>
            Export Markdown
          </Button>
          <Button variant="outline" onClick={() => exportRoom("txt")}>
            Export text
          </Button>
          <Button variant="outline" onClick={() => exportRoom("json")}>
            Export JSON
          </Button>
        </div>
        <output
          aria-live="polite"
          aria-atomic="true"
          className="block text-xs text-muted-foreground"
        >
          {status}
        </output>
        {manualMarkdown !== null && (
          <div className="space-y-2">
            <Label htmlFor={manualId}>Markdown for manual copy</Label>
            <Textarea
              id={manualId}
              readOnly
              value={manualMarkdown}
              rows={12}
              className="font-mono text-xs"
              onFocus={(event) => event.target.select()}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
