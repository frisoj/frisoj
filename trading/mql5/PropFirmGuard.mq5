//+------------------------------------------------------------------+
//| PropFirmGuard.mq5                                                |
//| Expert Advisor: bewaakt je EIGEN dag- en totaalverlieslimieten   |
//| (strakker dan die van de prop firm) en sluit alle posities en    |
//| pending orders zodra een limiet wordt geraakt. Toont de          |
//| resterende ruimte op de grafiek. Optioneel: OCO voor twee        |
//| pending orders op hetzelfde symbool (Londen-breakout).           |
//|                                                                  |
//| Gebruik: kopieer naar MQL5/Experts/, compileer (F7), sleep op    |
//| EEN grafiek (welke maakt niet uit), zet "Algo Trading" aan.      |
//| Test eerst op demo. Dit is een vangnet, geen vervanging voor je  |
//| eigen discipline; bij verbroken verbinding werkt hij niet.       |
//+------------------------------------------------------------------+
#property copyright "frisoj trading-kennisbank"
#property version   "1.00"
#property description "Sluit alles bij eigen dag-/totaalverlieslimiet (prop-firm vangnet)"

#include <Trade\Trade.mqh>

input double InitialBalance     = 50000;  // Startbalans van het account (0 = huidige balans)
input double DailyLossLimitPct  = 2.0;    // Eigen daglimiet in % (firm: 5%)
input double TotalLossLimitPct  = 6.0;    // Eigen totaallimiet in % (firm: 10%)
input double FirmDailyPct       = 5.0;    // Firm-daglimiet (alleen weergave)
input double FirmTotalPct       = 10.0;   // Firm-totaallimiet (alleen weergave)
input bool   CloseOnBreach      = true;   // Alles sluiten bij eigen limiet
input bool   DeletePendings     = true;   // Ook pending orders verwijderen bij breach
input bool   BlockAfterBreach   = true;   // Na breach: nieuwe posities dezelfde dag direct sluiten
input bool   OcoPendingOrders   = true;   // Bij vulling van een pending order de andere op dat symbool verwijderen
input double MaxOpenRiskWarnPct = 1.0;    // Waarschuwing als open verlies-op-SL groter is dan dit %
input int    TimerSeconds       = 1;      // Controlefrequentie

CTrade   trade;
double   g_dayStartBalance = 0;
double   g_initialBalance  = 0;
datetime g_currentDay      = 0;
bool     g_breachedToday   = false;
bool     g_breachedTotal   = false;
int      g_lastPositions   = 0;

//+------------------------------------------------------------------+
datetime DayStart(datetime t)
{
   MqlDateTime dt;
   TimeToStruct(t, dt);
   dt.hour = 0; dt.min = 0; dt.sec = 0;
   return StructToTime(dt);
}

//+------------------------------------------------------------------+
void ResetDay()
{
   g_currentDay      = DayStart(TimeCurrent());
   // Firms rekenen vanaf de balans van middernacht servertijd. Equity meenemen
   // is conservatiever als er posities open staan; wij nemen het laagste.
   double bal = AccountInfoDouble(ACCOUNT_BALANCE);
   double eq  = AccountInfoDouble(ACCOUNT_EQUITY);
   g_dayStartBalance = MathMin(bal, eq);
   g_breachedToday   = false;
   Print("PropFirmGuard: nieuwe dag, dagstart = ", DoubleToString(g_dayStartBalance, 2));
}

//+------------------------------------------------------------------+
int OnInit()
{
   g_initialBalance = (InitialBalance > 0) ? InitialBalance : AccountInfoDouble(ACCOUNT_BALANCE);
   ResetDay();
   g_lastPositions = PositionsTotal();
   EventSetTimer(TimerSeconds);
   return INIT_SUCCEEDED;
}

//+------------------------------------------------------------------+
void OnDeinit(const int reason)
{
   EventKillTimer();
   Comment("");
}

//+------------------------------------------------------------------+
void CloseEverything(string reason)
{
   Print("PropFirmGuard: ALLES SLUITEN. Reden: ", reason);
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong ticket = PositionGetTicket(i);
      if(ticket > 0 && !trade.PositionClose(ticket))
         Print("PropFirmGuard: sluiten mislukt voor ticket ", ticket, " ret=", trade.ResultRetcode());
   }
   if(DeletePendings)
   {
      for(int i = OrdersTotal() - 1; i >= 0; i--)
      {
         ulong ticket = OrderGetTicket(i);
         if(ticket > 0 && !trade.OrderDelete(ticket))
            Print("PropFirmGuard: verwijderen mislukt voor order ", ticket);
      }
   }
   Alert("PropFirmGuard: alle posities gesloten. ", reason);
}

