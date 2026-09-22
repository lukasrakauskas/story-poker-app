"use client";

import { useId, useState } from "react";
import { retroPriorities, priorityLabel } from "shared/retro-priorities";
import type { RetroColumn, RetroNote, RetroRoom } from "shared/retrospective";
import type { RetroSession } from "../../../hooks/use-retro-socket";
import { Button } from "ui/components/button";
import { Label } from "ui/components/label";
import { Badge } from "ui/components/badge";
import { Textarea } from "ui/components/textarea";
import { ItemActions } from "./item-actions";

export const columns: {
  id: RetroColumn;
  title: string;
  prompt: string;
  accent: string;
}[] = [
  {
    id: "went-well",
    title: "Went well",
    prompt: "What should we celebrate or keep doing?",
    accent: "border-t-emerald-500",
  },
  {
    id: "improve",
    title: "To improve",
    prompt: "What slowed us down or could be better?",
    accent: "border-t-amber-500",
  },
  {
    id: "ideas",
    title: "Ideas",
    prompt: "What could we try next time?",
    accent: "border-t-sky-500",
  },
];

function votingTargets(notes: RetroNote[]): RetroNote[][] {
  const seen = new Set<string>();
  const targets: RetroNote[][] = [];
  for (const note of notes) {
    if (!note.stackId) {
      targets.push([note]);
      continue;
    }
    if (seen.has(note.stackId)) continue;
    seen.add(note.stackId);
    targets.push(
      notes.filter((candidate) => candidate.stackId === note.stackId)
    );
  }
  return targets;
}

type BoardProps = {
  room: RetroRoom;
  selfId: string | null;
  disabled: boolean;
  send: RetroSession["send"];
  onDraftChange?: (column: RetroColumn, hasDraft: boolean) => void;
};

