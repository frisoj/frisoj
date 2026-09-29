/**
 * CLI: strategie-toernooi. Zet de ensemble-bot, elke strategie apart en
 * "gewoon kopen en vasthouden" naast elkaar over 1 week, 1 maand, 1 jaar en
 * 5 jaar, op meerdere markten, met hetzelfde startkapitaal en dezelfde kosten.
 * Voor de lange periodes volgt een walk-forward-controle: de instellingen
 * worden op een deel van de historie gekozen en getest op data die de
 * optimizer niet gezien heeft (eerlijker dan "de beste achteraf").
 *
 *   npm run tournament -- [--source auto|bitvavo|simulated] [--markets BTC-EUR,ETH-EUR]
 *                         [--capital 50] [--quick] [--no-walkforward] [--json pad.json]
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { runBacktestDetailed, spreadFromTicker, type BacktestInput } from "../backtest/backtester";
import { walkForward } from "../backtest/walkForward";
import { DEFAULT_ENGINE_CONFIG, DEFAULT_PAPER_CAPITAL } from "../core/defaults";
import {
  INTERVAL_MS,
  STRATEGY_IDS,
  type Candle,
  type EnsembleConfig,
  type Interval,
  type MarketDataFeed,
  type MarketInfo,
  type StrategyId,
} from "../core/types";
import { BitvavoFeed } from "../data/bitvavoFeed";
import { isBitvavoReachable } from "../data/reachability";
import { SimulatedFeed } from "../data/simulatedFeed";
import { BitvavoClient } from "../exchange/bitvavoClient";
import { backtestWarmupCandles } from "../server/warmup";
import { listStrategies } from "../strategies";
import { backtestWindow } from "./backtestReport";

const DAY_MS = 86_400_000;

export interface PeriodSpec {
  key: string;
  label: string;
  days: number;
  intervals: Interval[];
  /** Interval waarop de walk-forward-controle draait (alleen lange periodes) */
  walkForwardInterval?: Interval;
}

export const PERIODS: PeriodSpec[] = [
  { key: "1w", label: "1 week", days: 7, intervals: ["15m"] },
  { key: "1m", label: "1 maand", days: 30, intervals: ["15m", "1h"] },
  { key: "1y", label: "1 jaar", days: 365, intervals: ["1h", "4h"], walkForwardInterval: "1h" },
  { key: "5y", label: "5 jaar", days: 1826, intervals: ["4h", "1d"], walkForwardInterval: "4h" },
];

export const DEFAULT_MARKETS = ["BTC-EUR", "ETH-EUR", "SOL-EUR", "XRP-EUR", "ADA-EUR"];

export interface Contender {
  id: "ensemble" | StrategyId;
  name: string;
  ensemble: EnsembleConfig;
  /** Voor de walk-forward: optimaliseer de parameters van deze ene strategie */
  optimizeStrategy?: StrategyId;
}

export function contenders(): Contender[] {
  const base = DEFAULT_ENGINE_CONFIG.ensemble;
  const names = new Map(listStrategies().map((s) => [s.id, s.name]));
  return [
    { id: "ensemble", name: "Bot (alle 5 samen)", ensemble: base },
    ...STRATEGY_IDS.map((id) => ({
      id,
      name: names.get(id) ?? id,
      ensemble: { ...base, enabled: [id] },
      optimizeStrategy: id,
    })),
  ];
}

export interface TournamentRow {
  period: string;
  interval: Interval;
  market: string;
  contender: Contender["id"];
  contenderName: string;
  days: number;
  returnPct: number;
  pnlQuote: number;
  buyHoldReturnPct: number;
  maxDrawdownPct: number;
  trades: number;
  feesPaid: number;
  winRatePct: number;
}

export interface WalkForwardRow {
  period: string;
  interval: Interval;
  market: string;
  contender: Contender["id"];
  contenderName: string;
  oosReturnPct: number;
  oosPnlQuote: number;
  buyHoldReturnPct: number;
  foldsProfitable: number;
  folds: number;
  trades: number;
  verdict: string;
}

