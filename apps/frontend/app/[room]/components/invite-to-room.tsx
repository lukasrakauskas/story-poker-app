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

export function InviteToRoom() {
  const { users, currentUser, planningState } = usePlanning();

  const handleCopyLink = () => {
    navigator.clipboard.writeText(window.location.href);
  };

  const handleChangePlanningState = () => {}

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
          >
            Copy Link
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
                      <AvatarImage src="/avatars/03.png" />
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
                  {currentUser?.role === "mod" && (
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
            <Button className="w-full" onClick={handleChangePlanningState}>
              {planningState === "voting" ? "Reveal results" : "Start voting"}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
