import { createZodDto } from 'nestjs-zod';
import {
  ListCustomersSchema,
  UpdateCustomerSchema,
} from '@modules/customers/schemas/customers.schema';

export class UpdateCustomerDto extends createZodDto(UpdateCustomerSchema) {}
export class ListCustomersDto extends createZodDto(ListCustomersSchema) {}