export function NoteBoard({
  room,
  selfId,
  disabled,
  send,
  onDraftChange,
}: BoardProps) {
  const rankedHeading = useId();
  const targets = votingTargets(room.notes);
  const remaining = Math.max(
    0,
    3 - room.notes.filter((note) => note.votedBySelf).length
  );
  if (room.phase === "vote") {
    return (
      <section aria-labelledby="voting-targets" className="space-y-4">
        <div>
          <h2 id="voting-targets" className="text-xl font-semibold">
            Vote on notes
          </h2>
          <p className="text-sm text-muted-foreground">
            Choose up to three original messages. Related messages remain
            visibly grouped, and totals stay hidden until discussion.
          </p>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {targets.map((notes) => (
            <VotingTargetCard
              key={notes[0]?.stackId ?? notes[0]?.id}
              notes={notes}
              room={room}
              selfId={selfId}
              disabled={disabled}
              send={send}
              remaining={remaining}
            />
          ))}
        </div>
      </section>
    );
  }
  if (room.phase === "discuss" || room.phase === "closed") {
    const ranked = retroPriorities(room);
    return (
      <section aria-labelledby={rankedHeading} className="space-y-4">
        <div>
          <h2 id={rankedHeading} className="text-xl font-semibold">
            Discussion priorities
          </h2>
          <p className="text-sm text-muted-foreground">
            Most-voted notes first. Start at the top and capture your next
            steps. Equal votes share a rank, with ties kept in lane order.
          </p>
        </div>
        {ranked.length ? (
          <ol className="space-y-3">
            {ranked.map((target) => (
              <li key={target.id} className="flex items-start gap-3">
                <span
                  className="pt-4 text-sm tabular-nums text-muted-foreground"
                  aria-label={priorityLabel(target)}
                >
                  {target.rank}.
                  {target.tied && <span className="block text-xs">Tied</span>}
                </span>
                <div className="min-w-0 flex-1">
                  <DiscussionTargetCard
                    notes={target.notes}
                    totalVotes={target.voteCount ?? 0}
                    room={room}
                    selfId={selfId}
                    disabled={disabled}
                    send={send}
                    remaining={remaining}
                  />
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
            No notes were added. You can still capture action items from your
            discussion.
          </p>
        )}
      </section>
    );
  }
  return (
    <section
      aria-label="Retrospective notes"
      className="grid items-start gap-4 lg:grid-cols-3"
    >
      {columns.map((column) => (
        <section
          key={column.id}
          aria-labelledby={`heading-${column.id}`}
          className={`min-w-0 rounded-lg border border-t-4 bg-muted/30 p-4 ${column.accent}`}
        >
          <div className="mb-4 space-y-1">
            <h2 id={`heading-${column.id}`} className="font-semibold">
              {column.title}{" "}
              <Badge variant="secondary" size="count" className="ml-1">
                {room.notes.filter((note) => note.column === column.id).length}
              </Badge>
            </h2>
            <p className="text-sm text-muted-foreground">{column.prompt}</p>
          </div>
          <div className="space-y-3">
            {room.notes
              .filter((note) => note.column === column.id)
              .map((note) => (
                <NoteCard
                  key={note.id}
                  note={note}
                  room={room}
                  selfId={selfId}
                  disabled={disabled}
                  send={send}
                  remaining={remaining}
                />
              ))}
            {!room.notes.some((note) => note.column === column.id) && (
              <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                {room.phase === "write"
                  ? "Make space for a first thought."
                  : "No notes in this column."}
              </p>
            )}
            {room.phase === "write" && (
              <AddNote
                column={column.id}
                disabled={disabled}
                send={send}
                onDraftChange={onDraftChange}
              />
            )}
          </div>
        </section>
      ))}
    </section>
  );
}

function AddNote({
  column,
  disabled,
  send,
  onDraftChange,
}: {
  column: RetroColumn;
  disabled: boolean;
  send: RetroSession["send"];
  onDraftChange?: (column: RetroColumn, hasDraft: boolean) => void;
}) {
  const [text, setText] = useState("");
  return (
    <form
      className="space-y-2 pt-2"
      onSubmit={async (event) => {
        event.preventDefault();
        if (!text.trim() || disabled) return;
        if (await send({ type: "add-note", column, text: text.trim() })) {
          setText("");
          onDraftChange?.(column, false);
        }
      }}
    >
      <Label htmlFor={`new-${column}`}>Add a note</Label>
      <Textarea
        id={`new-${column}`}
        maxLength={1000}
        className="min-h-24 resize-y"
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          onDraftChange?.(column, event.target.value.length > 0);
        }}
        placeholder="One thought per note…"
        required
        disabled={disabled}
      />
      <Button
        type="submit"
        variant="secondary"
        className="w-full"
        disabled={disabled || !text.trim()}
      >
        Add to {columns.find((item) => item.id === column)?.title.toLowerCase()}
      </Button>
    </form>
  );
}

// Focus only when the editor mounts after an explicit Edit click.
function focusEditor(element: HTMLTextAreaElement | null) {
  element?.focus();
}

function VotingTargetCard({
  notes,
  room,
  selfId,
  disabled,
  send,
  remaining,
}: BoardProps & { notes: RetroNote[]; remaining: number }) {
  const representative = notes[0];
  if (!representative) return null;
  if (notes.length === 1)
    return (
      <NoteCard
        note={representative}
        room={room}
        selfId={selfId}
        disabled={disabled}
        send={send}
        remaining={remaining}
        showColumn
      />
    );

  const moderator = room.members.some(
    (member) => member.id === selfId && member.moderator
  );
  const canDelete = moderator && room.phase === "vote";
  return (
    <article className="overflow-hidden rounded-lg border bg-card text-card-foreground shadow-sm">
      <div className="flex items-center justify-between gap-2 border-b bg-muted/40 px-4 py-3">
        <Badge variant="secondary" size="count">
          {notes.length} grouped messages
        </Badge>
        <Badge variant="outline">
          {columns.find((column) => column.id === representative.column)?.title}
        </Badge>
      </div>
      <div className="divide-y">
        {notes.map((note) => (
          <section key={note.id} className="space-y-2 px-4 py-3">
            <div className="flex items-start justify-between gap-2 text-xs text-muted-foreground">
              <span className="min-w-0 break-words">
                {note.authorName}
                {note.authorId === selfId ? " (you)" : ""}
              </span>
              {canDelete && (
                <ItemActions
                  kind="note"
                  text={note.text}
                  disabled={disabled}
                  onDelete={() => send({ type: "delete-note", id: note.id })}
                />
              )}
            </div>
            <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
              {note.text}
            </p>
            <Button
              size="sm"
              variant={note.votedBySelf ? "default" : "outline"}
              aria-pressed={note.votedBySelf}
              aria-label={`${note.votedBySelf ? "Remove vote from" : "Vote for"} note: ${note.text}`}
              disabled={disabled || (!note.votedBySelf && remaining === 0)}
              onClick={() => void send({ type: "toggle-vote", id: note.id })}
            >
              {note.votedBySelf ? "Voted" : "Vote"}
            </Button>
          </section>
        ))}
      </div>
    </article>
  );
}

function DiscussionTargetCard({
  notes,
  totalVotes,
  room,
  selfId,
  disabled,
  send,
  remaining,
}: BoardProps & {
  notes: RetroNote[];
  totalVotes: number;
  remaining: number;
}) {
  const representative = notes[0];
  if (!representative) return null;
  if (notes.length === 1)
    return (
      <NoteCard
        note={representative}
        room={room}
        selfId={selfId}
        disabled={disabled}
        send={send}
        remaining={remaining}
        showColumn
      />
    );

  const moderator = room.members.some(
    (member) => member.id === selfId && member.moderator
  );
  return (
    <article className="overflow-hidden rounded-lg border bg-card text-card-foreground shadow-sm">
      <div className="flex items-center justify-between gap-2 border-b bg-muted/40 px-4 py-3">
        <Badge variant="secondary" size="count">
          {notes.length} grouped messages
        </Badge>
        <Badge variant="outline">
          {columns.find((column) => column.id === representative.column)?.title}
        </Badge>
      </div>
      <div className="divide-y">
        {notes.map((note) => (
          <section key={note.id} className="space-y-2 px-4 py-3">
            <div className="flex items-start justify-between gap-2 text-xs text-muted-foreground">
              <span className="min-w-0 break-words">
                {note.authorName}
                {note.authorId === selfId ? " (you)" : ""}
              </span>
              <div className="flex items-center gap-2">
                <span>
                  {note.voteCount ?? 0}{" "}
                  {note.voteCount === 1 ? "vote" : "votes"}
                </span>
                {moderator && room.phase === "discuss" && (
                  <ItemActions
                    kind="note"
                    text={note.text}
                    disabled={disabled}
                    onDelete={() => send({ type: "delete-note", id: note.id })}
                  />
                )}
              </div>
            </div>
            <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
              {note.text}
            </p>
          </section>
        ))}
      </div>
      <p className="border-t px-4 py-3 text-xs font-medium text-muted-foreground">
        {totalVotes} {totalVotes === 1 ? "vote" : "votes"} across group
      </p>
    </article>
  );
}

function NoteCard({
  note,
  room,
  selfId,
  disabled,
  send,
  remaining,
  showColumn = false,
}: BoardProps & { note: RetroNote; remaining: number; showColumn?: boolean }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(note.text);
  const own = note.authorId === selfId;
  const moderator = room.members.some(
    (member) => member.id === selfId && member.moderator
  );
  const canEdit = room.phase === "write" && own;
  const canDelete =
    (room.phase === "write" && own) ||
    (moderator &&
      (room.phase === "group" ||
        room.phase === "vote" ||
        room.phase === "discuss"));
  const voted = note.votedBySelf;
  const author = note.authorName;
  return (
    <article className="space-y-3 rounded-lg border bg-card p-4 text-card-foreground shadow-sm">
      <div className="flex items-start justify-between gap-2 text-xs text-muted-foreground">
        <span className="min-w-0 break-words">
          {author}
          {own ? " (you)" : ""}
        </span>
        {showColumn && (
          <Badge variant="outline" className="shrink-0">
            {columns.find((column) => column.id === note.column)?.title}
          </Badge>
        )}
        {(canEdit || canDelete) && (
          <ItemActions
            kind="note"
            text={note.text}
            disabled={disabled || editing}
            onEdit={
              canEdit
                ? () => {
                    setText(note.text);
                    setEditing(true);
                  }
                : undefined
            }
            onDelete={() => send({ type: "delete-note", id: note.id })}
          />
        )}
      </div>
      {editing && canEdit ? (
        <form
          className="space-y-2"
          onSubmit={async (event) => {
            event.preventDefault();
            if (disabled || !text.trim()) return;
            if (
              await send({ type: "edit-note", id: note.id, text: text.trim() })
            )
              setEditing(false);
          }}
        >
          <Label htmlFor={`edit-${note.id}`}>Edit your note</Label>
          <Textarea
            id={`edit-${note.id}`}
            maxLength={1000}
            className="min-h-24 resize-y"
            value={text}
            onChange={(event) => setText(event.target.value)}
            required
            disabled={disabled}
            ref={focusEditor}
          />
          <div className="flex gap-2">
            <Button size="sm" type="submit" disabled={disabled || !text.trim()}>
              Save
            </Button>
            <Button
              size="sm"
              variant="ghost"
              type="button"
              onClick={() => setEditing(false)}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
          {note.text}
        </p>
      )}
      {room.phase === "vote" ? (
        <Button
          size="sm"
          variant={voted ? "default" : "outline"}
          aria-pressed={voted}
          aria-label={`${voted ? "Remove vote from" : "Vote for"} note: ${note.text}`}
          disabled={disabled || (!voted && remaining === 0)}
          onClick={() => void send({ type: "toggle-vote", id: note.id })}
        >
          {voted ? "Voted" : "Vote"}
        </Button>
      ) : (
        (room.phase === "discuss" || room.phase === "closed") && (
          <p className="text-xs font-medium text-muted-foreground">
            {note.voteCount ?? 0} {note.voteCount === 1 ? "vote" : "votes"}
          </p>
        )
      )}
    </article>
  );
}
