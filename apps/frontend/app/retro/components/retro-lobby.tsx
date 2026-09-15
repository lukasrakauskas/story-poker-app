"use client";

import { useState } from "react";
import { Button } from "ui/components/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "ui/components/alert-dialog";
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
  const {
    send,
    connection,
    pending,
    error,
    retry,
    rememberedIdentity,
    rememberedStatus,
    inspectRemembered,
    continueRememberedSession,
    forgetRememberedSession,
  } = useRetro();
  const [mode, setMode] = useState<"create" | "join">(
    initialCode ? "join" : "create"
  );
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [code, setCode] = useState(initialCode);
  const joinCode = code.trim();
  const remembered =
    rememberedIdentity && rememberedIdentity.code === joinCode
      ? rememberedIdentity
      : null;
  const routeChecking =
    !!initialCode &&
    !remembered &&
    (rememberedStatus === "checking" || rememberedStatus === "resuming");
  const disabled =
    connection !== "connected" || pending || error?.code === "room-expired";

  async function submitJoin() {
    if (disabled || !name.trim() || !joinCode) return;
    // A saved credential is inspected first. The entered name remains in this
    // component until the visitor explicitly forgets the remembered identity.
    const inspected = await inspectRemembered(joinCode);
    if (inspected !== "none") return;
    void send({ type: "join", name: name.trim(), code: joinCode });
  }

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
              {routeChecking
                ? "Checking your saved retrospective identity…"
                : pending && rememberedStatus === "resuming"
                  ? "Continuing your saved session…"
                  : pending && rememberedStatus === "checking"
                    ? "Checking your saved retrospective identity…"
                    : pending
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
            {rememberedStatus === "invalid" && !remembered && (
              <output>
                The remembered identity was rejected and its credential was
                cleared for this room. Choose a new name to join.
              </output>
            )}
            {rememberedStatus === "forgotten" && !remembered && (
              <output>
                This room&apos;s remembered identity was forgotten. Joining now
                creates a separate participant.
              </output>
            )}
            {connection === "disconnected" &&
              error?.code !== "room-expired" &&
              error?.code !== "invalid-session" && (
                <Button size="sm" variant="outline" onClick={retry}>
                  Retry connection
                </Button>
              )}
            {error?.code === "room-expired" && (
              <a className="block underline underline-offset-4" href="/retro">
                Start or join another room
              </a>
            )}
            {error?.code === "invalid-session" && initialCode && (
              <a
                className="block underline underline-offset-4"
                href={`/retro/${encodeURIComponent(initialCode)}`}
              >
                Rejoin as a new participant
              </a>
            )}
          </div>

          {remembered && (
            <Card className="border-primary/50 bg-primary/5">
              <CardHeader>
                <h2 className="leading-none font-semibold">
                  Continue as {remembered.name}
                </h2>
                <CardDescription>
                  A remembered identity is available for room {remembered.code}.
                  {remembered.moderator
                    ? " This identity is the moderator and retains moderator access if you continue."
                    : " Continuing restores this participant identity and its existing ownership."}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {remembered.moderator && (
                  <output className="block text-sm font-medium">
                    Moderator access is saved with this identity.
                  </output>
                )}
                <Button
                  className="w-full"
                  disabled={disabled}
                  onClick={() =>
                    void continueRememberedSession(remembered.code)
                  }
                >
                  Continue as {remembered.name}
                </Button>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      className="w-full"
                      variant="outline"
                      disabled={pending}
                    >
                      Join as someone else / Forget this session
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>
                        Forget {remembered.name}&apos;s session?
                      </AlertDialogTitle>
                      <AlertDialogDescription>
                        This forgets the saved credential for this room only.
                        You will lose this participant&apos;s note and vote
                        ownership and any moderator access. Existing notes and
                        action ownership remain in the room with their original
                        attribution; joining as someone else creates a new
                        participant and cannot reclaim that content.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Keep this session</AlertDialogCancel>
                      <AlertDialogAction
                        variant="destructive"
                        disabled={pending}
                        onClick={() =>
                          void forgetRememberedSession(remembered.code)
                        }
                      >
                        Forget session and join as someone else
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </CardContent>
            </Card>
          )}

          {!remembered && (
            <form
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                if (disabled) return;
                if (mode === "create" && name.trim() && title.trim())
                  void send({
                    type: "create",
                    name: name.trim(),
                    title: title.trim(),
                  });
                if (mode === "join") void submitJoin();
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
                  disabled={
                    pending || connection !== "connected" || !!remembered
                  }
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
                  !!remembered ||
                  !name.trim() ||
                  !(mode === "create" ? title.trim() : joinCode)
                }
              >
                {pending
                  ? rememberedStatus === "resuming"
                    ? "Continuing your saved session…"
                    : "Waiting for the room…"
                  : mode === "create"
                    ? "Create retrospective"
                    : "Join retrospective"}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
      <p className="text-center text-sm text-muted-foreground">
        No account needed. Cookies let you rejoin until the room expires two
        hours after creation. Previous retros and actions stay on this browser.
      </p>
    </div>
  );
}
