"use client";

import { memo, useEffect, useState } from "react";
import { io, Socket } from "socket.io-client";
import { ClientToServerEvents, ServerToClientEvents } from "shared";
import { z } from "zod";

const socket = new WebSocket("ws://localhost:8080");

const userSchema = z.object({ id: z.string(), name: z.string() });

type User = z.infer<typeof userSchema>;

const serverEventsSchema = z.discriminatedUnion("event", [
  z.object({
    event: z.literal("room-joined"),
    data: z.object({ code: z.string(), users: userSchema.array() }),
  }),
  z.object({
    event: z.literal("user-created"),
    data: z.object({ user: userSchema }),
  }),
  z.object({
    event: z.literal("user-joined"),
    data: z.object({ user: userSchema }),
  }),
  z.object({
    event: z.literal("results-revealed"),
    data: z.object({ value: z.string(), count: z.number() }).array(),
  }),
]);

type ServerEvents = z.input<typeof serverEventsSchema>;

function WebsocketImpl() {
  const [messages, setMessages] = useState([]);
  const [name, setName] = useState("");
  const [room, setRoom] = useState("");

  useEffect(() => {
    const onOpen = (event) => {
      console.log("Connected");
    };

    const onMessage = (event) => {
      console.log(event);
      const message = serverEventsSchema.parse(JSON.parse(event.data));

      console.log(message);

      setMessages((prev) => [...prev, message]);
    };

    socket.addEventListener("open", onOpen);
    socket.addEventListener("message", onMessage);

    return () => {
      socket.removeEventListener("open", onOpen);
      socket.removeEventListener("message", onMessage);
    };
  }, []);

  const handleCreateRoom = () => {
    socket.send(
      JSON.stringify({
        event: "create-room",
        data: {
          name,
        },
      })
    );
  };

  const handleJoinRoom = () => {
    socket.send(
      JSON.stringify({
        event: "join-room",
        data: {
          name,
          room
        },
      })
    );
  };

  return (
    <div>
      <div>
        <div>
          Name:
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <div>
          Room:
          <input
            value={room}
            onChange={(event) => setRoom(event.target.value)}
          />
        </div>
        <div>
          <button onClick={handleCreateRoom}>Create room</button>
          <button onClick={handleJoinRoom}>Join room</button>

        </div>
      </div>
      <pre>
        {messages.map((message, index) => (
          <div key={message + index}>{JSON.stringify(message, null, 2)}</div>
        ))}
      </pre>
    </div>
  );
}

export default memo(WebsocketImpl);
