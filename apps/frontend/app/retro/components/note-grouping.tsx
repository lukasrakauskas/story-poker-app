"use client";

import { useState, type ReactNode } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  pointerWithin,
  rectIntersection,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
} from "@dnd-kit/core";
import type { RetroNote, RetroRoom } from "shared/retrospective";
import type { RetroSession } from "../../../hooks/use-retro-socket";
import { GripVertical } from "lucide-react";
import { Button } from "ui/components/button";
import { Input } from "ui/components/input";
import { Label } from "ui/components/label";
import { ItemActions } from "./item-actions";
import { NoteStack } from "./note-stack";
import { columns } from "./note-board";

// Prefer the card/stack under the pointer over the enclosing ungroup area.
const collisionDetection: CollisionDetection = (args) => {
  const hits = args.pointerCoordinates
    ? pointerWithin(args)
    : rectIntersection(args);
  return hits.sort(
    (a, b) => Number(a.id === "ungroup") - Number(b.id === "ungroup")
  );
};

type Props = {
  room: RetroRoom;
  moderator: boolean;
  disabled: boolean;
  send: RetroSession["send"];
};

export function NoteGrouping({ room, moderator, disabled, send }: Props) {
  const [title, setTitle] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const locked = disabled || !moderator;
  const selectedIds = selected.filter((id) =>
    room.notes.some((note) => note.id === id)
  );
  const active = room.notes.find((note) => note.id === activeId);
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 200, tolerance: 5 },
    }),
    useSensor(KeyboardSensor)
  );

  function drop({ active, over }: DragEndEvent) {
    setActiveId(null);
    if (locked || !over) return;
    const note = room.notes.find((item) => item.id === active.id);
    if (!note) return;
    if (over.id === "ungroup") {
      if (note.groupId) void send({ type: "ungroup-note", id: note.id });
      return;
    }
    const target = over.data.current;
    if (target?.groupId) {
      if (target.groupId !== note.groupId)
        void send({ type: "move-note", id: note.id, groupId: target.groupId });
    } else if (target?.noteId && target.noteId !== note.id) {
      setSelected([target.noteId, note.id]);
      setTitle("");
      // Dropping two notes prepares a named theme, without an optimistic mutation.
      document.getElementById("theme-title")?.focus();
    }
  }

  function renderNote(note: RetroNote) {
    return (
      <GroupingNote
        key={note.id}
        note={note}
        room={room}
        moderator={moderator}
        disabled={locked}
        selected={selectedIds.includes(note.id)}
        onSelect={(checked) =>
          setSelected((current) =>
            checked
              ? [...current, note.id]
              : current.filter((id) => id !== note.id)
          )
        }
        send={send}
      />
    );
  }

  return (
    <section aria-label="Retrospective notes" className="space-y-5">
      <div className="space-y-1">
        <h2 className="font-semibold">Group related notes</h2>
        <p className="text-sm text-muted-foreground">
          {moderator
            ? "Drag a note onto another to name a theme, onto a stack to join it, or back to ungrouped notes. You can also select notes and use the move controls without dragging."
            : "The moderator is stacking related notes into themes. Changes appear here live."}{" "}
          Each theme receives one vote per person, regardless of its note count.
        </p>
      </div>
      <DndContext
        id="retro-grouping"
        sensors={sensors}
        collisionDetection={collisionDetection}
        onDragStart={({ active }) => setActiveId(String(active.id))}
        onDragCancel={() => setActiveId(null)}
        onDragEnd={drop}
        accessibility={{
          screenReaderInstructions: {
            draggable:
              "Press Space to pick up a note, arrow keys to move, Space to drop, or Escape to cancel. Alternatively, use the select and move controls on each note.",
          },
          announcements: {
            onDragStart: ({ active }) =>
              `Picked up ${room.notes.find((note) => note.id === active.id)?.text ?? "note"}.`,
            onDragOver: ({ over }) =>
              over
                ? `Over ${over.data.current?.label ?? "ungrouped notes"}.`
                : "Outside a drop target.",
            onDragEnd: ({ over }) =>
              over
                ? `Dropped on ${over.data.current?.label ?? "ungrouped notes"}.`
                : "No change made.",
            onDragCancel: () => "Drag cancelled. No change made.",
          },
        }}
      >
        {room.groups.length > 0 && (
          <section aria-label="Current themes" className="space-y-3">
            <h3 className="text-sm font-semibold">Current themes</h3>
            <div className="grid items-start gap-5 md:grid-cols-2">
              {room.groups.map((group) => (
                <DropTarget
                  key={group.id}
                  id={`group:${group.id}`}
                  disabled={locked}
                  data={{ groupId: group.id, label: group.title }}
                >
                  <NoteStack
                    title={group.title}
                    count={
                      room.notes.filter((note) => note.groupId === group.id)
                        .length
                    }
                  >
                    <div className="space-y-2">
                      {room.notes
                        .filter((note) => note.groupId === group.id)
                        .map(renderNote)}
                    </div>
                  </NoteStack>
                </DropTarget>
              ))}
            </div>
          </section>
        )}
        <DropTarget
          id="ungroup"
          disabled={locked}
          data={{ label: "ungrouped notes" }}
        >
          <section
            aria-label="Ungrouped notes"
            className="space-y-3 rounded-lg border border-dashed p-3"
          >
            <h3 className="text-sm font-semibold">Ungrouped notes</h3>
            <div className="grid items-start gap-3 lg:grid-cols-3">
              {columns.map((column) => (
                <section
                  key={column.id}
                  aria-label={column.title}
                  className={`min-w-0 space-y-3 rounded-lg border border-t-4 bg-muted/30 p-3 ${column.accent}`}
                >
                  <h4 className="text-sm font-medium">{column.title}</h4>
                  {room.notes
                    .filter(
                      (note) => !note.groupId && note.column === column.id
                    )
                    .map(renderNote)}
                  {!room.notes.some(
                    (note) => !note.groupId && note.column === column.id
                  ) && (
                    <p className="text-xs text-muted-foreground">
                      No ungrouped notes.
                    </p>
                  )}
                </section>
              ))}
            </div>
          </section>
        </DropTarget>
        <DragOverlay dropAnimation={null}>
          {active && (
            <div className="max-w-sm rotate-2 rounded-lg border bg-card p-4 text-sm shadow-xl">
              <p className="whitespace-pre-wrap break-words">{active.text}</p>
              <p className="mt-2 text-xs text-muted-foreground">
                {active.authorName}
              </p>
            </div>
          )}
        </DragOverlay>
      </DndContext>
      {moderator && (
        <form
          className="space-y-3 rounded-lg border p-4"
          onSubmit={async (event) => {
            event.preventDefault();
            if (locked || selectedIds.length < 2 || !title.trim()) return;
            if (
              await send({
                type: "group-notes",
                title: title.trim(),
                noteIds: selectedIds,
              })
            ) {
              setTitle("");
              setSelected([]);
            }
          }}
        >
          <Label htmlFor="theme-title">Theme name</Label>
          <Input
            id="theme-title"
            value={title}
            maxLength={100}
            disabled={locked}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="For example: Team communication"
          />
          <p className="text-xs text-muted-foreground">
            Drop two notes together or select at least two notes above, then
            name their theme.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="submit"
              disabled={locked || selectedIds.length < 2 || !title.trim()}
            >
              Create theme from {selectedIds.length} notes
            </Button>
            {selectedIds.length > 0 && (
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setSelected([]);
                  setTitle("");
                }}
              >
                Clear selection
              </Button>
            )}
          </div>
        </form>
      )}
    </section>
  );
}

