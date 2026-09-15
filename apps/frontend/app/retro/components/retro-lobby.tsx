"use client";

import { useState } from "react";
import {
  normalizeParticipantName,
  participantNameError,
} from "shared/participant";
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

export function RetroLobby({ initialCode = "" }: { initialCode?: string }) {
  const { send, connection, pending, error, retry } = useRetro();
  const [mode, setMode] = useState<"create" | "join">(
    initialCode ? "join" : "create"
  );
  const [name, setName] = useState("");
  const [nameTouched, setNameTouched] = useState(false);
  const [title, setTitle] = useState("");
  const [code, setCode] = useState(initialCode);
  const disabled =
    connection !== "connected" ||
    pending ||
    error?.code === "room-expired" ||
    error?.code === "invalid-session";
  const normalizedName = normalizeParticipantName(name);
  const nameError = participantNameError(normalizedName);
  const visibleNameError = nameTouched ? nameError : null;
  const canSubmit =
    !disabled &&
    nameError === null &&
    !!(mode === "create" ? title.trim() : code.trim());

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
              {pending
                ? "Waiting for the room…"
                : connection === "connecting"
                  ? "Connecting to retrospective…"
                  : connection === "connected"
                    ? "Connected · ready to enter"
                    : "Disconnected · room entry is unavailable"}
            </output>
            {error && (
              <p role="alert" className="text-destructive">
                {error.message}
              </p>
            )}
            {connection === "disconnected" &&
              error?.code !== "room-expired" &&
              error?.code !== "invalid-session" && (
                <Button size="sm" variant="outline" onClick={retry}>
                  Retry connection
                </Button>
              )}
            {(error?.code === "room-expired" ||
              error?.code === "invalid-session") && (
              <a
                className="block underline underline-offset-4"
                href={
                  error.code === "invalid-session" && initialCode
                    ? `/retro/${encodeURIComponent(initialCode)}`
                    : "/retro"
                }
              >
                {error.code === "invalid-session"
                  ? "Rejoin as a new participant"
                  : "Start or join another room"}
              </a>
            )}
          </div>
          <form
            className="space-y-4"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              if (!canSubmit) {
                setNameTouched(true);
                return;
              }
              if (mode === "create")
                void send({
                  type: "create",
                  name: normalizedName,
                  title: title.trim(),
                });
              if (mode === "join")
                void send({
                  type: "join",
                  name: normalizedName,
                  code: code.trim(),
                });
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="retro-name">Your name</Label>
              <Input
                id="retro-name"
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                  setNameTouched(true);
                }}
                onBlur={() => setNameTouched(true)}
                autoComplete="off"
                placeholder="How should the team know you?"
                required
                aria-invalid={visibleNameError ? true : undefined}
                aria-describedby={
                  visibleNameError ? "retro-name-error" : undefined
                }
                disabled={pending || connection !== "connected"}
              />
              {visibleNameError && (
                <p
                  id="retro-name-error"
                  role="alert"
                  className="text-sm text-destructive"
                >
                  {visibleNameError}
                </p>
              )}
            </div>
            {mode === "create" ? (
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
            ) : (
              <div className="space-y-2">
                <Label htmlFor="retro-code">Room code</Label>
                <Input
                  id="retro-code"
                  maxLength={64}
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
            <Button className="w-full" type="submit" disabled={!canSubmit}>
              {pending
                ? "Waiting for the room…"
                : mode === "create"
                  ? "Create retrospective"
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
