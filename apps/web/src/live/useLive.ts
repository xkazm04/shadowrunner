// The control page's connection (spec flashhead-live, task 3.3): one `control` client per server
// URL, its status and the latest `state`, and a fan-out of every server message to the tabs that
// listen (lines, chat, slides).
import { useCallback, useEffect, useRef, useState } from "react";
import { connectLive, type ConnectionStatus, type LiveClient } from "./client";
import type { ClientMessage, LiveState, ServerMessage } from "./protocol";

export type Listener = (message: ServerMessage) => void;

export interface LiveControl {
  status: ConnectionStatus;
  state: LiveState | undefined;
  send: (message: ClientMessage) => boolean;
  sendBinary: (data: ArrayBuffer) => boolean;
  /** Subscribe to every server message; returns the unsubscribe. */
  listen: (listener: Listener) => () => void;
}

export function useLiveControl(url: string): LiveControl {
  const [status, setStatus] = useState<ConnectionStatus>({ kind: "connecting" });
  const [state, setState] = useState<LiveState | undefined>(undefined);
  const client = useRef<LiveClient | undefined>(undefined);
  const listeners = useRef(new Set<Listener>());

  useEffect(() => {
    const live = connectLive({
      url,
      role: "control",
      onStatus: (next) => {
        setStatus(next);
        if (next.kind !== "open") setState(undefined);
      },
      onMessage: (message) => {
        if (message.type === "state") setState(message);
        for (const listener of listeners.current) listener(message);
      },
    });
    client.current = live;
    return () => {
      client.current = undefined;
      live.close();
    };
  }, [url]);

  const send = useCallback((message: ClientMessage) => client.current?.send(message) ?? false, []);
  const sendBinary = useCallback((data: ArrayBuffer) => client.current?.sendBinary(data) ?? false, []);
  const listen = useCallback((listener: Listener) => {
    listeners.current.add(listener);
    return () => {
      listeners.current.delete(listener);
    };
  }, []);

  return { status, state, send, sendBinary, listen };
}
