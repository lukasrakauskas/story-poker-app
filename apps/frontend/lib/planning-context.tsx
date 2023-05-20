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
  castVote: (vote: string) => void;
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
  castVote: () => {},
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

  const castVote = (vote: string) => {
    setVote(vote);
    app.send("cast-vote", { vote });
  };

  useEffect(() => {
    const unsubRoomJoined = app.on("room-joined", (data) => {
      setUsers(data.users);
      setRoomCode(data.code);
      setCurrentUser(data.user);
    });

    const unsubUserJoined = app.on("user-joined", (data) => {
      setUsers((prev) => [...prev, data.user]);
    });

    const unsubUserLeft = app.on("user-left", (data) => {
      setUsers((prev) => prev.filter((it) => it.id !== data.user.id));
    });

    const unsubUserVoted = app.on("user-voted", (data) => {
      setUsers((prev) =>
        prev.map((it) =>
          it.id === data.user.id ? { ...it, ...data.user } : it
        )
      );
    });

    return () => {
      unsubRoomJoined();
      unsubUserJoined();
      unsubUserLeft();
      unsubUserVoted();
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
        joinRoom,
        castVote,
      }}
    >
      {children}
    </PlanningContext.Provider>
  );
}

export const usePlanning = () => useContext(PlanningContext);
