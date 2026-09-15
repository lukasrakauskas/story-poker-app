"use client";

import { useEffect, useState } from "react";
import {
  normalizeParticipantName,
  participantNameError,
} from "shared/participant";
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

const validCode = (value: string) => /^[a-zA-Z0-9_-]{1,64}$/.test(value);
const INVALID_ROOM_CODE_MESSAGE =
  "Room codes use 1–64 letters, numbers, hyphens, or underscores.";

export function RetroLobby({ initialCode = "" }: { initialCode?: string }) {
  const {
    send,
    connection,
    pending,
    error,
    retry,
    roomInfo,
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
  const [nameTouched, setNameTouched] = useState(false);
  const [title, setTitle] = useState("");
  const [code, setCode] = useState(initialCode);
  const [password, setPassword] = useState("");
  const [identityCheckCode, setIdentityCheckCode] = useState<string | null>(
    null
  );
  const codeValue = code.trim();
  const invalidRoute = !!initialCode && !validCode(initialCode);
  const inspectedRoom = roomInfo?.code === codeValue ? roomInfo : null;
  const remembered =
    rememberedIdentity && rememberedIdentity.code === codeValue
      ? rememberedIdentity
      : null;
  const identityChecking =
    rememberedStatus === "checking" || rememberedStatus === "resuming";
  const joinable = inspectedRoom?.available === true;
  const checkingAvailability =
    mode === "join" && validCode(codeValue) && !inspectedRoom && pending;
  const showJoinFields =
    mode === "join" &&
    !invalidRoute &&
    error?.code !== "room-expired" &&
    error?.code !== "invalid-session" &&
    (!initialCode || inspectedRoom?.available === true);
  const disabled =
    connection !== "connected" ||
    pending ||
    identityChecking ||
    invalidRoute ||
    error?.code === "room-expired" ||
    error?.code === "invalid-session";
  const normalizedName = normalizeParticipantName(name);
  const nameError = participantNameError(normalizedName);
  const visibleNameError = nameTouched ? nameError : null;
  const canSubmit =
    !disabled &&
    (mode === "create"
      ? nameError === null && !!title.trim()
      : validCode(codeValue) &&
        (!inspectedRoom || joinable) &&
        (!inspectedRoom || nameError === null));
  const needsPassword =
    mode === "create" ||
    inspectedRoom?.requiresPassword === true ||
    error?.code === "wrong-room-password";

  useEffect(() => {
    if (
      mode === "join" &&
      initialCode &&
      validCode(initialCode) &&
      connection === "connected" &&
      !pending &&
      !inspectedRoom &&
      !identityChecking
    ) {
      void send({ type: "inspect", code: initialCode });
    }
  }, [
    connection,
    identityChecking,
    initialCode,
    inspectedRoom,
    mode,
    pending,
    send,
  ]);

  useEffect(() => {
    if (
      mode !== "join" ||
      !inspectedRoom?.available ||
      !validCode(codeValue) ||
      identityCheckCode === codeValue ||
      rememberedStatus === "invalid" ||
      rememberedStatus === "forgotten" ||
      rememberedIdentity?.code === codeValue
    )
      return;
    setIdentityCheckCode(codeValue);
    void inspectRemembered(codeValue);
  }, [
    codeValue,
    identityCheckCode,
    inspectedRoom,
    inspectRemembered,
    mode,
    rememberedIdentity,
    rememberedStatus,
  ]);

  async function submitJoin() {
    if (disabled || !validCode(codeValue)) return;
    if (!inspectedRoom) {
      await send({ type: "inspect", code: codeValue });
      return;
    }
    if (!joinable || !nameError) {
      if (!joinable) return;
    }
    if (rememberedStatus !== "invalid" && rememberedStatus !== "forgotten") {
      const inspected = await inspectRemembered(codeValue);
      if (inspected === "valid") return;
    }
    if (nameError !== null) {
      setNameTouched(true);
      return;
    }
    void send({
      type: "join",
      name: normalizedName,
      code: codeValue,
      ...(password ? { password } : {}),
    });
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
              onClick={() => {
                setMode("create");
                setPassword("");
              }}
            >
              Create a room
            </Button>
            <Button
              className="flex-1"
              variant={mode === "join" ? "default" : "outline"}
              aria-pressed={mode === "join"}
              disabled={pending || connection !== "connected"}
              onClick={() => {
                setMode("join");
                setPassword("");
              }}
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
                : identityChecking
                  ? rememberedStatus === "resuming"
                    ? "Continuing your saved session…"
                    : "Checking your saved retrospective identity…"
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
              <p role="alert" className="text-destructive">
                {INVALID_ROOM_CODE_MESSAGE}
              </p>
            )}
            {mode === "join" &&
              !invalidRoute &&
              codeValue &&
              !validCode(codeValue) && (
                <p role="alert" className="text-destructive">
                  {INVALID_ROOM_CODE_MESSAGE}
                </p>
              )}
            {inspectedRoom && !inspectedRoom.available && (
              <output className="block">
                This room link is expired, closed, full, or does not exist. No
                room details were shared.
              </output>
            )}
            {inspectedRoom?.available && inspectedRoom.requiresPassword && (
              <output className="block">
                This room requires access verification before anyone can join.
                No room details were shared.
              </output>
            )}
            {rememberedStatus === "invalid" && !remembered && (
              <output>
                This saved session could not be verified. Join as someone else.
              </output>
            )}
            {rememberedStatus === "forgotten" && !remembered && (
              <output>
                This session was forgotten. Join as someone else to enter this
                room.
              </output>
            )}
            {connection === "disconnected" &&
              !invalidRoute &&
              error?.code !== "room-expired" &&
              error?.code !== "invalid-session" && (
                <Button size="sm" variant="outline" onClick={retry}>
                  Retry connection
                </Button>
              )}
            {(error?.code === "room-expired" ||
              error?.code === "invalid-session" ||
              invalidRoute ||
              (inspectedRoom && !inspectedRoom.available)) && (
              <a className="block underline underline-offset-4" href="/retro">
                Start or join another room
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
                {name.trim() && (
                  <p className="text-sm text-muted-foreground">
                    Your entered name, {name.trim()}, is kept if you choose to
                    join as someone else.
                  </p>
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
                      disabled={disabled}
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
                        disabled={disabled}
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
              noValidate
              onSubmit={(event) => {
                event.preventDefault();
                if (mode === "create") {
                  if (!canSubmit) {
                    setNameTouched(true);
                    return;
                  }
                  void send({
                    type: "create",
                    name: normalizedName,
                    title: title.trim(),
                    ...(password ? { password } : {}),
                  });
                  return;
                }
                void submitJoin();
              }}
            >
              {mode === "join" && (
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
              {(mode === "create" || showJoinFields) && (
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
              )}
              {mode === "create" ? (
                <>
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
                  <div className="space-y-2">
                    <Label htmlFor="retro-password">
                      Room password <span>(optional)</span>
                    </Label>
                    <Input
                      id="retro-password"
                      type="password"
                      maxLength={100}
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      autoComplete="off"
                      placeholder="Use a separate channel to share it"
                      disabled={pending || connection !== "connected"}
                    />
                    <p className="text-xs text-muted-foreground">
                      A password keeps forwarded links from granting access. It
                      is never included in the room link or browser storage.
                    </p>
                  </div>
                </>
              ) : (
                showJoinFields &&
                needsPassword && (
                  <div className="space-y-2">
                    <Label htmlFor="retro-password">
                      Room password <span>(required)</span>
                    </Label>
                    <Input
                      id="retro-password"
                      type="password"
                      maxLength={100}
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      autoComplete="off"
                      required
                      disabled={pending || connection !== "connected"}
                    />
                    <p className="text-xs text-muted-foreground">
                      This protected room reveals nothing until the password is
                      verified. Your password is not saved in cookies, history,
                      or exports.
                    </p>
                  </div>
                )
              )}
              <Button
                className="w-full"
                type="submit"
                disabled={
                  mode === "create"
                    ? !canSubmit
                    : disabled ||
                      !validCode(codeValue) ||
                      (!!inspectedRoom && (!joinable || nameError !== null))
                }
              >
                {pending
                  ? checkingAvailability
                    ? "Checking room availability…"
                    : "Waiting for the room…"
                  : mode === "create"
                    ? "Create retrospective"
                    : !inspectedRoom
                      ? "Check room availability"
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
