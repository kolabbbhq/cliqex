import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@common/prisma/prisma.service';
import { TenantContext } from '@common/tenant/tenant-context.service';
import { CreateMenuItemInput, UpdateMenuItemInput } from './dto/menu.schema';

@Injectable()
export class MenuService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContext,
  ) {}

  async findAll() {
    const businessId = this.tenant.get();

    const items = await this.prisma.menuItem.findMany({
      where: { businessId },
      orderBy: [{ category: 'asc' }, { sort: 'asc' }, { name: 'asc' }],
    });

    // Group by category
    const grouped = new Map<string, typeof items>();
    for (const item of items) {
      if (!grouped.has(item.category)) grouped.set(item.category, []);
      grouped.get(item.category)!.push(item);
    }

    const categories = Array.from(grouped.entries()).map(([name, items]) => ({
      name,
      items: items.map((i) => ({
        ...i,
        price: Number(i.price),
      })),
    }));

    return { categories };
  }

  async create(dto: CreateMenuItemInput) {
    const businessId = this.tenant.get();

    const item = await this.prisma.menuItem.create({
      data: { ...dto, businessId },
    });

    return { ...item, price: Number(item.price) };
  }

  async update(id: string, dto: UpdateMenuItemInput) {
    const businessId = this.tenant.get();
    await this.assertOwnership(id, businessId);

    const item = await this.prisma.menuItem.update({
      where: { id },
      data: dto,
    });

    return { ...item, price: Number(item.price) };
  }

  async remove(id: string) {
    const businessId = this.tenant.get();
    await this.assertOwnership(id, businessId);

    await this.prisma.menuItem.delete({ where: { id } });
    return { success: true };
  }

  async toggle(id: string) {
    const businessId = this.tenant.get();
    const item = await this.assertOwnership(id, businessId);

    const updated = await this.prisma.menuItem.update({
      where: { id },
      data: { isAvailable: !item.isAvailable },
    });

    return { ...updated, price: Number(updated.price) };
  }

  async reorder(items: { id: string; sort: number }[]) {
    const businessId = this.tenant.get();

    await this.prisma.$transaction(
      items.map(({ id, sort }) =>
        this.prisma.menuItem.updateMany({
          where: { id, businessId },
          data: { sort },
        }),
      ),
    );

    return { success: true };
  }

  private async assertOwnership(id: string, businessId: string) {
    const item = await this.prisma.menuItem.findFirst({
      where: { id, businessId },
    });
    if (!item) throw new NotFoundException(`Menu item ${id} not found`);
    return item;
  }
}
