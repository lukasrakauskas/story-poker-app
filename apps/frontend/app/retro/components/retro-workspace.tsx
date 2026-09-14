"use client";

import { useEffect, useState } from "react";
import type { RetroColumn, RetroPhase } from "shared/retrospective";
import { Button } from "ui/components/button";
import { RetroProvider, useRetro } from "./retro-provider";
import { RetroLobby } from "./retro-lobby";
import { NoteBoard } from "./note-board";
import { NoteGrouping } from "./note-grouping";
import { ActionItems } from "./action-items";
import { RoomDetails } from "./room-details";
import { PhaseAdvanceDialog } from "./phase-advance-dialog";
import { RetroExport } from "./retro-export";
import { RetroStatus } from "./retro-status";

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
      "Write independently. Only you can see your notes during this phase. Revealing the board shows every note to the team at the same time.",
    next: "Reveal and group notes",
  },
  {
    id: "group",
    label: "Group",
    description:
      "Review the revealed board. The moderator can organize related notes into themes before voting begins.",
    next: "Start voting",
  },
  {
    id: "vote",
    label: "Vote",
    description:
      "Choose your priorities. Three votes per person, one per note. Totals stay hidden until discussion; click a voted note again to remove your vote.",
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
      "This retrospective is complete and read-only. Find the saved snapshot in Previous retrospectives, or export a backup.",
  },
];

export function RetroWorkspace({ initialCode }: { initialCode?: string }) {
  return (
    <RetroProvider>
      <Workspace initialCode={initialCode} />
    </RetroProvider>
  );
}

