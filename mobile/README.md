# Briefje — snap je post, weet wat je moet doen

Dagelijks krijgt iedereen post, facturen, aanslagen en berichten die moeilijk te begrijpen zijn en waar een deadline aan hangt.
Briefje: foto maken → AI legt het uit in gewone taal → concrete stappen, bedrag, deadline, conceptantwoord → herinnering vóór de deadline.

> Er zijn algemene AI-chatbots en scanapps, maar (voor zover gecontroleerd) geen app die *post → uitleg → deadline-inbox → herinnering* als één dagelijkse gewoonte combineert. Valideer dit zelf nog in de App Store / Play Store voordat je geld in marketing steekt.

## Verdienmodel
- **Gratis:** 3 scans per week.
- **Pro:** onbeperkt scannen. Voorstel: €4,99/maand of €29,99/jaar, 7 dagen proef. Geregeld via RevenueCat (entitlement `pro`).
- Kosten per scan ≈ één vision-call (orde van eurocenten), dus marge is gezond; houd dit in de gaten via de Anthropic-console.
- Later: zakelijke variant (ZZP'ers, mantelzorgers), familie-abonnement.

## Architectuur
- `app/` — Expo Router (SDK 57), schermen: Vandaag, Scan, Detail, Paywall, Instellingen.
- `lib/` — opslag op het toestel (AsyncStorage), notificaties, RevenueCat, pure logica met tests.
- `backend/api/analyze.ts` — Vercel-functie die de Anthropic API aanroept (API-sleutel nooit in de app). Geen opslag van afbeeldingen.

## Lokaal draaien
```bash
cd mobile && npm install
npm test && npm run typecheck
EXPO_PUBLIC_API_URL=https://<jouw-backend> npx expo start
```
Aankopen werken alleen in een development/production build (niet in Expo Go): `eas build --profile development`.

## Backend deployen
1. Maak een Vercel-project met root directory `mobile/backend`; zet `ANTHROPIC_API_KEY`.
2. Zet `EXPO_PUBLIC_API_URL` (of `extra.apiUrl` in `app.json`) op die URL.

## Live in App Store & Play Store — wat jij moet doen
Dit kan ik niet voor je regelen; het vereist jouw accounts en betalingen:
1. Apple Developer Program (€99/jaar) en Google Play Console (eenmalig $25).
2. `npm i -g eas-cli && eas login && eas init` (vult `extra.eas.projectId`). Pas `bundleIdentifier`/`package` aan als `nl.briefje.app` niet van jou is.
3. RevenueCat: project maken, iOS- en Android-app koppelen, producten `monthly`/`annual` + entitlement `pro` + offering aanmaken; zet de publieke SDK-keys in `EXPO_PUBLIC_RC_IOS` / `EXPO_PUBLIC_RC_ANDROID`. Maak dezelfde abonnementen aan in App Store Connect en Play Console.
4. Vervang `PRIVACY_URL`/`TERMS_URL` in `lib/config.ts` door echte pagina's (verplicht; post bevat gevoelige gegevens, vermeld verwerking door Anthropic als verwerker, AVG).
5. Vervang de placeholder-iconen in `assets/`, maak screenshots.
6. `eas build --platform all --profile production` en `eas submit --platform all`.
7. Vul App Privacy (iOS) en Data Safety (Android) in: foto's worden verzonden voor analyse, niet bewaard.

## Bekende beperkingen / volgende stappen
- Gratis-limiet staat client-side; de backend heeft alleen een burst-limiet per installatie. Voor productie: server-side quota + RevenueCat-check (zie TODO in `analyze.ts`).
- Alleen Nederlands in de UI; de backend ondersteunt al `language`.
- Geen cloud-sync of accounts (bewust: privacy); back-up/sync is een logische Pro-feature.
- De AI-uitleg is geen juridisch of financieel advies (disclaimer staat in de app).
