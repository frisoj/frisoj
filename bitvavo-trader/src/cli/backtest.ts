/**
 * CLI: eerlijke backtest in de terminal.
 *
 *   npm run backtest -- --market BTC-EUR --interval 15m --days 30 [--capital 50]
 *                       [--source auto|bitvavo|simulated] [--optimize] [--walkforward]
 *                       [--objective sharpe|return|profitFactor|calmar] [--strategy <id>]
 *                       [--folds 4] [--train 0.7] [--combos 120] [--seed 1]
 *
 * Gebruikt DEFAULT_ENGINE_CONFIG (ensemble + risico), dezelfde code als de bot.
 */
import { join } from "node:path";
import { parseArgs } from "node:util";
import { computeMetrics } from "../backtest/metrics";
import { runBacktestDetailed, spreadFromTicker, type BacktestInput } from "../backtest/backtester";
import { optimize } from "../backtest/optimizer";
import { backtestVerdict } from "../backtest/verdict";
import { walkForward } from "../backtest/walkForward";
import { DEFAULT_ENGINE_CONFIG, DEFAULT_PAPER_CAPITAL } from "../core/defaults";
import {
  INTERVALS,
  INTERVAL_MS,
  STRATEGY_IDS,
  type BacktestMetrics,
  type BacktestResult,
  type ExitReason,
  type Interval,
  type MarketDataFeed,
  type MarketInfo,
  type OptimizeObjective,
  type StrategyId,
} from "../core/types";
import { BitvavoFeed } from "../data/bitvavoFeed";
import { isBitvavoReachable } from "../data/reachability";
import { SimulatedFeed } from "../data/simulatedFeed";
import { BitvavoClient } from "../exchange/bitvavoClient";

const WARMUP_CANDLES = 250;
const DAY_MS = 24 * 60 * 60 * 1000;
const OBJECTIVES: OptimizeObjective[] = ["sharpe", "return", "profitFactor", "calmar"];

// ─────────────────────────────── Opmaak ───────────────────────────────

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code: string) => (s: string) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
const green = paint("32");
const red = paint("31");
const yellow = paint("33");
const bold = paint("1");
const dim = paint("2");

const nf = (min: number, max: number) =>
  new Intl.NumberFormat("nl-NL", { minimumFractionDigits: min, maximumFractionDigits: max });
const nf2 = nf(2, 2);
const nf4 = nf(4, 4);

function eur(x: number): string {
  return `${x < 0 ? "-" : ""}€${nf2.format(Math.abs(x))}`;
}
function pct(x: number, decimals = 2): string {
  const s = `${x > 0 ? "+" : x < 0 ? "-" : ""}${nf(decimals, decimals).format(Math.abs(x))}%`;
  return x > 0 ? green(s) : x < 0 ? red(s) : s;
}
function plainPct(x: number, decimals = 1): string {
  return `${nf(decimals, decimals).format(x)}%`;
}
function ratio(x: number): string {
  return x >= 999 ? "∞" : nf2.format(x);
}
function price(x: number): string {
  if (!Number.isFinite(x)) return String(x);
  const a = Math.abs(x);
  if (a >= 1000) return nf2.format(x);
  if (a >= 1) return nf4.format(x);
  return x.toPrecision(5).replace(".", ",");
}
const dateFmt = new Intl.DateTimeFormat("nl-NL", {
  timeZone: "Europe/Amsterdam",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});
function when(ms: number): string {
  return dateFmt.format(new Date(ms)).replace(",", "");
}

// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;]*m/g;
const visible = (s: string) => s.replace(ANSI, "").length;
const padEnd = (s: string, w: number) => s + " ".repeat(Math.max(0, w - visible(s)));
const padStart = (s: string, w: number) => " ".repeat(Math.max(0, w - visible(s))) + s;

/** Eenvoudige tabel: eerste kolom (en `leftCols`) links, de rest rechts uitgelijnd. */
function table(header: string[], rows: string[][], leftCols: number[] = []): string {
  const widths = header.map((h, c) => Math.max(visible(h), ...rows.map((r) => visible(r[c] ?? ""))));
  const left = new Set([0, ...leftCols]);
  const line = (cells: string[]) =>
    cells.map((cell, c) => (left.has(c) ? padEnd(cell, widths[c]) : padStart(cell, widths[c]))).join("  ");
  return [bold(line(header)), dim(widths.map((w) => "─".repeat(w)).join("  ")), ...rows.map(line)].join("\n");
}

