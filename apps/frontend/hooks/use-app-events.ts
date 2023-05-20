import { useEffect, useRef } from "react";
import { useWebsocket } from "./use-websocket";
import z from "zod";
import { createEmitter } from "../lib/event-emitter";

const userSchema = z.object({
  id: z.string(),
  name: z.string(),
  voted: z.boolean(),
  role: z.enum(["user", "mod"]),
});

export type User = z.infer<typeof userSchema>;

const serverEventsSchema = z.discriminatedUnion("event", [
  z.object({
    event: z.literal("room-joined"),
    data: z.object({ code: z.string(), users: userSchema.array(), user: userSchema }),
  }),
  z.object({
    event: z.literal("results-revealed"),
    data: z.object({ value: z.string(), count: z.number() }).array(),
  }),
]);

type ServerEvents = z.infer<typeof serverEventsSchema>;
type ServerEventsMap = { [T in ServerEvents as T["event"]]: T["data"] };

type ClientEvents = {
  "create-room": { name: string };
  "join-room": { name: string, room: string }
};

export function useAppEvents() {
  const socket = useWebsocket("ws://localhost:8080");
  const emitterRef = useRef(createEmitter<ServerEventsMap>());

  useEffect(() => {
    const onMessage = (socketEvent: any) => {
      const { event, data } = serverEventsSchema.parse(
        JSON.parse(socketEvent?.data ?? "")
      );
      console.log({ event, data });
      emitterRef.current.emit(event, data);
    };

    socket.on("message", onMessage);

    return () => {
      socket.off("message", onMessage);
    };
  }, [socket]);

  function send<T extends keyof ClientEvents>(event: T, data: ClientEvents[T]) {
    socket.send(JSON.stringify({ event, data }));
  }

  return { send, ...emitterRef.current };
}
