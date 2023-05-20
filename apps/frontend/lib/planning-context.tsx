"use client";

import {
  ReactNode,
  createContext,
  useContext,
  useEffect,
  useState,
} from "react";
import { User, useAppEvents } from "../hooks/use-app-events";

interface PlanningData {
  users: User[];
  currentUser: User | null;
  vote: string | null;
  planningState?: "voting" | "results";
  results: Record<string, number>;
  roomCode: string;

  setRoomCode: (room: string) => void;
  createRoom: (name: string) => void;
  joinRoom: (name: string, room: string) => void;
}

export const PlanningContext = createContext<PlanningData>({
  users: [],
  currentUser: null,
  vote: null,
  results: {},
  roomCode: "",
  setRoomCode: () => {},
  createRoom: () => {},
  joinRoom: () => {},
});

export function PlanningProvider({ children }: { children: ReactNode }) {
  const [roomCode, setRoomCode] = useState("");
  const [users, setUsers] = useState<User[]>([]);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [vote, setVote] = useState<string | null>(null);
  const [planningState, setPlanningState] = useState<"voting" | "results">();
  const [results, setResults] = useState<Record<string, number>>({});

  const app = useAppEvents();

  const createRoom = (name: string) => {
    app.send("create-room", { name });
  };

  const joinRoom = (name: string, room: string) => {
    app.send("join-room", { name, room });
  };

  useEffect(() => {
    const unsubRoomJoined = app.on("room-joined", (data) => {
      setUsers(data.users);
      setRoomCode(data.code);
      setCurrentUser(data.user);
    });

    const unsubUserJoined = app.on('user-joined', (data) => {
      setUsers(prev => [...prev, data.user])
    })

    const unsubUserLeft = app.on('user-left', (data) => {
      setUsers(prev => prev.filter(it => it.id !== data.user.id))
    })

    return () => {
      unsubRoomJoined();
      unsubUserJoined();
      unsubUserLeft();
    };
  }, [app]);

  return (
    <PlanningContext.Provider
      value={{
        users,
        currentUser,
        vote,
        planningState,
        results,
        roomCode,
        setRoomCode,
        createRoom,
        joinRoom
      }}
    >
      {children}
    </PlanningContext.Provider>
  );
}

export const usePlanning = () => useContext(PlanningContext);
