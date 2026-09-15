"use client";

import { useState } from "react";
import {
  actionOwnerLabel,
  type RetroAction,
  type RetroActionAssignment,
  type RetroActionOwner,
  type RetroRoom,
} from "shared/retrospective";
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

type Props = {
  room: RetroRoom;
  moderator: boolean;
  disabled: boolean;
  send: RetroSession["send"];
};

export function ActionItems({ room, moderator, disabled, send }: Props) {
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
              <ActionRow
                key={action.id}
                action={action}
                room={room}
                editable={editable}
                disabled={disabled}
                send={send}
              />
            ))}
          </ul>
        ) : (
          <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
            No actions yet. What is one concrete thing the team can do
            differently?
          </p>
        )}
        {editable && (
          <ActionEditor room={room} disabled={disabled} send={send} />
        )}
      </CardContent>
    </Card>
  );
}

function ActionRow({
  action,
  room,
  editable,
  disabled,
  send,
}: Omit<Props, "moderator"> & { action: RetroAction; editable: boolean }) {
  const [editing, setEditing] = useState(false);
  const removedOwner =
    action.owner.kind === "participant" &&
    !room.members.some(
      (member) =>
        action.owner.kind === "participant" &&
        member.id === action.owner.participantId
    );
  return (
    <li className="space-y-2 rounded-md border p-3">
      {editing && editable ? (
        <ActionEditor
          action={action}
          room={room}
          disabled={disabled}
          send={send}
          onClose={() => setEditing(false)}
        />
      ) : (
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
              Owner: {actionOwnerLabel(action.owner)}
              {removedOwner
                ? " (no longer in room)"
                : action.owner.kind === "external"
                  ? " (team / external)"
                  : ""}
            </p>
          </div>
          {editable && (
            <ItemActions
              kind="action"
              text={action.text}
              disabled={disabled}
              onEdit={() => setEditing(true)}
              onDelete={() => send({ type: "delete-action", id: action.id })}
            />
          )}
        </div>
      )}
    </li>
  );
}

function focusEditor(element: HTMLTextAreaElement | null) {
  element?.focus();
}

function ownerAssignment(owner: RetroActionOwner): RetroActionAssignment {
  if (owner.kind === "participant")
    return { kind: "participant", participantId: owner.participantId };
  return owner;
}

function ActionEditor({
  action,
  room,
  disabled,
  send,
  onClose,
}: Omit<Props, "moderator"> & { action?: RetroAction; onClose?: () => void }) {
  const [text, setText] = useState(action?.text ?? "");
  const [owner, setOwner] = useState<RetroActionAssignment>(() =>
    action ? ownerAssignment(action.owner) : { kind: "unassigned" }
  );
  const [externalName, setExternalName] = useState(
    action?.owner.kind === "external" ? action.owner.name : ""
  );
  const id = action ? `edit-action-${action.id}` : "action";
  const originalOwner = action?.owner;
  const removedOwner =
    originalOwner?.kind === "participant" &&
    !room.members.some((member) => member.id === originalOwner.participantId)
      ? originalOwner
      : null;
  const invalid =
    !text.trim() || (owner.kind === "external" && !externalName.trim());
  return (
    <form
      aria-label={action ? "Edit action" : "New action"}
      className="space-y-3 border-t pt-4"
      onSubmit={async (event) => {
        event.preventDefault();
        if (disabled || invalid) return;
        const assignment: RetroActionAssignment =
          owner.kind === "external"
            ? { kind: "external", name: externalName.trim() }
            : owner;
        if (
          await send(
            action
              ? {
                  type: "edit-action",
                  id: action.id,
                  text: text.trim(),
                  owner: assignment,
                }
              : { type: "add-action", text: text.trim(), owner: assignment }
          )
        ) {
          setText("");
          setOwner({ kind: "unassigned" });
          setExternalName("");
          onClose?.();
        }
      }}
    >
      <div className="space-y-2">
        <Label htmlFor={`${id}-text`}>
          {action ? "Edit next step" : "Next step"}
        </Label>
        <Textarea
          id={`${id}-text`}
          maxLength={1000}
          className="min-h-24 resize-y"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="A specific, achievable change…"
          required
          disabled={disabled}
          ref={action ? focusEditor : undefined}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${id}-owner`}>Owner (optional)</Label>
        <select
          id={`${id}-owner`}
          className="w-full rounded-md border bg-background p-2 text-sm"
          value={
            owner.kind === "participant"
              ? `participant:${owner.participantId}`
              : owner.kind
          }
          disabled={disabled}
          onChange={(event) => {
            const value = event.target.value;
            setOwner(
              value.startsWith("participant:")
                ? { kind: "participant", participantId: value.slice(12) }
                : value === "external"
                  ? { kind: "external", name: externalName }
                  : { kind: "unassigned" }
            );
          }}
        >
          <option value="unassigned">Unassigned</option>
          {room.members.map((member) => (
            <option key={member.id} value={`participant:${member.id}`}>
              {member.name}
              {member.connected ? "" : " (offline)"}
            </option>
          ))}
          {removedOwner && (
            <option value={`participant:${removedOwner.participantId}`}>
              {removedOwner.name} (no longer in room)
            </option>
          )}
          <option value="external">Team / external owner</option>
        </select>
      </div>
      {owner.kind === "external" && (
        <div className="space-y-2">
          <Label htmlFor={`${id}-external`}>Team / external name</Label>
          <Input
            id={`${id}-external`}
            value={externalName}
            maxLength={60}
            required
            disabled={disabled}
            onChange={(event) => setExternalName(event.target.value)}
          />
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={disabled || invalid}>
          {action ? "Save action" : "Add action"}
        </Button>
        {onClose && (
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}
