"use client";

import {
  ReactNode,
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { User, useAppEvents } from "../hooks/use-app-events";
import { useToast } from "ui/hooks/use-toast";
import { MurmurHash3, SimpleFastCounter32 } from "./random";

interface UserWithAvatar extends Omit<User, "avatar"> {
  avatar: string;
  avatarIndex: number;
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
  requiresPassword: boolean;
  avatars: readonly string[];

  setRoomCode: (room: string) => void;
  createRoom: (name: string, cardSet?: string[], password?: string) => void;
  joinRoom: (name: string, room: string, password?: string) => void;
  castVote: (vote: string) => void;
  removeVote: () => void;
  changePlanningState: () => void;
  claimModerator: () => void;
  promoteUser: (userId: string) => void;
  kickUser: (userId: string) => void;
  changeAvatar: (avatar: number) => void;
  broadcastMessage: (data: {
    roomId: string;
    message: string;
    password: string;
  }) => void;
}

export const PlanningContext = createContext<PlanningData>({
  state: "connecting",
  users: [],
  currentUser: null,
  vote: null,
  results: {},
  cardSet: [],
  roomCode: "",
  requiresPassword: false,
  avatars: [],
  setRoomCode: () => {},
  createRoom: () => {},
  joinRoom: () => {},
  castVote: () => {},
  removeVote: () => {},
  changePlanningState: () => {},
  claimModerator: () => {},
  promoteUser: () => {},
  kickUser: () => {},
  changeAvatar: () => {},
  broadcastMessage: () => {},
});

export function PlanningProvider({
  children,
  avatars,
}: {
  children: ReactNode;
  avatars: readonly string[];
}) {
  const [state, setState] = useState<State>("connecting");
  const [users, setUsers] = useState<UserWithAvatar[]>([]);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [vote, setVote] = useState<string | null>(null);
  const [planningState, setPlanningState] = useState<"voting" | "results">();
  const [results, setResults] = useState<Record<string, number>>({});
  const [roomCode, setRoomCode] = useState("");
  const [cardSet, setCardSet] = useState<string[]>([]);
  const [requiresPassword, setRequiresPassword] = useState(false);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined
  );
  const currentUserId = useRef<string | undefined>(undefined);
  useEffect(() => {
    currentUserId.current = currentUser?.id;
  }, [currentUser?.id]);

  const app = useAppEvents();
  const { toast } = useToast();

  const createRoom = (
    name: string,
    customCardSet?: string[],
    password?: string
  ) => {
    const url = new URL(window.location.href);
    customCardSet ??=
      url.searchParams
        .get("cardSet")
        ?.split(",")
        .map((card) => card.trim())
        .filter(Boolean) ?? [];

    setCardSet(customCardSet);
    setState("joining");
    app.send("create-room", {
      name,
      cardSet: customCardSet,
      password: password || undefined,
    });
  };

  const joinRoom = (name: string, room: string, password?: string) => {
    setState("joining");
    app.send("join-room", { name, room, password: password || undefined });
  };

  const updateVote = (newVote: string | null) => {
    setVote(newVote);
    setCurrentUser((user) =>
      user ? { ...user, vote: newVote, voted: newVote !== null } : user
    );
    app.send("cast-vote", { vote: newVote });
  };

  const castVote = (selectedVote: string) => {
    updateVote(vote === selectedVote ? null : selectedVote);
  };

  const removeVote = () => updateVote(null);

  const changePlanningState = () => {
    if (planningState === "voting") app.send("reveal-results");
    if (planningState === "results") app.send("start-voting");
  };

  const claimModerator = () => {
    app.send("claim-moderator");
  };

  const promoteUser = (userId: string) => {
    app.send("promote-user", { userId });
  };

  const kickUser = (userId: string) => {
    app.send("kick-user", { userId });
  };

  const changeAvatar = (avatar: number) => {
    app.send("change-avatar", { avatar });
  };

  const broadcastMessage = (data: {
    roomId: string;
    message: string;
    password: string;
  }) => {
    app.send("broadcast-message", data);
  };

  useEffect(() => {
    const clearRoomState = (room = roomFromPath()) => {
      setRoomCode(room);
      setUsers([]);
      setCurrentUser(null);
      setVote(null);
      setPlanningState(undefined);
      setResults({});
      setCardSet([]);
      setRequiresPassword(false);
    };

    const updateUser = (updatedUser: User) => {
      const displayUser = makeUserWithAvatar(updatedUser, avatars);
      setUsers((previous) =>
        previous.map((user) =>
          user.id === displayUser.id ? displayUser : user
        )
      );
      setCurrentUser((user) =>
        user?.id === updatedUser.id ? { ...user, ...updatedUser } : user
      );
    };

    const handleConnected = () => {
      clearTimeout(reconnectTimer.current);
      const room = roomFromPath();
      const token = room ? readSession(room) : null;
      if (room && token) {
        setState("joining");
        app.send("reconnect", { token, room });
      } else {
        setState("connected");
      }
    };

    const unsubIsAlive = app.on("is-alive", () => {
      app.send("keep-alive");
    });

    const unsubRoomJoined = app.on("room-joined", (data) => {
      setState("joined");
      setPlanningState(data.state);
      setUsers(data.users.map((user) => makeUserWithAvatar(user, avatars)));
      setRoomCode(data.code);
      setCurrentUser(data.user);
      setVote(data.user.vote ?? null);
      setCardSet(data.cardSet);
      setResults(data.results);
      setRequiresPassword(data.requiresPassword);
      saveSession(data.code, data.user.token);
    });

    const unsubUserJoined = app.on("user-joined", (data) => {
      const newUser = makeUserWithAvatar(data.user, avatars);
      setUsers((previous) => {
        if (previous.some((user) => user.id === newUser.id)) {
          return previous.map((user) =>
            user.id === newUser.id ? newUser : user
          );
        }
        return [...previous, newUser];
      });
    });

    const unsubUserLeft = app.on("user-left", (data) => {
      updateUser(data.user);
    });

    const unsubUserVoted = app.on("user-voted", (data) => {
      updateUser(data.user);
      if (data.user.id === currentUserId.current && !data.user.voted) {
        setVote(null);
      }
    });

    const unsubUserUpdated = app.on("user-updated", (data) => {
      updateUser(data.user);
    });

    const unsubUserRemoved = app.on("user-removed", (data) => {
      setUsers((previous) =>
        previous.filter((user) => user.id !== data.userId)
      );
    });

    const unsubVotingStarted = app.on("voting-started", () => {
      setPlanningState("voting");
      setResults({});
      setVote(null);
      setCurrentUser((user) =>
        user ? { ...user, vote: null, voted: false } : user
      );
      setUsers((previous) =>
        previous.map((user) => ({ ...user, voted: false, vote: null }))
      );
    });

    const unsubResultsRevealed = app.on("results-revealed", (data) => {
      setPlanningState("results");
      setResults(data.results);
      setUsers(data.users.map((user) => makeUserWithAvatar(user, avatars)));
      const ownResult = data.users.find(
        (user) => user.id === currentUserId.current
      );
      if (ownResult) {
        setVote(ownResult.vote ?? null);
        setCurrentUser((user) => (user ? { ...user, ...ownResult } : user));
      }
    });

    const unsubConnected = app.on("connected", handleConnected);
    const unsubDisconnected = app.on("disconnected", ({ code }) => {
      if (code === 4000) {
        clearSession(roomFromPath());
        clearRoomState();
        setState("connected");
        toast({
          title: "Session opened elsewhere",
          description: "This room session moved to another tab or window.",
        });
        return;
      }
      if (code === 4001) return;

      setState("disconnected");
      clearTimeout(reconnectTimer.current);
      reconnectTimer.current = setTimeout(app.reconnect, 1000);
    });

    const unsubNameTaken = app.on("name-taken", () => {
      setState("connected");
      toast({
        title: "Name is taken",
        description: "Choose a different name.",
        variant: "destructive",
      });
    });

    const unsubRoomNotFound = app.on("room-not-found", () => {
      const room = roomFromPath();
      clearSession(room);
      clearRoomState(room);
      setState("connected");
      toast({
        title: "Room not found",
        description: "Check that the room link is correct.",
        variant: "destructive",
      });
    });

    const unsubUserNotFound = app.on("user-not-found", () => {
      const room = roomFromPath();
      clearSession(room);
      clearRoomState(room);
      setState("connected");
    });

    const unsubBadUsername = app.on("bad-username", (data) => {
      setState("connected");
      toast({
        title: "Invalid name",
        description: data.error,
        variant: "destructive",
      });
    });

    const unsubInvalidCardSet = app.on("invalid-card-set", () => {
      setState("connected");
      toast({
        title: "Invalid card set",
        description: "Use 1 to 30 cards with short, non-empty values.",
        variant: "destructive",
      });
    });

    const unsubWrongRoomPassword = app.on("wrong-room-password", () => {
      setState("connected");
      toast({
        title: "Incorrect room password",
        description: "Enter the password set by the room owner.",
        variant: "destructive",
      });
    });

    const unsubKicked = app.on("kicked", () => {
      const room = roomFromPath();
      clearSession(room);
      clearRoomState(room);
      setState("connected");
      toast({
        title: "Removed from room",
        description: "A moderator removed you from this room.",
        variant: "destructive",
      });
    });

    const unsubTargetUserNotFound = app.on("target-user-not-found", () => {
      toast({
        title: "User is no longer in the room",
        variant: "destructive",
      });
    });

    const unsubUserNotMod = app.on("user-not-mod", () => {
      toast({
        title: "Moderator access required",
        variant: "destructive",
      });
    });

    const unsubModeratorOnline = app.on("moderator-online", () => {
      toast({
        title: "A moderator is online",
        description:
          "You can only claim the role when all moderators are offline.",
        variant: "destructive",
      });
    });

    const unsubMessageBroadcasted = app.on("broadcasted-message", (data) => {
      toast({ title: data.message, duration: 10000 });
    });

    if (app.isOpen()) handleConnected();

    const handleClose = () => app.close();
    window.addEventListener("beforeunload", handleClose);

    return () => {
      clearTimeout(reconnectTimer.current);
      unsubIsAlive();
      unsubRoomJoined();
      unsubUserJoined();
      unsubUserLeft();
      unsubUserVoted();
      unsubUserUpdated();
      unsubUserRemoved();
      unsubVotingStarted();
      unsubResultsRevealed();
      unsubConnected();
      unsubDisconnected();
      unsubNameTaken();
      unsubRoomNotFound();
      unsubUserNotFound();
      unsubBadUsername();
      unsubInvalidCardSet();
      unsubWrongRoomPassword();
      unsubKicked();
      unsubTargetUserNotFound();
      unsubUserNotMod();
      unsubModeratorOnline();
      unsubMessageBroadcasted();
      window.removeEventListener("beforeunload", handleClose);
    };
  }, [app, avatars, toast]);

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
        requiresPassword,
        avatars,
        setRoomCode,
        createRoom,
        joinRoom,
        castVote,
        removeVote,
        changePlanningState,
        claimModerator,
        promoteUser,
        kickUser,
        changeAvatar,
        broadcastMessage,
      }}
    >
      {children}
    </PlanningContext.Provider>
  );
}