const EXIT_NL: Record<ExitReason, string> = {
  "stop-loss": "Stop-loss",
  "take-profit": "Take-profit",
  "trailing-stop": "Trailing stop",
  "break-even": "Break-even",
  signal: "Verkoopsignaal",
  "time-stop": "Tijdstop",
  manual: "Handmatig",
  "kill-switch": "Noodstop",
  "end-of-backtest": "Einde test",
};

function banner(lines: string[], color: (s: string) => string): string {
  const w = Math.max(...lines.map((l) => l.length)) + 4;
  const bar = "!".repeat(w);
  return [bar, ...lines.map((l) => `! ${l.padEnd(w - 4)} !`), bar].map(color).join("\n");
}

// ─────────────────────────────── Argumenten ───────────────────────────────

const USAGE = `Gebruik:
  npm run backtest -- --market BTC-EUR --interval 15m --days 30 [--capital 50]
                      [--source auto|bitvavo|simulated] [--optimize] [--walkforward]
                      [--objective sharpe|return|profitFactor|calmar] [--strategy <id>]
                      [--folds 4] [--train 0.7] [--combos 120] [--seed 1]`;

interface CliOptions {
  market: string;
  interval: Interval;
  days: number;
  capital: number;
  source: "auto" | "bitvavo" | "simulated";
  optimize: boolean;
  walkforward: boolean;
  objective: OptimizeObjective;
  strategy?: StrategyId;
  folds: number;
  trainRatio: number;
  combos: number;
  seed?: number;
}

function fail(message: string): never {
  console.error(red(`Fout: ${message}`));
  console.error(USAGE);
  process.exit(1);
}

function rawArgs(argv: string[]) {
  try {
    return parseArgs({
      args: argv,
      options: {
        market: { type: "string", default: "BTC-EUR" },
        interval: { type: "string", default: "15m" },
        days: { type: "string", default: "30" },
        capital: { type: "string", default: String(DEFAULT_PAPER_CAPITAL) },
        source: { type: "string", default: "auto" },
        optimize: { type: "boolean", default: false },
        walkforward: { type: "boolean", default: false },
        objective: { type: "string", default: "sharpe" },
        strategy: { type: "string" },
        folds: { type: "string", default: "4" },
        train: { type: "string", default: "0.7" },
        combos: { type: "string", default: "120" },
        seed: { type: "string" },
        help: { type: "boolean", short: "h", default: false },
      },
      allowPositionals: false,
      strict: true,
    }).values;
  } catch (err) {
    fail((err as Error).message);
  }
}

function parseCli(argv: string[]): CliOptions {
  const values = rawArgs(argv);
  if (values.help) {
    console.log(USAGE);
    process.exit(0);
  }
  const num = (name: string, raw: string | undefined, min: number, max: number): number => {
    const v = Number(String(raw).replace(",", "."));
    if (!Number.isFinite(v) || v < min || v > max) fail(`--${name} moet een getal tussen ${min} en ${max} zijn (nu: ${raw})`);
    return v;
  };
  const interval = values.interval as Interval;
  if (!INTERVALS.includes(interval)) fail(`onbekend interval "${values.interval}" (kies uit ${INTERVALS.join(", ")})`);
  const source = values.source as CliOptions["source"];
  if (!["auto", "bitvavo", "simulated"].includes(source)) fail(`--source moet auto, bitvavo of simulated zijn`);
  const objective = values.objective as OptimizeObjective;
  if (!OBJECTIVES.includes(objective)) fail(`--objective moet een van ${OBJECTIVES.join(", ")} zijn`);
  const strategy = values.strategy as StrategyId | undefined;
  if (strategy !== undefined && !STRATEGY_IDS.includes(strategy)) {
    fail(`onbekende strategie "${strategy}" (kies uit ${STRATEGY_IDS.join(", ")})`);
  }
  const market = String(values.market).toUpperCase();
  if (!/^[A-Z0-9]+-[A-Z]+$/.test(market)) fail(`ongeldige markt "${values.market}" (bijv. BTC-EUR)`);
  return {
    market,
    interval,
    days: num("days", values.days, 0.1, 3650),
    capital: num("capital", values.capital, 1, 10_000_000),
    source,
    optimize: Boolean(values.optimize),
    walkforward: Boolean(values.walkforward),
    objective,
    strategy,
    folds: Math.round(num("folds", values.folds, 1, 20)),
    trainRatio: num("train", values.train, 0.1, 0.9),
    combos: Math.round(num("combos", values.combos, 1, 5000)),
    seed: values.seed !== undefined ? Math.round(num("seed", values.seed, 0, 2 ** 31)) : undefined,
  };
}

