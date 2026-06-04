import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { tauriMockScript } from './tauri-mock';

// A realistic PluginRecord, matching the backend shape the mock returns.
function makePlugin(id: string, name: string, enabled = true) {
  return {
    manifest: {
      id,
      name,
      version: '1.0.0',
      description: `${name} description`,
      author: 'test',
      entry: 'index.html',
      capabilities: ['network'],
      window: {
        width: 400,
        height: 300,
        resizable: true,
        alwaysOnTop: false,
        transparent: false,
        decorations: true,
      },
    },
    enabled,
    status: { type: 'Loaded' },
  };
}

// Inject the Tauri mock + seed plugin globals BEFORE navigation so they are
// available when React boots and usePlugins first calls get_plugins.
async function loadSettings(
  page: Page,
  mockPlugins: unknown[] = [],
  installPlugin: unknown = null,
) {
  await page.addInitScript(tauriMockScript);
  await page.addInitScript(
    ([plugins, install]) => {
      (window as any).__MOCK_PLUGINS__ = plugins;
      if (install) (window as any).__MOCK_INSTALL_PLUGIN__ = install;
    },
    [mockPlugins, installPlugin] as const,
  );
  await page.goto('/settings.html');

  // Navigate to the Plugins tab (sidebar items are <button> with visible text).
  await page.getByRole('button', { name: 'Plugins', exact: true }).click();

  // The Plugin Manager should be mounted under the plugins tab.
  await expect(page.locator('[data-testid="plugin-manager"]')).toBeVisible();
}

// ---------------------------------------------------------------------------
// 1. Empty state
// ---------------------------------------------------------------------------
test('empty state shows when no plugins installed', async ({ page }) => {
  await loadSettings(page, []);

  await expect(page.locator('[data-testid="plugin-empty-state"]')).toBeVisible();
});

// ---------------------------------------------------------------------------
// 2. Install shows a card
// ---------------------------------------------------------------------------
test('installing a plugin shows its card', async ({ page }) => {
  await loadSettings(page, [], makePlugin('translator', 'Translator'));

  // Empty state first.
  await expect(page.locator('[data-testid="plugin-empty-state"]')).toBeVisible();

  // Click install — the mock appends __MOCK_INSTALL_PLUGIN__ and the hook
  // re-fetches get_plugins.
  await page.locator('[data-testid="install-plugin-btn"]').click();

  await expect(page.locator('[data-testid="plugin-card-translator"]')).toBeVisible();
  await expect(page.locator('[data-testid="plugin-empty-state"]')).toHaveCount(0);
});

// ---------------------------------------------------------------------------
// 3. Launch records the id
// ---------------------------------------------------------------------------
test('launching a plugin records its id', async ({ page }) => {
  await loadSettings(page, [makePlugin('translator', 'Translator', true)]);

  const card = page.locator('[data-testid="plugin-card-translator"]');
  await expect(card).toBeVisible();

  const launchBtn = page.locator('[data-testid="plugin-launch-btn-translator"]');
  await expect(launchBtn).toBeEnabled();
  await launchBtn.click();

  const launched = await page.evaluate(() => (window as any).__MOCK_LAUNCHED__ ?? []);
  expect(launched).toContain('translator');
});

// ---------------------------------------------------------------------------
// 4. Disabling greys out the launch button
// ---------------------------------------------------------------------------
test('disabling a plugin greys out launch and flips the toggle', async ({ page }) => {
  await loadSettings(page, [makePlugin('translator', 'Translator', true)]);

  const toggle = page.locator('[data-testid="plugin-enable-toggle-translator"]');
  const launchBtn = page.locator('[data-testid="plugin-launch-btn-translator"]');

  // Starts enabled.
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await expect(launchBtn).toBeEnabled();

  // Disable it — the mock updates the record and the hook re-fetches.
  await toggle.click();

  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await expect(launchBtn).toBeDisabled();
});

// ---------------------------------------------------------------------------
// 5. Uninstall (two clicks) removes the card
// ---------------------------------------------------------------------------
test('uninstalling a plugin removes its card after confirmation', async ({ page }) => {
  await loadSettings(page, [makePlugin('translator', 'Translator', true)]);

  const card = page.locator('[data-testid="plugin-card-translator"]');
  await expect(card).toBeVisible();

  const uninstallBtn = page.locator('[data-testid="plugin-uninstall-btn-translator"]');

  // First click arms the confirmation; second click performs the uninstall.
  await uninstallBtn.click();
  await uninstallBtn.click();

  await expect(card).toHaveCount(0);
  await expect(page.locator('[data-testid="plugin-empty-state"]')).toBeVisible();
});
