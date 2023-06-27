import { Injectable } from '@nestjs/common';
import { TrpcService } from 'src/trpc/trpc.service';
import { z } from 'zod';
import { nanoid } from 'nanoid';
import { RoomService } from './room.service';
import { WebSocket } from 'ws';

const HOUR = 60 * 60 * 1000;

@Injectable()
export class RoomRouter {
  constructor(
    private readonly trpc: TrpcService,
    private readonly roomService: RoomService,
  ) {}

  router = this.trpc.router({
    create: this.trpc.procedure
      .input(z.object({ name: z.string().min(3) }))
      .output(z.object({ code: z.string() }))
      .mutation(async (opts) => {
        const { id } = this.roomService.create();

        this.roomService.addUser(id, {
          id: nanoid(7),
          name: opts.input.name,
          vote: null,
          role: 'user',
        });

        if (!(opts.ctx.res instanceof WebSocket)) {
          opts.ctx.res.cookie('roomId', id, {
            secure: process.env.NODE_ENV !== 'development',
            httpOnly: true,
            expires: new Date(Date.now() + HOUR),
          });
        }

        console.log((opts.ctx.req as any)?.cookies);

        return this.roomService.getRoomById(id);
      }),
  });
}