export interface TournamentResult {
  dataSource: MarketDataFeed["source"];
  capital: number;
  generatedAt: number;
  markets: string[];
  rows: TournamentRow[];
  walkForward: WalkForwardRow[];
  notes: string[];
}

export interface TournamentOptions {
  markets: string[];
  capital: number;
  periods: PeriodSpec[];
  walkForward: boolean;
  now?: number;
  log?: (msg: string) => void;
}

async function safe<T>(fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn();
  } catch {
    return undefined;
  }
}

/** Voert het hele toernooi uit. Puur rekenwerk; printen doet de CLI. */
export async function runTournament(feed: MarketDataFeed, opts: TournamentOptions): Promise<TournamentResult> {
  const now = opts.now ?? Date.now();
  const log = opts.log ?? (() => {});
  const cfg = DEFAULT_ENGINE_CONFIG;
  const all = contenders();
  const warmup = backtestWarmupCandles(cfg.ensemble);
  const rows: TournamentRow[] = [];
  const wfRows: WalkForwardRow[] = [];
  const notes: string[] = [];
  const infos = (await safe(() => feed.getMarkets())) ?? [];

  for (const market of opts.markets) {
    const marketInfo: MarketInfo | undefined = infos.find((m) => m.market === market);
    const ticker = await safe(async () => (await feed.getTickers24h([market])).find((t) => t.market === market));
    const spreadPct = spreadFromTicker(ticker);

    // Eén keer ophalen per interval, voor de langste periode die dat interval gebruikt
    const needDays = new Map<Interval, number>();
    for (const p of opts.periods) {
      for (const iv of [...p.intervals, ...(p.walkForwardInterval ? [p.walkForwardInterval] : [])]) {
        needDays.set(iv, Math.max(needDays.get(iv) ?? 0, p.days));
      }
    }
    const history = new Map<Interval, Candle[]>();
    for (const [iv, days] of needDays) {
      const wfWarm = opts.walkForward ? backtestWarmupCandles(cfg.ensemble, "ema-trend") : 0;
      const from = now - days * DAY_MS - Math.max(warmup, wfWarm, 250) * INTERVAL_MS[iv];
      log(`${market} ${iv}: candles ophalen (${days} dagen)…`);
      const candles = (await safe(() => feed.getHistory(market, iv, from, now))) ?? [];
      history.set(iv, candles);
    }

    for (const p of opts.periods) {
      const periodStart = now - p.days * DAY_MS;
      for (const iv of p.intervals) {
        const all_ = history.get(iv) ?? [];
        const { firstInPeriod, tradeFromIndex, shortened } = backtestWindow(all_, periodStart, warmup);
        const from = Math.max(0, firstInPeriod - warmup - 10);
        const candles = all_.slice(from);
        const tfi = tradeFromIndex - from;
        if (candles.length - tfi < 30) {
          notes.push(`${market} ${p.label} (${iv}): te weinig historie, overgeslagen.`);
          continue;
        }
        const days = (candles[candles.length - 1].time - candles[tfi].time) / DAY_MS;
        if (shortened || days < p.days * 0.9) {
          notes.push(`${market} ${p.label} (${iv}): maar ${Math.round(days)} dagen historie beschikbaar.`);
        }
        for (const c of all) {
          const input: BacktestInput = {
            market,
            interval: iv,
            candles,
            initialCapital: opts.capital,
            ensemble: c.ensemble,
            risk: cfg.risk,
            marketInfo,
            dataSource: feed.source,
            tradeFromIndex: tfi,
            spreadPct,
          };
          const m = runBacktestDetailed(input).result.metrics;
          rows.push({
            period: p.key,
            interval: iv,
            market,
            contender: c.id,
            contenderName: c.name,
            days,
            returnPct: m.totalReturnPct,
            pnlQuote: m.finalEquity - opts.capital,
            buyHoldReturnPct: m.buyHoldReturnPct,
            maxDrawdownPct: m.maxDrawdownPct,
            trades: m.trades,
            feesPaid: m.feesPaid,
            winRatePct: m.winRatePct,
          });
        }
      }

      if (opts.walkForward && p.walkForwardInterval) {
        const iv = p.walkForwardInterval;
        const all_ = history.get(iv) ?? [];
        for (const c of all) {
          const need = backtestWarmupCandles(c.ensemble, c.optimizeStrategy);
          const { firstInPeriod, tradeFromIndex } = backtestWindow(all_, periodStart, need);
          const from = Math.max(0, firstInPeriod - need - 10);
          const candles = all_.slice(from);
          const tfi = tradeFromIndex - from;
          if (candles.length - tfi < 200) continue;
          log(`${market} ${p.label}: walk-forward ${c.name}…`);
          const wf = walkForward(
            {
              market,
              interval: iv,
              candles,
              initialCapital: opts.capital,
              ensemble: c.ensemble,
              risk: cfg.risk,
              marketInfo,
              dataSource: feed.source,
              tradeFromIndex: tfi,
              spreadPct,
            },
            { folds: 4, trainRatio: 0.7, objective: "sharpe", maxCombos: 40, strategy: c.optimizeStrategy },
          );
          wfRows.push({
            period: p.key,
            interval: iv,
            market,
            contender: c.id,
            contenderName: c.name,
            oosReturnPct: wf.oosMetrics.totalReturnPct,
            oosPnlQuote: wf.oosMetrics.finalEquity - opts.capital,
            buyHoldReturnPct: wf.oosMetrics.buyHoldReturnPct,
            foldsProfitable: wf.folds.filter((f) => f.testMetrics.totalReturnPct > 0).length,
            folds: wf.folds.length,
            trades: wf.oosMetrics.trades,
            verdict: wf.verdict,
          });
        }
      }
    }
  }

  return { dataSource: feed.source, capital: opts.capital, generatedAt: now, markets: opts.markets, rows, walkForward: wfRows, notes };
}

