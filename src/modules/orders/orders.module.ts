import { Module } from '@nestjs/common';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { OrdersRepository } from './orders.repository';
import { PrismaModule } from '@common/prisma/prisma.module';
import { ReviewsModule } from '@modules/reviews/reviews.module';

@Module({
  imports: [PrismaModule, ReviewsModule],
  controllers: [OrdersController],
  providers: [OrdersService, OrdersRepository],
  exports: [OrdersService], // WhatsappModule uses this
})
export class OrdersModule {}
