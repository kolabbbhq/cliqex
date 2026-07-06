import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import { MenuService } from './menu.service';
import { CreateMenuItemInput, UpdateMenuItemInput, ReorderMenuItemsInput } from './dto/menu.schema';
import { JwtGuard } from '@modules/auth/guards/auth.guards';

@UseGuards(JwtGuard)
@Controller('menu-items')
export class MenuController {
  constructor(private readonly menuService: MenuService) {}

  @Get()
  findAll() {
    return this.menuService.findAll();
  }

  @Post()
  create(@Body() dto: CreateMenuItemInput) {
    return this.menuService.create(dto);
  }

  @Post('reorder')
  reorder(@Body() dto: ReorderMenuItemsInput) {
    return this.menuService.reorder(dto.items);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateMenuItemInput) {
    return this.menuService.update(id, dto);
  }

  @Patch(':id/toggle')
  toggle(@Param('id') id: string) {
    return this.menuService.toggle(id);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.menuService.remove(id);
  }
}