"use client";

import { useState } from "react";
import type { RetroRoom } from "shared/retrospective";
import type { RetroSession } from "../../../hooks/use-retro-socket";
import { Button } from "ui/components/button";
import { Input } from "ui/components/input";
import { Label } from "ui/components/label";

export function NoteGrouping({
  room,
  disabled,
  send,
}: {
  room: RetroRoom;
  disabled: boolean;
  send: RetroSession["send"];
}) {
  const [title, setTitle] = useState("");
  const [selected, setSelected] = useState<string[]>([]);

  return (
    <section
      aria-labelledby="group-notes-heading"
      className="space-y-4 rounded-lg border p-4"
    >
      <div className="space-y-1">
        <h2 id="group-notes-heading" className="font-semibold">
          Group related notes
        </h2>
        <p className="text-sm text-muted-foreground">
          Select at least two notes and give their shared theme a name. Voting
          will target the theme once instead of splitting votes across its
          notes.
        </p>
      </div>

      {room.groups.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">Current themes</h3>
          {room.groups.map((group) => (
            <div key={group.id} className="rounded-md bg-muted/40 p-3 text-sm">
              <p className="font-medium">{group.title}</p>
              <ul className="mt-2 space-y-1">
                {room.notes
                  .filter((note) => note.groupId === group.id)
                  .map((note) => (
                    <li
                      key={note.id}
                      className="flex items-start justify-between gap-3"
                    >
                      <span className="min-w-0 break-words">{note.text}</span>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={disabled}
                        aria-label={`Remove note from theme: ${note.text}`}
                        onClick={() =>
                          void send({ type: "ungroup-note", id: note.id })
                        }
                      >
                        Ungroup
                      </Button>
                    </li>
                  ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      <form
        className="space-y-3"
        onSubmit={async (event) => {
          event.preventDefault();
          if (disabled || selected.length < 2 || !title.trim()) return;
          if (
            await send({
              type: "group-notes",
              title: title.trim(),
              noteIds: selected,
            })
          ) {
            setTitle("");
            setSelected([]);
          }
        }}
      >
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Notes in this theme</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {room.notes.map((note) => {
              const id = `group-note-${note.id}`;
              const group = room.groups.find(
                (item) => item.id === note.groupId
              );
              return (
                <div
                  key={note.id}
                  className="flex items-start gap-2 rounded-md border p-2"
                >
                  <input
                    id={id}
                    type="checkbox"
                    className="mt-1 size-4"
                    checked={selected.includes(note.id)}
                    disabled={disabled}
                    onChange={(event) =>
                      setSelected((current) =>
                        event.target.checked
                          ? [...current, note.id]
                          : current.filter((id) => id !== note.id)
                      )
                    }
                  />
                  <Label htmlFor={id} className="min-w-0 font-normal">
                    <span className="block break-words">{note.text}</span>
                    {group && (
                      <span className="block text-xs text-muted-foreground">
                        Currently in {group.title}
                      </span>
                    )}
                  </Label>
                </div>
              );
            })}
          </div>
        </fieldset>
        <div className="space-y-2">
          <Label htmlFor="theme-title">Theme name</Label>
          <Input
            id="theme-title"
            value={title}
            maxLength={100}
            disabled={disabled}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="For example: Team communication"
          />
        </div>
        <Button
          type="submit"
          disabled={disabled || selected.length < 2 || !title.trim()}
        >
          Create theme from {selected.length} notes
        </Button>
      </form>
    </section>
  );
}
