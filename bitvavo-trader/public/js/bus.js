// Mini event-bus. Server-events (SSE) worden 1-op-1 doorgezet met hun type
// ("snapshot", "price", ...). UI-events: "market-selected" {market},
// "tab-changed" {tab}, "connection" {status: "open"|"closed"|"connecting"|"paused"},
// "config-changed" (EngineConfig).

export function createBus() {
  const handlers = new Map();
  return {
    /** Registreer handler; geeft unsubscribe-functie terug */
    on(type, fn) {
      if (!handlers.has(type)) handlers.set(type, new Set());
      handlers.get(type).add(fn);
      return () => handlers.get(type)?.delete(fn);
    },
    emit(type, data) {
      for (const fn of handlers.get(type) || []) {
        try {
          fn(data);
        } catch (err) {
          console.error(`Fout in handler voor "${type}"`, err);
        }
      }
    },
  };
}