// ─────────────────────────────── Rapport ───────────────────────────────

function benchmarkMetrics(result: BacktestResult, takerFee: number): BacktestMetrics {
  return computeMetrics({
    trades: [],
    equityCurve: result.equityCurve.map((p) => ({ ...p, equity: p.benchmark })),
    initialCapital: result.initialCapital,
    interval: result.interval,
    candles: [],
    takerFee,
    exposureCandles: 0,
  });
}

function printMetrics(m: BacktestMetrics, bh: BacktestMetrics, initialCapital: number): void {
  const rows: string[][] = [
    ["Startkapitaal", eur(initialCapital), eur(initialCapital)],
    ["Eindkapitaal", eur(m.finalEquity), eur(bh.finalEquity)],
    ["Rendement", pct(m.totalReturnPct), pct(m.buyHoldReturnPct)],
    ["Max. drawdown", pct(m.maxDrawdownPct), pct(bh.maxDrawdownPct)],
    ["Sharpe (per jaar)", ratio(m.sharpe), ratio(bh.sharpe)],
    ["Sortino (per jaar)", ratio(m.sortino), ratio(bh.sortino)],
    ["Calmar", ratio(m.calmar), ratio(bh.calmar)],
    ["Aantal trades", String(m.trades), "1"],
    ["Winrate", plainPct(m.winRatePct), ""],
    ["Profit factor", ratio(m.profitFactor), ""],
    ["Gem. trade", pct(m.avgTradePct), ""],
    ["Gem. winst / verlies", `${pct(m.avgWinPct)} / ${pct(m.avgLossPct)}`, ""],
    ["Beste / slechtste trade", `${pct(m.bestTradePct)} / ${pct(m.worstTradePct)}`, ""],
    ["Verwachting per trade", eur(m.expectancyQuote), ""],
    ["Betaalde fees", eur(m.feesPaid), ""],
    ["Tijd in de markt", plainPct(m.exposurePct), "100,0%"],
    ["Gem. duur (candles)", nf(1, 1).format(m.avgCandlesHeld), ""],
  ];
  console.log(table(["", "Strategie", "Buy & hold"], rows));
}

function printTrades(result: BacktestResult, max = 10): void {
  const trades = result.trades.slice(-max);
  if (trades.length === 0) {
    console.log(dim("Geen trades."));
    return;
  }
  const rows = trades.map((t) => [
    when(t.entryTime),
    when(t.exitTime),
    price(t.entryPrice),
    price(t.exitPrice),
    eur(t.pnlQuote),
    pct(t.pnlPct),
    nf2.format(t.rMultiple),
    EXIT_NL[t.exitReason] ?? t.exitReason,
  ]);
  console.log(table(["Koop", "Verkoop", "Koopprijs", "Verkoopprijs", "Winst €", "Winst %", "R", "Reden"], rows, [1, 7]));
}

// ─────────────────────────────── Main ───────────────────────────────

async function pickFeed(opts: CliOptions): Promise<MarketDataFeed> {
  const cacheDir = join(process.cwd(), "data", "cache");
  if (opts.source === "simulated") return new SimulatedFeed({ seed: opts.seed });
  const client = new BitvavoClient();
  if (opts.source === "bitvavo") return new BitvavoFeed(client, { cacheDir });
  process.stdout.write(dim("Bitvavo bereikbaar? ... "));
  const reachable = await isBitvavoReachable(client);
  console.log(reachable ? green("ja") : yellow("nee"));
  return reachable ? new BitvavoFeed(client, { cacheDir }) : new SimulatedFeed({ seed: opts.seed });
}

