import { Module } from '@nestjs/common';
import { WhatsappModule } from '@modules/whatsapp/whatsapp.module';
import { CampaignsService } from '@modules/campaigns/campaigns.service';
import { CampaignsController } from '@modules/campaigns/campaigns.controller';
import { BusinessModule } from '@modules/business/business.module';

@Module({
  imports: [WhatsappModule, BusinessModule],
  controllers: [CampaignsController],
  providers: [CampaignsService],
})
export class CampaignsModule {}