// ─────────────────────────────── Samenvatten ───────────────────────────────

export interface ContenderSummary {
  contender: Contender["id"];
  name: string;
  avgReturnPct: number;
  avgPnlQuote: number;
  bestReturnPct: number;
  bestLabel: string;
  worstReturnPct: number;
  worstLabel: string;
  beatBuyHold: number;
  profitable: number;
  runs: number;
  avgTrades: number;
  avgFees: number;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);

/** Rangschikking per periode, gemiddeld over markten en intervallen. */
export function summarize(rows: TournamentRow[], period: string): { ranking: ContenderSummary[]; buyHoldAvgPct: number } {
  const inPeriod = rows.filter((r) => r.period === period);
  const byC = new Map<string, TournamentRow[]>();
  for (const r of inPeriod) byC.set(r.contender, [...(byC.get(r.contender) ?? []), r]);
  const ranking: ContenderSummary[] = [...byC.entries()].map(([id, rs]) => {
    const best = rs.reduce((a, b) => (b.returnPct > a.returnPct ? b : a));
    const worst = rs.reduce((a, b) => (b.returnPct < a.returnPct ? b : a));
    return {
      contender: id as Contender["id"],
      name: rs[0].contenderName,
      avgReturnPct: mean(rs.map((r) => r.returnPct)),
      avgPnlQuote: mean(rs.map((r) => r.pnlQuote)),
      bestReturnPct: best.returnPct,
      bestLabel: `${best.market} ${best.interval}`,
      worstReturnPct: worst.returnPct,
      worstLabel: `${worst.market} ${worst.interval}`,
      beatBuyHold: rs.filter((r) => r.returnPct > r.buyHoldReturnPct).length,
      profitable: rs.filter((r) => r.returnPct > 0).length,
      runs: rs.length,
      avgTrades: mean(rs.map((r) => r.trades)),
      avgFees: mean(rs.map((r) => r.feesPaid)),
    };
  });
  ranking.sort((a, b) => b.avgReturnPct - a.avgReturnPct);
  // Buy & hold is per markt/interval gelijk voor alle deelnemers: neem één set
  const bhRows = inPeriod.filter((r) => r.contender === "ensemble");
  return { ranking, buyHoldAvgPct: mean(bhRows.map((r) => r.buyHoldReturnPct)) };
}

