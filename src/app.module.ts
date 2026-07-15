import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { BullModule } from '@nestjs/bull';

import { PrismaModule } from './common/prisma/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { CustomersModule } from './modules/customers/customers.module';
import { OrdersModule } from './modules/orders/orders.module';
import { WhatsappModule } from './modules/whatsapp/whatsapp.module';
import { QuotesModule } from '@modules/quotes/quotes.module';
import { PricingModule } from '@modules/pricing/pricing.module';
import { PaymentsModule } from '@modules/payments/payments.module';
import { NotificationsModule } from '@modules/notifications/notifications.module';
import { CampaignsModule } from '@modules/campaigns/campaigns.module';
import { BuddiesModule } from '@modules/buddies/buddies.module';
import { TenantModule } from '@common/tenant/tenant.module';
import { OnboardingModule } from '@modules/onboarding/onboarding.module';
import { UploadModule } from '@modules/upload/upload.module';
import { FlowsModule } from '@modules/whatsapp/flows/flows.module';
import { ReviewsModule } from '@modules/reviews/reviews.module';
import { AnalyticsModule } from '@modules/analytics/analytics.module';
import { MenuModule } from '@modules/menu/menu.module';
import { PublicModule } from '@modules/public/public.module';
import { GatewayModule } from '@modules/gateway/gateway.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' }),
    EventEmitterModule.forRoot({ wildcard: true, maxListeners: 20 }),
    BullModule.forRoot({
      redis: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379'),
      },
    }),
    ReviewsModule,
    PrismaModule,
    AuthModule,
    FlowsModule,
    UploadModule,
    OnboardingModule,
    CustomersModule,
    OrdersModule,
    WhatsappModule,
    BuddiesModule,
    QuotesModule,
    PricingModule,
    TenantModule,
    PaymentsModule,
    CampaignsModule,
    AnalyticsModule,
    MenuModule,
    PublicModule,
    GatewayModule,
    NotificationsModule,
  ],
})
export class AppModule {}
