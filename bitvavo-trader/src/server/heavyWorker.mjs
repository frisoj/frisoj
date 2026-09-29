// Entry van de rekenwerker (worker-thread) voor backtests/optimalisaties.
// Gewoon JavaScript: registreert eerst tsx in deze thread (loader-hooks van de
// hoofdthread gelden niet in workers) en laadt dan de TypeScript-implementatie.
import { register } from "tsx/esm/api";

register();
await import("./heavyWorkerImpl.ts");
