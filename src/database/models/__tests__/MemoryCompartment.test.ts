import MemoryCompartmentModel from '../MemoryCompartment';

function makeCompartment(
  raw: Record<string, any> = {},
): MemoryCompartmentModel {
  const base: Record<string, any> = {
    name: 'work',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-02T00:00:00Z'),
    ...raw,
  };
  const instance = Object.create(MemoryCompartmentModel.prototype);
  for (const [k, v] of Object.entries(base)) {
    Object.defineProperty(instance, k, {
      value: v,
      writable: true,
      configurable: true,
      enumerable: true,
    });
  }
  return instance as MemoryCompartmentModel;
}

describe('MemoryCompartment.toView', () => {
  it('produces the view shape with ISO dates', () => {
    const compartment = makeCompartment({description: 'work-related memory'});

    const view = compartment.toView();
    expect(view.name).toBe('work');
    expect(view.description).toBe('work-related memory');
    expect(view.createdAt).toBe('2026-01-01T00:00:00.000Z');
    expect(view.updatedAt).toBe('2026-01-02T00:00:00.000Z');
  });
});
