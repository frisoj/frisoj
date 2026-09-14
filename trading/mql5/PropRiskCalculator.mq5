//+------------------------------------------------------------------+
//| PropRiskCalculator.mq5                                           |
//| Script: berekent de lotgrootte uit risico-% en stop-afstand,     |
//| met de echte symboolgegevens (tick value / tick size) van de     |
//| broker. Kopieer naar MQL5/Scripts/, compileer (F7) en sleep op   |
//| de grafiek van het instrument dat je wilt handelen.              |
//+------------------------------------------------------------------+
#property copyright "frisoj trading-kennisbank"
#property version   "1.00"
#property script_show_inputs
#property description "Lotgrootte-calculator voor prop-firm accounts"

input double RiskPercent    = 0.5;   // Risico per trade in % van balans
input double StopLossPoints = 0;     // Stop-afstand in punten (0 = gebruik StopLossPrice)
input double StopLossPrice  = 0;     // Stop-koers (gebruikt als StopLossPoints = 0)
input bool   UseEquity      = true;  // Rekenen op equity (true) of balans (false)

void OnStart()
{
   string sym = _Symbol;
   double base = UseEquity ? AccountInfoDouble(ACCOUNT_EQUITY)
                           : AccountInfoDouble(ACCOUNT_BALANCE);
   double riskMoney = base * RiskPercent / 100.0;

   double tickValue = SymbolInfoDouble(sym, SYMBOL_TRADE_TICK_VALUE);
   double tickSize  = SymbolInfoDouble(sym, SYMBOL_TRADE_TICK_SIZE);
   double point     = SymbolInfoDouble(sym, SYMBOL_POINT);
   double lotStep   = SymbolInfoDouble(sym, SYMBOL_VOLUME_STEP);
   double lotMin    = SymbolInfoDouble(sym, SYMBOL_VOLUME_MIN);
   double lotMax    = SymbolInfoDouble(sym, SYMBOL_VOLUME_MAX);
   int    digits    = (int)SymbolInfoInteger(sym, SYMBOL_DIGITS);
   string currency  = AccountInfoString(ACCOUNT_CURRENCY);

   if(tickValue <= 0 || tickSize <= 0 || point <= 0)
   {
      Alert("Symboolgegevens ontbreken voor ", sym, " (open Market Watch -> Specificatie).");
      return;
   }

   double slPoints = StopLossPoints;
   if(slPoints <= 0 && StopLossPrice > 0)
   {
      double bid = SymbolInfoDouble(sym, SYMBOL_BID);
      slPoints = MathAbs(bid - StopLossPrice) / point;
   }
   if(slPoints <= 0)
   {
      Alert("Geef StopLossPoints of StopLossPrice op.");
      return;
   }

   // Verlies per lot bij deze stop-afstand, in accountvaluta.
   double lossPerLot = (slPoints * point / tickSize) * tickValue;
   if(lossPerLot <= 0)
   {
      Alert("Berekening mislukt (lossPerLot <= 0).");
      return;
   }

   double lots = riskMoney / lossPerLot;
   lots = MathFloor(lots / lotStep) * lotStep;   // altijd naar beneden afronden
   if(lots < lotMin) lots = 0;                    // te klein: geen trade
   if(lots > lotMax) lots = lotMax;

   double actualRisk = lots * lossPerLot;
   double spreadPts  = (double)SymbolInfoInteger(sym, SYMBOL_SPREAD);

   string msg = StringFormat(
      "%s | basis %.2f %s | risico %.2f%% = %.2f %s\n"
      "stop %.0f punten (%s) | spread nu %.0f punten\n"
      "verlies per lot %.2f %s -> LOTS: %.2f (werkelijk risico %.2f %s)",
      sym, base, currency, RiskPercent, riskMoney, currency,
      slPoints, DoubleToString(slPoints * point, digits), spreadPts,
      lossPerLot, currency, lots, actualRisk, currency);

   Print(msg);
   Comment(msg);
   if(lots <= 0)
      Alert("Stop te groot voor dit risico: minimum lot ", lotMin, " overschrijdt je budget.");
   else
      Alert(StringFormat("%s: %.2f lots bij %.0f punten stop (risico %.2f %s)",
                         sym, lots, slPoints, actualRisk, currency));
}
//+------------------------------------------------------------------+