function DropTarget({
  id,
  disabled,
  data,
  children,
}: {
  id: string;
  disabled: boolean;
  data: { groupId?: string; noteId?: string; label: string };
  children: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id, disabled, data });
  return (
    <div
      ref={setNodeRef}
      data-drop-target={id}
      className={`min-w-0 rounded-lg transition-colors ${isOver ? "bg-primary/10 ring-2 ring-primary" : ""}`}
    >
      {children}
    </div>
  );
}

function GroupingNote({
  note,
  room,
  moderator,
  disabled,
  selected,
  onSelect,
  send,
}: Props & {
  note: RetroNote;
  selected: boolean;
  onSelect: (checked: boolean) => void;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, isDragging } =
    useDraggable({ id: note.id, disabled });
  return (
    <DropTarget
      id={`note:${note.id}`}
      disabled={disabled || isDragging}
      data={{
        noteId: note.id,
        groupId: note.groupId ?? undefined,
        label: note.text,
      }}
    >
      <article
        ref={setNodeRef}
        className={`space-y-2 rounded-md border bg-card p-3 text-card-foreground shadow-sm ${isDragging ? "opacity-30" : ""}`}
      >
        <div className="flex items-center gap-2">
          {moderator && (
            <>
              <button
                ref={setActivatorNodeRef}
                type="button"
                {...attributes}
                {...listeners}
                aria-label={`Drag note: ${note.text}`}
                disabled={disabled}
                className="touch-none rounded p-2 text-muted-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50"
              >
                <GripVertical className="size-4" />
              </button>
              <input
                type="checkbox"
                aria-label={note.text}
                checked={selected}
                disabled={disabled}
                onChange={(event) => onSelect(event.target.checked)}
                className="size-4"
              />
            </>
          )}
          <span className="min-w-0 flex-1 break-words text-xs text-muted-foreground">
            {note.authorName}
          </span>
          {moderator && (
            <ItemActions
              kind="note"
              text={note.text}
              disabled={disabled}
              onDelete={() => send({ type: "delete-note", id: note.id })}
            />
          )}
        </div>
        <p className="whitespace-pre-wrap break-words text-sm">{note.text}</p>
        <p className="text-xs text-muted-foreground">
          {columns.find((column) => column.id === note.column)?.title}
        </p>
        {moderator && (
          <div className="space-y-2">
            {room.groups.some((group) => group.id !== note.groupId) && (
              <select
                aria-label={`Move note to theme: ${note.text}`}
                className="w-full rounded border bg-background p-2 text-sm"
                disabled={disabled}
                value=""
                onChange={(event) => {
                  if (event.target.value)
                    void send({
                      type: "move-note",
                      id: note.id,
                      groupId: event.target.value,
                    });
                }}
              >
                <option value="">Move to theme…</option>
                {room.groups
                  .filter((group) => group.id !== note.groupId)
                  .map((group) => (
                    <option key={group.id} value={group.id}>
                      {group.title}
                    </option>
                  ))}
              </select>
            )}
            {note.groupId && (
              <Button
                size="sm"
                variant="ghost"
                disabled={disabled}
                aria-label={`Remove note from theme: ${note.text}`}
                onClick={() => void send({ type: "ungroup-note", id: note.id })}
              >
                Ungroup
              </Button>
            )}
          </div>
        )}
      </article>
    </DropTarget>
  );
}
