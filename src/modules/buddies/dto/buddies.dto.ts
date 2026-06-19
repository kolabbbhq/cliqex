import { createZodDto } from 'nestjs-zod';
import {
  CreateBuddySchema,
  UpdateBuddySchema,
  ListBuddiesSchema,
  UpdateBuddyStatusSchema,
} from '@modules/buddies/schemas/buddies.schema';

export class CreateBuddyDto extends createZodDto(CreateBuddySchema) {}
export class UpdateBuddyDto extends createZodDto(UpdateBuddySchema) {}
export class UpdateBuddyStatusDto extends createZodDto(UpdateBuddyStatusSchema) {}
export class ListBuddiesDto extends createZodDto(ListBuddiesSchema) {}
