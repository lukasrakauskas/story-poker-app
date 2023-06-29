import { useEffect, useRef } from "react";
import { useWebsocket } from "./use-websocket";
import z from "zod";
import { createEmitter } from "../lib/event-emitter";

const userSchema = z.object({
  id: z.string(),
  name: z.string(),
  voted: z.boolean(),
  role: z.enum(["user", "mod"]),
  vote: z.string().nullable().optional(),
  status: z.enum(["connected", "disconnected"]),
});

const currentUserSchema = userSchema.merge(z.object({ token: z.string() }));

export type User = z.infer<typeof userSchema>;

const serverEventsSchema = z.discriminatedUnion("event", [
  z.object({
    event: z.literal("room-joined"),
    data: z.object({
      code: z.string(),
      users: userSchema.array(),
      user: currentUserSchema,
      state: z.enum(["voting", "results"]),
    }),
  }),
  z.object({
    event: z.literal("user-joined"),
    data: z.object({
      user: userSchema,
    }),
  }),
  z.object({
    event: z.literal("user-left"),
    data: z.object({
      user: userSchema,
    }),
  }),
  z.object({
    event: z.literal("user-voted"),
    data: z.object({
      user: userSchema,
    }),
  }),
  z.object({
    event: z.literal("voting-started"),
    data: z.null(),
  }),
  z.object({
    event: z.literal("results-revealed"),
    data: z.object({
      results: z.record(z.number()),
      users: userSchema.array(),
    }),
  }),
  z.object({
    event: z.literal("is-alive"),
    data: z.null().optional(),
  }),
  z.object({
    event: z.literal("room-not-found"),
    data: z.null().optional(),
  }),
  z.object({
    event: z.literal("name-taken"),
    data: z.null().optional(),
  }),
]);

type ServerEvents = z.infer<typeof serverEventsSchema>;
type ServerEventsMap = { [T in ServerEvents as T["event"]]: T["data"] };

type WebsocketEventsMap = {
  connected: undefined;
  disconnected: undefined;
};

type ClientEvents = {
  "create-room": { name: string };
  "join-room": { name: string; room: string };
  "cast-vote": { vote: string };
  "start-voting": undefined;
  "reveal-results": undefined;
  "keep-alive": undefined;
  reconnect: { token: string };
};

export function useAppEvents() {
  const socket = useWebsocket(process.env.NEXT_PUBLIC_WS_URL ?? "");
  const emitterRef = useRef(
    createEmitter<ServerEventsMap & WebsocketEventsMap>()
  );

  useEffect(() => {
    const onOpen = () => {
      emitterRef.current.emit("connected", undefined);
    };

    const onClose = () => {
      emitterRef.current.emit("disconnected", undefined);
    };

    const onMessage = (socketEvent: any) => {
      const parsedMessage = JSON.parse(socketEvent?.data ?? "");
      const { event, data } = serverEventsSchema.parse(parsedMessage);
      emitterRef.current.emit(event, data);
    };

    socket.on("open", onOpen);
    socket.on("message", onMessage);
    socket.on("close", onClose);

    return () => {
      socket.off("open", onOpen);
      socket.off("message", onMessage);
      socket.off("close", onClose);
    };
  }, [socket]);

  function send<T extends keyof ClientEvents>(
    event: T,
    data?: ClientEvents[T]
  ) {
    socket.send(JSON.stringify({ event, data }));
  }

  return {
    send,
    ...emitterRef.current,
    reconnect: socket.reconnect,
    close: socket.close,
  };
}
