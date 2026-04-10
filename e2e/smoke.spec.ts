import { test, expect } from '@playwright/test';
import { tauriMockScript } from './tauri-mock';

// Helper: inject mock before navigation so it's available when React boots.
async function loadWithMock(page: import('@playwright/test').Page, path = '/') {
  await page.addInitScript(tauriMockScript);
  await page.goto(path);
}

// ---------------------------------------------------------------------------
// 1. App loads
// ---------------------------------------------------------------------------
test('app loads and shows initializing status', async ({ page }) => {
  await loadWithMock(page);

  // The main container should be visible
  const container = page.locator('[data-testid="app-container"]');
  await expect(container).toBeVisible();

  // The sprite element should exist
  const sprite = page.locator('[data-testid="mascot-sprite"]');
  await expect(sprite).toBeVisible();

  // The status pill should show "Initializing..." (the default state)
  const label = page.locator('[data-testid="status-label"]');
  await expect(label).toHaveText('Initializing...');
});

// ---------------------------------------------------------------------------
// 2. Status transition to busy
// ---------------------------------------------------------------------------
test('status transitions to busy', async ({ page }) => {
  await loadWithMock(page);

  // Wait for initial render
  await expect(page.locator('[data-testid="status-label"]')).toBeVisible();

  // Emit a status-changed event with "busy"
  await page.evaluate(() => {
    (window as any).__TEST_EMIT__('status-changed', 'busy');
  });

  // The label should now read "Working..."
  const label = page.locator('[data-testid="status-label"]');
  await expect(label).toHaveText('Working...');

  // The dot should have the "busy" class
  const dot = page.locator('[data-testid="status-dot"]');
  await expect(dot).toHaveClass(/\bbusy\b/);
});

// ---------------------------------------------------------------------------
// 3. Status transition to idle
// ---------------------------------------------------------------------------
test('status transitions to idle', async ({ page }) => {
  await loadWithMock(page);

  await expect(page.locator('[data-testid="status-label"]')).toBeVisible();

  // Emit idle
  await page.evaluate(() => {
    (window as any).__TEST_EMIT__('status-changed', 'idle');
  });

  const label = page.locator('[data-testid="status-label"]');
  await expect(label).toHaveText('Free');

  const dot = page.locator('[data-testid="status-dot"]');
  await expect(dot).toHaveClass(/\bidle\b/);
});

// ---------------------------------------------------------------------------
// 4. Speech bubble appears and dismisses
// ---------------------------------------------------------------------------
test('speech bubble appears on task-completed and dismisses on click', async ({ page }) => {
  await loadWithMock(page);

  await expect(page.locator('[data-testid="status-label"]')).toBeVisible();

  // The bubble should not be visible initially
  await expect(page.locator('[data-testid="speech-bubble"]')).not.toBeVisible();

  // Emit a task-completed event (useBubble listens to this)
  await page.evaluate(() => {
    (window as any).__TEST_EMIT__('task-completed', { duration_secs: 5 });
  });

  // The bubble should now be visible with some message text
  const bubble = page.locator('[data-testid="speech-bubble"]');
  await expect(bubble).toBeVisible();

  const bubbleText = page.locator('[data-testid="speech-bubble-text"]');
  await expect(bubbleText).not.toBeEmpty();

  // Click the bubble to dismiss it
  await bubble.click();

  // The bubble should disappear
  await expect(bubble).not.toBeVisible();
});

// ---------------------------------------------------------------------------
// 5. Scenario mode
// ---------------------------------------------------------------------------
test('scenario override shows badge and changes status', async ({ page }) => {
  await loadWithMock(page);

  await expect(page.locator('[data-testid="status-label"]')).toBeVisible();

  // No scenario badge initially
  await expect(page.locator('[data-testid="scenario-badge"]')).not.toBeVisible();

  // Emit scenario-override with status "service"
  await page.evaluate(() => {
    (window as any).__TEST_EMIT__('scenario-override', { status: 'service' });
  });

  // The scenario badge should appear
  const badge = page.locator('[data-testid="scenario-badge"]');
  await expect(badge).toBeVisible();
  await expect(badge).toHaveText('SCENARIO');

  // The container should have scenario-active class
  const container = page.locator('[data-testid="app-container"]');
  await expect(container).toHaveClass(/scenario-active/);

  // The status pill should show "Service"
  const label = page.locator('[data-testid="status-label"]');
  await expect(label).toHaveText('Service');
});

// ---------------------------------------------------------------------------
// 6. Status transition to disconnected
// ---------------------------------------------------------------------------
test('status transitions to disconnected', async ({ page }) => {
  await loadWithMock(page);

  await expect(page.locator('[data-testid="status-label"]')).toBeVisible();

  // Emit disconnected
  await page.evaluate(() => {
    (window as any).__TEST_EMIT__('status-changed', 'disconnected');
  });

  const label = page.locator('[data-testid="status-label"]');
  await expect(label).toHaveText('Sleep');

  const dot = page.locator('[data-testid="status-dot"]');
  await expect(dot).toHaveClass(/\bdisconnected\b/);
});

