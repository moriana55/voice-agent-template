import test from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import {
  isServerDraining,
  resetServerDrainingForTests,
  shutdownHttpServer,
} from "../server/lifecycle";

test("graceful shutdown draining durumuna geçip aktif işleri bekler", async () => {
  resetServerDrainingForTests();
  let forced = false;
  const server = {
    close(callback: (error?: Error) => void) { callback(); return this; },
    closeAllConnections() { forced = true; },
  } as unknown as Server;
  const result = await shutdownHttpServer(server, 50);
  assert.equal(isServerDraining(), true);
  assert.deepEqual(result, { forced: false, error: null });
  assert.equal(forced, false);
});

test("graceful shutdown süre aşımında bağlantıları kontrollü kapatır", async () => {
  resetServerDrainingForTests();
  let forced = false;
  const server = {
    close() { return this; },
    closeAllConnections() { forced = true; },
  } as unknown as Server;
  const result = await shutdownHttpServer(server, 5);
  assert.deepEqual(result, { forced: true, error: null });
  assert.equal(forced, true);
});
