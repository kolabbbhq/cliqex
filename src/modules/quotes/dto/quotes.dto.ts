import { createZodDto } from 'nestjs-zod';
import { SendQuoteSchema, UpdateItemPriceSchema } from '../schemas/quotes.schema';

export class SendQuoteDto extends createZodDto(SendQuoteSchema) {}
export class UpdateItemPriceDto extends createZodDto(UpdateItemPriceSchema) {}