async function main(): Promise<void> {
  const opts = parseCli(process.argv.slice(2));
  const cfg = DEFAULT_ENGINE_CONFIG;
  const feed = await pickFeed(opts);
  const simulated = feed.source === "simulated";

  console.log();
  console.log(bold(`Backtest ${opts.market} · ${opts.interval} · ${nf(0, 1).format(opts.days)} dagen · startkapitaal ${eur(opts.capital)}`));
  if (simulated) {
    console.log(
      banner(
        [
          "LET OP: GESIMULEERDE DATA (geen echte Bitvavo-koersen).",
          "Deze resultaten zeggen NIETS over hoe de bot op de echte markt presteert.",
          "Gebruik --source bitvavo (internet nodig) voor een echte test.",
        ],
        yellow,
      ),
    );
  } else {
    console.log(green("Databron: Bitvavo (echte historische candles)"));
  }

  const now = Date.now();
  const periodStart = now - opts.days * DAY_MS;
  const fromMs = periodStart - WARMUP_CANDLES * INTERVAL_MS[opts.interval];
  process.stdout.write(dim("Candles ophalen ... "));
  const candles = await feed.getHistory(opts.market, opts.interval, fromMs, now);
  let tradeFromIndex = candles.findIndex((c) => c.time >= periodStart);
  if (tradeFromIndex < 0) tradeFromIndex = candles.length;
  console.log(dim(`${candles.length} candles (${tradeFromIndex} warmup)`));
  if (candles.length - tradeFromIndex < 50) {
    throw new Error(`Te weinig candles in de periode (${candles.length - tradeFromIndex}); kies meer dagen of een korter interval.`);
  }

  let marketInfo: MarketInfo | undefined;
  try {
    marketInfo = (await feed.getMarkets()).find((m) => m.market === opts.market);
  } catch {
    marketInfo = undefined;
  }
  if (!marketInfo) console.log(yellow(`Marktinfo voor ${opts.market} niet gevonden: minimale order ${eur(cfg.risk.minOrderQuote)} aangenomen.`));

  // Huidige bid/ask-spread (best effort): een market order betaalt ongeveer de helft per kant.
  let spreadPct: number | undefined;
  try {
    spreadPct = spreadFromTicker((await feed.getTickers24h([opts.market])).find((t) => t.market === opts.market));
  } catch {
    spreadPct = undefined;
  }

  const input: BacktestInput = {
    market: opts.market,
    interval: opts.interval,
    candles,
    initialCapital: opts.capital,
    ensemble: cfg.ensemble,
    risk: cfg.risk,
    marketInfo,
    dataSource: feed.source,
    tradeFromIndex,
    spreadPct,
  };

  const detail = runBacktestDetailed(input);
  const result = detail.result;
  const slip = detail.slippagePct;
  const roundTrip = 2 * cfg.risk.takerFee + 2 * slip;
  const spreadTxt =
    spreadPct === undefined
      ? "spread onbekend"
      : slip > cfg.risk.slippagePct
        ? `incl. halve spread, huidige spread ${plainPct(spreadPct * 100, 2)}`
        : `spread ${plainPct(spreadPct * 100, 2)} valt binnen de slippage`;
  console.log();
  console.log(bold("── Resultaat ──"));
  console.log(
    dim(
      `Periode ${when(result.from)} t/m ${when(result.to)} · ${result.candlesCount} candles · ` +
        `kosten per round trip ${plainPct(roundTrip * 100, 2)} (2× ${plainPct(cfg.risk.takerFee * 100, 2)} fee + 2× ${plainPct(slip * 100, 2)} slippage, ${spreadTxt}) · ${result.durationMs} ms`,
    ),
  );
  if (detail.stuckTrades > 0) {
    const minOrder = marketInfo?.minOrderQuote ?? cfg.risk.minOrderQuote;
    console.log(
      yellow(
        `Let op: bij ${detail.stuckTrades} ${detail.stuckTrades === 1 ? "trade" : "trades"} weigerde de beurs de verkoop: de positie was minder ` +
          `waard dan het minimum van ${eur(minOrder)}. De positie bleef dan open zonder stop-loss (samen ${detail.stuckCandles} candles) ` +
          `tot hij weer genoeg waard was. Een grotere inleg per trade of een kleinere stop-afstand voorkomt dit.`,
      ),
    );
  }
  printMetrics(result.metrics, benchmarkMetrics(result, cfg.risk.takerFee), opts.capital);
  console.log();
  console.log(bold(`── Laatste ${Math.min(10, result.trades.length)} trades ──`));
  printTrades(result);

  if (opts.optimize) {
    console.log();
    console.log(bold(`── Optimalisatie (${opts.strategy ?? "ensemble-drempels + risico"}, doel: ${opts.objective}) ──`));
    const opt = optimize(input, { strategy: opts.strategy, objective: opts.objective, maxCombos: opts.combos });
    console.log(dim(`${opt.combosTested} combinaties getest in ${opt.durationMs} ms (minder dan 5 trades telt niet mee)`));
    const top = opt.rows.slice(0, 10);
    if (top.length > 0) {
      const keys = Object.keys(top[0].params);
      console.log(
        table(
          [...keys.map((k) => k.replace(/^ensemble\.|^risk\./, "")), "Score", "Rendement", "Max DD", "Trades", "PF"],
          top.map((r) => [
            ...keys.map((k) => String(r.params[k]).replace(".", ",")),
            r.score <= -1e9 ? "—" : nf2.format(r.score),
            pct(r.metrics.totalReturnPct),
            pct(r.metrics.maxDrawdownPct),
            String(r.metrics.trades),
            ratio(r.metrics.profitFactor),
          ]),
        ),
      );
    }
    console.log(
      yellow(
        "Let op: dit is IN-SAMPLE. De beste combinatie is gekozen op dezelfde data waarop hij getest is " +
          "(overfitting). Alleen een walk-forward (--walkforward) zegt iets over de toekomst.",
      ),
    );
  }

  let verdict = backtestVerdict(result.metrics, { simulatedData: simulated });
  if (opts.walkforward) {
    console.log();
    console.log(bold(`── Walk-forward (${opts.folds} folds, ${plainPct(opts.trainRatio * 100, 0)} train, doel: ${opts.objective}) ──`));
    const wf = walkForward(input, {
      folds: opts.folds,
      trainRatio: opts.trainRatio,
      strategy: opts.strategy,
      objective: opts.objective,
      maxCombos: opts.combos,
    });
    console.log(
      table(
        ["Fold", "Test van", "Test t/m", "Train rend.", "Test rend.", "Trades", "Beste params"],
        wf.folds.map((f) => [
          String(f.index + 1),
          when(f.testFrom),
          when(f.testTo),
          pct(f.trainMetrics.totalReturnPct),
          pct(f.testMetrics.totalReturnPct),
          String(f.testMetrics.trades),
          Object.entries(f.bestParams)
            .map(([k, v]) => `${k.replace(/^ensemble\.|^risk\./, "")}=${String(v).replace(".", ",")}`)
            .join(" "),
        ]),
        [6],
      ),
    );
    const o = wf.oosMetrics;
    console.log();
    console.log(
      table(
        ["Out-of-sample (alle testperiodes)", "Strategie", "Buy & hold"],
        [
          ["Rendement", pct(o.totalReturnPct), pct(o.buyHoldReturnPct)],
          ["Eindkapitaal", eur(o.finalEquity), eur(opts.capital * (1 + o.buyHoldReturnPct / 100))],
          ["Max. drawdown", pct(o.maxDrawdownPct), ""],
          ["Sharpe (per jaar)", ratio(o.sharpe), ""],
          ["Trades / winrate", `${o.trades} / ${plainPct(o.winRatePct)}`, ""],
          ["Profit factor", ratio(o.profitFactor), ""],
          ["Betaalde fees", eur(o.feesPaid), ""],
        ],
      ),
    );
    console.log(dim(`Walk-forward duurde ${wf.durationMs} ms`));
    verdict = wf.verdict;
  }

  console.log();
  console.log(bold("── Oordeel ──"));
  console.log(bold(verdict));
  if (!opts.walkforward) console.log(dim("Tip: voeg --walkforward toe voor een out-of-sample test (eerlijker dan één backtest)."));
  console.log();
}

main().catch((err: unknown) => {
  console.error(red(`Fout: ${err instanceof Error ? err.message : String(err)}`));
  process.exit(1);
});
