import { Module } from '@nestjs/common';
import { BuddiesService } from '@modules/buddies/buddies.service';
import { BuddiesController } from '@modules/buddies/buddies.controller';
import { BuddiesRepository } from '@modules/buddies/buddies.repository';

@Module({
  controllers: [BuddiesController],
  providers: [BuddiesService, BuddiesRepository],
  exports: [BuddiesService],
})
export class BuddiesModule {}
