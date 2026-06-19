import { createZodDto } from 'nestjs-zod';
import {
  ListCampaignsSchema,
  CreateCampaignSchema,
} from '@modules/campaigns/schemas/campaigns.schema';

export class CreateCampaignDto extends createZodDto(CreateCampaignSchema) {}
export class ListCampaignsDto extends createZodDto(ListCampaignsSchema) {}
