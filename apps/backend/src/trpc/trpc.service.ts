import { Injectable } from '@nestjs/common';
import { initTRPC } from '@trpc/server';
import { CreateExpressContextOptions } from '@trpc/server/adapters/express';
import { CreateWSSContextFnOptions } from '@trpc/server/adapters/ws';

@Injectable()
export class TrpcService {
  trpc = initTRPC.context<typeof this.createContext>().create();
  procedure = this.trpc.procedure;
  router = this.trpc.router;
  mergeRouters = this.trpc.mergeRouters;

  async createContext(
    opts: CreateExpressContextOptions | CreateWSSContextFnOptions,
  ) {
    // opts.req.cookies;

    return { ...opts };
  }
}
