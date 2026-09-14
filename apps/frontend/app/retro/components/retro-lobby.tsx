"use client";

import { useState } from "react";
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
  const { send, connection, pending, error } = useRetro();
  const [mode, setMode] = useState<"create" | "join">(
    initialCode ? "join" : "create"
  );
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [code, setCode] = useState(initialCode);
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
        <CardContent>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (disabled || !name.trim()) return;
              if (mode === "create" && title.trim())
                void send({
                  type: "create",
                  name: name.trim(),
                  title: title.trim(),
                });
              if (mode === "join" && code.trim())
                void send({
                  type: "join",
                  name: name.trim(),
                  code: code.trim(),
                });
            }}
          >
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
            <Button
              className="w-full"
              type="submit"
              disabled={
                disabled ||
                !name.trim() ||
                !(mode === "create" ? title.trim() : code.trim())
              }
            >
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