// ─────────────────────────────── CLI ───────────────────────────────

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code: string) => (s: string) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
const green = paint("32");
const red = paint("31");
const yellow = paint("33");
const bold = paint("1");
const dim = paint("2");
const nf = (d: number) => new Intl.NumberFormat("nl-NL", { minimumFractionDigits: d, maximumFractionDigits: d });
const pct = (x: number) => (Number.isFinite(x) ? `${x > 0 ? "+" : ""}${nf(1).format(x)}%` : "–");
const eur = (x: number) => (Number.isFinite(x) ? `${x < 0 ? "-" : x > 0 ? "+" : ""}€${nf(2).format(Math.abs(x))}` : "–");
const color = (x: number, s: string) => (x > 0 ? green(s) : x < 0 ? red(s) : s);

// eslint-disable-next-line no-control-regex
const visible = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "").length;
function table(header: string[], rows: string[][]): string {
  const widths = header.map((h, i) => Math.max(visible(h), ...rows.map((r) => visible(r[i] ?? ""))));
  const line = (cells: string[]) =>
    cells.map((c, i) => (i === 0 ? c + " ".repeat(widths[i] - visible(c)) : " ".repeat(widths[i] - visible(c)) + c)).join("  ");
  return [bold(line(header)), dim(widths.map((w) => "─".repeat(w)).join("  ")), ...rows.map(line)].join("\n");
}

function printReport(res: TournamentResult): void {
  for (const p of PERIODS) {
    if (!res.rows.some((r) => r.period === p.key)) continue;
    const { ranking, buyHoldAvgPct } = summarize(res.rows, p.key);
    const ivs = [...new Set(res.rows.filter((r) => r.period === p.key).map((r) => r.interval))].join(" + ");
    console.log();
    console.log(bold(`══ ${p.label.toUpperCase()} (${p.days} dagen · ${ivs} · ${res.markets.length} markten) ══`));
    const rows = ranking.map((s, i) => [
      `${i + 1}. ${s.name}`,
      color(s.avgReturnPct, pct(s.avgReturnPct)),
      color(s.avgPnlQuote, eur(s.avgPnlQuote)),
      `${s.profitable}/${s.runs}`,
      `${s.beatBuyHold}/${s.runs}`,
      `${pct(s.bestReturnPct)} ${dim(s.bestLabel)}`,
      `${pct(s.worstReturnPct)} ${dim(s.worstLabel)}`,
      nf(1).format(s.avgTrades),
      `€${nf(2).format(s.avgFees)}`,
    ]);
    rows.push([
      dim("Kopen & vasthouden"),
      color(buyHoldAvgPct, pct(buyHoldAvgPct)),
      color(buyHoldAvgPct, eur((buyHoldAvgPct / 100) * res.capital)),
      "", "", "", "", "1", "",
    ]);
    console.log(
      table(
        ["Strategie", "Gem. rendement", `Gem. op €${res.capital}`, "Winst", "Wint v. B&H", "Beste", "Slechtste", "Trades", "Fees"],
        rows,
      ),
    );
  }

  if (res.walkForward.length > 0) {
    console.log();
    console.log(bold("══ EERLIJKE CONTROLE: WALK-FORWARD (instellingen gekozen op oude data, getest op nieuwe) ══"));
    for (const p of PERIODS) {
      const wf = res.walkForward.filter((w) => w.period === p.key);
      if (wf.length === 0) continue;
      const byC = new Map<string, WalkForwardRow[]>();
      for (const w of wf) byC.set(w.contenderName, [...(byC.get(w.contenderName) ?? []), w]);
      const rows = [...byC.entries()]
        .map(([name, ws]) => ({
          name,
          ret: mean(ws.map((w) => w.oosReturnPct)),
          pnl: mean(ws.map((w) => w.oosPnlQuote)),
          bh: mean(ws.map((w) => w.buyHoldReturnPct)),
          folds: `${ws.reduce((a, w) => a + w.foldsProfitable, 0)}/${ws.reduce((a, w) => a + w.folds, 0)}`,
          trades: mean(ws.map((w) => w.trades)),
        }))
        .sort((a, b) => b.ret - a.ret)
        .map((r, i) => [
          `${i + 1}. ${r.name}`,
          color(r.ret, pct(r.ret)),
          color(r.pnl, eur(r.pnl)),
          pct(r.bh),
          r.folds,
          nf(1).format(r.trades),
        ]);
      console.log(dim(`${p.label} · ${wf[0].interval} · 4 vensters per markt, 70% trainen / 30% testen`));
      console.log(table(["Strategie", "Rendement (ongezien)", `Op €${res.capital}`, "Kopen & vasth.", "Winstgevende vensters", "Trades"], rows));
      console.log();
    }
  }

  if (res.notes.length > 0) {
    console.log(yellow(res.notes.map((n) => `• ${n}`).join("\n")));
  }
  console.log();
  console.log(
    dim(
      "Let op: de 'beste' strategie in één periode is vaak geluk. Kijk vooral naar de walk-forward-controle en of een\n" +
        "strategie in veel markten én periodes wint. Fees (0,25% per kant) en slippage zijn overal meegerekend.",
    ),
  );
}

