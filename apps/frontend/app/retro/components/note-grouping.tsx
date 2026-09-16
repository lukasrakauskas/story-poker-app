"use client";

import { useRef, useState, type ReactNode } from "react";
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
  type DragMoveEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import type {
  RetroColumn,
  RetroNote,
  RetroPresenceEvent,
  RetroRoom,
} from "shared/retrospective";
import type { RetroSession } from "../../../hooks/use-retro-socket";
import {
  ChevronDown,
  ChevronUp,
  GripVertical,
  MousePointer2,
} from "lucide-react";
import { Badge } from "ui/components/badge";
import { ItemActions } from "./item-actions";
import { columns } from "./note-board";

const collisionDetection: CollisionDetection = (args) => {
  const hits = args.pointerCoordinates
    ? pointerWithin(args)
    : rectIntersection(args);
  return hits.sort(
    (a, b) =>
      Number(String(a.id).startsWith("lane:")) -
      Number(String(b.id).startsWith("lane:"))
  );
};

const presenceColors = [
  "#2563eb",
  "#dc2626",
  "#7c3aed",
  "#059669",
  "#d97706",
  "#db2777",
] as const;

function memberColor(id: string) {
  let hash = 0;
  for (const character of id) hash = (hash * 31 + character.charCodeAt(0)) | 0;
  return presenceColors[Math.abs(hash) % presenceColors.length];
}

type Props = {
  room: RetroRoom;
  moderator: boolean;
  disabled: boolean;
  send: RetroSession["send"];
  sendPresence: RetroSession["sendPresence"];
  presence: RetroSession["presence"];
};

type DropData = {
  column: RetroColumn;
  targetNoteId?: string;
  label: string;
};

type DragData = {
  noteId: string;
  moveStack: boolean;
  notes: RetroNote[];
};

type NoteUnit = {
  id: string;
  notes: RetroNote[];
};

function noteUnits(room: RetroRoom, column: RetroColumn): NoteUnit[] {
  const seen = new Set<string>();
  const units: NoteUnit[] = [];
  for (const note of room.notes.filter((item) => item.column === column)) {
    if (!note.stackId) {
      units.push({ id: note.id, notes: [note] });
      continue;
    }
    if (seen.has(note.stackId)) continue;
    seen.add(note.stackId);
    units.push({
      id: note.stackId,
      notes: room.notes.filter((item) => item.stackId === note.stackId),
    });
  }
  return units;
}

