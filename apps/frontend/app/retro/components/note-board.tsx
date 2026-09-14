"use client";

import { useState } from "react";
import type {
  RetroColumn,
  RetroGroup,
  RetroNote,
  RetroRoom,
} from "shared/retrospective";
import type { RetroSession } from "../../../hooks/use-retro-socket";
import { Button } from "ui/components/button";
import { Label } from "ui/components/label";
import { Badge } from "ui/components/badge";
import { Textarea } from "ui/components/textarea";
import { ItemActions } from "./item-actions";
import { NoteStack } from "./note-stack";

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
  const remaining = Math.max(
    0,
    3 -
      room.notes.filter((note) => note.votedBySelf).length -
      room.groups.filter((group) => group.votedBySelf).length
  );
  const ungrouped = room.notes.filter((note) => !note.groupId);
  if (room.phase === "vote") {
    return (
      <section aria-labelledby="voting-targets" className="space-y-4">
        <div>
          <h2 id="voting-targets" className="text-xl font-semibold">
            Vote on themes and notes
          </h2>
          <p className="text-sm text-muted-foreground">
            Each theme is one voting target. Ungrouped notes remain individual
            choices.
          </p>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {room.groups.map((group) => (
            <ThemeCard
              key={group.id}
              group={group}
              room={room}
              selfId={selfId}
              disabled={disabled}
              send={send}
              remaining={remaining}
            />
          ))}
          {ungrouped.map((note) => (
            <NoteCard
              key={note.id}
              note={note}
              room={room}
              selfId={selfId}
              disabled={disabled}
              send={send}
              remaining={remaining}
              showColumn
            />
          ))}
        </div>
      </section>
    );
  }
  if (room.phase === "discuss" || room.phase === "closed") {
    const ranked = [
      ...room.groups.map((group) => ({
        id: group.id,
        voteCount: group.voteCount,
        group,
      })),
      ...ungrouped.map((note) => ({
        id: note.id,
        voteCount: note.voteCount,
        note,
      })),
    ].sort(
      (a, b) =>
        (b.voteCount ?? 0) - (a.voteCount ?? 0) || a.id.localeCompare(b.id)
    );
    return (
      <section aria-labelledby="ranked-notes" className="space-y-4">
        <div>
          <h2 id="ranked-notes" className="text-xl font-semibold">
            Discussion priorities
          </h2>
          <p className="text-sm text-muted-foreground">
            Most-voted themes and notes first. Start at the top and capture your
            next steps.
          </p>
        </div>
        {ranked.length ? (
          <ol className="space-y-3">
            {ranked.map((target, index) => (
              <li key={target.id} className="flex items-start gap-3">
                <span
                  className="pt-4 text-sm tabular-nums text-muted-foreground"
                  aria-label={`Rank ${index + 1}`}
                >
                  {index + 1}.
                </span>
                <div className="min-w-0 flex-1">
                  {"group" in target ? (
                    <ThemeCard
                      group={target.group}
                      room={room}
                      selfId={selfId}
                      disabled={disabled}
                      send={send}
                      remaining={remaining}
                    />
                  ) : (
                    <NoteCard
                      note={target.note}
                      room={room}
                      selfId={selfId}
                      disabled={disabled}
                      send={send}
                      remaining={remaining}
                      showColumn
                    />
                  )}
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
              <Badge variant="secondary" className="ml-1 tabular-nums">
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

function ThemeCard({
  group,
  room,
  selfId,
  disabled,
  send,
  remaining,
}: BoardProps & { group: RetroGroup; remaining: number }) {
  const moderator = room.members.some(
    (member) => member.id === selfId && member.moderator
  );
  const notes = room.notes.filter((note) => note.groupId === group.id);
  return (
    <NoteStack title={group.title} count={notes.length}>
      <ul className="space-y-2">
        {notes.map((note) => (
          <li
            key={note.id}
            className="flex items-start justify-between gap-2 rounded-md border bg-muted/20 p-3 text-sm"
          >
            <div className="min-w-0">
              <p className="whitespace-pre-wrap break-words">{note.text}</p>
              <p className="text-xs text-muted-foreground">{note.authorName}</p>
            </div>
            {moderator &&
              (room.phase === "vote" || room.phase === "discuss") && (
                <ItemActions
                  kind="note"
                  text={note.text}
                  disabled={disabled}
                  onDelete={() => send({ type: "delete-note", id: note.id })}
                />
              )}
          </li>
        ))}
      </ul>
      {room.phase === "vote" ? (
        <Button
          size="sm"
          variant={group.votedBySelf ? "default" : "outline"}
          aria-pressed={group.votedBySelf}
          aria-label={`${group.votedBySelf ? "Remove vote from" : "Vote for"} theme: ${group.title}`}
          disabled={disabled || (!group.votedBySelf && remaining === 0)}
          onClick={() => void send({ type: "toggle-vote", id: group.id })}
        >
          {group.votedBySelf ? "Voted" : "Vote"}
        </Button>
      ) : (
        <p className="text-xs font-medium text-muted-foreground">
          {group.voteCount ?? 0} {group.voteCount === 1 ? "vote" : "votes"}
        </p>
      )}
    </NoteStack>
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
        {room.phase === "group" && note.groupId && (
          <Badge variant="secondary" className="shrink-0">
            {room.groups.find((group) => group.id === note.groupId)?.title}
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