function Workspace({ initialCode }: { initialCode?: string }) {
  const {
    room,
    selfId,
    connection,
    pending,
    error,
    retry,
    send,
    cookieSaved,
    historySaved,
  } = useRetro();
  const [now, setNow] = useState<number | null>(null);
  const [draftColumns, setDraftColumns] = useState<RetroColumn[]>([]);
  useEffect(() => {
    // Synchronize the browser clock after hydration, then keep the expiry boundary current.
    // oxlint-disable-next-line react/set-state-in-effect
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const expired =
    error?.code === "room-expired" ||
    !!(room && now !== null && now >= room.expiresAt);
  const removed = error?.code === "removed";
  const invalid = error?.code === "invalid-session" || removed;
  const disabled =
    connection !== "connected" ||
    pending ||
    expired ||
    invalid ||
    room?.phase === "closed" ||
    !selfId;
  const self = room?.members.find((member) => member.id === selfId);
  const moderator = !!self?.moderator;
  const current = phases.find((phase) => phase.id === room?.phase);
  const readinessPhase = room?.phase === "write" || room?.phase === "vote";
  const activeMembers = readinessPhase
    ? (room?.members ?? []).filter((member) => member.connected)
    : [];
  const readyMembers = activeMembers.filter((member) => member.ready);
  const notReadyNames = activeMembers
    .filter((member) => !member.ready)
    .map((member) => member.name);
  const remaining = room
    ? Math.max(
        0,
        3 -
          room.notes.filter((note) => note.votedBySelf).length -
          room.groups.filter((group) => group.votedBySelf).length
      )
    : 3;
  const minutes =
    room && now !== null
      ? Math.max(0, Math.ceil((room.expiresAt - now) / 60000))
      : null;
  const supportingError =
    error && ["configuration", "connection", "timeout"].includes(error.code)
      ? error
      : null;
  const actionError =
    error && !supportingError && !invalid && !expired ? error : null;

  return (
    <main className="mx-auto max-w-[1600px] space-y-5 px-4 py-6 sm:px-8">
      <nav
        className="flex flex-wrap gap-4 text-sm"
        aria-label="Retrospective navigation"
      >
        <a className="underline underline-offset-4" href="/retro">
          Start or join a room
        </a>
        <a className="underline underline-offset-4" href="/retro/history">
          Previous retrospectives
        </a>
      </nav>
      {room && (invalid || expired) && (
        <div
          role="alert"
          className="space-y-2 rounded-lg border border-destructive/50 bg-destructive/5 p-4 text-sm"
        >
          <p className="font-medium">
            {error?.message ??
              "This room has expired. The last snapshot is read-only."}
          </p>
          {invalid && (
            <p>
              {removed
                ? "Your former session and reconnect credential are no longer valid. Its existing notes keep their author attribution, but this browser cannot mutate them."
                : "This connection no longer owns the session. The last snapshot is read-only. If you reopened the room in another tab, use that tab or reopen it here. If the saved credential was rejected, join with a new name; the old notes and moderator role cannot be reclaimed."}
            </p>
          )}
          <a
            className="inline-block underline underline-offset-4"
            href={
              invalid && !removed
                ? `/retro/${encodeURIComponent(room.code)}`
                : "/retro"
            }
          >
            {invalid && !removed ? "Reopen room" : "Start or join another room"}
          </a>
        </div>
      )}
      {room && actionError && (
        <p
          role="alert"
          className="rounded-lg border border-destructive/50 bg-destructive/5 p-4 text-sm font-medium"
        >
          {actionError.message}
        </p>
      )}
      {!room ? (
        <RetroLobby initialCode={initialCode} />
      ) : (
        <>
          <header className="space-y-5">
            <div className="min-w-0 space-y-1">
              <p className="text-sm text-muted-foreground">
                Retrospective · Room {room.code}
              </p>
              <h1 className="break-words text-3xl font-semibold tracking-tight">
                {room.title}
              </h1>
            </div>
            <ol
              aria-label="Retrospective phases"
              className="grid grid-cols-2 gap-2 sm:grid-cols-5"
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
                {readinessPhase && self && (
                  <div className="flex flex-wrap items-center gap-2 pt-2">
                    <Button
                      size="sm"
                      variant={self.ready ? "secondary" : "outline"}
                      disabled={
                        disabled ||
                        (room.phase === "write" &&
                          !self.ready &&
                          draftColumns.length > 0)
                      }
                      onClick={() => void send({ type: "toggle-ready" })}
                    >
                      {self.ready
                        ? "Mark as not ready"
                        : room.phase === "write"
                          ? "Mark writing done"
                          : "Mark voting done"}
                    </Button>
                    {room.phase === "write" &&
                      !self.ready &&
                      draftColumns.length > 0 && (
                        <span className="text-xs font-medium text-destructive">
                          Submit or clear your note drafts before marking
                          writing done.
                        </span>
                      )}
                  </div>
                )}
                {readinessPhase && moderator && (
                  <output className="block text-sm font-medium">
                    {readyMembers.length} of {activeMembers.length} active
                    participants ready
                  </output>
                )}
                {!moderator && room.phase !== "closed" && (
                  <p className="text-xs text-muted-foreground">
                    The moderator moves the team to the next phase.
                  </p>
                )}
              </div>
              {moderator && current?.next && room.phase !== "closed" && (
                <PhaseAdvanceDialog
                  phase={room.phase}
                  label={current.next}
                  disabled={disabled}
                  notReadyNames={notReadyNames}
                  hasUnsentDraft={draftColumns.length > 0}
                  onConfirm={async () => {
                    const success = await send({ type: "advance" });
                    if (success) setDraftColumns([]);
                    return success;
                  }}
                />
              )}
            </div>
          </header>
          <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
            <RetroStatus
              className="order-1 xl:col-start-2 xl:row-start-1"
              connection={connection}
              pending={pending}
              error={supportingError}
              retry={retry}
              cookieSaved={cookieSaved}
              historySaved={historySaved}
              expired={expired}
              terminal={expired || invalid}
              minutes={minutes}
              expiresAt={room.expiresAt}
              phase={room.phase}
            />
            <div className="order-2 min-w-0 space-y-6 xl:col-start-1 xl:row-span-2 xl:row-start-1">
              {room.phase === "group" && moderator && (
                <NoteGrouping room={room} disabled={disabled} send={send} />
              )}
              <NoteBoard
                room={room}
                selfId={selfId}
                disabled={disabled}
                send={send}
                onDraftChange={(column, hasDraft) =>
                  setDraftColumns((currentDrafts) =>
                    hasDraft
                      ? currentDrafts.includes(column)
                        ? currentDrafts
                        : [...currentDrafts, column]
                      : currentDrafts.filter((item) => item !== column)
                  )
                }
              />
              {room.phase === "closed" && (
                <RetroExport room={room} selfId={selfId} />
              )}
            </div>
            <aside
              aria-label="Room information and actions"
              className="order-3 space-y-4 xl:col-start-2 xl:row-start-2"
            >
              {(room.phase === "discuss" || room.phase === "closed") && (
                <ActionItems
                  room={room}
                  moderator={moderator}
                  disabled={disabled}
                  send={send}
                />
              )}
              <RoomDetails
                room={room}
                selfId={selfId}
                disabled={disabled}
                send={send}
              />
            </aside>
          </div>
        </>
      )}
    </main>
  );
}
