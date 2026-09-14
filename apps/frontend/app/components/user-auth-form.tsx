"use client";

import * as React from "react";

import { cn } from "ui/utils";
import { Button } from "ui/components/button";
import { Input } from "ui/components/input";
import { Label } from "ui/components/label";
import { Icons } from "ui/icons";
import { usePlanning } from "../../lib/planning-context";
import { usePathname, useRouter } from "next/navigation";

interface UserAuthFormProps extends React.HTMLAttributes<HTMLDivElement> {
  action: string;
}

export function UserAuthForm({
  className,
  action,
  ...props
}: UserAuthFormProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { state } = usePlanning();
  const [name, setName] = React.useState("");
  const [nameError, setNameError] = React.useState("");
  const [password, setPassword] = React.useState("");

  const { createRoom, joinRoom, roomCode } = usePlanning();

  async function onSubmit(event: React.SyntheticEvent) {
    event.preventDefault();
    const normalizedName = name.trim();
    if (normalizedName.length < 3 || normalizedName.length > 30) {
      setNameError(
        "Name must be 3 to 30 characters after surrounding spaces are removed."
      );
      return;
    }
    setName(normalizedName);
    setNameError("");

    const url = new URL(window.location.href);
    const cardSet =
      url.searchParams
        .get("cardSet")
        ?.split(",")
        .map((card) => card.trim())
        .filter(Boolean) ?? [];

    if (!roomCode) {
      createRoom(normalizedName, cardSet, password);
    } else {
      joinRoom(normalizedName, roomCode, password);
    }
  }

  React.useEffect(() => {
    if (roomCode && pathname === "/") {
      router.replace(`/${roomCode}`);
    }
  }, [roomCode, pathname, router]);

  const isLoading = state === "connecting" || state === "joining";

  return (
    <div className={cn("grid gap-6", className)} {...props}>
      <form onSubmit={onSubmit} noValidate>
        <div className="grid gap-2">
          <div className="grid gap-1.5">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              name="name"
              type="text"
              autoCapitalize="none"
              autoCorrect="off"
              autoComplete="nickname"
              required
              aria-invalid={nameError ? true : undefined}
              aria-describedby={nameError ? "name-error" : undefined}
              disabled={isLoading}
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                setNameError("");
              }}
            />
            {nameError && (
              <p
                id="name-error"
                role="alert"
                className="text-sm text-destructive"
              >
                {nameError}
              </p>
            )}
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="room-password">
              Room password{" "}
              <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id="room-password"
              type="password"
              autoComplete={roomCode ? "current-password" : "new-password"}
              maxLength={100}
              disabled={isLoading}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>
          <Button disabled={isLoading}>
            {isLoading && (
              <Icons.spinner className="mr-2 h-4 w-4 animate-spin" />
            )}
            {state === "connecting" ? "Connecting..." : action}
          </Button>
        </div>
      </form>
    </div>
  );
}