async function pickFeed(source: string): Promise<MarketDataFeed> {
  const cacheDir = join(process.cwd(), "data", "cache");
  if (source === "simulated") return new SimulatedFeed();
  const client = new BitvavoClient();
  if (source === "bitvavo") return new BitvavoFeed(client, { cacheDir });
  process.stdout.write(dim("Bitvavo bereikbaar? ... "));
  const ok = await isBitvavoReachable(client);
  console.log(ok ? green("ja") : yellow("nee"));
  return ok ? new BitvavoFeed(client, { cacheDir }) : new SimulatedFeed();
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      source: { type: "string", default: "auto" },
      markets: { type: "string", default: DEFAULT_MARKETS.join(",") },
      capital: { type: "string", default: String(DEFAULT_PAPER_CAPITAL) },
      quick: { type: "boolean", default: false },
      "no-walkforward": { type: "boolean", default: false },
      json: { type: "string" },
      help: { type: "boolean", default: false },
    },
  });
  if (values.help) {
    console.log("npm run tournament -- [--source auto|bitvavo|simulated] [--markets BTC-EUR,ETH-EUR] [--capital 50] [--quick] [--no-walkforward] [--json uitvoer.json]");
    return;
  }
  const markets = String(values.markets).split(",").map((m) => m.trim().toUpperCase()).filter(Boolean);
  const capital = Number(values.capital);
  if (!Number.isFinite(capital) || capital < 5) throw new Error("--capital moet minstens 5 zijn");
  const feed = await pickFeed(String(values.source));
  const periods = values.quick ? PERIODS.filter((p) => p.key === "1w" || p.key === "1m") : PERIODS;

  console.log(bold(`Strategie-toernooi · startkapitaal €${capital} · ${markets.join(", ")}`));
  if (feed.source === "simulated") {
    console.log(yellow("LET OP: GESIMULEERDE KOERSEN. De uitkomst zegt niets over de echte markt; draai met --source bitvavo voor echte data."));
  } else {
    console.log(green("Databron: Bitvavo (echte historische koersen)"));
  }
  const t0 = Date.now();
  const res = await runTournament(feed, {
    markets,
    capital,
    periods,
    walkForward: !values["no-walkforward"],
    log: (m) => process.stdout.write(dim(`\r${m}`.padEnd(70)) + (useColor ? "" : "\n")),
  });
  process.stdout.write("\r" + " ".repeat(72) + "\r");
  printReport(res);
  console.log(dim(`Klaar in ${Math.round((Date.now() - t0) / 1000)} s.`));
  if (values.json) {
    writeFileSync(String(values.json), JSON.stringify(res, null, 1));
    console.log(dim(`Resultaten opgeslagen in ${values.json}`));
  }
}

const isMain = process.argv[1] && /tournament\.ts$/.test(process.argv[1]);
if (isMain) {
  main().catch((err) => {
    console.error(red(`✖ ${(err as Error).message}`));
    process.exit(1);
  });
}
