//+------------------------------------------------------------------+
//| PropDemoTrader.mq5                                               |
//| Expert Advisor voor DEMO: handelt setup A (trend-pullback) uit   |
//| 04-strategieen.md volledig automatisch, met de risicoregels uit  |
//| 03-risicomanagement-50k.md ingebouwd.                            |
//|                                                                  |
//| Zet hem op een M15-grafiek van EURUSD, GBPUSD, XAUUSD of GER40.  |
//| Eén grafiek per symbool. "Algo Trading" moet aan staan.          |
//|                                                                  |
//| Dit is een startpunt om op demo te testen, geen bewezen          |
//| winstgevend systeem. Draai hem minstens 30 trades op demo en     |
//| in de Strategy Tester (2 jaar, echte ticks) voordat je er ook    |
//| maar over denkt hem op een challenge te zetten.                  |
//+------------------------------------------------------------------+
#property copyright "frisoj trading-kennisbank"
#property version   "1.00"
#property description "Setup A trend-pullback, vast risico-%, daglimiet, 1 trade per dag per symbool"

#include <Trade\Trade.mqh>

//--- risico
input double RiskPercent        = 0.5;    // Risico per trade (% van equity)
input double DailyLossLimitPct  = 2.0;    // Eigen daglimiet (%): daarna geen trades, open posities dicht
input double TotalLossLimitPct  = 6.0;    // Eigen totaallimiet (%) t.o.v. InitialBalance
input double InitialBalance     = 50000;  // Startbalans (0 = balans bij eerste start)
input int    MaxTradesPerDay    = 1;      // Max nieuwe trades per dag op dit symbool
//--- setup
input ENUM_TIMEFRAMES TrendTF   = PERIOD_H1; // Timeframe voor trendbepaling
input int    EmaFast            = 20;
input int    EmaSlow            = 50;
input int    AtrPeriod          = 14;
input double AtrStopMult        = 1.0;    // Stop = swing-low/high +/- ATR x dit
input int    SwingBars          = 3;      // Aantal bars voor swing-low/high
input double TakeProfitR        = 2.0;    // Target in R
input bool   BreakEvenAt1R      = true;   // Stop naar break-even bij +1R
input double MaxStopAtrMult     = 3.0;    // Setup overslaan als stop groter is dan ATR x dit
//--- sessie (servertijd; FTMO = Nederlandse tijd)
input int    StartHour          = 8;      // Vanaf dit uur handelen
input int    EndHour            = 17;     // Geen nieuwe trades vanaf dit uur
input bool   CloseBeforeWeekend = true;   // Vrijdag na 21:00 alles dicht
input int    MagicNumber        = 260915;

CTrade trade;
int    hEmaFastTrend, hEmaSlowTrend, hEmaFast, hEmaSlow, hAtr;
datetime g_lastBar = 0;
datetime g_day = 0;
double   g_dayStart = 0;
double   g_initial = 0;
bool     g_haltedToday = false;

//+------------------------------------------------------------------+
datetime DayStart(datetime t)
{
   MqlDateTime dt; TimeToStruct(t, dt);
   dt.hour = 0; dt.min = 0; dt.sec = 0;
   return StructToTime(dt);
}

//+------------------------------------------------------------------+
int OnInit()
{
   trade.SetExpertMagicNumber(MagicNumber);
   trade.SetDeviationInPoints(20);
   hEmaFastTrend = iMA(_Symbol, TrendTF, EmaFast, 0, MODE_EMA, PRICE_CLOSE);
   hEmaSlowTrend = iMA(_Symbol, TrendTF, EmaSlow, 0, MODE_EMA, PRICE_CLOSE);
   hEmaFast      = iMA(_Symbol, PERIOD_CURRENT, EmaFast, 0, MODE_EMA, PRICE_CLOSE);
   hEmaSlow      = iMA(_Symbol, PERIOD_CURRENT, EmaSlow, 0, MODE_EMA, PRICE_CLOSE);
   hAtr          = iATR(_Symbol, PERIOD_CURRENT, AtrPeriod);
   if(hEmaFastTrend == INVALID_HANDLE || hEmaSlowTrend == INVALID_HANDLE ||
      hEmaFast == INVALID_HANDLE || hEmaSlow == INVALID_HANDLE || hAtr == INVALID_HANDLE)
   {
      Print("PropDemoTrader: indicator-handle mislukt");
      return INIT_FAILED;
   }
   g_initial = (InitialBalance > 0) ? InitialBalance : AccountInfoDouble(ACCOUNT_BALANCE);
   NewDay();
   return INIT_SUCCEEDED;
}

//+------------------------------------------------------------------+
void OnDeinit(const int reason) { Comment(""); }

