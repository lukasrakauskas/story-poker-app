"use client";

import {
  ReactNode,
  createContext,
  useContext,
  useEffect,
  useState,
} from "react";
import { User, useAppEvents } from "../hooks/use-app-events";
import { useToast } from "ui/hooks/use-toast";
import { ToastAction } from "ui/components/toast";
import { MurmurHash3, SimpleFastCounter32 } from "./random";

interface UserWithAvatar extends User {
  avatar: string;
}

interface PlanningData {
  isConnected: boolean;
  users: UserWithAvatar[];
  currentUser: User | null;
  vote: string | null;
  planningState?: "voting" | "results";
  results: Record<string, number>;
  roomCode: string;

  setRoomCode: (room: string) => void;
  createRoom: (name: string) => void;
  joinRoom: (name: string, room: string) => void;
  castVote: (vote: string) => void;
  changePlanningState: () => void;
}

export const PlanningContext = createContext<PlanningData>({
  isConnected: false,
  users: [],
  currentUser: null,
  vote: null,
  results: {},
  roomCode: "",
  setRoomCode: () => {},
  createRoom: () => {},
  joinRoom: () => {},
  castVote: () => {},
  changePlanningState: () => {},
});

export function PlanningProvider({
  children,
  avatars,
}: {
  children: ReactNode;
  avatars: string[];
}) {
  const [isConnected, setIsConnected] = useState(false);
  const [users, setUsers] = useState<UserWithAvatar[]>([]);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [vote, setVote] = useState<string | null>(null);
  const [planningState, setPlanningState] = useState<"voting" | "results">();
  const [results, setResults] = useState<Record<string, number>>({});
  const [roomCode, setRoomCode] = useState("");

  const app = useAppEvents();
  const { toast } = useToast();

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

  const changePlanningState = () => {
    if (planningState === "voting") {
      app.send("reveal-results");
    }

    if (planningState === "results") {
      app.send("start-voting");
    }
  };

  const reset = () => {
    setRoomCode("");
    setUsers([]);
    setCurrentUser(null);
    setVote(null);
    setResults({});
  };

  useEffect(() => {
    const unsubRoomJoined = app.on("room-joined", (data) => {
      setPlanningState(data.state);
      setUsers(data.users.map((user) => makeUserWithAvatar(user, avatars)));
      setRoomCode(data.code);
      setCurrentUser(data.user);
    });

    const unsubUserJoined = app.on("user-joined", (data) => {
      setUsers((prev) => [...prev, makeUserWithAvatar(data.user, avatars)]);
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

    const unsubVotingStarted = app.on("voting-started", () => {
      setPlanningState("voting");
      setResults({});
      setUsers((prev) => prev.map((it) => ({ ...it, voted: false })));
    });

    const unsubResultsRevealed = app.on("results-revealed", (data) => {
      setPlanningState("results");
      setResults(data);
      setVote(null);
    });

    const unsubConnected = app.on("connected", () => {
      setIsConnected(true);
    });

    const unsubDisconnected = app.on("disconnected", () => {
      setIsConnected(false);
      reset();
      toast({
        title: "Uh oh! Something went wrong.",
        description: "There was a problem with your connection.",
        action: (
          <ToastAction
            altText="Reload page"
            onClick={() => window.location.reload()}
          >
            Reload page
          </ToastAction>
        ),
      });
    });

    return () => {
      unsubRoomJoined();
      unsubUserJoined();
      unsubUserLeft();
      unsubUserVoted();
      unsubVotingStarted();
      unsubResultsRevealed();
      unsubConnected();
      unsubDisconnected();
    };
  }, [app, toast, avatars]);

  return (
    <PlanningContext.Provider
      value={{
        isConnected,
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
        changePlanningState,
      }}
    >
      {children}
    </PlanningContext.Provider>
  );
}

export const usePlanning = () => useContext(PlanningContext);

function makeUserWithAvatar(user: User, avatars: string[]): UserWithAvatar {
  const generateSeed = MurmurHash3(user.id);
  const generateRandomNumber = SimpleFastCounter32(
    generateSeed(),
    generateSeed()
  );

  const avatar = avatars[Math.floor(generateRandomNumber() * avatars.length)];

  return {
    ...user,
    avatar,
  };
}
