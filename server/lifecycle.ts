import type { Server } from "node:http";

let draining = false;

export function isServerDraining() {
  return draining;
}

export function resetServerDrainingForTests() {
  draining = false;
}

export async function listenHttpServer(server: Server, port: number, host: string) {
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      server.off("error", onError);
      server.off("listening", onListening);
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const onListening = () => {
      cleanup();
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen({ port, host });
  });
}

export async function shutdownHttpServer(server: Server, timeoutMs = 9_000) {
  draining = true;
  return new Promise<{ forced: boolean; error: Error | null }>((resolve) => {
    let settled = false;
    const settle = (forced: boolean, error: Error | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ forced, error });
    };
    const timer = setTimeout(() => {
      server.closeAllConnections();
      settle(true, null);
    }, timeoutMs);
    server.close((error) => settle(false, error || null));
  });
}