//+------------------------------------------------------------------+
// Som van het verlies als alle open posities op hun SL zouden sluiten.
double OpenRiskAtStops()
{
   double total = 0;
   for(int i = 0; i < PositionsTotal(); i++)
   {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0 || !PositionSelectByTicket(ticket)) continue;
      string sym   = PositionGetString(POSITION_SYMBOL);
      double sl    = PositionGetDouble(POSITION_SL);
      double open  = PositionGetDouble(POSITION_PRICE_OPEN);
      double vol   = PositionGetDouble(POSITION_VOLUME);
      long   type  = PositionGetInteger(POSITION_TYPE);
      double tickValue = SymbolInfoDouble(sym, SYMBOL_TRADE_TICK_VALUE);
      double tickSize  = SymbolInfoDouble(sym, SYMBOL_TRADE_TICK_SIZE);
      if(sl <= 0 || tickSize <= 0) { total += 1e12; continue; } // geen SL = onbegrensd risico
      double dist = (type == POSITION_TYPE_BUY) ? (open - sl) : (sl - open);
      if(dist < 0) dist = 0; // SL in winst: geen risico
      total += dist / tickSize * tickValue * vol;
   }
   return total;
}

//+------------------------------------------------------------------+
// OCO: als het aantal posities op een symbool toeneemt, verwijder de
// overgebleven pending orders op dat symbool.
void HandleOco()
{
   int now = PositionsTotal();
   if(now > g_lastPositions)
   {
      for(int p = 0; p < PositionsTotal(); p++)
      {
         ulong pt = PositionGetTicket(p);
         if(pt == 0 || !PositionSelectByTicket(pt)) continue;
         string sym = PositionGetString(POSITION_SYMBOL);
         for(int o = OrdersTotal() - 1; o >= 0; o--)
         {
            ulong ot = OrderGetTicket(o);
            if(ot == 0 || !OrderSelect(ot)) continue;
            if(OrderGetString(ORDER_SYMBOL) == sym)
            {
               trade.OrderDelete(ot);
               Print("PropFirmGuard OCO: pending order ", ot, " op ", sym, " verwijderd");
            }
         }
      }
   }
   g_lastPositions = now;
}

//+------------------------------------------------------------------+
void OnTimer()
{
   if(DayStart(TimeCurrent()) != g_currentDay) ResetDay();

   double equity  = AccountInfoDouble(ACCOUNT_EQUITY);
   double balance = AccountInfoDouble(ACCOUNT_BALANCE);

   double dayLoss   = g_dayStartBalance - equity;            // positief = verlies vandaag
   double totalLoss = g_initialBalance - equity;             // positief = verlies totaal
   double dayLimit  = g_dayStartBalance * DailyLossLimitPct / 100.0;
   double totLimit  = g_initialBalance  * TotalLossLimitPct / 100.0;
   double firmDay   = g_dayStartBalance * FirmDailyPct / 100.0;
   double firmTot   = g_initialBalance  * FirmTotalPct / 100.0;

   if(OcoPendingOrders) HandleOco();

   if(!g_breachedTotal && totalLoss >= totLimit)
   {
      g_breachedTotal = true;
      if(CloseOnBreach) CloseEverything(StringFormat("eigen totaallimiet %.1f%% geraakt", TotalLossLimitPct));
   }
   if(!g_breachedToday && dayLoss >= dayLimit)
   {
      g_breachedToday = true;
      if(CloseOnBreach) CloseEverything(StringFormat("eigen daglimiet %.1f%% geraakt", DailyLossLimitPct));
   }
   if(BlockAfterBreach && (g_breachedToday || g_breachedTotal) && CloseOnBreach && PositionsTotal() > 0)
      CloseEverything("nieuwe positie na breach (dag is voorbij)");

   double openRisk = OpenRiskAtStops();
   string riskTxt  = (openRisk >= 1e12) ? "GEEN SL OP EEN POSITIE!"
                    : StringFormat("%.0f (%.2f%%)", openRisk, openRisk / g_initialBalance * 100.0);
   string warn = "";
   if(openRisk >= 1e12 || openRisk > g_initialBalance * MaxOpenRiskWarnPct / 100.0)
      warn = "\n!! OPEN RISICO TE GROOT !!";
   if(g_breachedToday) warn += "\n!! DAGLIMIET GERAAKT - VANDAAG NIET MEER HANDELEN !!";
   if(g_breachedTotal) warn += "\n!! TOTAALLIMIET GERAAKT - STOP EN HERBEOORDEEL !!";

   Comment(StringFormat(
      "PropFirmGuard  %s\n"
      "Balans %.0f | Equity %.0f | Dagstart %.0f\n"
      "Dag:    verlies %.0f | eigen limiet %.0f (over %.0f) | firm %.0f (over %.0f)\n"
      "Totaal: verlies %.0f | eigen limiet %.0f (over %.0f) | firm %.0f (over %.0f)\n"
      "Open risico op stops: %s | posities %d | pending %d%s",
      TimeToString(TimeCurrent(), TIME_DATE | TIME_MINUTES),
      balance, equity, g_dayStartBalance,
      dayLoss, dayLimit, dayLimit - dayLoss, firmDay, firmDay - dayLoss,
      totalLoss, totLimit, totLimit - totalLoss, firmTot, firmTot - totalLoss,
      riskTxt, PositionsTotal(), OrdersTotal(), warn));
}

//+------------------------------------------------------------------+
void OnTick()
{
   // Alles gebeurt in OnTimer zodat het ook loopt als dit symbool geen ticks geeft.
}
//+------------------------------------------------------------------+