export function NoteGrouping({
  room,
  moderator,
  disabled,
  send,
  sendPresence,
  presence,
}: Props) {
  const [active, setActive] = useState<DragData | null>(null);
  const board = useRef<HTMLDivElement | null>(null);
  const lastPresenceAt = useRef(0);
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 200, tolerance: 5 },
    }),
    useSensor(KeyboardSensor)
  );

  const activePresence = Object.values(presence).filter(
    (item) =>
      item.active && room.members.some((member) => member.id === item.memberId)
  );

  function sharePosition(rect: {
    left: number;
    top: number;
    width: number;
    height: number;
  }) {
    const bounds = board.current?.getBoundingClientRect();
    if (!bounds || !active) return;
    const now = performance.now();
    if (now - lastPresenceAt.current < 30) return;
    lastPresenceAt.current = now;
    sendPresence({
      x: Math.max(
        0,
        Math.min(1, (rect.left + rect.width / 2 - bounds.left) / bounds.width)
      ),
      y: Math.max(
        0,
        Math.min(1, (rect.top + rect.height / 2 - bounds.top) / bounds.height)
      ),
      noteId: active.noteId,
      active: true,
    });
  }

  function start(event: DragStartEvent) {
    const data = event.active.data.current as DragData | undefined;
    if (!data) return;
    setActive(data);
    const rect = event.active.rect.current.initial;
    if (rect) {
      const bounds = board.current?.getBoundingClientRect();
      if (bounds)
        sendPresence({
          x: Math.max(
            0,
            Math.min(
              1,
              (rect.left + rect.width / 2 - bounds.left) / bounds.width
            )
          ),
          y: Math.max(
            0,
            Math.min(
              1,
              (rect.top + rect.height / 2 - bounds.top) / bounds.height
            )
          ),
          noteId: data.noteId,
          active: true,
        });
    }
  }

  function move(event: DragMoveEvent) {
    const rect = event.active.rect.current.translated;
    if (rect) sharePosition(rect);
  }

  function finishPresence() {
    sendPresence({ x: 0, y: 0, noteId: null, active: false });
    setActive(null);
  }

  function drop({ active: dragged, over }: DragEndEvent) {
    const source = dragged.data.current as DragData | undefined;
    finishPresence();
    if (disabled || !source || !over) return;
    const destination = over.data.current as DropData | undefined;
    if (!destination?.column) return;
    if (
      destination.targetNoteId &&
      source.notes.some((note) => note.id === destination.targetNoteId)
    )
      return;
    void send({
      type: "move-note",
      id: source.noteId,
      column: destination.column,
      beforeId: null,
      stackWithId: destination.targetNoteId ?? null,
      moveStack: source.moveStack,
    });
  }

  return (
    <section aria-label="Retrospective notes" className="space-y-5">
      <div className="space-y-1">
        <h2 className="font-semibold">Stack related notes</h2>
        <p className="text-sm text-muted-foreground">
          Drag a note onto another note to stack matching ideas, or drag it into
          another lane. Select a stack to reveal every original message. Every
          note remains its own voting choice.
        </p>
      </div>
      <DndContext
        id="retro-grouping"
        sensors={sensors}
        collisionDetection={collisionDetection}
        onDragStart={start}
        onDragMove={move}
        onDragCancel={finishPresence}
        onDragEnd={drop}
        accessibility={{
          screenReaderInstructions: {
            draggable:
              "Press Space to pick up a note or stack, use arrow keys to choose a lane or note, press Space to drop, or Escape to cancel.",
          },
          announcements: {
            onDragStart: ({ active }) =>
              `Picked up ${(active.data.current as DragData | undefined)?.notes[0]?.text ?? "note"}.`,
            onDragOver: ({ over }) =>
              over
                ? `Over ${over.data.current?.label ?? "lane"}.`
                : "Outside a drop target.",
            onDragEnd: ({ over }) =>
              over
                ? `Dropped on ${over.data.current?.label ?? "lane"}.`
                : "No change made.",
            onDragCancel: () => "Drag cancelled. No change made.",
          },
        }}
      >
        <div ref={board} className="relative">
          <div className="grid items-start gap-4 lg:grid-cols-3">
            {columns.map((column) => {
              const units = noteUnits(room, column.id);
              return (
                <DropTarget
                  key={column.id}
                  id={`lane:${column.id}`}
                  disabled={disabled}
                  data={{ column: column.id, label: `${column.title} lane` }}
                >
                  <section
                    aria-label={`${column.title} lane`}
                    className={`min-w-0 space-y-3 rounded-lg border border-t-4 bg-muted/30 p-3 ${column.accent}`}
                  >
                    <h3 className="font-semibold">{column.title}</h3>
                    {units.map((unit) => (
                      <StackCard
                        key={unit.id}
                        unit={unit}
                        room={room}
                        moderator={moderator}
                        disabled={disabled}
                        remote={activePresence.find((item) =>
                          unit.notes.some((note) => note.id === item.noteId)
                        )}
                        send={send}
                      />
                    ))}
                    {units.length === 0 && (
                      <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                        Drop notes here.
                      </p>
                    )}
                  </section>
                </DropTarget>
              );
            })}
          </div>
          <div className="pointer-events-none absolute inset-0 z-50 overflow-hidden">
            {activePresence.map((item) => {
              const member = room.members.find(
                (candidate) => candidate.id === item.memberId
              );
              return member ? (
                <RemotePointer
                  key={item.memberId}
                  presence={item}
                  name={member.name}
                  color={memberColor(item.memberId)}
                />
              ) : null;
            })}
          </div>
        </div>
        <DragOverlay dropAnimation={null}>
          {active && (
            <div className="max-w-sm rotate-2 rounded-lg border bg-card p-4 text-sm shadow-xl">
              <p className="whitespace-pre-wrap break-words">
                {active.notes[0].text}
              </p>
              {active.notes.length > 1 && (
                <p className="mt-2 font-medium">
                  {active.notes.length} stacked notes
                </p>
              )}
            </div>
          )}
        </DragOverlay>
      </DndContext>
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
  data: DropData;
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

function StackCard({
  unit,
  room,
  moderator,
  disabled,
  remote,
  send,
}: {
  unit: NoteUnit;
  room: RetroRoom;
  moderator: boolean;
  disabled: boolean;
  remote?: RetroPresenceEvent["data"];
  send: RetroSession["send"];
}) {
  const [expanded, setExpanded] = useState(false);
  const representative = unit.notes[0];
  const stacked = unit.notes.length > 1;
  const color = remote ? memberColor(remote.memberId) : undefined;
  const member = remote
    ? room.members.find((candidate) => candidate.id === remote.memberId)
    : undefined;
  const dragData: DragData = {
    noteId: representative.id,
    moveStack: stacked,
    notes: unit.notes,
  };
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, isDragging } =
    useDraggable({ id: `unit:${unit.id}`, disabled, data: dragData });

  return (
    <DropTarget
      id={`target:${representative.id}`}
      disabled={disabled || isDragging}
      data={{
        column: representative.column,
        targetNoteId: representative.id,
        label: stacked
          ? `${unit.notes.length} stacked notes`
          : representative.text,
      }}
    >
      <div className="relative pb-1 pr-1">
        {stacked && (
          <>
            <div className="absolute inset-1 translate-x-1 translate-y-1 rounded-md border bg-card" />
            <div className="absolute inset-0.5 translate-x-0.5 translate-y-0.5 rounded-md border bg-card" />
          </>
        )}
        <article
          ref={setNodeRef}
          style={
            color
              ? { borderColor: color, boxShadow: `0 0 0 2px ${color}` }
              : undefined
          }
          className={`relative space-y-3 rounded-md border bg-card p-3 text-card-foreground shadow-sm transition-[border-color,box-shadow,opacity] ${isDragging ? "opacity-30" : ""}`}
        >
          <div className="flex items-start gap-2">
            <button
              ref={setActivatorNodeRef}
              type="button"
              {...attributes}
              {...listeners}
              aria-label={`Drag ${stacked ? "stack" : "note"}: ${representative.text}`}
              disabled={disabled}
              className="touch-none rounded p-2 text-muted-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50"
            >
              <GripVertical className="size-4" />
            </button>
            {stacked ? (
              <button
                type="button"
                className="min-w-0 flex-1 space-y-1 text-left"
                aria-expanded={expanded}
                onClick={() => setExpanded((current) => !current)}
              >
                <span className="block whitespace-pre-wrap break-words text-sm">
                  {representative.text}
                </span>
                <span className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
                  {expanded ? (
                    <ChevronUp className="size-3" />
                  ) : (
                    <ChevronDown className="size-3" />
                  )}
                  {unit.notes.length} matching notes
                </span>
              </button>
            ) : (
              <div className="min-w-0 flex-1">
                <p className="whitespace-pre-wrap break-words text-sm">
                  {representative.text}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {representative.authorName}
                </p>
              </div>
            )}
            {moderator && !stacked && (
              <ItemActions
                kind="note"
                text={representative.text}
                disabled={disabled}
                onDelete={() =>
                  send({ type: "delete-note", id: representative.id })
                }
              />
            )}
          </div>
          {member && (
            <Badge variant="outline" style={{ borderColor: color, color }}>
              {member.name} is moving this
            </Badge>
          )}
          {stacked && expanded && (
            <div className="space-y-2 border-t pt-3">
              {unit.notes.map((note) => (
                <StackedNote
                  key={note.id}
                  note={note}
                  moderator={moderator}
                  disabled={disabled}
                  send={send}
                />
              ))}
            </div>
          )}
        </article>
      </div>
    </DropTarget>
  );
}

