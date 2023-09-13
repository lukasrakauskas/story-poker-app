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
import { MurmurHash3, SimpleFastCounter32 } from "./random";

interface UserWithAvatar extends User {
  avatar: string;
}

export type State =
  | "connecting"
  | "connected"
  | "joining"
  | "joined"
  | "disconnected";

interface PlanningData {
  state: State;
  users: UserWithAvatar[];
  currentUser: User | null;
  vote: string | null;
  planningState?: "voting" | "results";
  results: Record<string, number>;
  cardSet: string[];
  roomCode: string;

  setRoomCode: (room: string) => void;
  createRoom: (name: string, cardSet?: string[]) => void;
  joinRoom: (name: string, room: string) => void;
  castVote: (vote: string) => void;
  changePlanningState: () => void;
}

export const PlanningContext = createContext<PlanningData>({
  state: "connecting",
  users: [],
  currentUser: null,
  vote: null,
  results: {},
  cardSet: [],
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
  const [state, setState] = useState<State>("connecting");
  const [users, setUsers] = useState<UserWithAvatar[]>([]);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [vote, setVote] = useState<string | null>(null);
  const [planningState, setPlanningState] = useState<"voting" | "results">();
  const [results, setResults] = useState<Record<string, number>>({});
  const [roomCode, setRoomCode] = useState("");
  const [cardSet, setCardSet] = useState<string[]>([]);

  const app = useAppEvents();
  const { toast } = useToast();

  const createRoom = (name: string, customCardSet?: string[]) => {
    const url = new URL(window.location.href);
    customCardSet ??= url.searchParams.get("cardSet")?.split(",") ?? [];

    setCardSet(customCardSet ?? []);
    setState("joining");
    app.send("create-room", { name, cardSet: customCardSet });
  };

  const joinRoom = (name: string, room: string) => {
    setState("joining");
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
    const unsubIsAlive = app.on("is-alive", () => {
      app.send("keep-alive");
    });

    const unsubRoomJoined = app.on("room-joined", (data) => {
      setState("joined");
      setPlanningState(data.state);
      setUsers(data.users.map((user) => makeUserWithAvatar(user, avatars)));
      setRoomCode(data.code);
      setCurrentUser(data.user);
      setCardSet(data.cardSet);

      localStorage.setItem("token", data.user.token);
      localStorage.setItem("room", data.code);
    });

    const unsubUserJoined = app.on("user-joined", (data) => {
      const newUser = makeUserWithAvatar(data.user, avatars);

      setUsers((prev) => {
        if (prev.some((it) => it.id === newUser.id)) {
          return prev.map((it) => (it.id === newUser.id ? newUser : it));
        }

        return [...prev, newUser];
      });
    });

    const unsubUserLeft = app.on("user-left", (data) => {
      const newUser = makeUserWithAvatar(data.user, avatars);

      setUsers((prev) =>
        prev.map((it) => (it.id === data.user.id ? newUser : it))
      );
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
      setUsers((prev) =>
        prev.map((it) => ({ ...it, voted: false, vote: null }))
      );
    });

    const unsubResultsRevealed = app.on("results-revealed", (data) => {
      setPlanningState("results");
      setResults(data.results);
      setUsers(data.users.map((user) => makeUserWithAvatar(user, avatars)));
      setVote(null);
    });

    const unsubConnected = app.on("connected", () => {
      setState("connected");

      const token = localStorage.getItem("token");
      const room = localStorage.getItem("room");

      if (token && room && window.location.pathname.endsWith(room)) {
        app.send("reconnect", { token });

        toast({
          title: "Reconnected",
        });
      }
    });

    const unsubDisconnected = app.on("disconnected", () => {
      app.reconnect();
    });

    const unsubNameTaken = app.on("name-taken", () => {
      setState("connected");
      toast({
        title: "Uh oh! Name is taken.",
        description: "Please choose a different name",
        variant: "destructive",
      });
    });

    const unsubRoomNotFound = app.on("room-not-found", () => {
      reset();
      setState("connected");
      toast({
        title: "Uh oh! Room not found.",
        description: "Please check if you got correct room URL.",
        variant: "destructive",
      });
    });

    const unsubBadUsername = app.on("bad-username", (data) => {
      setState("connected");
      toast({
        title: "Uh oh! Bad username.",
        description: data.error,
        variant: "destructive",
      });
    });

    const handleClose = () => {
      app.close();
    };

    window.addEventListener("beforeunload", handleClose);

    return () => {
      unsubIsAlive();
      unsubRoomJoined();
      unsubUserJoined();
      unsubUserLeft();
      unsubUserVoted();
      unsubVotingStarted();
      unsubResultsRevealed();
      unsubConnected();
      unsubDisconnected();
      unsubNameTaken();
      unsubRoomNotFound();
      unsubBadUsername();
      window.removeEventListener("beforeunload", handleClose);
    };
  }, [app, toast, avatars]);

  return (
    <PlanningContext.Provider
      value={{
        state,
        users,
        currentUser,
        vote,
        planningState,
        results,
        cardSet,
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
