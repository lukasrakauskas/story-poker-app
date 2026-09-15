"use client";

import { useEffect, useState } from "react";
import { actionOwnerLabel } from "shared/retrospective";
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
  deleteAllRetroHistory,
  deleteRetroHistory,
  readRetroHistory,
  retroHistoryKey,
  RETRO_HISTORY_CHANGED,
  RETRO_HISTORY_POLICY_CHANGED,
  type SavedRetro,
} from "../../../lib/retro-history";
import { RetroExport } from "./retro-export";
import { NoteBoard } from "./note-board";

const columns = [
  { id: "went-well", title: "Went well" },
  { id: "improve", title: "To improve" },
  { id: "ideas", title: "Ideas" },
] as const;

export function RetroHistory() {
  const [entries, setEntries] = useState<SavedRetro[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [now, setNow] = useState(0);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const refresh = () => {
      const history = readRetroHistory();
      setEntries(history.entries);
      setError(history.error);
      setLoaded(true);
      setNow(Date.now());
    };
    refresh();
    window.addEventListener("storage", refresh);
    window.addEventListener(RETRO_HISTORY_CHANGED, refresh);
    window.addEventListener(RETRO_HISTORY_POLICY_CHANGED, refresh);
    return () => {
      window.removeEventListener("storage", refresh);
      window.removeEventListener(RETRO_HISTORY_CHANGED, refresh);
      window.removeEventListener(RETRO_HISTORY_POLICY_CHANGED, refresh);
    };
  }, []);

  return (
    <main className="mx-auto max-w-4xl space-y-6 px-4 py-8 sm:px-8">
      <a href="/retro" className="text-sm underline underline-offset-4">
        Start or join a retrospective
      </a>
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">
          Previous retrospectives
        </h1>
        <p className="text-sm text-muted-foreground">
          Saved on this browser without an account, including notes, names, and
          action items. History is saved only after a participant chooses a
          room-level preference; clearing browser data removes it and it does
          not sync across devices. Anyone using this browser profile can see it.
        </p>
        <p className="text-sm text-muted-foreground">
          Completed retros contain the final actions received while connected.
          Recovery entries are explicitly consented, may be incomplete, and
          contain only the private writing visible to the browser that saved
          them. An exported file is a separate backup; deleting local history
          does not delete that file.
        </p>
      </header>
      <section className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4">
        <div>
          <h2 className="font-semibold">Manage browser history</h2>
          <p className="text-sm text-muted-foreground">
            Delete all saved retrospectives and pause future live saves in every
            open tab until each room is explicitly chosen again.
          </p>
        </div>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="destructive" size="sm">
              Delete all retrospective history
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                Delete all retrospective history?
              </AlertDialogTitle>
              <AlertDialogDescription>
                This removes every saved retrospective from this browser and
                stops open rooms from recreating entries. It does not delete the
                live rooms or exported files and cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                onClick={(event) => {
                  if (deleteAllRetroHistory()) return;
                  event.preventDefault();
                  setError(
                    "Could not delete all retrospective history. Check browser storage permissions."
                  );
                }}
              >
                Delete all history
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </section>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {!loaded ? (
        <p>Loading saved retrospectives…</p>
      ) : !entries.length ? (
        <p className="rounded-lg border border-dashed p-6 text-muted-foreground">
          No saved retrospectives yet. Join a room and choose a history
          preference to save an outcome or consented recovery snapshots.
        </p>
      ) : (
        entries.map(({ room, savedAt, viewerId }) => (
          <article
            key={retroHistoryKey(room)}
            className="space-y-4 rounded-lg border p-4 sm:p-6"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 space-y-1">
                <h2 className="break-words text-xl font-semibold">
                  {room.title}
                </h2>
                <p className="text-sm text-muted-foreground">
                  Room {room.code} ·{" "}
                  {room.phase === "closed"
                    ? "Completed · final actions"
                    : `Last seen in ${room.phase} · may be incomplete`}
                </p>
                <p className="text-xs text-muted-foreground">
                  Saved {new Date(savedAt).toLocaleString()}
                </p>
              </div>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="outline" size="sm">
                    Delete saved retro
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>
                      Delete this saved retrospective?
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      Delete “{room.title}” from this browser? This does not
                      delete the live room, but it also stops open tabs from
                      recreating this entry until you choose again. It cannot be
                      undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      variant="destructive"
                      onClick={(event) => {
                        if (deleteRetroHistory(room)) return;
                        event.preventDefault();
                        setError(
                          "Could not delete this saved retrospective. Check browser storage permissions."
                        );
                      }}
                    >
                      Delete saved retro
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
            {room.expiresAt > now && (
              <a
                className="inline-block text-sm underline underline-offset-4"
                href={`/retro/${encodeURIComponent(room.code)}`}
              >
                Return to room
              </a>
            )}
            <section
              aria-label={`Action items for ${room.title}`}
              className="space-y-2"
            >
              <h3 className="font-semibold">Action items</h3>
              {!room.actions.length ? (
                <p className="text-sm text-muted-foreground">
                  No action items in this snapshot.
                </p>
              ) : (
                <ul className="space-y-2">
                  {room.actions.map((action) => (
                    <li
                      key={action.id}
                      className="rounded-md bg-muted/40 p-3 text-sm"
                    >
                      <p className="whitespace-pre-wrap break-words">
                        {action.text}
                      </p>
                      <p className="mt-1 break-words text-muted-foreground">
                        {action.done ? "Done" : "Open"} ·{" "}
                        {actionOwnerLabel(action.owner)}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <details className="space-y-4">
              <summary className="cursor-pointer text-sm font-medium">
                View saved notes and participants
              </summary>
              <p className="break-words text-sm text-muted-foreground">
                People:{" "}
                {room.members
                  .map(
                    (member) =>
                      `${member.name}${member.moderator ? " (moderator)" : ""}`
                  )
                  .join(", ")}
              </p>
              {room.phase === "discuss" || room.phase === "closed" ? (
                <NoteBoard
                  room={room}
                  selfId={null}
                  disabled
                  send={async () => false}
                />
              ) : (
                columns.map((column) => (
                  <section key={column.id} className="space-y-2">
                    <h3 className="font-semibold">{column.title}</h3>
                    <ul className="space-y-2">
                      {room.notes
                        .filter((note) => note.column === column.id)
                        .sort(
                          (a, b) => (b.voteCount ?? -1) - (a.voteCount ?? -1)
                        )
                        .map((note) => (
                          <li
                            key={note.id}
                            className="rounded-md bg-muted/40 p-3 text-sm"
                          >
                            <p className="whitespace-pre-wrap break-words">
                              {note.text}
                            </p>
                            {note.groupId && (
                              <p className="mt-1 text-muted-foreground">
                                Theme:{" "}
                                {room.groups.find(
                                  (group) => group.id === note.groupId
                                )?.title ?? "Former theme"}
                              </p>
                            )}
                            <p className="mt-1 text-muted-foreground">
                              {note.groupId
                                ? "Votes counted with theme"
                                : note.voteCount === null
                                  ? "Votes hidden"
                                  : `${note.voteCount} votes`}{" "}
                              {" · "}
                              {note.authorName}
                            </p>
                          </li>
                        ))}
                    </ul>
                  </section>
                ))
              )}
            </details>
            <RetroExport room={room} selfId={viewerId} />
          </article>
        ))
      )}
    </main>
  );
}
