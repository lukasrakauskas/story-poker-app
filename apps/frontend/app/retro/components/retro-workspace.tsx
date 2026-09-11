"use client";

import { useEffect, useState } from "react";
import type { RetroPhase } from "shared/retrospective";
import { Button } from "ui/components/button";
import { useRetro } from "./retro-provider";
import { RetroLobby } from "./retro-lobby";
import { NoteBoard } from "./note-board";
import { ActionItems } from "./action-items";
import { RoomDetails } from "./room-details";

const phases: {
  id: RetroPhase;
  label: string;
  description: string;
  next?: string;
}[] = [
  {
    id: "write",
    label: "Write",
    description:
      "Add your thoughts to the board. All notes are visible to everyone; only you can edit yours.",
    next: "Start voting",
  },
  {
    id: "vote",
    label: "Vote",
    description:
      "Choose your priorities. Three votes per person, one per note. Click a voted note again to remove your vote.",
    next: "Start discussion",
  },
  {
    id: "discuss",
    label: "Discuss",
    description:
      "Explore your highest-voted notes and agree on concrete next steps.",
    next: "Close retrospective",
  },
  {
    id: "closed",
    label: "Closed",
    description:
      "This retrospective is complete and read-only. Save the takeaways before the room expires.",
  },
];

export function RetroWorkspace({ initialCode }: { initialCode?: string }) {
  const { room, selfId, connection, pending, error, retry, send } = useRetro();
  const [now, setNow] = useState<number | null>(null);
  const hasRoom = room !== null;
  useEffect(() => {
    // Synchronize the browser clock after hydration, then keep the expiry boundary current.
    // oxlint-disable-next-line react/set-state-in-effect
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!hasRoom) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [hasRoom]);

  const expired =
    error?.code === "room-expired" ||
    !!(room && now !== null && now >= room.expiresAt);
  const invalid = error?.code === "invalid-session";
  const disabled =
    connection !== "connected" ||
    pending ||
    expired ||
    invalid ||
    room?.phase === "closed" ||
    !selfId;
  const moderator = !!room?.members.find((member) => member.id === selfId)
    ?.moderator;
  const current = phases.find((phase) => phase.id === room?.phase);
  const remaining = room
    ? Math.max(
        0,
        3 -
          room.notes.filter((note) => selfId && note.voterIds.includes(selfId))
            .length
      )
    : 3;
  const minutes =
    room && now !== null
      ? Math.max(0, Math.ceil((room.expiresAt - now) / 60000))
      : null;

  return (
    <main className="mx-auto max-w-[1600px] space-y-5 px-4 py-6 sm:px-8">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/30 px-4 py-3">
        <output className="text-sm">
          <span
            aria-hidden="true"
            className={`mr-2 inline-block h-2 w-2 rounded-full ${connection === "connected" ? "bg-emerald-500" : "bg-amber-500"}`}
          />
          {pending
            ? connection === "connecting"
              ? "Restoring your session…"
              : "Waiting for server confirmation…"
            : connection === "connecting"
              ? "Connecting to retrospective…"
              : connection === "connected"
                ? "Connected · changes sync live"
                : "Disconnected · changes are disabled"}
        </output>
        {connection === "disconnected" && !expired && !invalid && (
          <Button size="sm" variant="outline" onClick={retry}>
            Retry connection
          </Button>
        )}
      </div>
      {error && (
        <div
          role="alert"
          className="space-y-2 rounded-lg border border-destructive/50 bg-destructive/5 p-4 text-sm"
        >
          <p className="font-medium">{error.message}</p>
          {invalid && (
            <p>
              Your identity could not be restored. The last snapshot is
              read-only. Rejoin with a new identity; you cannot reclaim your old
              notes or moderator role.
            </p>
          )}
          {(invalid || error.code === "room-expired") && (
            <a
              className="inline-block underline underline-offset-4"
              href={
                invalid && room
                  ? `/retro/${encodeURIComponent(room.code)}`
                  : "/retro"
              }
            >
              {invalid
                ? "Rejoin as a new participant"
                : "Start or join another room"}
            </a>
          )}
        </div>
      )}
      <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 px-4 py-3 text-sm">
        <strong>Keep this tab open.</strong> Your identity is held only in
        memory. Reloading or leaving loses your identity, note ownership, and
        moderator access. Reconnecting in this tab can restore your session.
        Rooms expire permanently two hours after creation.
      </div>
      {!room ? (
        <RetroLobby initialCode={initialCode} />
      ) : (
        <>
          <header className="space-y-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0 space-y-1">
                <p className="text-sm text-muted-foreground">
                  Retrospective · Room {room.code}
                </p>
                <h1 className="break-words text-3xl font-semibold tracking-tight">
                  {room.title}
                </h1>
              </div>
              <div
                className={`rounded-md border px-3 py-2 text-sm ${expired || (minutes !== null && minutes <= 15) ? "border-amber-500/50 bg-amber-500/10" : "text-muted-foreground"}`}
              >
                {expired
                  ? "Room expired · read-only snapshot"
                  : minutes === null
                    ? "Expires two hours after creation"
                    : `Expires in ${minutes} min`}
                {now !== null && (
                  <p className="mt-1 text-xs">
                    {new Date(room.expiresAt).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}{" "}
                    · not extended by activity
                  </p>
                )}
              </div>
            </div>
            {(expired || (minutes !== null && minutes <= 15)) && (
              <p role="alert" className="text-sm font-medium">
                {expired
                  ? "This room has expired. You can still export the last snapshot from this tab; no further changes are possible."
                  : "This room expires soon. Export your notes and actions now so you don’t lose them."}
              </p>
            )}
            <ol
              aria-label="Retrospective phases"
              className="grid grid-cols-2 gap-2 sm:grid-cols-4"
            >
              {phases.map((phase, index) => (
                <li
                  key={phase.id}
                  aria-current={room.phase === phase.id ? "step" : undefined}
                  className={`rounded-md border px-3 py-2 text-sm ${room.phase === phase.id ? "border-primary bg-primary text-primary-foreground font-medium" : "text-muted-foreground"}`}
                >
                  {index + 1}. {phase.label}
                </li>
              ))}
            </ol>
            <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border p-4">
              <div className="max-w-2xl space-y-1">
                <h2 className="font-semibold">
                  {room.phase === "closed"
                    ? "Retrospective complete"
                    : `${current?.label} together`}
                  {room.phase === "closed" ? " · read-only" : ""}
                </h2>
                <p className="text-sm text-muted-foreground">
                  {current?.description}
                </p>
                {room.phase === "vote" && (
                  <output className="block text-sm font-medium">
                    {remaining} of 3 votes remaining
                  </output>
                )}
                {!moderator && room.phase !== "closed" && (
                  <p className="text-xs text-muted-foreground">
                    The moderator moves the team to the next phase.
                  </p>
                )}
              </div>
              {moderator && current?.next && (
                <Button
                  disabled={disabled}
                  onClick={() => {
                    const message =
                      room.phase === "write"
                        ? "Start voting? Notes will be locked for everyone. You cannot return to writing."
                        : room.phase === "vote"
                          ? "Start discussion? Voting will end for everyone. You cannot return to voting."
                          : "Close this retrospective? All notes and actions will become read-only. This cannot be undone.";
                    if (window.confirm(message)) void send({ type: "advance" });
                  }}
                >
                  {current.next}
                </Button>
              )}
            </div>
          </header>
          <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
            <div className="min-w-0 space-y-6">
              <NoteBoard
                room={room}
                selfId={selfId}
                disabled={disabled}
                send={send}
              />
            </div>
            <aside
              aria-label="Room information and actions"
              className="space-y-4"
            >
              {(room.phase === "discuss" || room.phase === "closed") && (
                <ActionItems
                  room={room}
                  moderator={moderator}
                  disabled={disabled}
                  send={send}
                />
              )}
              <RoomDetails room={room} selfId={selfId} />
            </aside>
          </div>
        </>
      )}
    </main>
  );
}
