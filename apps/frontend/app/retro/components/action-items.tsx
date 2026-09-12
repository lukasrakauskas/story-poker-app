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
import { Textarea } from "ui/components/textarea";
import { Checkbox } from "ui/components/checkbox";
import { Badge } from "ui/components/badge";
import { ItemActions } from "./item-actions";

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
            ? "Your team’s final next steps. Check your saved history or export a backup."
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
                    <Checkbox
                      className="mt-1 shrink-0"
                      checked={action.done}
                      disabled={disabled}
                      aria-label={`Mark action ${action.done ? "incomplete" : "complete"}: ${action.text}`}
                      onCheckedChange={() =>
                        void send({ type: "toggle-action", id: action.id })
                      }
                    />
                  ) : (
                    <Badge variant={action.done ? "secondary" : "outline"}>
                      {action.done ? "Done" : "Open"}
                    </Badge>
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
                  {editable && (
                    <ItemActions
                      kind="action"
                      text={action.text}
                      disabled={disabled}
                      onDelete={() =>
                        send({ type: "delete-action", id: action.id })
                      }
                    />
                  )}
                </div>
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
              <Textarea
                id="action-text"
                maxLength={1000}
                className="min-h-24 resize-y"
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
