// "use client";

// import { memo, useEffect, useState } from "react";
// import { z } from "zod";
// import { createEmitter } from "../lib/event-emitter";
// import { useWebsocket } from "../hooks/use-websocket";

// const userSchema = z.object({ id: z.string(), name: z.string() });

// type User = z.infer<typeof userSchema>;

// const serverEventsSchema = z.discriminatedUnion("event", [
//   z.object({
//     event: z.literal("room-joined"),
//     data: z.object({ code: z.string(), users: userSchema.array() }),
//   }),
//   z.object({
//     event: z.literal("user-created"),
//     data: z.object({ user: userSchema }),
//   }),
//   z.object({
//     event: z.literal("user-joined"),
//     data: z.object({ user: userSchema }),
//   }),
//   z.object({
//     event: z.literal("results-revealed"),
//     data: z.object({ value: z.string(), count: z.number() }).array(),
//   }),
// ]);

// const serverEventMapSchema = z.object({
//   "room-joined": z.object({ code: z.string(), users: userSchema.array() }),
// });

// type ServerEvents = z.input<typeof serverEventsSchema>;
// type ServerEventsMap = z.input<typeof serverEventMapSchema>;

// const emitter = createEmitter<ServerEventsMap>();

// function WebsocketImpl() {
//   const [messages, setMessages] = useState<any[]>([]);
//   const [name, setName] = useState("");
//   const [room, setRoom] = useState("");

//   const socket = useWebsocket({
//     url: "ws://localhost:8080",
//     onOpen: () => console.log("Connected"),
//     onMessage: (event) => {
//       const message = serverEventsSchema.parse(JSON.parse(event.data));
//       setMessages((prev) => [...prev, message]);
//       console.log(message);
//     }
//   });

//   const handleCreateRoom = () => {
//     socket.send("create-room", { name });
//   };

//   const handleJoinRoom = () => {
//     socket.send("join-room", { name, room });
//   };

//   return (
//     <div>
//       <div>
//         <div>
//           Name:
//           <input
//             value={name}
//             onChange={(event) => setName(event.target.value)}
//           />
//         </div>
//         <div>
//           Room:
//           <input
//             value={room}
//             onChange={(event) => setRoom(event.target.value)}
//           />
//         </div>
//         <div>
//           <button onClick={handleCreateRoom}>Create room</button>
//           <button onClick={handleJoinRoom}>Join room</button>
//         </div>
//       </div>
//       <pre>
//         {messages.map((message, index) => (
//           <div key={message + index}>{JSON.stringify(message, null, 2)}</div>
//         ))}
//       </pre>
//     </div>
//   );
// }

// export default memo(WebsocketImpl);