//+------------------------------------------------------------------+
void NewDay()
{
   g_day = DayStart(TimeCurrent());
   g_dayStart = MathMin(AccountInfoDouble(ACCOUNT_BALANCE), AccountInfoDouble(ACCOUNT_EQUITY));
   g_haltedToday = false;
}

//+------------------------------------------------------------------+
double Buf(int handle, int shift)
{
   double b[1];
   if(CopyBuffer(handle, 0, shift, 1, b) != 1) return 0;
   return b[0];
}

//+------------------------------------------------------------------+
bool HasPosition()
{
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong t = PositionGetTicket(i);
      if(t > 0 && PositionSelectByTicket(t) &&
         PositionGetString(POSITION_SYMBOL) == _Symbol &&
         PositionGetInteger(POSITION_MAGIC) == MagicNumber) return true;
   }
   return false;
}

//+------------------------------------------------------------------+
int TradesToday()
{
   int n = 0;
   if(!HistorySelect(g_day, TimeCurrent() + 60)) return 0;
   for(int i = HistoryDealsTotal() - 1; i >= 0; i--)
   {
      ulong d = HistoryDealGetTicket(i);
      if(d == 0) continue;
      if(HistoryDealGetString(d, DEAL_SYMBOL) != _Symbol) continue;
      if(HistoryDealGetInteger(d, DEAL_MAGIC) != MagicNumber) continue;
      if(HistoryDealGetInteger(d, DEAL_ENTRY) == DEAL_ENTRY_IN) n++;
   }
   return n;
}

//+------------------------------------------------------------------+
void CloseOwn(string reason)
{
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong t = PositionGetTicket(i);
      if(t > 0 && PositionSelectByTicket(t) &&
         PositionGetString(POSITION_SYMBOL) == _Symbol &&
         PositionGetInteger(POSITION_MAGIC) == MagicNumber)
      {
         trade.PositionClose(t);
         Print("PropDemoTrader: positie ", t, " gesloten: ", reason);
      }
   }
}

//+------------------------------------------------------------------+
double LotsForRisk(double stopDistance)
{
   double equity    = AccountInfoDouble(ACCOUNT_EQUITY);
   double riskMoney = equity * RiskPercent / 100.0;
   double tickValue = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_VALUE);
   double tickSize  = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_SIZE);
   double lotStep   = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_STEP);
   double lotMin    = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MIN);
   double lotMax    = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MAX);
   if(tickValue <= 0 || tickSize <= 0 || stopDistance <= 0) return 0;
   double lossPerLot = stopDistance / tickSize * tickValue;
   double lots = MathFloor((riskMoney / lossPerLot) / lotStep) * lotStep;
   if(lots < lotMin) return 0;
   if(lots > lotMax) lots = lotMax;
   return lots;
}

//+------------------------------------------------------------------+
void ManageBreakEven()
{
   if(!BreakEvenAt1R) return;
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong t = PositionGetTicket(i);
      if(t == 0 || !PositionSelectByTicket(t)) continue;
      if(PositionGetString(POSITION_SYMBOL) != _Symbol || PositionGetInteger(POSITION_MAGIC) != MagicNumber) continue;
      double open = PositionGetDouble(POSITION_PRICE_OPEN);
      double sl   = PositionGetDouble(POSITION_SL);
      double tp   = PositionGetDouble(POSITION_TP);
      long type   = PositionGetInteger(POSITION_TYPE);
      if(sl <= 0) continue;
      double risk = MathAbs(open - sl);
      double bid = SymbolInfoDouble(_Symbol, SYMBOL_BID);
      double ask = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
      int digits = (int)SymbolInfoInteger(_Symbol, SYMBOL_DIGITS);
      if(type == POSITION_TYPE_BUY && sl < open && bid >= open + risk)
         trade.PositionModify(t, NormalizeDouble(open, digits), tp);
      if(type == POSITION_TYPE_SELL && sl > open && ask <= open - risk)
         trade.PositionModify(t, NormalizeDouble(open, digits), tp);
   }
}