// ---------------------------------------------------------------------------
// 7. Status transition to searching
// ---------------------------------------------------------------------------
test('status transitions to searching', async ({ page }) => {
  await loadWithMock(page);

  await expect(page.locator('[data-testid="status-label"]')).toBeVisible();

  // Emit searching
  await page.evaluate(() => {
    (window as any).__TEST_EMIT__('status-changed', 'searching');
  });

  const label = page.locator('[data-testid="status-label"]');
  await expect(label).toHaveText('Searching...');

  const dot = page.locator('[data-testid="status-dot"]');
  await expect(dot).toHaveClass(/\bsearching\b/);
});

// ---------------------------------------------------------------------------
// 8. Visiting status hides mascot
// ---------------------------------------------------------------------------
test('visiting status hides mascot', async ({ page }) => {
  await loadWithMock(page);

  // Wait for initial render and set idle so mascot is visible
  await expect(page.locator('[data-testid="status-label"]')).toBeVisible();
  await page.evaluate(() => {
    (window as any).__TEST_EMIT__('status-changed', 'idle');
  });
  await expect(page.locator('[data-testid="mascot-sprite"]')).toBeVisible();

  // Emit dog-away with true to trigger visiting status
  await page.evaluate(() => {
    (window as any).__TEST_EMIT__('dog-away', true);
  });

  // The mascot sprite should no longer be visible (replaced by placeholder div)
  await expect(page.locator('[data-testid="mascot-sprite"]')).not.toBeVisible();

  // The status pill should show "Visiting..."
  const label = page.locator('[data-testid="status-label"]');
  await expect(label).toHaveText('Visiting...');
});

// ---------------------------------------------------------------------------
// 9. Settings page loads
// ---------------------------------------------------------------------------
test('settings page loads and renders form', async ({ page }) => {
  await loadWithMock(page, '/settings.html');

  // The settings container should be visible
  const settings = page.locator('.settings');
  await expect(settings).toBeVisible();

  // The sidebar should be rendered with tab buttons
  const sidebar = page.locator('.settings-sidebar');
  await expect(sidebar).toBeVisible();

  // Should have General, Mime, and About tabs
  await expect(sidebar.locator('.sidebar-item')).toHaveCount(3);
  await expect(sidebar.locator('.sidebar-item').nth(0)).toHaveText('General');
  await expect(sidebar.locator('.sidebar-item').nth(1)).toHaveText('Mime');
  await expect(sidebar.locator('.sidebar-item').nth(2)).toHaveText('About');

  // The content area with the title should be visible
  const content = page.locator('.settings-content');
  await expect(content).toBeVisible();

  // The title should show "General" (the default tab)
  const title = page.locator('.settings-title');
  await expect(title).toHaveText('General');
});

// ---------------------------------------------------------------------------
// 10. Upload Charlotte as custom sprite
// ---------------------------------------------------------------------------
test('upload Charlotte as custom sprite via manual flow', async ({ page }) => {
  await loadWithMock(page, '/settings.html');

  // Navigate to Mime tab
  await page.click('.sidebar-item:nth-child(2)');
  await expect(page.locator('.settings-title')).toHaveText('Mime');

  // Click the Manual add card to open the creator form
  await page.click('.pet-card.add-card:has-text("Manual")');
  const creator = page.locator('.custom-creator');
  await expect(creator).toBeVisible();

  // Save should be disabled initially (no name, no files selected)
  const saveBtn = creator.locator('.creator-btn.save');
  await expect(saveBtn).toBeDisabled();

  // Enter "Charlotte" as the mime name
  await creator.locator('.settings-input').fill('Charlotte');

  // Configure mock file dialog to return a fake sprite path
  await page.evaluate(() => {
    (window as any).__MOCK_DIALOG_RESULT__ = '/mock/sprites/charlotte.png';
  });

  // Pick a sprite file for each of the 7 statuses
  const pickButtons = creator.locator('.sprite-pick-btn');
  await expect(pickButtons).toHaveCount(7);

  for (let i = 0; i < 7; i++) {
    await pickButtons.nth(i).click();
    // Button text changes from "Choose PNG" to the selected filename
    await expect(pickButtons.nth(i)).toHaveText('charlotte.png');
  }

  // Save should now be enabled (name filled + all 7 files selected)
  await expect(saveBtn).toBeEnabled();

  // Save the custom mime
  await saveBtn.click();

  // The creator form should close
  await expect(creator).not.toBeVisible();

  // Charlotte should appear in the custom mimes list
  const charlotteName = page.locator('.pet-card-wrapper .pet-name', { hasText: 'Charlotte' });
  await expect(charlotteName).toBeVisible();
});
