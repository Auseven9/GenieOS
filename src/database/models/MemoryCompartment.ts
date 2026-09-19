import {Model} from '@nozbe/watermelondb';
import {field, readonly, date} from '@nozbe/watermelondb/decorators';
import type {MemoryCompartment as MemoryCompartmentView} from '../../types/memoryGraph';

export default class MemoryCompartment extends Model {
  static table = 'memory_compartments';

  @field('name') name!: string;
  @field('description') description?: string;
  @readonly @date('created_at') createdAt!: Date;
  @readonly @date('updated_at') updatedAt!: Date;

  toView(): MemoryCompartmentView {
    return {
      id: this.id,
      name: this.name,
      description: this.description,
      createdAt: this.createdAt.toISOString(),
      updatedAt: this.updatedAt.toISOString(),
    };
  }
}