//+------------------------------------------------------------------+
void OnTick()
{
   if(DayStart(TimeCurrent()) != g_day) NewDay();

   //--- risicobewaking op elke tick
   double equity = AccountInfoDouble(ACCOUNT_EQUITY);
   bool dayBreach   = (g_dayStart - equity) >= g_dayStart * DailyLossLimitPct / 100.0;
   bool totalBreach = (g_initial - equity)  >= g_initial  * TotalLossLimitPct / 100.0;
   if((dayBreach || totalBreach) && !g_haltedToday)
   {
      g_haltedToday = true;
      CloseOwn(dayBreach ? "eigen daglimiet geraakt" : "eigen totaallimiet geraakt");
      Alert("PropDemoTrader ", _Symbol, ": limiet geraakt, vandaag geen trades meer");
   }

   MqlDateTime now; TimeToStruct(TimeCurrent(), now);
   if(CloseBeforeWeekend && now.day_of_week == 5 && now.hour >= 21) CloseOwn("weekend");

   ManageBreakEven();

   //--- alleen op een nieuwe bar zoeken naar een setup
   datetime barTime = iTime(_Symbol, PERIOD_CURRENT, 0);
   if(barTime == g_lastBar) return;
   g_lastBar = barTime;

   string status = StringFormat("PropDemoTrader %s | equity %.0f | dagverlies %.0f / limiet %.0f | trades vandaag %d",
                                _Symbol, equity, g_dayStart - equity, g_dayStart * DailyLossLimitPct / 100.0, TradesToday());
   Comment(status);

   if(g_haltedToday || totalBreach) return;
   if(now.hour < StartHour || now.hour >= EndHour) return;
   if(now.day_of_week == 0 || now.day_of_week == 6) return;
   if(HasPosition()) return;
   if(TradesToday() >= MaxTradesPerDay) return;

   //--- trend op hoger timeframe (laatst gesloten bar)
   double tFast = Buf(hEmaFastTrend, 1), tSlow = Buf(hEmaSlowTrend, 1);
   double tClose = iClose(_Symbol, TrendTF, 1);
   if(tFast == 0 || tSlow == 0) return;
   bool upTrend   = (tFast > tSlow && tClose > tSlow);
   bool downTrend = (tFast < tSlow && tClose < tSlow);
   if(!upTrend && !downTrend) return;

   //--- pullback + afwijzing op de laatst gesloten M15-bar (index 1)
   double eFast = Buf(hEmaFast, 1), eSlow = Buf(hEmaSlow, 1), atr = Buf(hAtr, 1);
   if(eFast == 0 || eSlow == 0 || atr == 0) return;
   double o = iOpen(_Symbol, PERIOD_CURRENT, 1), c = iClose(_Symbol, PERIOD_CURRENT, 1);
   double h = iHigh(_Symbol, PERIOD_CURRENT, 1), l = iLow(_Symbol, PERIOD_CURRENT, 1);
   int digits = (int)SymbolInfoInteger(_Symbol, SYMBOL_DIGITS);
   double ask = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
   double bid = SymbolInfoDouble(_Symbol, SYMBOL_BID);
   double spread = ask - bid;

   if(upTrend && l <= eFast && l >= eSlow - atr && c > eFast && c > o)
   {
      double swingLow = l;
      for(int i = 1; i <= SwingBars; i++) swingLow = MathMin(swingLow, iLow(_Symbol, PERIOD_CURRENT, i));
      double sl = swingLow - AtrStopMult * atr - spread;
      double dist = ask - sl;
      if(dist > MaxStopAtrMult * atr) return;
      double lots = LotsForRisk(dist);
      if(lots <= 0) { Print("PropDemoTrader: stop te groot voor risico, overslaan"); return; }
      double tp = ask + TakeProfitR * dist;
      if(trade.Buy(lots, _Symbol, ask, NormalizeDouble(sl, digits), NormalizeDouble(tp, digits), "setupA long"))
         Print("PropDemoTrader LONG ", lots, " lots, SL ", sl, " TP ", tp);
      else Print("PropDemoTrader: Buy mislukt ", trade.ResultRetcode(), " ", trade.ResultRetcodeDescription());
   }
   else if(downTrend && h >= eFast && h <= eSlow + atr && c < eFast && c < o)
   {
      double swingHigh = h;
      for(int i = 1; i <= SwingBars; i++) swingHigh = MathMax(swingHigh, iHigh(_Symbol, PERIOD_CURRENT, i));
      double sl = swingHigh + AtrStopMult * atr + spread;
      double dist = sl - bid;
      if(dist > MaxStopAtrMult * atr) return;
      double lots = LotsForRisk(dist);
      if(lots <= 0) { Print("PropDemoTrader: stop te groot voor risico, overslaan"); return; }
      double tp = bid - TakeProfitR * dist;
      if(trade.Sell(lots, _Symbol, bid, NormalizeDouble(sl, digits), NormalizeDouble(tp, digits), "setupA short"))
         Print("PropDemoTrader SHORT ", lots, " lots, SL ", sl, " TP ", tp);
      else Print("PropDemoTrader: Sell mislukt ", trade.ResultRetcode(), " ", trade.ResultRetcodeDescription());
   }
}
//+------------------------------------------------------------------+
