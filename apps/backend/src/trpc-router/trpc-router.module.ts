import { Module } from '@nestjs/common';
import { TrpcRouter } from './trpc.router';
import { RoomModule } from 'src/room/room.module';
import { TrpcModule } from 'src/trpc/trpc.module';

@Module({
  imports: [TrpcModule, RoomModule],
  providers: [TrpcRouter],
})
export class TrpcRouterModule {}
