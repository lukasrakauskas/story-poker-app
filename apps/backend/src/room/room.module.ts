import { Module } from '@nestjs/common';
import { RoomService } from './room.service';
import { RoomRouter } from './room.router';
import { TrpcModule } from 'src/trpc/trpc.module';

@Module({
  imports: [TrpcModule],
  providers: [RoomService, RoomRouter],
  exports: [RoomRouter],
})
export class RoomModule {}
