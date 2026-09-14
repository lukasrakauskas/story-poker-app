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
import { RetroExport } from "./retro-export";

export function RoomDetails({
  room,
  selfId,
}: {
  room: RetroRoom;
  selfId: string | null;
}) {
  const [origin, setOrigin] = useState("");
  const [copyStatus, setCopyStatus] = useState("");
  const mounted = useRef(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined
  );
  const link = `${origin}/retro/${encodeURIComponent(room.code)}`;

  useEffect(() => {
    mounted.current = true;
    // Synchronize a browser-only origin after hydration (SSR must use the same initial value).
    // oxlint-disable-next-line react/set-state-in-effect
    setOrigin(window.location.origin);
    return () => {
      mounted.current = false;
      clearTimeout(copyTimer.current);
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

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Invite your team</CardTitle>
          <CardDescription>
            Anyone with the link can join. Notes stay visible only to their
            author while the team writes, then everyone sees the complete,
            attributed board when voting starts.
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
      <RetroExport room={room} selfId={selfId} />
    </div>
  );
}
