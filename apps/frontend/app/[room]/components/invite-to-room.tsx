"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy, Eye, RotateCcw, Users } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "ui/components/avatar";
import { Badge } from "ui/components/badge";
import { Button } from "ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "ui/components/card";
import { Input } from "ui/components/input";
import { Label } from "ui/components/label";
import { Progress } from "ui/components/progress";
import { usePlanning } from "../../../lib/planning-context";

export function InviteToRoom() {
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">(
    "idle"
  );
  const { users, currentUser, planningState, changePlanningState, roomCode } =
    usePlanning();
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const linkRef = useRef<HTMLInputElement>(null);
  const connected = users.filter((user) => user.status === "connected");
  const voted = connected.filter((user) => user.voted).length;
  const revealed = planningState === "results";

  const handleCopyLink = async () => {
    clearTimeout(timerRef.current);
    try {
      await navigator.clipboard.writeText(
        `${window.location.origin}/${roomCode}`
      );
      setCopyStatus("copied");
      timerRef.current = setTimeout(() => setCopyStatus("idle"), 2000);
    } catch {
      setCopyStatus("failed");
      linkRef.current?.focus();
      linkRef.current?.select();
    }
  };

  useEffect(() => () => clearTimeout(timerRef.current), []);
  const origin = typeof window !== "undefined" ? window.location.origin : "";

  return (
    <Card className="min-h-0 min-w-0 gap-0 overflow-y-auto py-0">
      <CardHeader className="shrink-0 gap-3 border-b p-4 sm:p-5">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-lg font-semibold tracking-tight">
            Planning room
          </h2>
          <Badge
            variant="outline"
            className="max-w-32 truncate font-mono"
            title={roomCode}
          >
            {roomCode}
          </Badge>
        </div>
        <CardDescription>
          Invite your team and estimate together.
        </CardDescription>
        <div className="space-y-2">
          <Label htmlFor="poker-room-link">Room link</Label>
          <div className="flex gap-2">
            <Input
              id="poker-room-link"
              ref={linkRef}
              value={`${origin}/${roomCode}`}
              readOnly
              className="min-w-0"
              onFocus={(event) => event.target.select()}
            />
            <Button
              variant="secondary"
              size="icon"
              className="shrink-0"
              onClick={handleCopyLink}
              aria-label={
                copyStatus === "copied" ? "Link copied" : "Copy room link"
              }
            >
              {copyStatus === "copied" ? (
                <Check aria-hidden="true" />
              ) : (
                <Copy aria-hidden="true" />
              )}
            </Button>
          </div>
          <output className="block text-xs text-muted-foreground">
            {copyStatus === "failed"
              ? "Could not copy. Select and copy the link manually."
              : copyStatus === "copied"
                ? "Room link copied."
                : "Anyone with this link can join."}
          </output>
        </div>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col gap-4 p-4 sm:p-5">
        <div className="shrink-0 space-y-3">
          <h3 className="flex items-center gap-2 text-sm font-medium">
            <Users className="size-4" aria-hidden="true" /> Team{" "}
            <Badge variant="secondary" className="ml-auto">
              {connected.length} online
            </Badge>
          </h3>
          {!revealed && (
            <div className="space-y-2">
              <output className="flex justify-between gap-2 text-xs text-muted-foreground">
                <span>
                  {voted} of {connected.length} voted
                </span>
                {connected.length > 0 && voted === connected.length && (
                  <span className="font-medium text-foreground">
                    Ready to reveal
                  </span>
                )}
              </output>
              <Progress
                value={connected.length ? (voted / connected.length) * 100 : 0}
                aria-label="Team voting progress"
                className="h-1.5"
              />
            </div>
          )}
        </div>
        <ul
          aria-label="People in the room"
          className="min-h-0 space-y-3 md:flex-1 md:overflow-y-auto"
        >
          {users.map((user) => (
            <li key={user.id} className="flex items-center gap-3">
              <Avatar className="shrink-0">
                <AvatarImage src={`/avatars/${user.avatar}`} alt="" />
                <AvatarFallback>
                  {user.name.slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <p className="break-words text-sm font-medium">
                  {user.name}
                  {user.id === currentUser?.id && (
                    <span className="font-normal text-muted-foreground">
                      {" "}
                      (you)
                    </span>
                  )}
                </p>
                {user.role === "mod" && (
                  <p className="text-xs text-muted-foreground">Moderator</p>
                )}
              </div>
              <Badge
                variant={user.voted ? "secondary" : "outline"}
                className="max-w-24 shrink-0 whitespace-normal break-all text-center"
              >
                {user.status === "disconnected" ? (
                  "Offline"
                ) : revealed ? (
                  (user.vote ?? "No vote")
                ) : user.voted ? (
                  <>
                    <Check aria-hidden="true" className="size-3" /> Voted
                  </>
                ) : (
                  "Thinking"
                )}
              </Badge>
            </li>
          ))}
        </ul>
        <div className="mt-auto shrink-0 border-t pt-4">
          {currentUser?.role === "mod" ? (
            <Button className="w-full" onClick={changePlanningState}>
              {revealed ? (
                <RotateCcw aria-hidden="true" />
              ) : (
                <Eye aria-hidden="true" />
              )}
              {revealed ? "Start voting" : "Reveal results"}
            </Button>
          ) : (
            <p className="text-center text-xs text-muted-foreground">
              {revealed
                ? "The moderator will start the next round."
                : "The moderator will reveal results when the team is ready."}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
