"use client";

import { useEffect, useRef, useState } from "react";
import {
  Check,
  Copy,
  Eye,
  LockKeyhole,
  MoreVertical,
  QrCode,
  RotateCcw,
  ShieldCheck,
  UserRoundX,
  Users,
  X,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { Avatar, AvatarFallback, AvatarImage } from "ui/components/avatar";
import { Badge } from "ui/components/badge";
import { Button } from "ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "ui/components/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "ui/components/dropdown-menu";
import { Input } from "ui/components/input";
import { Label } from "ui/components/label";
import { Progress } from "ui/components/progress";
import { usePlanning } from "../../../lib/planning-context";

export function InviteToRoom() {
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">(
    "idle"
  );
  const [showQrCode, setShowQrCode] = useState(true);
  const {
    users,
    currentUser,
    planningState,
    changePlanningState,
    roomCode,
    requiresPassword,
    avatars,
    claimModerator,
    promoteUser,
    kickUser,
    changeAvatar,
  } = usePlanning();
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const linkRef = useRef<HTMLInputElement>(null);
  const connected = users.filter((user) => user.status === "connected");
  const voted = connected.filter((user) => user.voted).length;
  const revealed = planningState === "results";
  const moderatorsOffline = !users.some(
    (user) => user.role === "mod" && user.status === "connected"
  );
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const roomLink = `${origin}/${roomCode}`;

  const handleCopyLink = async () => {
    clearTimeout(timerRef.current);
    try {
      await navigator.clipboard.writeText(roomLink);
      setCopyStatus("copied");
      timerRef.current = setTimeout(() => setCopyStatus("idle"), 2000);
    } catch {
      setCopyStatus("failed");
      linkRef.current?.focus();
      linkRef.current?.select();
    }
  };

  useEffect(() => () => clearTimeout(timerRef.current), []);

  return (
    <Card className="min-h-0 min-w-0 gap-0 overflow-y-auto py-0">
      <CardHeader className="shrink-0 gap-3 border-b p-4 sm:p-5">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-lg font-semibold tracking-tight">
            Planning room
          </h2>
          <div className="flex items-center gap-1">
            {requiresPassword && (
              <Badge variant="outline" title="Password protected">
                <LockKeyhole aria-hidden="true" className="size-3" />
                <span className="sr-only">Password protected</span>
              </Badge>
            )}
            <Badge
              variant="outline"
              className="max-w-32 truncate font-mono"
              title={roomCode}
            >
              {roomCode}
            </Badge>
          </div>
        </div>
        <CardDescription>
          Invite your team and estimate together.
        </CardDescription>
        <div className="space-y-2">
          <Label htmlFor="poker-room-link">Room link</Label>
          <div className="flex gap-2">
            <Input
              id="poker-room-link"
              ref={linkRef}
              value={roomLink}
              readOnly
              className="min-w-0"
              onFocus={(event) => event.target.select()}
            />
            <Button
              variant="secondary"
              size="icon"
              className="shrink-0"
              onClick={handleCopyLink}
              aria-label={
                copyStatus === "copied" ? "Link copied" : "Copy room link"
              }
            >
              {copyStatus === "copied" ? (
                <Check aria-hidden="true" />
              ) : (
                <Copy aria-hidden="true" />
              )}
            </Button>
          </div>
          <output className="block text-xs text-muted-foreground">
            {copyStatus === "failed"
              ? "Could not copy. Select and copy the link manually."
              : copyStatus === "copied"
                ? "Room link copied."
                : requiresPassword
                  ? "People also need the room password."
                  : "Anyone with this link can join."}
          </output>
        </div>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col gap-4 p-4 sm:p-5">
        <div className="shrink-0 space-y-3">
          <h3 className="flex items-center gap-2 text-sm font-medium">
            <Users className="size-4" aria-hidden="true" /> Team{" "}
            <Badge variant="secondary" className="ml-auto">
              {connected.length} online
            </Badge>
          </h3>
          <div className="space-y-2">
            <output className="flex justify-between gap-2 text-xs text-muted-foreground">
              {revealed ? (
                <span>Results revealed</span>
              ) : (
                <>
                  <span>
                    {voted} of {connected.length} voted
                  </span>
                  {connected.length > 0 && voted === connected.length && (
                    <span className="font-medium text-foreground">
                      Ready to reveal
                    </span>
                  )}
                </>
              )}
            </output>
            <Progress
              value={
                revealed
                  ? 100
                  : connected.length
                    ? (voted / connected.length) * 100
                    : 0
              }
              aria-label={revealed ? "Voting complete" : "Team voting progress"}
              className="h-1.5"
            />
          </div>
        </div>
        <ul
          aria-label="People in the room"
          className="min-h-0 space-y-3 md:flex-1 md:overflow-y-auto"
        >
          {users.map((user) => {
            const isCurrentUser = user.id === currentUser?.id;
            const canManage = currentUser?.role === "mod" && !isCurrentUser;

            return (
              <li key={user.id} className="flex items-center gap-3">
                {isCurrentUser ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        className="shrink-0 rounded-full outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                        aria-label="Change your avatar"
                      >
                        <Avatar>
                          <AvatarImage src={`/avatars/${user.avatar}`} alt="" />
                          <AvatarFallback>
                            {user.name.slice(0, 2).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="w-64">
                      <DropdownMenuLabel>Choose your avatar</DropdownMenuLabel>
                      <div className="grid grid-cols-5 gap-1 p-1">
                        {avatars.map((avatar, index) => (
                          <DropdownMenuItem
                            key={avatar}
                            aria-label={`Use avatar ${index + 1}`}
                            className="justify-center p-1"
                            onSelect={() => changeAvatar(index)}
                          >
                            <Avatar className="size-8">
                              <AvatarImage src={`/avatars/${avatar}`} alt="" />
                              <AvatarFallback>{index + 1}</AvatarFallback>
                            </Avatar>
                          </DropdownMenuItem>
                        ))}
                      </div>
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : (
                  <Avatar className="shrink-0">
                    <AvatarImage src={`/avatars/${user.avatar}`} alt="" />
                    <AvatarFallback>
                      {user.name.slice(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                )}
                <div className="min-w-0 flex-1">
                  <p className="break-words text-sm font-medium">
                    {user.name}
                    {isCurrentUser && (
                      <span className="font-normal text-muted-foreground">
                        {" "}
                        (you)
                      </span>
                    )}
                  </p>
                  {user.role === "mod" && (
                    <p className="text-xs text-muted-foreground">Moderator</p>
                  )}
                </div>
                <Badge
                  variant={user.voted ? "secondary" : "outline"}
                  className="max-w-24 shrink-0 whitespace-normal break-all text-center"
                >
                  {user.status === "disconnected" ? (
                    "Offline"
                  ) : revealed ? (
                    (user.vote ?? "No vote")
                  ) : user.voted ? (
                    <>
                      <Check aria-hidden="true" className="size-3" />
                      Voted
                    </>
                  ) : (
                    "Thinking"
                  )}
                </Badge>
                {canManage && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8 shrink-0"
                        aria-label={`Manage ${user.name}`}
                      >
                        <MoreVertical aria-hidden="true" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {user.role !== "mod" && (
                        <DropdownMenuItem onSelect={() => promoteUser(user.id)}>
                          <ShieldCheck aria-hidden="true" /> Make moderator
                        </DropdownMenuItem>
                      )}
                      {user.role !== "mod" && <DropdownMenuSeparator />}
                      <DropdownMenuItem
                        variant="destructive"
                        onSelect={() => kickUser(user.id)}
                      >
                        <UserRoundX aria-hidden="true" /> Remove from room
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </li>
            );
          })}
        </ul>
        <div className="mt-auto shrink-0 space-y-4 border-t pt-4">
          {currentUser?.role === "mod" ? (
            <Button className="w-full" onClick={changePlanningState}>
              {revealed ? (
                <RotateCcw aria-hidden="true" />
              ) : (
                <Eye aria-hidden="true" />
              )}
              {revealed ? "Start voting" : "Reveal results"}
            </Button>
          ) : moderatorsOffline ? (
            <div className="space-y-2">
              <p className="text-center text-xs text-muted-foreground">
                All moderators are offline. Claim the role to keep the room
                moving.
              </p>
              <Button
                variant="outline"
                className="w-full"
                onClick={claimModerator}
              >
                <ShieldCheck aria-hidden="true" /> Claim moderator role
              </Button>
            </div>
          ) : (
            <p className="text-center text-xs text-muted-foreground">
              {revealed
                ? "The moderator will start the next round."
                : "The moderator will reveal results when the team is ready."}
            </p>
          )}
          {currentUser?.role === "mod" && showQrCode && (
            <section aria-labelledby="room-qr-title" className="border-t pt-4">
              <div className="mb-3 flex items-start justify-between gap-2">
                <div>
                  <h3
                    id="room-qr-title"
                    className="flex items-center gap-2 text-sm font-medium"
                  >
                    <QrCode aria-hidden="true" className="size-4" /> Scan to
                    join
                  </h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    The room password is not included.
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7 shrink-0"
                  aria-label="Dismiss room QR code"
                  onClick={() => setShowQrCode(false)}
                >
                  <X aria-hidden="true" />
                </Button>
              </div>
              <div className="mx-auto w-fit rounded-lg bg-white p-2">
                <QRCodeSVG
                  value={roomLink}
                  size={256}
                  level="M"
                  title={`Join planning room ${roomCode}`}
                />
              </div>
            </section>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
