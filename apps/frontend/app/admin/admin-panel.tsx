"use client";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "ui/components/card";
import { usePlanning } from "../../lib/planning-context";
import { Button } from "ui/components/button";
import { Label } from "ui/components/label";
import { Input } from "ui/components/input";

export function AdminPanel() {
  const { broadcastMessage } = usePlanning();

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const roomId = event.currentTarget.roomId.value;
    const message = event.currentTarget.message.value;
    const password = event.currentTarget.password.value;

    broadcastMessage({ roomId, message, password });
  };

  return (
    <form onSubmit={handleSubmit}>
      <Card className="m-8 lg:w-1/3">
        <CardHeader className="space-y-1">
          <CardTitle className="text-2xl">Broadcast message</CardTitle>
          <CardDescription>
            Enter a message to broadcast to all users in the room.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="roomId">Room Id</Label>
            <Input
              id="roomId"
              type="text"
              placeholder="Example: r0oMiD"
              autoComplete="off"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="message">Message</Label>
            <Input
              id="message"
              type="text"
              placeholder="Your message to the room"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="password">Password</Label>
            <Input id="password" type="password" autoComplete="off" />
          </div>
        </CardContent>
        <CardFooter>
          <Button type="submit" className="w-full">
            Broadcast message
          </Button>
        </CardFooter>
      </Card>
    </form>
  );
}
