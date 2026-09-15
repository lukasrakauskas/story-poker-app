"use client";

import { useState } from "react";
import { isValidRetroCode } from "shared/retrospective";
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
import { useRetro } from "./retro-provider";

const INVALID_ROOM_CODE_MESSAGE =
  "That room link is invalid. Room codes use 1–64 letters, numbers, hyphens, or underscores.";

export function RetroLobby({ initialCode = "" }: { initialCode?: string }) {
  const { send, connection, pending, error, retry, roomInfo } = useRetro();
  const [mode, setMode] = useState<"create" | "join">(
    initialCode ? "join" : "create"
  );
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [code, setCode] = useState(initialCode);
  const codeValue = code.trim();
  const routeEntry = !!initialCode;
  const invalidRoute = routeEntry && !isValidRetroCode(initialCode);
  const inspectedRoom = roomInfo?.code === codeValue ? roomInfo : null;
  const joinable =
    inspectedRoom?.available === true && !inspectedRoom.requiresPassword;
  const checkingAvailability =
    routeEntry &&
    !invalidRoute &&
    isValidRetroCode(codeValue) &&
    !inspectedRoom &&
    (pending || connection === "connecting");
  const disabled =
    connection !== "connected" ||
    pending ||
    error?.code === "room-expired" ||
    error?.code === "invalid-session";

  return (
    <div className="mx-auto max-w-lg space-y-6 py-6 sm:py-12">
      <div className="space-y-3 text-center">
        <p className="text-sm font-medium text-muted-foreground">
          A little reflection. A better next sprint.
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">
          Team retrospective
        </h1>
        <p className="text-muted-foreground">
          Write privately, reveal together, vote on what matters, and turn your
          discussion into actions.
        </p>
      </div>
      <Card>
        <CardHeader>
          <fieldset className="mb-4 flex gap-2">
            <legend className="sr-only">Choose how to enter</legend>
            <Button
              className="flex-1"
              variant={mode === "create" ? "default" : "outline"}
              aria-pressed={mode === "create"}
              disabled={pending || connection !== "connected"}
              onClick={() => setMode("create")}
            >
              Create a room
            </Button>
            <Button
              className="flex-1"
              variant={mode === "join" ? "default" : "outline"}
              aria-pressed={mode === "join"}
              disabled={pending || connection !== "connected"}
              onClick={() => setMode("join")}
            >
              Join a room
            </Button>
          </fieldset>
          <CardTitle>
            {mode === "create"
              ? "Start a fresh conversation"
              : "Join your team"}
          </CardTitle>
          <CardDescription>
            {mode === "create"
              ? "You’ll be the moderator and guide the team from private writing through a shared reveal."
              : "Enter the room code from your invitation. Writing stays private until the moderator starts voting and reveals every note."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2 rounded-md border bg-muted/30 p-3 text-sm">
            <output aria-live="polite" aria-atomic="true">
              {invalidRoute
                ? "Room entry is unavailable"
                : inspectedRoom && !inspectedRoom.available
                  ? "Room unavailable"
                  : inspectedRoom?.available && inspectedRoom.requiresPassword
                    ? "Room access required"
                    : checkingAvailability
                      ? "Checking room availability…"
                      : pending
                        ? "Waiting for the room…"
                        : connection === "connecting"
                          ? "Connecting to retrospective…"
                          : connection === "connected"
                            ? "Connected · ready to enter"
                            : "Disconnected · room entry is unavailable"}
            </output>
            {error && error.code !== "invalid-room-code" && (
              <p role="alert" className="text-destructive">
                {error.message}
              </p>
            )}
            {invalidRoute && (
              <p
                id="retro-code-error"
                role="alert"
                className="text-destructive"
              >
                {INVALID_ROOM_CODE_MESSAGE}
              </p>
            )}
            {mode === "join" &&
              !invalidRoute &&
              codeValue &&
              !isValidRetroCode(codeValue) && (
                <p
                  id="retro-code-error"
                  role="alert"
                  className="text-destructive"
                >
                  Room codes use 1–64 letters, numbers, hyphens, or underscores.
                </p>
              )}
            {!invalidRoute && inspectedRoom && !inspectedRoom.available && (
              <output className="block">
                This room link is expired or does not exist. No room details
                were shared.
              </output>
            )}
            {inspectedRoom?.available && inspectedRoom.requiresPassword && (
              <output className="block">
                This room requires access verification before anyone can join.
                No room details were shared.
              </output>
            )}
            {connection === "disconnected" &&
              !invalidRoute &&
              !inspectedRoom &&
              error?.code !== "room-expired" &&
              error?.code !== "invalid-session" && (
                <Button size="sm" variant="outline" onClick={retry}>
                  Retry connection
                </Button>
              )}
            {(error?.code === "room-expired" ||
              error?.code === "invalid-session" ||
              invalidRoute ||
              (inspectedRoom &&
                (!inspectedRoom.available ||
                  inspectedRoom.requiresPassword))) && (
              <a
                className="block underline underline-offset-4"
                href={
                  error?.code === "invalid-session" && initialCode
                    ? `/retro/${encodeURIComponent(initialCode)}`
                    : "/retro"
                }
              >
                {error?.code === "invalid-session"
                  ? "Rejoin as a new participant"
                  : "Start or join another room"}
              </a>
            )}
          </div>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (disabled) return;
              if (mode === "create") {
                if (!name.trim() || !title.trim()) return;
                void send({
                  type: "create",
                  name: name.trim(),
                  title: title.trim(),
                });
                return;
              }
              if (!isValidRetroCode(codeValue)) return;
              if (routeEntry && !joinable) {
                void send({ type: "inspect", code: codeValue });
                return;
              }
              if (!name.trim()) return;
              void send({
                type: "join",
                name: name.trim(),
                code: codeValue,
              });
            }}
          >
            {mode === "join" && (
              <div className="space-y-2">
                <Label htmlFor="retro-code">Room code</Label>
                <Input
                  id="retro-code"
                  minLength={1}
                  maxLength={64}
                  pattern="[a-zA-Z0-9_-]{1,64}"
                  aria-invalid={
                    (!!codeValue && !isValidRetroCode(codeValue)) ||
                    invalidRoute
                  }
                  aria-describedby={
                    (!!codeValue && !isValidRetroCode(codeValue)) ||
                    invalidRoute
                      ? "retro-code-error"
                      : undefined
                  }
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  placeholder="Paste your room code"
                  required
                  disabled={pending || connection !== "connected"}
                />
              </div>
            )}
            {(mode === "create" || !routeEntry || joinable) && (
              <div className="space-y-2">
                <Label htmlFor="retro-name">Your name</Label>
                <Input
                  id="retro-name"
                  minLength={3}
                  maxLength={30}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  autoComplete="off"
                  placeholder="How should the team know you?"
                  required
                  disabled={pending || connection !== "connected"}
                />
              </div>
            )}
            {mode === "create" && (
              <div className="space-y-2">
                <Label htmlFor="retro-title">Retrospective title</Label>
                <Input
                  id="retro-title"
                  maxLength={100}
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="Sprint 24 · Looking back"
                  required
                  disabled={pending || connection !== "connected"}
                />
              </div>
            )}
            <Button
              className="w-full"
              type="submit"
              disabled={
                disabled ||
                (mode === "create"
                  ? !name.trim() || !title.trim()
                  : !isValidRetroCode(codeValue) ||
                    (routeEntry ? false : !name.trim()))
              }
            >
              {pending
                ? checkingAvailability
                  ? "Checking room availability…"
                  : "Waiting for the room…"
                : mode === "create"
                  ? "Create retrospective"
                  : routeEntry && !joinable
                    ? "Check room availability"
                    : "Join retrospective"}
            </Button>
          </form>
        </CardContent>
      </Card>
      <p className="text-center text-sm text-muted-foreground">
        No account needed. Cookies let you rejoin until the room expires two
        hours after creation. Previous retros and actions stay on this browser.
      </p>
    </div>
  );
}
