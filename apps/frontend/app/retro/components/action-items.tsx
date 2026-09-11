"use client";

import { useState } from "react";
import type { RetroRoom } from "shared/retrospective";
import type { RetroSession } from "../../../hooks/use-retro-socket";
import { Button } from "ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "ui/components/card";
import { Input } from "ui/components/input";
import { Label } from "ui/components/label";
import { textAreaClass } from "./note-board";

export function ActionItems({
  room,
  moderator,
  disabled,
  send,
}: {
  room: RetroRoom;
  moderator: boolean;
  disabled: boolean;
  send: RetroSession["send"];
}) {
  const [text, setText] = useState("");
  const [owner, setOwner] = useState("");
  const editable = moderator && room.phase === "discuss";
  return (
    <Card>
      <CardHeader>
        <CardTitle>Action items</CardTitle>
        <CardDescription>
          {room.phase === "closed"
            ? "Your team’s next steps. Export them before the room expires."
            : "Agree on a next step and who will take it. The moderator records actions."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {room.actions.length ? (
          <ul className="space-y-3">
            {room.actions.map((action) => (
              <li key={action.id} className="space-y-2 rounded-md border p-3">
                <div className="flex items-start gap-3">
                  {editable ? (
                    <input
                      type="checkbox"
                      className="mt-1 h-4 w-4 shrink-0 accent-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
                      checked={action.done}
                      disabled={disabled}
                      aria-label={`Mark action ${action.done ? "incomplete" : "complete"}: ${action.text}`}
                      onChange={() =>
                        void send({ type: "toggle-action", id: action.id })
                      }
                    />
                  ) : (
                    <span className="pt-0.5 text-xs text-muted-foreground">
                      {action.done ? "Done" : "Open"}
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <p
                      className={`whitespace-pre-wrap break-words text-sm ${action.done ? "line-through text-muted-foreground" : ""}`}
                    >
                      {action.text}
                    </p>
                    <p className="mt-1 break-words text-xs text-muted-foreground">
                      Owner: {action.owner || "Unassigned"}
                    </p>
                  </div>
                </div>
                {editable && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={disabled}
                    aria-label={`Delete action: ${action.text}`}
                    onClick={() => {
                      if (window.confirm("Delete this action item?"))
                        void send({ type: "delete-action", id: action.id });
                    }}
                  >
                    Delete
                  </Button>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
            No actions yet. What is one concrete thing the team can do
            differently?
          </p>
        )}
        {editable && (
          <form
            className="space-y-3 border-t pt-4"
            onSubmit={async (event) => {
              event.preventDefault();
              if (disabled || !text.trim()) return;
              if (
                await send({
                  type: "add-action",
                  text: text.trim(),
                  owner: owner.trim(),
                })
              ) {
                setText("");
                setOwner("");
              }
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="action-text">Next step</Label>
              <textarea
                id="action-text"
                maxLength={1000}
                className={textAreaClass}
                value={text}
                onChange={(event) => setText(event.target.value)}
                placeholder="A specific, achievable change…"
                required
                disabled={disabled}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="action-owner">Owner (optional)</Label>
              <Input
                id="action-owner"
                maxLength={60}
                value={owner}
                onChange={(event) => setOwner(event.target.value)}
                placeholder="Person or team"
                disabled={disabled}
              />
            </div>
            <Button
              type="submit"
              className="w-full"
              disabled={disabled || !text.trim()}
            >
              Add action
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
