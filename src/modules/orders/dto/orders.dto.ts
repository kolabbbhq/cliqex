import { createZodDto } from 'nestjs-zod';
import {
  ListOrdersSchema,
  UpdateOrderNotesSchema,
  PriceItemSchema,
  PriceAllItemsSchema,
  CancelOrderSchema,
  AssignBuddySchema,
} from '../schemas/orders.schema';

export class ListOrdersDto extends createZodDto(ListOrdersSchema) {}
export class UpdateOrderNotesDto extends createZodDto(UpdateOrderNotesSchema) {}
export class PriceItemDto extends createZodDto(PriceItemSchema) {}
export class PriceAllItemsDto extends createZodDto(PriceAllItemsSchema) {}
export class CancelOrderDto extends createZodDto(CancelOrderSchema) {}
export class AssignBuddyDto extends createZodDto(AssignBuddySchema) {}