export const usePlanning = () => useContext(PlanningContext);

function makeUserWithAvatar(
  user: User,
  avatars: readonly string[]
): UserWithAvatar {
  const generateSeed = MurmurHash3(user.id);
  const generateRandomNumber = SimpleFastCounter32(
    generateSeed(),
    generateSeed()
  );
  const generatedIndex = Math.floor(generateRandomNumber() * avatars.length);
  const avatarIndex = user.avatar ?? generatedIndex;
  const { avatar: _avatar, ...userWithoutAvatar } = user;

  return {
    ...userWithoutAvatar,
    avatar: avatars[avatarIndex % avatars.length] ?? "",
    avatarIndex,
  };
}

function roomFromPath() {
  const segments = window.location.pathname.split("/").filter(Boolean);
  return segments.length === 1 ? decodeURIComponent(segments[0]) : "";
}

function sessionKey(room: string) {
  return `planning-room:${room}:token`;
}

function readSession(room: string) {
  const token = sessionStorage.getItem(sessionKey(room));
  if (token) return token;

  if (localStorage.getItem("room") === room) {
    const legacyToken = localStorage.getItem("token");
    if (legacyToken) {
      saveSession(room, legacyToken);
      return legacyToken;
    }
  }
  return null;
}

function saveSession(room: string, token: string) {
  sessionStorage.setItem(sessionKey(room), token);
  localStorage.removeItem("room");
  localStorage.removeItem("token");
}

function clearSession(room: string) {
  if (room) sessionStorage.removeItem(sessionKey(room));
  if (localStorage.getItem("room") === room) {
    localStorage.removeItem("room");
    localStorage.removeItem("token");
  }
}
