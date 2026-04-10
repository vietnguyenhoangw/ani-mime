import { useState, useEffect, useRef, useCallback, useLayoutEffect } from "react";
import { load } from "@tauri-apps/plugin-store";
import { emit, listen } from "@tauri-apps/api/event";

const STORE_FILE = "settings.json";
const STORE_KEY = "bubbleEnabled";
const BUBBLE_DURATION_MS = 7000;

const messages = [
  "Done! Check it out",
  "All finished!",
  "Hey, take a look!",
  "Task complete!",
  "Ready for you!",
];

const welcomeMessages = [
  "Hey! Ready to work",
  "Let's get started!",
  "Hello there!",
  "Woof! Hi!",
];

function randomMessage(): string {
  return messages[Math.floor(Math.random() * messages.length)];
}

interface TaskCompleted {
  duration_secs: number;
}

export function useBubble() {
  const [enabled, setEnabledState] = useState(true);
  const [visible, setVisible] = useState(false);
  const [message, setMessage] = useState("");
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const hasGreeted = useRef(false);

  // Load saved preference
  useLayoutEffect(() => {
    load(STORE_FILE).then((store) => {
      store.get<boolean>(STORE_KEY).then((saved) => {
        setEnabledState(saved ?? true);
      });
    });
  }, []);

  // Listen for setting changes from Settings window
  useEffect(() => {
    const unlisten = listen<boolean>("bubble-changed", (event) => {
      setEnabledState(event.payload);
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  // Welcome bubble on first "idle" after app launch
  useEffect(() => {
    const unlisten = listen<string>("status-changed", (e) => {
      if (hasGreeted.current || !enabled) return;
      if (e.payload === "idle") {
        hasGreeted.current = true;
        clearTimeout(timerRef.current);
        setMessage(welcomeMessages[Math.floor(Math.random() * welcomeMessages.length)]);
        setVisible(true);
        timerRef.current = setTimeout(() => {
          setVisible(false);
        }, BUBBLE_DURATION_MS);
      }
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [enabled]);

  // Hide bubble when status changes to busy/service
  useEffect(() => {
    const unlisten = listen<string>("status-changed", (e) => {
      if (e.payload === "busy" || e.payload === "service") {
        clearTimeout(timerRef.current);
        setVisible(false);
      }
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  // Listen for task-completed events
  useEffect(() => {
    const unlisten = listen<TaskCompleted>("task-completed", () => {
      if (!enabled) return;

      clearTimeout(timerRef.current);
      setMessage(randomMessage());
      setVisible(true);

      timerRef.current = setTimeout(() => {
        setVisible(false);
      }, BUBBLE_DURATION_MS);
    });

    return () => {
      clearTimeout(timerRef.current);
      unlisten.then((fn) => fn());
    };
  }, [enabled]);

  // Listen for discovery-hint: no peers found after timeout
  useEffect(() => {
    const unlisten = listen<string>("discovery-hint", (e) => {
      if (e.payload !== "no_peers") return;

      clearTimeout(timerRef.current);
      setMessage("No friends nearby! Check Privacy \u2192 Local Network");
      setVisible(true);

      timerRef.current = setTimeout(() => {
        setVisible(false);
      }, 10000);
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  const dismiss = useCallback(() => {
    clearTimeout(timerRef.current);
    setVisible(false);
  }, []);

  const setEnabled = async (next: boolean) => {
    setEnabledState(next);
    const store = await load(STORE_FILE);
    await store.set(STORE_KEY, next);
    await store.save();
    await emit("bubble-changed", next);
  };

  return { visible, message, dismiss, enabled, setEnabled };
}
