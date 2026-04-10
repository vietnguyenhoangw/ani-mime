/**
 * Mock for @tauri-apps/api/menu
 */

export class MenuItem {
  config: Record<string, unknown>;

  constructor(config: Record<string, unknown>) {
    this.config = config;
  }

  static async new(config: Record<string, unknown>): Promise<MenuItem> {
    return new MenuItem(config);
  }
}

const popupFn = vi.fn(async () => {});

export class Menu {
  items: MenuItem[];
  popup = popupFn;

  constructor(items: MenuItem[]) {
    this.items = items;
  }

  static async new(config: { items: MenuItem[] }): Promise<Menu> {
    return new Menu(config.items);
  }
}

export function resetMocks() {
  popupFn.mockClear();
}
