import {
  createTRPCProxyClient,
  createWSClient,
  httpBatchLink,
  loggerLink,
  wsLink,
} from "@trpc/client";
import { AppRouter } from "backend/src/trpc/trpc.router";

const wsClient = createWSClient({
  url: () => {
    if (process.env.NEXT_PUBLIC_WS_URL) {
      return process.env.NEXT_PUBLIC_WS_URL;
    }

    throw new Error("NEXT_PUBLIC_WS_URL is not defined");
  },
});

export const trpc = createTRPCProxyClient<AppRouter>({
  links: [
    loggerLink({
      enabled: () =>
        process.env.NODE_ENV === "development" && typeof window !== "undefined",
    }),
    httpBatchLink({
      url: `${process.env.NEXT_PUBLIC_API_URL}/trpc`,
    }),
    wsLink({
      client: wsClient,
    }),
  ],
});
