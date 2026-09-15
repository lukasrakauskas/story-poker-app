"use client";

import type { RetroPhase } from "shared/retrospective";
import type { RetroHistoryPreference } from "../../../lib/retro-history";
import { Button } from "ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "ui/components/card";

type Connection = "connecting" | "connected" | "disconnected";
type Failure = { code: string; message: string };

export function RetroStatus({
  connection,
  pending,
  error,
  retry,
  cookieSaved,
  historySaved,
  historyPreference,
  historyPreferenceSaved,
  historyDisabled,
  expired,
  terminal,
  minutes,
  expiresAt,
  phase,
  className = "",
}: {
  connection: Connection;
  pending: boolean;
  error: Failure | null;
  retry: () => void;
  cookieSaved: boolean | null;
  historySaved: boolean | null;
  historyPreference: RetroHistoryPreference | null;
  historyPreferenceSaved: boolean | null;
  historyDisabled: boolean;
  expired: boolean;
  terminal: boolean;
  minutes: number | null;
  expiresAt: number;
  phase: RetroPhase;
  className?: string;
}) {
  const status = pending
    ? connection === "connecting"
      ? "Restoring your session…"
      : "Waiting for server confirmation…"
    : connection === "connecting"
      ? "Connecting to retrospective…"
      : connection === "connected"
        ? "Connected · changes sync live"
        : "Disconnected · changes are disabled";

  return (
    <Card className={`gap-4 py-4 ${className}`}>
      <CardHeader className="gap-1 px-4">
        <CardTitle className="flex items-center gap-2 text-sm">
          <span
            aria-hidden="true"
            className={`inline-block h-2 w-2 rounded-full ${connection === "connected" ? "bg-emerald-500" : "bg-amber-500"}`}
          />
          Room status
        </CardTitle>
        <CardDescription>
          <output aria-live="polite" aria-atomic="true">
            {status}
          </output>
        </CardDescription>
      </CardHeader>
      <CardContent
        className="space-y-3 px-4 text-xs text-muted-foreground"
        aria-live="polite"
        aria-atomic="false"
      >
        {connection === "disconnected" && !terminal && (
          <Button size="sm" variant="outline" onClick={retry}>
            Retry connection
          </Button>
        )}
        {error && !expired && (
          <p className="text-destructive">{error.message}</p>
        )}
        <div
          className={
            expired || (minutes !== null && minutes <= 15)
              ? "rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-foreground"
              : undefined
          }
        >
          <p className="font-medium">
            {expired
              ? "Room expired · read-only snapshot"
              : minutes === null
                ? "Expires two hours after creation"
                : `Expires in ${minutes} min`}
          </p>
          <p className="mt-1">
            {new Date(expiresAt).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}{" "}
            · not extended by activity
          </p>
          {!expired && minutes !== null && minutes <= 15 && (
            <p className="mt-2 font-medium">
              Finish and close soon to make final exports available.
            </p>
          )}
        </div>
        {cookieSaved === false && (
          <p className="text-destructive">
            Could not save your rejoin cookie. Keep this tab open to retain your
            identity and moderator access.
          </p>
        )}
        {historyPreferenceSaved === false && (
          <p className="text-destructive">
            Could not save this history preference. It applies only to this tab;
            collaboration is not interrupted.
          </p>
        )}
        {historyDisabled && historyPreference?.mode !== "none" && (
          <p>
            Browser history is disabled for this room after deletion. Live
            updates will not recreate the saved entry.
          </p>
        )}
        {historyPreference?.mode === "none" && (
          <p>
            Browser history is disabled for this room. Exported backups still
            work.
          </p>
        )}
        {historyPreference?.mode === "final-only" && phase !== "closed" && (
          <p>
            Only the completed takeaway will be saved; in-progress recovery
            snapshots stay out of browser history.
          </p>
        )}
        {historySaved === false && !historyDisabled && (
          <p className="text-destructive">
            Could not save this snapshot in browser history. Storage may be
            blocked or full.
            {phase === "closed"
              ? " Export the final result before leaving."
              : " Final exports become available after closure."}
          </p>
        )}
        {historySaved === true && (
          <p>
            Browser snapshot saved
            {phase === "closed" ? " with final action items" : ""}.
          </p>
        )}
        <details className="border-t pt-3">
          <summary className="cursor-pointer font-medium text-foreground">
            Privacy and browser storage
          </summary>
          <p className="mt-2">
            No account is required. A room cookie restores your identity until
            expiry. Notes, names, and actions are saved in this browser only
            after you choose a history policy; they are not a backup or shared
            across devices. Opening this room in another tab moves your live
            connection there. Exported files are separate backups.
          </p>
        </details>
      </CardContent>
    </Card>
  );
}