function StackedNote({
  note,
  moderator,
  disabled,
  send,
}: {
  note: RetroNote;
  moderator: boolean;
  disabled: boolean;
  send: RetroSession["send"];
}) {
  const data: DragData = { noteId: note.id, moveStack: false, notes: [note] };
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, isDragging } =
    useDraggable({ id: `note:${note.id}`, disabled, data });
  return (
    <div
      ref={setNodeRef}
      className={`flex items-start gap-2 rounded border bg-muted/20 p-2 ${isDragging ? "opacity-30" : ""}`}
    >
      <button
        ref={setActivatorNodeRef}
        type="button"
        {...attributes}
        {...listeners}
        aria-label={`Drag note: ${note.text}`}
        disabled={disabled}
        className="touch-none rounded p-1 text-muted-foreground hover:bg-muted"
      >
        <GripVertical className="size-3" />
      </button>
      <div className="min-w-0 flex-1">
        <p className="whitespace-pre-wrap break-words text-sm">{note.text}</p>
        <p className="text-xs text-muted-foreground">{note.authorName}</p>
      </div>
      {moderator && (
        <ItemActions
          kind="note"
          text={note.text}
          disabled={disabled}
          onDelete={() => send({ type: "delete-note", id: note.id })}
        />
      )}
    </div>
  );
}

function RemotePointer({
  presence,
  name,
  color,
}: {
  presence: RetroPresenceEvent["data"];
  name: string;
  color: string;
}) {
  return (
    <div
      className="absolute flex items-start transition-[left,top] duration-100 ease-linear"
      style={{ left: `${presence.x * 100}%`, top: `${presence.y * 100}%` }}
      aria-hidden="true"
    >
      <MousePointer2 className="size-5" fill={color} style={{ color }} />
      <span
        className="ml-1 whitespace-nowrap rounded px-2 py-1 text-xs font-medium text-white shadow"
        style={{ backgroundColor: color }}
      >
        {name}
      </span>
    </div>
  );
}
