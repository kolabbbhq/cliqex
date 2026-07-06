import { createZodDto } from 'nestjs-zod';
import {
  PriceItemSchema,
   ListOrdersSchema,
  CancelOrderSchema,
  AssignBuddySchema,
  PriceAllItemsSchema,
  UpdateOrderNotesSchema,
} from '@modules/orders/schemas/orders.schema';

export class PriceItemDto        extends createZodDto(PriceItemSchema) {}
export class ListOrdersDto       extends createZodDto(ListOrdersSchema) {}
export class CancelOrderDto      extends createZodDto(CancelOrderSchema) {}
export class AssignBuddyDto      extends createZodDto(AssignBuddySchema) {}
export class PriceAllItemsDto    extends createZodDto(PriceAllItemsSchema) {}
export class UpdateOrderNotesDto extends createZodDto(UpdateOrderNotesSchema) {}
