/**
 * Tauri mock for Playwright E2E tests.
 *
 * Injects a fake `window.__TAURI_INTERNALS__` and
 * `window.__TAURI_EVENT_PLUGIN_INTERNALS__` so the React app can boot
 * without a real Tauri backend.
 *
 * Usage in a test:
 *   await page.addInitScript(tauriMockScript);
 *   await page.goto('/');
 *
 * Then from the test you can simulate backend events:
 *   await page.evaluate(() => window.__TEST_EMIT__('status-changed', 'busy'));
 */

export const tauriMockScript = `
(() => {
  // ---------------------------------------------------------------------------
  // Callback registry (mirrors the real Tauri transformCallback / runCallback)
  // ---------------------------------------------------------------------------
  const callbacks = new Map();

  function registerCallback(callback, once) {
    const id = Math.floor(Math.random() * 0xFFFFFFFF);
    callbacks.set(id, (data) => {
      if (once) callbacks.delete(id);
      return callback && callback(data);
    });
    return id;
  }

  function unregisterCallback(id) {
    callbacks.delete(id);
  }

  function runCallback(id, data) {
    const cb = callbacks.get(id);
    if (cb) cb(data);
  }

  // ---------------------------------------------------------------------------
  // Event listener registry
  // ---------------------------------------------------------------------------
  const listeners = new Map(); // event -> handler callback id[]

  function handleListen(args) {
    const { event, handler } = args;
    if (!listeners.has(event)) listeners.set(event, []);
    listeners.get(event).push(handler);
    return handler; // eventId = the callback id
  }

  function handleEmit(args) {
    const { event, payload } = args;
    const ids = listeners.get(event) || [];
    for (const id of ids) {
      runCallback(id, { event, payload, id });
    }
  }

  function handleUnlisten(args) {
    const { event, eventId } = args;
    const ids = listeners.get(event);
    if (ids) {
      const idx = ids.indexOf(eventId);
      if (idx !== -1) ids.splice(idx, 1);
    }
    unregisterCallback(eventId);
  }

  // ---------------------------------------------------------------------------
  // Mock store (in-memory)
  // ---------------------------------------------------------------------------
  const mockStores = new Map(); // path -> Map<key, value>
  let ridCounter = 1;
  const ridToPath = new Map();

  function getOrCreateStore(path) {
    if (!mockStores.has(path)) mockStores.set(path, new Map());
    return mockStores.get(path);
  }

  // ---------------------------------------------------------------------------
  // invoke() mock — handles core plugin commands
  // ---------------------------------------------------------------------------
  async function invoke(cmd, args, _options) {
    // Event plugin
    if (cmd === 'plugin:event|listen') return handleListen(args);
    if (cmd === 'plugin:event|emit')   { handleEmit(args); return null; }
    if (cmd === 'plugin:event|emit_to') { handleEmit(args); return null; }
    if (cmd === 'plugin:event|unlisten') { handleUnlisten(args); return null; }

    // Store plugin  -------------------------------------------------------
    if (cmd === 'plugin:store|load') {
      const path = args.path || args.filename || 'store.json';
      getOrCreateStore(path);
      const rid = ridCounter++;
      ridToPath.set(rid, path);
      return rid;
    }
    if (cmd === 'plugin:store|get') {
      const path = ridToPath.get(args.rid) || 'store.json';
      const store = getOrCreateStore(path);
      const val = store.get(args.key);
      return val !== undefined ? [val] : null;
    }
    if (cmd === 'plugin:store|set') {
      const path = ridToPath.get(args.rid) || 'store.json';
      const store = getOrCreateStore(path);
      store.set(args.key, args.value);
      return null;
    }
    if (cmd === 'plugin:store|delete') {
      const path = ridToPath.get(args.rid) || 'store.json';
      const store = getOrCreateStore(path);
      store.delete(args.key);
      return true;
    }
    if (cmd === 'plugin:store|save')  return null;
    if (cmd === 'plugin:store|clear') return null;

    // Resource plugin
    if (cmd === 'plugin:resources|close') return null;

    // Path plugin  ---------------------------------------------------------
    if (cmd === 'plugin:path|resolve_directory') return '/mock/app-data/';
    if (cmd === 'plugin:path|resolve')  return (args.paths || []).join('/');
    if (cmd === 'plugin:path|join')     return (args.paths || []).join('/');
    if (cmd === 'plugin:path|normalize') return args.path || '';
    if (cmd === 'plugin:path|basename')  return 'mock';
    if (cmd === 'plugin:path|dirname')   return '/mock';
    if (cmd === 'plugin:path|extname')   return '';
    if (cmd === 'plugin:path|is_absolute') return true;

    // Window plugin  -------------------------------------------------------
    if (cmd === 'plugin:window|start_dragging') return null;
    if (cmd === 'plugin:window|set_size')       return null;
    if (cmd === 'plugin:window|inner_size')     return { width: 500, height: 220 };
    if (cmd === 'plugin:window|outer_size')     return { width: 500, height: 220 };
    if (cmd === 'plugin:window|inner_position') return { x: 0, y: 0 };
    if (cmd === 'plugin:window|outer_position') return { x: 0, y: 0 };
    if (cmd === 'plugin:window|is_focused')     return true;

    // Menu plugin
    if (cmd && cmd.startsWith('plugin:menu|'))  return null;

    // Dialog plugin  ------------------------------------------------------
    if (cmd === 'plugin:dialog|open') return window.__MOCK_DIALOG_RESULT__ ?? null;

    // FS plugin (in-memory no-ops)  ---------------------------------------
    if (cmd === 'plugin:fs|exists')     return false;
    if (cmd === 'plugin:fs|mkdir')      return null;
    if (cmd === 'plugin:fs|copy_file')  return null;
    if (cmd === 'plugin:fs|read_file')  return new Uint8Array(0);
    if (cmd === 'plugin:fs|write_file') return null;
    if (cmd === 'plugin:fs|remove')     return null;

    // Log plugin  ---------------------------------------------------------
    if (cmd === 'plugin:log|log') return null;

    // Custom app commands
    if (cmd === 'start_visit') return null;

    // Fallback: log and return null
    console.debug('[tauri-mock] unhandled invoke:', cmd, args);
    return null;
  }

  // ---------------------------------------------------------------------------
  // convertFileSrc mock
  // ---------------------------------------------------------------------------
  function convertFileSrc(filePath, protocol) {
    protocol = protocol || 'asset';
    const path = encodeURIComponent(filePath);
    return protocol + '://localhost/' + path;
  }

  // ---------------------------------------------------------------------------
  // Install globals
  // ---------------------------------------------------------------------------
  window.__TAURI_INTERNALS__ = {
    invoke,
    transformCallback: registerCallback,
    unregisterCallback,
    runCallback,
    callbacks,
    convertFileSrc,
    metadata: {
      currentWindow: { label: 'main' },
      currentWebview: { windowLabel: 'main', label: 'main' },
    },
    plugins: {
      path: { sep: '/', delimiter: ':' },
    },
  };

  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
    unregisterListener(event, id) {
      const ids = listeners.get(event);
      if (ids) {
        const idx = ids.indexOf(id);
        if (idx !== -1) ids.splice(idx, 1);
      }
      unregisterCallback(id);
    },
  };

  // Also set the flag that @tauri-apps/api/core.isTauri() checks
  window.isTauri = true;

  // ---------------------------------------------------------------------------
  // Test helper: emit a Tauri event from the test side
  // ---------------------------------------------------------------------------
  window.__TEST_EMIT__ = function (event, payload) {
    handleEmit({ event, payload });
  };

  // Pre-seed a mock store value before the page boots.
  window.__TEST_SEED_STORE__ = function (storePath, key, value) {
    getOrCreateStore(storePath).set(key, value);
  };
})();
`;
