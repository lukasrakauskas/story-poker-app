"use client";

import { Avatar, AvatarFallback, AvatarImage } from "ui/components/avatar";
import { Button } from "ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "ui/components/card";
import { Input } from "ui/components/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "ui/components/select";
import { Separator } from "ui/components/separator";
import { usePlanning } from "../../../lib/planning-context";
import { cn } from "ui/utils";
import { useEffect, useMemo, useRef, useState } from "react";
import { MurmurHash3, SimpleFastCounter32 } from "../../../lib/random";

export function InviteToRoom() {
  const [copied, setCopied] = useState(false);
  const {
    users,
    currentUser,
    planningState,
    changePlanningState,
    avatars,
    roomCode,
  } = usePlanning();
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  const handleCopyLink = () => {
    setCopied(true);
    navigator.clipboard.writeText(window.location.href);

    timerRef.current = setTimeout(() => {
      setCopied(false);
    }, 1000);
  };

  useEffect(() => {
    return () => clearTimeout(timerRef.current);
  }, []);

  const avatar = useMemo(() => {
    const generateSeed = MurmurHash3(`${roomCode}+${currentUser?.id}`);
    const generateRandomNumber = SimpleFastCounter32(
      generateSeed(),
      generateSeed()
    );

    return avatars[Math.floor(generateRandomNumber() * avatars.length)];
  }, [roomCode, currentUser, avatars]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Invite to room</CardTitle>
        <CardDescription>
          Anyone with the link can join this room.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex space-x-2">
          <Input
            value={typeof window !== "undefined" ? window.location.href : ""}
            readOnly
          />
          <Button
            variant="secondary"
            className="shrink-0"
            onClick={handleCopyLink}
            disabled={copied}
          >
            {copied ? "Copied" : "Copy Link"}
          </Button>
        </div>
        <Separator className="my-4" />
        <div className="space-y-4">
          <h4 className="text-sm font-medium">People in the room</h4>
          <div className="grid gap-6">
            {users.map((user) => {
              return (
                <div
                  key={user.id}
                  className="flex items-center justify-between space-x-4"
                >
                  <div className="flex items-center space-x-4">
                    <Avatar>
                      <AvatarImage src={`/avatars/${avatar}`} />
                      <AvatarFallback>OM</AvatarFallback>
                    </Avatar>
                    <div>
                      <p
                        className={cn(
                          "text-sm font-medium leading-none",
                          user.id === currentUser?.id && "underline"
                        )}
                      >
                        {user.name}
                      </p>
                      <p className="text-sm leading-none">
                        {user.voted ? "has voted" : "currently voting"}
                      </p>
                    </div>
                  </div>
                  {currentUser?.role === "mod" && false && (
                    <Select defaultValue="edit">
                      <SelectTrigger className="ml-auto w-[110px]">
                        <SelectValue placeholder="Select" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="edit">Can edit</SelectItem>
                        <SelectItem value="view">Can view</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                </div>
              );
            })}
          </div>
        </div>
        {currentUser?.role === "mod" && (
          <>
            <Separator className="my-4" />
            <Button className="w-full" onClick={changePlanningState}>
              {planningState === "voting" ? "Reveal results" : "Start voting"}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
