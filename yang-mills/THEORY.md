# Yang–Mills-theorie en de massakloof

**Theorie, stand van zaken, en wat dit project wél en níet aantoont**

> **Eerlijke kernboodschap.** Het millenniumprobleem "Yang–Mills: bestaan en massakloof" is op de datum van dit document (11 november 2026) **niet opgelost** (over een recente, nog niet te controleren claim die alleen het bestaansdeel betreft: zie de kanttekening in §1), en **dit project lost het ook niet op**. Geen enkele berekening in deze repository is een wiskundig bewijs. Wat hier wél staat: (1) de precieze probleemstelling, (2) de formules die echt vaststaan, elk met uitleg in gewone taal, en (3) de theorie achter de zorgvuldig geteste *numerieke aanwijzingen* (geen bewijs) voor een massakloof in SU(2)-roostertheorie in 2, 3 en 4 dimensies.

---

## 0. Het korte antwoord op de vraag

De vraag was: *"los het Yang–Mills-millenniumprobleem op en kom met de juiste formule"*. Het eerlijke antwoord heeft drie delen.

**1. Een erkend bewijs is er niet — ook hier niet.** Het probleem vraagt om een wiskundig bewijs over een limiet (roosterafstand naar nul, volume naar oneindig). Een computer kan maar eindig veel roosters doorrekenen, dus een simulatie kan zo'n bewijs per definitie niet leveren (zie §8). En een door een AI-systeem geschreven "bewijs" telt pas als bewijs wanneer vakgenoten elke stap hebben gecontroleerd; in deze sessie is geen bewijs gevonden, en doen alsof zou oneerlijk zijn.

**2. "De juiste formule" voor de massakloof bestaat niet als gesloten uitdrukking.** Wat wél vaststaat is het volgende.

- De massakloof $m$ van de vierdimensionale theorie is een vast getal maal de enige schaal die de theorie zelf voortbrengt (§4):

$$
m = c_G \cdot \Lambda , \qquad \Lambda = \mu \cdot \left(b_0 g^2\right)^{-b_1/(2b_0^2)} \exp\left(-\frac{1}{2 b_0 g^2}\right)\left(1+O(g^2)\right).
$$

  *In gewone taal:* de massa van het lichtste deeltje is evenredig met één natuurlijke energieschaal $\Lambda$; die schaal hangt op een zeer bijzondere (niet in machten van $g$ te ontwikkelen) manier af van de koppelingssterkte $g$ bij de meetschaal $\mu$. Het getal $c_G$ volgt **niet** uit deze formule; het kan tot nu toe alleen numeriek worden bepaald.

- Voor SU(2) op het rooster (Wilson-actie, $\beta = 4/g^2$) wordt dit (§4.5, door ons nagerekend):

$$
a \Lambda_L = \left(\frac{6\pi^2\beta}{11}\right)^{51/121} \exp\left(-\frac{3\pi^2\beta}{11}\right).
$$

  *In gewone taal:* dit voorspelt hoe snel de roosterafstand $a$ krimpt als je $\beta$ verhoogt — exponentieel snel.

- Een gangbare literatuurwaarde voor SU(2) in vier dimensies is $m(0^{++})/\sqrt{\sigma} = 3{,}78 \pm 0{,}07$ (Lucini, Teper en Wenger 2004; zie `literature.json`). *In gewone taal:* het lichtste "lijmdeeltje" (glueball) is ongeveer 3,8 keer zo zwaar als de natuurlijke eenheid die de kracht tussen quarks bepaalt. Dit is een rekenresultaat met foutmarge, geen stelling.

- In **twee** dimensies is alles exact bekend (§5.6), bijvoorbeeld de gemiddelde plaquette $P = I_2(\beta)/I_1(\beta)$ en de snaarspanning $a^2\sigma = -\ln\left(I_2(\beta)/I_1(\beta)\right)$. Die formules gebruiken wij om onze code te ijken.

**3. Wat dit project beoogt te leveren.** Een geteste simulatie van SU(2)-roostertheorie die (a) wordt getoetst aan de exacte tweedimensionale formules, (b) wordt vergeleken met bekende literatuurwaarden in drie en vier dimensies, en (c) nagaat of glueballmassa en snaarspanning ongelijk aan nul zijn en zich bij verfijning van het rooster gedragen zoals de theorie voorspelt. Zulke uitkomsten zijn *bewijsmateriaal in de natuurkundige zin*, geen *bewijs in de wiskundige zin*. In hoeverre elke toets geslaagd is, staat — met getallen en foutmarges — in §7.

### Symbolen die steeds terugkomen

| Symbool | Betekenis |
|---|---|
| $G$ | de ijkgroep; in dit project $G = \mathrm{SU}(2)$ |
| $A_\mu$ | het ijkveld (de "potentiaal"), een matrix per richting $\mu$ |
| $F_{\mu\nu}$ | de veldsterkte (het analogon van elektrisch en magnetisch veld) |
| $g$ | de koppelingsconstante (sterkte van de wisselwerking) |
| $a$ | de roosterafstand |
| $\beta$ | de roosterkoppeling, $\beta = 4/(g^2 a^{4-D})$ in $D$ dimensies |
| $U_\mu(x)$ | de SU(2)-matrix op de roosterverbinding van $x$ naar $x+\hat\mu$ |
| $P$ | gemiddelde plaquette, $P = \langle \tfrac12 \mathrm{Tr}\ U_p\rangle$ |
| $u(\beta)$ | $I_2(\beta)/I_1(\beta)$, verhouding van gemodificeerde Besselfuncties |
| $\sigma$ | de snaarspanning (energie per lengte van de fluxbuis tussen twee bronnen) |
| $m$, $\Delta$ | massa van het lichtste deeltje = de massakloof |
| $\Lambda$ | de dynamisch gegenereerde schaal van de theorie |

---

## 1. Het Clay-probleem, precies geformuleerd

De officiële probleembeschrijving is geschreven door Arthur Jaffe en Edward Witten ("Quantum Yang–Mills Theory", Clay Mathematics Institute, 2000). De opgave luidt letterlijk:

> **Yang–Mills Existence and Mass Gap.** Prove that for any compact simple gauge group $G$, a non-trivial quantum Yang–Mills theory exists on $\mathbb{R}^4$ and has a mass gap $\Delta \gt 0$. Existence includes establishing axiomatic properties at least as strong as those cited in [45, 35].

Vertaald: *bewijs dat voor elke compacte enkelvoudige ijkgroep $G$ een niet-triviale kwantum-Yang–Mills-theorie op $\mathbb{R}^4$ bestaat en een massakloof $\Delta \gt 0$ heeft. "Bestaan" houdt in dat axiomatische eigenschappen worden aangetoond die minstens zo sterk zijn als die in [45, 35].* De verwijzingen [45] en [35] zijn Streater en Wightman (*PCT, Spin and Statistics, and All That*, 1964) en Osterwalder en Schrader (*Axioms for Euclidean Green's functions*, 1973 en 1975).

De opgave bestaat dus uit de volgende onderdelen, die **allemaal** bewezen moeten worden.

1. **Voor elke compacte enkelvoudige groep $G$**: dus voor SU(2), SU(3), SO(5), $E_8$, enzovoort — niet voor één voorbeeld.
2. **Bestaan**: er moet een wiskundig volledig gedefinieerde kwantumveldentheorie op de vierdimensionale ruimtetijd worden geconstrueerd die aan de Wightman- of Osterwalder–Schrader-axioma's voldoet (§3).
3. **Niet-triviaal**: het mag geen vrije theorie zijn (een theorie zonder wisselwerking). Jaffe en Witten verwachten bovendien dat de correlatiefuncties op korte afstand het gedrag vertonen dat de storingsrekening voorspelt (asymptotische vrijheid, §4).
4. **Massakloof**: het energiespectrum heeft boven de grondtoestand een gat van grootte $\Delta \gt 0$ (§3).

Jaffe en Witten leggen ook uit waarom dit natuurkundig belangrijk is: om de sterke kernkracht te beschrijven moet de theorie (1) een massakloof hebben, (2) quarks opsluiten ("confinement") en (3) chirale symmetrie breken. Alle drie worden door experimenten en computersimulaties ondersteund; geen van de drie is wiskundig bewezen.

### Status

**Het probleem geldt op 11 november 2026 als onopgelost.** Er is geen door de wiskundige gemeenschap gecontroleerd en aanvaard bewijs van bestaan-plus-massakloof; een bewijs van de massakloof is, voor zover wij konden nagaan, zelfs door niemand geclaimd; en het Clay-instituut heeft de prijs (1 miljoen dollar) niet toegekend. **Dit project lost het probleem niet op en beweert dat ook nergens.**

> **Kanttekening over recente berichten (stand 11 november 2026; door ons alleen in zoekmachine-uittreksels gezien, geen primaire bron geopend).**
>
> *Wat er volgens de berichtgeving is gebeurd.* Eind oktober 2026 (de meeste berichten noemen 26 oktober) heeft het bedrijf OpenAI bekendgemaakt dat zijn AI-modellen een bewijs zouden hebben geproduceerd van het **bestaans**deel van het probleem voor vierdimensionale Yang–Mills-theorie, inclusief een formalisering in de bewijsassistent Lean — en uitdrukkelijk **zonder** een claim over de massakloof.
>
> *Waar wij dat zagen.* In zoekresultaten van *Scientific American* (artikel met de titel "OpenAI just scooped human researchers on a million-dollar quantum math problem"), van de nieuwsredactie van *Science*, van het weblog *Not Even Wrong* van Peter Woit, en van een reeks kleinere nieuws- en blogsites (onder meer Interesting Engineering, Let's Data Science, cloudmagazin en OfficeChai). De zoekmachine toont ook een pagina op openai.com met de titel "Working with academic communities to build scientific understanding".
>
> *Wat die uittreksels verder zeggen.* (a) Het bewijs is **niet openbaar**: een commissie van vijf natuurkundigen onder voorzitterschap van David Gross (genoemd worden verder Michael Douglas, Arthur Jaffe, Igor Klebanov en Nikita Nekrasov) houdt het materiaal achter totdat zij het zelf heeft beoordeeld en opgeschreven. (b) Een onafhankelijke adviesgroep van wiskundigen (de "Advisory Group on Mathematics and Artificial Intelligence") heeft om openbaarmaking gevraagd. (c) Niemand buiten die kring heeft het bewijs kunnen controleren, en er zijn sceptische reacties van vakgenoten. (d) Dezelfde berichtgeving noemt een afzonderlijke, eveneens nog ongetoetste claim van de wiskundigen Alpöge en Sussman over het bestaansprobleem; over de reikwijdte daarvan (drie dimensies, of ook $\mathbb{R}^4$) zijn de uittreksels het niet eens.
>
> *Wat wij níet konden vaststellen.* Wij konden geen enkele primaire bron openen — niet de aankondiging zelf, geen artikel of preprint met het bewijs, geen verklaring van het Clay-instituut; de netwerktoegang van deze sessie liet alleen zoekresultaten toe. De uittreksels spreken elkaar bovendien op details (data, precieze reikwijdte van de claim) tegen. Een verklaring van het Clay-instituut over deze claim hebben wij niet gevonden.
>
> *Onze conclusie.* Wij nemen deze claim **niet** als vaststaand feit over, en wij beweren evenmin dat hij onjuist is: hij is op dit moment eenvoudigweg **niet te controleren**. Voor de kern van dit document verandert het niets: (i) ook volgens deze berichten blijft de massakloof — het onderwerp van dit project — open; (ii) het Clay-probleem vereist bestaan **én** massakloof en is niet als opgelost erkend; (iii) de Clay-regels eisen publicatie, minstens twee jaar toetsing en brede aanvaarding (§8).

---

## 2. De klassieke theorie

### 2.1 Conventies

Wij gebruiken de wiskundige conventie waarin het ijkveld anti-hermitisch is en de koppelingsconstante vóór de actie staat.

- $G$ is een compacte enkelvoudige Lie-groep met Lie-algebra $\mathfrak{g}$. Voor $G=\mathrm{SU}(N)$ bestaat $\mathfrak{g}$ uit de anti-hermitische, spoorloze $N\times N$-matrices.
- Basis: $T_a$ met $[T_a,T_b] = f_{abc}T_c$ en $\mathrm{Tr}(T_aT_b) = -\tfrac12\delta_{ab}$. Voor SU(2): $T_a = -\tfrac{i}{2}\sigma_a$ (Pauli-matrices) en $f_{abc}=\epsilon_{abc}$.
- Het ijkveld is $A_\mu(x) = A_\mu^a(x)T_a \in \mathfrak{g}$, met $\mu = 0,1,2,3$.

### 2.2 Covariante afgeleide en veldsterkte

$$
D_\mu = \partial_\mu + A_\mu, \qquad F_{\mu\nu} = [D_\mu, D_\nu] = \partial_\mu A_\nu - \partial_\nu A_\mu + [A_\mu, A_\nu].
$$

*In gewone taal:* $F_{\mu\nu}$ is het Yang–Mills-analogon van het elektromagnetische veld; de extra term $[A_\mu,A_\nu]$ (die bij licht ontbreekt) betekent dat het veld met zichzelf wisselwerkt. In componenten: $F^a_{\mu\nu} = \partial_\mu A^a_\nu - \partial_\nu A^a_\mu + f_{abc}A^b_\mu A^c_\nu$.

### 2.3 IJksymmetrie

Voor elke functie $\Omega(x)\in G$ is

$$
A_\mu \to \Omega A_\mu \Omega^{-1} - (\partial_\mu\Omega)\Omega^{-1}, \qquad F_{\mu\nu} \to \Omega F_{\mu\nu}\Omega^{-1}.
$$

*In gewone taal:* je mag in elk punt van de ruimtetijd onafhankelijk een "draaiing" in de groep uitvoeren zonder dat de natuurkunde verandert; alleen ijkinvariante grootheden zoals $\mathrm{Tr}(F_{\mu\nu}F_{\rho\sigma})$ zijn meetbaar.

### 2.4 Actie en Lagrangiaan

Euclidisch (de vorm die op het rooster wordt gebruikt):

$$
S_{\mathrm{YM}}[A] = -\frac{1}{2g^2}\int d^4x\ \mathrm{Tr}\left(F_{\mu\nu}F_{\mu\nu}\right) = \frac{1}{4g^2}\int d^4x\ F^a_{\mu\nu}F^a_{\mu\nu} \ \geq 0 .
$$

In Minkowski-ruimte, signatuur $(+,-,-,-)$:

$$
\mathcal{L} = \frac{1}{2g^2}\mathrm{Tr}\left(F_{\mu\nu}F^{\mu\nu}\right) = -\frac{1}{4g^2}F^a_{\mu\nu}F^{a\ \mu\nu}.
$$

*In gewone taal:* de actie is "veldsterkte in het kwadraat", net als bij elektromagnetisme. Met de herschaling $A_\mu = g\tilde A_\mu$ krijg je de natuurkundige schrijfwijze $\mathcal{L} = -\tfrac14 \tilde F^a_{\mu\nu}\tilde F^{a\ \mu\nu}$ met $\tilde F^a_{\mu\nu} = \partial_\mu\tilde A^a_\nu - \partial_\nu\tilde A^a_\mu + g f_{abc}\tilde A^b_\mu\tilde A^c_\nu$; daar zie je dat $g$ de sterkte van de zelfwisselwerking is.

### 2.5 Bewegingsvergelijkingen en Bianchi-identiteit

Variatie van de actie geeft de **Yang–Mills-vergelijkingen**:

$$
D^\mu F_{\mu\nu} = \partial^\mu F_{\mu\nu} + [A^\mu, F_{\mu\nu}] = 0 .
$$

Daarnaast geldt automatisch (uit de Jacobi-identiteit voor $[D_\lambda,[D_\mu,D_\nu]]$) de **Bianchi-identiteit**:

$$
D_\lambda F_{\mu\nu} + D_\mu F_{\nu\lambda} + D_\nu F_{\lambda\mu} = 0 .
$$

*In gewone taal:* dit zijn de niet-lineaire versies van de Maxwell-vergelijkingen; in de taal van differentiaalvormen: $F = dA + A\wedge A$, $D_A F = 0$ (Bianchi) en $D_A{\star}F = 0$ (Yang–Mills).

### 2.6 De klassieke theorie heeft géén massakloof

De klassieke energie is $H = \frac{1}{2g^2}\int d^3x\ \left(E^a_iE^a_i + B^a_iB^a_i\right)$ met $E_i = F_{0i}$ en $B_i = \tfrac12\epsilon_{ijk}F_{jk}$. In vier dimensies is $g$ dimensieloos en bevat de theorie geen enkele lengteschaal: als $A_\mu(x)$ een oplossing is, dan is $\lambda A_\mu(\lambda x)$ dat ook, met energie $\lambda$ keer zo groot. *In gewone taal:* er bestaan klassieke golven met willekeurig kleine energie, precies zoals licht. **De massakloof is dus een zuiver kwantummechanisch effect** — dat is de kern van de moeilijkheid.

---

## 3. Wat "bestaan" en "massakloof" precies betekenen

### 3.1 Bestaan: de axioma's

Een kwantumveldentheorie "bestaat" in de zin van het probleem als er objecten zijn geconstrueerd die aan een van de volgende twee (in essentie gelijkwaardige) lijsten voldoen.

**Wightman-axioma's (Minkowski-ruimte).**

1. Er is een Hilbertruimte $\mathcal{H}$ met een unitaire representatie van de Poincaré-groep (translaties en Lorentz-transformaties).
2. *Spectrumconditie:* energie en impuls $(H,\vec P)$ hebben een gezamenlijk spectrum in de voorwaartse lichtkegel; in het bijzonder $H \geq 0$.
3. Er is precies één Poincaré-invariante toestand $\Omega$ (het vacuüm), met $H\Omega = 0$.
4. De velden zijn operatorwaardige (getemperde) distributies op een gemeenschappelijk dicht domein en transformeren covariant.
5. *Lokaliteit:* velden op ruimte-achtige afstand commuteren.
6. *Cycliciteit:* door velden op het vacuüm te laten werken krijg je een dichte deelverzameling van $\mathcal{H}$.

**Osterwalder–Schrader-axioma's (Euclidische ruimte).** Voor de Euclidische correlatiefuncties (Schwinger-functies) $S_n(x_1,\dots,x_n)$: (E0) regulariteit met een groeibegrenzing, (E1) invariantie onder Euclidische draaiingen en translaties, (E2) **reflectiepositiviteit**, (E3) symmetrie onder verwisseling van argumenten, (E4) clustereigenschap. De reconstructiestelling van Osterwalder en Schrader zegt: uit zulke Schwinger-functies volgt een Wightman-theorie.

Reflectiepositiviteit is de belangrijkste: voor elke waarneembare grootheid $F$ die alleen van velden op positieve tijden afhangt geldt

$$
\left\langle \overline{\theta F}\cdot F \right\rangle \geq 0 ,
$$

waarbij $\theta$ de spiegeling $t\to -t$ is. *In gewone taal:* deze ongelijkheid garandeert dat uit de statistische (Euclidische) beschrijving een echte kwantumtheorie met positieve waarschijnlijkheden en een Hamiltoniaan $H\geq0$ kan worden teruggewonnen.

Bij ijktheorieën is $A_\mu$ zelf niet ijkinvariant; de axioma's moeten gelden voor **ijkinvariante lokale grootheden**, zoals $\mathrm{Tr}\left(F_{\mu\nu}F_{\rho\sigma}\right)(x)$. Jaffe en Witten merken zelf op (parafrase) dat er nog geen wiskundig volledig voorbeeld van een kwantumijktheorie in vier dimensies bestaat, en zelfs geen precieze definitie ervan.

### 3.2 De massakloof

**Definitie.** De theorie heeft een massakloof $\Delta \gt 0$ als de Hamiltoniaan $H$ geen spectrum heeft in het open interval $(0,\Delta)$:

$$
\mathrm{Spec}(H) \subset \lbrace 0 \rbrace \cup [\Delta, \infty), \qquad \text{met } 0 \text{ een enkelvoudige eigenwaarde (het vacuüm).}
$$

*In gewone taal:* de goedkoopste aangeslagen toestand kost minstens energie $\Delta$; er bestaan geen willekeurig "zachte" excitaties. De grootste $\Delta$ waarvoor dit geldt is de massa $m$ van het lichtste deeltje; Jaffe en Witten eisen ook $m \lt \infty$ (er moeten wél excitaties bestaan).

**Gelijkwaardige formulering met correlatiefuncties.** Neem een lokale ijkinvariante grootheid $\mathcal{O}$ en bekijk de samenhangende Euclidische tijdcorrelator. De spectraalstelling geeft

$$
C_{\mathcal{O}}(t) = \langle \Omega, \mathcal{O}^\dagger e^{-tH}\mathcal{O}\ \Omega\rangle - \vert\langle\Omega,\mathcal{O}\ \Omega\rangle\vert^2 = \int_{(0,\infty)} e^{-tE}\ d\mu_{\mathcal{O}}(E), \qquad t \geq 0,
$$

met $\mu_{\mathcal{O}}$ een positieve maat (de spectrale maat van $H$ in de toestand $\mathcal{O}\Omega$, zonder het vacuümdeel). *In gewone taal:* een correlator is een som van dalende e-machten, één voor elk energieniveau dat $\mathcal{O}$ uit het vacuüm kan maken.

Daaruit volgt: $\mathrm{Spec}(H)\subset\lbrace 0\rbrace\cup[\Delta,\infty)$ **dan en slechts dan als** voor alle zulke $\mathcal{O}$

$$
0 \leq C_{\mathcal{O}}(t) \leq C_{\mathcal{O}}(0)\ e^{-\Delta t} \quad \text{voor alle } t\geq 0 .
$$

(Van links naar rechts volgt dit direct uit de integraalformule. Van rechts naar links — van exponentieel verval naar het spectrum — gebruikt men de cycliciteit van het vacuüm: de vectoren $\mathcal{O}\Omega$ liggen dicht in $\mathcal{H}$.) In ruimtetijd-vorm: voor lokale grootheden $A$ en $B$ is $\vert\langle A(x)B(y)\rangle - \langle A\rangle\langle B\rangle\vert \leq C_{AB}\ e^{-\Delta\vert x-y\vert}$. *In gewone taal:* **massakloof = alle samenhangende correlaties sterven exponentieel uit met de afstand**, met een reikwijdte (correlatielengte) $\xi = 1/m$. Dit is precies wat een roostersimulatie kan meten (§5.3) — maar meten is niet bewijzen.

---

## 4. Waarom het moeilijk is

### 4.1 Asymptotische vrijheid

In de kwantumtheorie hangt de effectieve koppeling af van de energieschaal $\mu$ waarop je meet. Voor $G=\mathrm{SU}(N)$ zonder materie:

$$
\mu\frac{dg}{d\mu} = -b_0 g^3 - b_1 g^5 + O(g^7), \qquad b_0 = \frac{11N}{48\pi^2}, \qquad b_1 = \frac{34}{3}\cdot\frac{N^2}{(16\pi^2)^2}.
$$

*In gewone taal:* het minteken betekent dat de koppeling **kleiner** wordt bij hogere energie (kortere afstand) — "asymptotische vrijheid" (Gross en Wilczek; Politzer, 1973) — en dus **groter** bij lage energie (grote afstand). De coëfficiënten $b_0$ en $b_1$ zijn universeel (onafhankelijk van het rekenschema); hogere coëfficiënten zijn dat niet.

In laagste orde is de oplossing $g^2(\mu) = 1/\left(b_0\ln(\mu^2/\Lambda^2)\right)$. *In gewone taal:* bij $\mu\to\infty$ gaat $g\to0$ (daar werkt storingsrekening), maar bij $\mu\to\Lambda$ wordt $g$ groot en verliest storingsrekening elke betekenis — en juist daar, op grote afstand, leeft de massakloof.

### 4.2 Dimensionele transmutatie

De klassieke theorie heeft geen schaal (§2.6). De kwantumtheorie heeft er precies één, de integratieconstante van de vergelijking hierboven:

$$
\Lambda = \mu\cdot\left(b_0g^2\right)^{-b_1/(2b_0^2)}\exp\left(-\frac{1}{2b_0g^2}\right)\left(1+O(g^2)\right), \qquad g = g(\mu).
$$

*In gewone taal:* de dimensieloze koppeling $g$ wordt "ingeruild" voor een energieschaal $\Lambda$; dat heet dimensionele transmutatie. $\Lambda$ hangt niet af van de gekozen $\mu$.

**Controle** dat $\Lambda$ niet van $\mu$ afhangt: met $\ln\Lambda = \ln\mu - \frac{b_1}{2b_0^2}\ln(b_0g^2) - \frac{1}{2b_0g^2}$ en de vergelijking voor $dg/d\ln\mu$ volgt

$$
\frac{d\ln\Lambda}{d\ln\mu} = 1 + \left(\frac{1}{b_0g^3} - \frac{b_1}{b_0^2g}\right)\left(-b_0g^3 - b_1g^5\right) = \frac{b_1^2}{b_0^2}g^4 ,
$$

dus nul tot op termen die in de factor $(1+O(g^2))$ worden opgenomen. Voor de tot twee lussen afgekapte vergelijking is die factor exact $\left(1+b_1g^2/b_0\right)^{b_1/(2b_0^2)}$; wij hebben dit numeriek nagerekend door de vergelijking, startend bij $g^2 = 4/2{,}2$, over 40 e-machten in $\mu$ te integreren (de exacte invariant bleef constant tot op $10^{-10}$).

Omdat $\Lambda$ de enige schaal is, moet elke grootheid met de dimensie van massa een zuiver getal maal $\Lambda$ zijn:

$$
m = c_G\cdot\Lambda, \qquad \sqrt{\sigma} = c'_G\cdot\Lambda, \qquad \text{dus} \quad \frac{m}{\sqrt{\sigma}} = \frac{c_G}{c'_G} = \text{een zuiver getal.}
$$

*In gewone taal:* de theorie heeft geen vrij instelbare parameters; verhoudingen zoals $m/\sqrt\sigma$ zijn vaste getallen die de theorie zelf bepaalt. **In deze taal komt het massakloof-deel van het millenniumprobleem erop neer dat $c_G$ bestaat en strikt positief is.** (Dit is een parafrase: de officiële opgave in §1 noemt $\Lambda$ niet en vraagt om het bestaan van de theorie en een kloof $\Delta \gt 0$.) De formule zegt niets over de waarde van $c_G$.

### 4.3 Waarom storingsrekening de kloof nooit kan vinden

Schrijf $x = g^2$ en bekijk $m/\mu$ als functie van $x$:

$$
\frac{m}{\mu} = c_G\cdot (b_0x)^{-b_1/(2b_0^2)}\ e^{-1/(2b_0x)}\left(1+O(x)\right).
$$

Voor elke macht $n$ geldt $\lim_{x\downarrow0} x^{-n}e^{-1/(2b_0x)} = 0$. *In gewone taal:* deze functie gaat bij kleine koppeling sneller naar nul dan elke macht van $g$; **alle Taylor-coëfficiënten rond $g=0$ zijn nul.** Storingsrekening is een Taylor-reeks in $g$, dus tot elke eindige orde voorspelt zij $m=0$. De massakloof is "niet-perturbatief": onzichtbaar voor de enige systematische rekenmethode die in het continuüm beschikbaar is. (Numerieke illustratie: bij $g^2=0{,}1$ is de factor ongeveer $10^{-46}$.)

### 4.4 De overige obstakels

1. **Geen kleine parameter op grote afstand.** Bij de schaal $\Lambda$ is de koppeling van orde 1.
2. **Vier dimensies is het randgeval.** In 2 en 3 dimensies heeft de koppeling een positieve massadimensie ($g^2$ is een massa in het kwadraat in 2D en een massa in 3D) en zijn de ultraviolette divergenties mild ("superrenormaliseerbaar"); daar zijn constructieve methoden deels geslaagd. In 4 dimensies is de koppeling dimensieloos ("marginaal") en moet men oneindig veel schalen tegelijk beheersen. Ter vergelijking: voor de eenvoudigste kandidaat, $\phi^4$-theorie in 4 dimensies (één reëel veld, roosterregularisatie), is bewezen dat de continuümlimiet triviaal is, dat wil zeggen een vrije theorie zonder wisselwerking (Aizenman en Duminil-Copin 2021); Yang–Mills zou dankzij asymptotische vrijheid juist wél moeten bestaan.
3. **IJkinvariantie.** De natuurlijke configuratieruimte is "verbindingen modulo ijktransformaties", een oneindig-dimensionale gekromde ruimte; ijkfixatie lukt niet globaal (Gribov-kopieën).
4. **Infrarood.** Zelfs als de constructie in een eindige doos lukt, moet men het volume naar oneindig sturen én de kloof daarbij uniform van onderen begrenzen. Daarvoor is geen mechanisme bekend dat men kan bewijzen.

### 4.5 De roostervorm voor SU(2), met controle van de algebra

Op het rooster speelt $1/a$ de rol van $\mu$ en de kale koppeling $g$ (met $\beta = 4/g^2$) de rol van $g(\mu)$:

$$
a\Lambda_L = \left(b_0g^2\right)^{-b_1/(2b_0^2)}\exp\left(-\frac{1}{2b_0g^2}\right).
$$

Voor $N=2$:

| Grootheid | Berekening | Uitkomst |
|---|---|---|
| $b_0$ | $11\cdot2/(48\pi^2)$ | $11/(24\pi^2)$ |
| $b_1$ | $(34/3)\cdot4/(256\pi^4)$ | $17/(96\pi^4)$ |
| $b_1/(2b_0^2)$ | $\dfrac{17}{96}\cdot\dfrac{576}{2\cdot121}$ | $51/121$ |
| $b_0g^2$ met $g^2=4/\beta$ | $\dfrac{11}{24\pi^2}\cdot\dfrac{4}{\beta}$ | $\dfrac{11}{6\pi^2\beta}$ |
| $1/(2b_0g^2)$ | $\dfrac{6\pi^2\beta}{2\cdot11}$ | $\dfrac{3\pi^2\beta}{11}$ |

Dus

$$
a\Lambda_L = \left(\frac{6\pi^2\beta}{11}\right)^{51/121}\exp\left(-\frac{3\pi^2\beta}{11}\right).
$$

*In gewone taal:* de roosterafstand, gemeten in de natuurlijke eenheid $1/\Lambda_L$, krimpt exponentieel als $\beta$ groeit; de continuümlimiet $a\to0$ ligt bij $\beta\to\infty$. De breuken zijn door ons met exacte rationale rekenkunde gecontroleerd (zie de Bijlage), en de formule komt tot op machineprecisie overeen met `ym/exact.py::a_lambda_two_loop`.

De roosterversie van de hoofdformule is dan

$$
a\cdot m(\beta) = c\cdot\left(\frac{6\pi^2\beta}{11}\right)^{51/121}\exp\left(-\frac{3\pi^2\beta}{11}\right)\left(1+O(1/\beta)\right) \qquad (\beta\to\infty).
$$

*In gewone taal:* als de theorie een massakloof heeft, moet de massa in roostereenheden bij groeiende $\beta$ precies volgens deze kromme naar nul gaan ("asymptotische schaling"). De correlatielengte in roosterpunten, $\xi/a = 1/(am)$, groeit dan exponentieel met $\beta$.

**Waarschuwing: bij bereikbare $\beta$ is deze limiet nog niet bereikt.** Met literatuurwaarden voor $a\sqrt\sigma$ (zie `literature.json`):

| $\beta$ | $a\Lambda_L$ (formule) | $a\sqrt\sigma$ (literatuur) | $\sqrt\sigma/\Lambda_L$ |
|---|---|---|---|
| 2,2 | 0,007597 | 0,467(10) | 61,5 |
| 2,3 | 0,005914 | 0,3687(22) | 62,3 |
| 2,4 | 0,004600 | 0,2673(15) | 58,1 |
| 2,5 | 0,003576 | 0,186(3) | 52,0 |

Bij echte asymptotische schaling zou de laatste kolom constant zijn; zij daalt nog ongeveer 17 procent tussen $\beta=2{,}3$ en $2{,}5$. *In gewone taal:* de twee-lus-formule is een uitspraak over $\beta\to\infty$ en is bij $\beta\approx2{,}5$ nog niet nauwkeurig. De betrouwbaardere toets is daarom **schaling**: verhoudingen van fysische grootheden, zoals $m/\sqrt\sigma$, moeten constant worden met correcties van orde $a^2\sigma$. Onze eigen data halen die toets in $D=3$ binnen 1 à 2 %, maar in $D=4$ niet (§7.3). (De schaal $\Lambda_L$ verschilt bovendien per regularisatie een bekende constante factor van bijvoorbeeld $\Lambda_{\overline{\mathrm{MS}}}$.)

---

## 5. De roosterformulering

### 5.1 Definitie (exact zoals in de code)

De ruimtetijd wordt vervangen door een rooster met afmetingen $(L_0,\dots,L_{D-1})$, periodiek in alle richtingen; as 0 is de Euclidische tijd. Op elke verbinding van $x$ naar $x+\hat\mu$ staat een matrix $U_\mu(x)\in\mathrm{SU}(2)$, opgeslagen als reële eenheidsvector $q=(a_0,a_1,a_2,a_3)$:

$$
U = a_0\mathbb{1} + i\left(a_1\sigma_1 + a_2\sigma_2 + a_3\sigma_3\right), \qquad a_0^2+a_1^2+a_2^2+a_3^2 = 1, \qquad \tfrac12\mathrm{Tr}\ U = a_0 .
$$

De plaquette (het kleinste gesloten lusje) in het vlak $(\mu,\nu)$ is

$$
U_{\mu\nu}(x) = U_\mu(x)\ U_\nu(x+\hat\mu)\ U_\mu^\dagger(x+\hat\nu)\ U_\nu^\dagger(x),
$$

en de **Wilson-actie** is

$$
S = \beta\sum_x\sum_{\mu\lt\nu}\left(1 - \tfrac12\mathrm{Tr}\ U_{\mu\nu}(x)\right), \qquad \langle\mathcal{O}\rangle = \frac{1}{Z}\int\prod_{x,\mu}dU_\mu(x)\ \mathcal{O}(U)\ e^{-S(U)},
$$

met $dU$ de Haar-maat (de uniforme verdeling op de groep). *In gewone taal:* elke configuratie van matrices krijgt een kans evenredig met $e^{-S}$; de actie straft plaquettes die ver van de eenheidsmatrix liggen, en $\beta$ bepaalt hoe streng. Dit is een gewone, eindig-dimensionale integraal: **op een eindig rooster is alles wiskundig volkomen goed gedefinieerd.** De ijksymmetrie is $U_\mu(x)\to\Omega(x)U_\mu(x)\Omega^\dagger(x+\hat\mu)$ en is op het rooster exact.

### 5.2 Verband met het continuüm

Met $U_\mu(x) = \exp\left(aA_\mu(x)\right)$ (op tekenconventies en hogere orden in $a$ na) is $U_{\mu\nu} = \exp\left(a^2F_{\mu\nu}+O(a^3)\right)$, en met $\mathrm{Tr}(T_aT_b) = -\tfrac12\delta_{ab}$:

$$
1 - \tfrac12\mathrm{Tr}\ U_{\mu\nu}(x) = \frac{a^4}{8}F^a_{\mu\nu}F^a_{\mu\nu}\ \text{(geen som over } \mu,\nu) + \text{hogere orde}.
$$

Sommeren en $a^D\sum_x\to\int d^Dx$ geeft $S \to \frac{\beta a^{4-D}}{16}\int d^Dx\ F^a_{\mu\nu}F^a_{\mu\nu}$. Vergelijken met $S_{\mathrm{YM}} = \frac{1}{4g^2}\int F^a_{\mu\nu}F^a_{\mu\nu}$ levert

$$
\beta = \frac{4}{g^2a^{4-D}} \qquad\left(D=4:\ \beta=\frac{4}{g^2};\quad D=3:\ \beta=\frac{4}{g^2a};\quad D=2:\ \beta=\frac{4}{g^2a^2}\right).
$$

*In gewone taal:* voor gladde velden en kleine $a$ is de Wilson-actie gelijk aan de Yang–Mills-actie; $\beta$ is de omgekeerde koppeling.

### 5.3 Hoe massa's uit correlatoren volgen

De Wilson-actie is reflectiepositief (Osterwalder en Seiler 1978) en heeft een positieve, zelfgeadjungeerde overdrachtsmatrix $\mathsf{T}$ (Lüscher 1977). Daarmee is $aH = -\ln\left(\mathsf{T}/\lambda_0\right)$ een echte Hamiltoniaan met $H\geq0$, en voor elke ijkinvariante operator $\mathcal{O}(t)$ op tijdlaag $t$ geldt op een rooster met tijdlengte $T$:

$$
C(t) = \langle\mathcal{O}(t)\mathcal{O}(0)\rangle - \langle\mathcal{O}\rangle^2 = \sum_{n\geq1}\vert\langle0\vert\mathcal{O}\vert n\rangle\vert^2\left(e^{-E_nt} + e^{-E_n(T-t)}\right) + \dots
$$

*In gewone taal:* de roostercorrelator is exact een som van dalende e-machten met positieve gewichten (de tweede term komt van de periodieke tijdrichting; de puntjes zijn termen die bij grote $T$ exponentieel klein zijn). Voor grote $t$ wint de laagste energie: $C(t)\approx A\ e^{-mt}$.

De **effectieve massa** is

$$
a\ m_{\mathrm{eff}}(t) = \ln\frac{C(t)}{C(t+a)} \qquad\left(\text{of de oplossing van } \frac{C(t)}{C(t+a)} = \frac{\cosh\left(m_{\mathrm{eff}}(t-T/2)\right)}{\cosh\left(m_{\mathrm{eff}}(t+a-T/2)\right)}\right).
$$

*In gewone taal:* je leest de massa af uit hoe snel de correlator per tijdstap daalt. Omdat alle gewichten positief zijn, daalt $m_{\mathrm{eff}}(t)$ (voor $T\to\infty$) monotoon naar de echte laagste massa in dat kanaal. **Belangrijke eerlijkheidsclausule:** een gemeten plateau is dus een *bovengrens*. Hoe dicht die bij de echte massa ligt, hangt af van de operatoren en van het bereik in $t$: in onze $D=4$-metingen berust het "plateau" op de overeenstemming van twee tijdstappen en ligt het bij $\beta=2{,}4$ en $2{,}5$ 5 tot 14 % boven de literatuurwaarden, afhankelijk van de referentie (§7.3). Bovendien kan een simulatie nooit uitsluiten dat een nog lichtere toestand bestaat die zó zwak aan $\mathcal{O}$ koppelt dat zij in de ruis verdwijnt.

Operatoren in dit project:

- **Glueball ($0^{++}$):** de som over een tijdlaag van ruimtelijke lussen van $1\times1$ en $2\times2$ roosterstappen, gemeten op 4 of 5 niveaus van "uitsmering" (APE-smearing, om de overlap met de grondtoestand te vergroten) en variationeel gecombineerd (GEVP, regels R2 en R3 in `ym/stats.py`), met aftrek van de vacuümverwachting.
- **Snaarspanning via de torelon:** de Polyakov-lus rond een ruimtelijke richting van lengte $L$, namelijk $\mathcal{P}(t) = \sum_{x_\perp}\tfrac12\mathrm{Tr}\prod_{k=0}^{L-1}U_1(x+k\hat1)$. Deze maakt een gesloten fluxbuis ("torelon") met energie

$$
E(L) = \sigma L - \frac{\pi(D-2)}{6L} + \dots
$$

  *In gewone taal:* de energie van de fluxbuis groeit evenredig met zijn lengte; de evenredigheidsconstante is de snaarspanning $\sigma$, en de tweede term is de universele correctie door trillingen van de snaar (Lüscher). In $D=2$ is er geen correctie en geldt $E=\sigma L$ exact.
- **Wilson-lussen:** $\langle\tfrac12\mathrm{Tr}\ W(R,T)\rangle\sim e^{-\sigma RT}$ ("oppervlaktewet") is het klassieke criterium voor opsluiting.

### 5.4 De continuümlimiet

Het rooster is een hulpmiddel; de theorie waar het om gaat ontstaat in de limiet $a\to0$.

- **$D=4$.** Volgens §4.5 betekent $a\to0$ dat $\beta\to\infty$. Fysische massa's zijn $m = \lim (am)(\beta)/a(\beta)$; in de praktijk bekijkt men dimensieloze verhoudingen: $m/\sqrt\sigma = \lim_{\beta\to\infty}(am)/(a\sqrt\sigma)$, met leidende roosterfout van orde $a^2\sigma$. In de taal van de statistische fysica is $\beta=\infty$ een kritiek punt: de correlatielengte $\xi/a$ divergeert.
- **$D=3$.** Hier heeft $g^2$ de dimensie van massa en is $a = 4/(\beta g^2)$; alle massa's zijn een getal maal $g^2$, bijvoorbeeld $\sqrt\sigma/g^2 = \lim_{\beta\to\infty}\beta\cdot a\sqrt\sigma/4$. Literatuur (Teper 1998): $\sqrt\sigma/g^2 = 0{,}3353(18)$ en $m(0^{++})/\sqrt\sigma\approx4{,}72$. Ook in drie dimensies is de massakloof wiskundig onbewezen.
- **$D=2$.** Exact oplosbaar (§5.6): met $\beta = 4/(g^2a^2)$ volgt $\sigma = \lim_{a\to0}\left(-\ln u(\beta)\right)/a^2 = \tfrac38g^2$.
- **Volume.** Tegelijk moet de doos groot zijn ten opzichte van de correlatielengte: $a\ll\xi\ll La$. Op onze roosters is $\xi = 1/(am)$ maar 0,8 tot 1,8 roosterafstanden, zodat aan $a\ll\xi$ niet is voldaan (§7.3).

### 5.5 Wat er wiskundig precies ontbreekt

Op een eindig rooster is er niets te bewijzen: alles bestaat, en de kloof van de (eindige) overdrachtsmatrix is vanzelf positief. Het probleem zit volledig in de limieten. Er ontbreekt:

1. **Bestaan van de limiet $a\to0$, $L\to\infty$** van de correlatiefuncties van ijkinvariante grootheden (ten minste langs deelrijen), met behoud van niet-trivialiteit.
2. **De axioma's voor de limiet.** Reflectiepositiviteit erft men van het rooster, maar volledige Euclidische draai-invariantie (het rooster kent alleen kubische symmetrie) en de regulariteitsaxioma's moeten in de limiet worden aangetoond.
3. **Een uniforme ondergrens voor de kloof in fysische eenheden.** Men moet constanten $0\lt c\leq C\lt\infty$ vinden met

$$
c \ \leq\ \frac{m(\beta)}{\Lambda_L(\beta)} = \frac{a\ m(\beta)}{a\Lambda_L(\beta)} \ \leq\ C \qquad \text{voor alle voldoende grote } \beta,
$$

   waarbij de noemer de functie uit §4.5 is. *In gewone taal:* de roostermassa moet naar nul gaan (anders is er geen continuümlimiet), maar **precies zo snel** als de formule van asymptotische vrijheid zegt, en niet sneller. De ondergrens $c$ is de massakloof; de bovengrens $C$ zegt dat er werkelijk deeltjes met eindige massa zijn.
4. **Zelfs op het rooster is bij zwakke koppeling weinig bewezen.** Dat SU(2)-roostertheorie in vier dimensies voor *alle* $\beta$ een massakloof en een oppervlaktewet heeft (dus geen faseovergang naar een toestand zonder kloof), is alleen bewezen voor kleine $\beta$ (§6) en is voor grote $\beta$ een open probleem. Dat dit niet vanzelf spreekt, blijkt uit de U(1)-roostertheorie in vier dimensies, die bij zwakke koppeling bewijsbaar géén opsluiting heeft (Guth 1980; Fröhlich en Spencer 1982).
5. **Voor elke compacte enkelvoudige groep**, niet alleen SU(2).

### 5.6 Exacte en analytische ijkpunten die dit project gebruikt

Notatie: $u(\beta) = I_2(\beta)/I_1(\beta)$ en $u'(\beta) = du/d\beta = 1 - u^2 - 3u/\beta$.

De bouwsteen is de integraal over één plaquette. Met de Haar-maat van SU(2), $\frac{2}{\pi}\sin^2\theta\ d\theta$ waarbij $\tfrac12\mathrm{Tr}\ U = \cos\theta$:

$$
Z_1(\beta) = \frac{2}{\pi}\int_0^\pi\sin^2\theta\ e^{\beta\cos\theta}\ d\theta = \frac{2I_1(\beta)}{\beta}, \qquad \frac{d\ln Z_1}{d\beta} = \frac{I_2(\beta)}{I_1(\beta)} = u(\beta).
$$

*In gewone taal:* voor één losse plaquette is het gemiddelde van $\tfrac12\mathrm{Tr}\ U$ exact een verhouding van Besselfuncties. (Numeriek door ons gecontroleerd, evenals de formule voor $u'$.)

| Grootheid | Formule | Status |
|---|---|---|
| Plaquette, $D=2$ | $P = u(\beta)$ | exact (oneindig volume; op een torus exponentieel kleine correcties) |
| Wilson-lus met oppervlak $A$, $D=2$ | $\langle\tfrac12\mathrm{Tr}\ W\rangle = u^A$ | exact: zuivere oppervlaktewet |
| Snaarspanning, $D=2$ | $a^2\sigma = -\ln u(\beta)$; continuüm $\sigma = \tfrac38g^2$ | exact |
| Torelon-correlator, $D=2$, torus $L\times T$ | $\tfrac14\left(u^{L\tau} + u^{L(T-\tau)}\right)$, dus $E = -L\ln u$ | exact op exponentieel kleine termen van hogere representaties na |
| Plaquette, sterke koppeling, $D$ dimensies | $P = u + 8(D-2)u^5u' + O(u^9)$ | afgekapte reeks; **voorspelling, wordt getoetst** |
| Snaarspanning, sterke koppeling | $a^2\sigma = -\ln u - 2(D-2)u^4 + O(u^6)$ | leidende orde; ter oriëntatie |
| Glueballmassa, sterke koppeling, $D\geq3$ | $am = -4\ln u\cdot(1+o(1))$ voor $\beta\to0$ | leidende orde; ter oriëntatie |

**Waarom $D=2$ exact is.** In twee dimensies kun je (bij open rand of oneindig volume) de verbindingsvariabelen vervangen door onafhankelijke plaquettevariabelen; elke verwachtingswaarde valt dan uiteen in één-plaquette-integralen. *In gewone taal:* in 2D "voelen" plaquettes elkaar niet. Dat maakt 2D een perfecte ijkopstelling voor de code — maar ook een slecht model voor het echte probleem: in 2D bestaan geen zich voortplantende gluonen en dus geen glueballs. De energieniveaus van de 2D-theorie op een cirkel met omtrek $L$ zijn $E_j = \tfrac12g^2L\ j(j+1)$ met $j=0,\tfrac12,1,\dots$; de torelon is $j=\tfrac12$, met $E = \tfrac38g^2L = \sigma L$.

**Waar de sterke-koppelingsreeks vandaan komt.** Ontwikkel de Boltzmann-factor per plaquette in karakters: $e^{\beta\cdot\frac12\mathrm{Tr}U} = \sum_j d_jf_j(\beta)\chi_j(U)$ met $d_j = 2j+1$ en $f_j/f_0 = I_{2j+1}(\beta)/I_1(\beta)$. Een gesloten oppervlak van $n$ plaquettes in de fundamentele representatie met de topologie van een bol draagt $d_{1/2}^2u^n = 4u^n$ bij aan de logaritme van de toestandssom. Het kleinste zulke oppervlak is de kubus ($n=6$); per plaquette zijn er $(D-2)/3$ kubussen. Met $Z' = \int\prod dU\ e^{\beta\sum_p\frac12\mathrm{Tr}U_p}$ (de toestandssom zonder de constante term van de actie) en $N_p$ het aantal plaquettes is dus $\ln Z'/N_p = \ln f_0 + \tfrac{D-2}{3}\cdot4u^6 + \dots$, en $P = \frac{1}{N_p}\frac{d\ln Z'}{d\beta}$ geeft $P = u + 8(D-2)u^5u' + \dots$. *In gewone taal:* bij kleine $\beta$ is de plaquette bijna de 2D-waarde, met een kleine correctie van de kubusjes die in meer dan twee dimensies mogelijk zijn. (De code in `ym/exact.py` bevat ook de eerstvolgende term, afgeleid door de auteur van die module.) De correctie op de snaarspanning komt van een "bobbel" op het minimale oppervlak (één plaquette vervangen door de vijf andere zijden van een kubus: vier plaquettes extra, in $2(D-2)$ richtingen). De leidende glueballmassa komt van de buis van $4t$ plaquettes die twee plaquettes op tijdafstand $t$ verbindt.

Deze reeksen convergeren alleen voor kleine $\beta$ en zeggen op zichzelf niets over de continuümlimiet $\beta\to\infty$.

---

## 6. Wat wél rigoureus bekend is

Verificatiestatus van elke verwijzing staat in de Referenties (§9): ✔ = titel en vindplaats in deze sessie via een zoekmachine teruggevonden; ○ = uit het geheugen geciteerd en niet opnieuw gecontroleerd.

### 6.1 Roostertheorie bij vaste roosterafstand

- **Wilson (1974)** voerde de roosterformulering in en liet met de sterke-koppelingsreeks de oppervlaktewet zien.
- **Osterwalder en Seiler (1978)** bewezen reflectiepositiviteit van de Wilson-actie (voor alle $\beta$) en, met een convergente clusterontwikkeling, **massakloof én opsluiting voor voldoende kleine $\beta$** (sterke koppeling). *Waarom dit het probleem niet oplost:* de continuümlimiet ligt bij $\beta\to\infty$, het tegenovergestelde uiteinde.
- **Lüscher (1977)** construeerde de positieve overdrachtsmatrix; **Seiler (1982)** geeft een overzicht in boekvorm.
- **Shen, Zhu en Zhu (2023)** bewezen met stochastische analyse (Langevin-dynamica, log-Sobolev-ongelijkheden) opnieuw en met expliciete grens een massakloof voor rooster-Yang–Mills bij sterke koppeling. Ook dit betreft alleen kleine $\beta$.
- **Adhikari en Cao (2025)** bewezen exponentieel verval van correlaties bij **zwakke** koppeling, maar voor **eindige** ijkgroepen — niet voor continue groepen als SU(2).
- **Chatterjee (2021)** bewees een voorwaardelijke stelling: áls een zuivere roosterijktheorie exponentieel verval van correlaties heeft onder willekeurige randvoorwaarden en de groep een niet-triviaal centrum heeft, dán is er opsluiting. Hij schreef ook een toegankelijk overzicht van de open problemen ("Yang–Mills for probabilists", 2019) en loste sterk gekoppelde $\mathrm{SO}(N)$-roostertheorie op in de limiet van grote $N$ (2019).
- **Abelse tegenhangers:** U(1) in vier dimensies heeft bij zwakke koppeling géén opsluiting (Guth 1980; Fröhlich en Spencer 1982); U(1) in drie dimensies heeft opsluiting voor alle koppelingen (Göpfert en Mack 1982). Bij hoge temperatuur verdwijnt opsluiting (Borgs en Seiler 1983). Het niet-abelse geval in vier dimensies bij zwakke koppeling is open.

### 6.2 Continuümlimiet: gedeeltelijke resultaten in drie en vier dimensies

- **Bałaban (1984–1989)** bewees in een lange reeks artikelen met renormalisatiegroepmethoden **ultraviolette stabiliteit**: de toestandssom van rooster-Yang–Mills in een vast fysisch volume blijft, na renormalisatie, uniform begrensd als $a\to0$ — in drie dimensies (1985) en in vier dimensies (1987–1989). *Waarom dit het probleem niet oplost:* het zijn grenzen op de toestandssom in eindig volume; convergentie van waarneembare grootheden, de axioma's, het oneindige volume en de massakloof volgen er niet uit.
- **Magnen, Rivasseau en Sénéor (1993)** werkten een constructie uit van de Schwinger-functies van zuivere SU(2)-Yang–Mills in vier dimensies **met een vaste infrarood-afsnijding** (het gedrag op grote afstand wordt kunstmatig afgekapt) en zonder ultraviolet-afsnijding, in een geregulariseerde axiale ijk en in de triviale topologische sector. (De auteurs spreken zelf, voor zover wij ons herinneren, voorzichtig van "de basis voor een rigoureuze constructie"; hun afsnijding breekt de ijkinvariantie, die met tegentermen wordt hersteld.) *Waarom dit het probleem niet oplost:* de infrarood-afsnijding verwijderen is precies waar de massakloof zit.
- **Abelse Higgs-modellen** (elektromagnetisme met een geladen scalair veld) zijn in twee dimensies in het continuüm geconstrueerd door Brydges, Fröhlich en Seiler (1979–1981); voor drie dimensies bestaan resultaten van latere auteurs (uit het geheugen; niet opnieuw gecontroleerd). *Waarom dit het probleem niet oplost:* deze theorieën zijn abels en laag-dimensionaal.

### 6.3 Twee dimensies: volledig opgelost

- **Migdal (1975)** vond de exacte oplossing van 2D-rooster-Yang–Mills; **Witten (1991)** werkte de continuümtheorie op oppervlakken uit.
- **Gross, King en Sengupta (1989)** en **Driver (1989)** construeerden de continue 2D-Yang–Mills-maat wiskundig streng, en Driver bewees dat de roostertheorie ernaar convergeert. **Sengupta (1997)** en **Lévy (2003, 2010)** breidden dit uit naar willekeurige compacte oppervlakken.
- *Waarom dit het probleem niet oplost:* 2D-Yang–Mills heeft geen lokale vrijheidsgraden (§5.6); de moeilijkheden van §4 treden niet op.

### 6.4 Stochastische kwantisatie (recent)

- **Chandra, Chevyrev, Hairer en Shen** construeerden de Langevin-dynamica (de "stochastische Yang–Mills-warmtestroming") met een natuurlijke toestandsruimte in **twee dimensies** (Publ. Math. IHÉS 2022) en, lokaal in de tijd, voor Yang–Mills–Higgs in **drie dimensies** (Invent. Math. 2024). **Chevyrev en Shen** (2023, preprint; uit het geheugen geciteerd) toonden voor 2D aan dat de Yang–Mills-maat invariant is onder deze dynamica.
- *Waarom dit het probleem niet oplost:* in drie dimensies is alleen de dynamica voor korte tijden geconstrueerd, niet de invariante maat (de eigenlijke kwantumtheorie); vier dimensies is voor deze methode het kritieke geval en valt er (nog) buiten; en over een massakloof zeggen deze resultaten niets.

### 6.5 Samenvatting in één tabel

| Wat | Bewezen? |
|---|---|
| Roostertheorie op eindig rooster bestaat | ja (triviaal: eindige integraal) |
| Reflectiepositiviteit, overdrachtsmatrix op het rooster | ja |
| Massakloof en opsluiting op het rooster, kleine $\beta$ | ja |
| Massakloof op het rooster voor alle $\beta$ (SU(2), $D=4$) | **nee** |
| Continuümlimiet in $D=2$, met alle eigenschappen | ja |
| Ultraviolette stabiliteit in eindig volume, $D=3,4$ | ja (Bałaban) |
| Continuümtheorie in $D=3$ of $D=4$ in oneindig volume met axioma's | **nee**: er is geen openbaar, door vakgenoten gecontroleerd bewijs (zie de kanttekening in §1 over een recente claim voor $D=4$ waarvan het bewijs niet openbaar en dus niet te controleren is) |
| Massakloof in het continuüm, $D=3$ of $D=4$ | **nee** |

---

## 7. Wat deze repository wel en niet aantoont

### 7.1 Wat de simulaties wél kunnen aantonen

1. **Dat de code klopt**, door vergelijking met formules die exact bekend zijn (§5.6): in $D=2$ de plaquette, Wilson-lussen en de torelon-energie; bij kleine $\beta$ in $D=3,4$ de sterke-koppelingsreeks.
2. **Of de code bekende resultaten reproduceert** in $D=3$ en $D=4$: plaquette, snaarspanning en glueballmassa vergeleken met de literatuurwaarden in `literature.json` (waarin per getal staat of het in deze sessie is teruggevonden of uit het geheugen komt). Uitkomst (§7.3): gehaald voor de plaquette en voor de snaarspanning in $D=3$; niet gehaald voor de glueballmassa in $D=4$ bij $\beta=2{,}4$ en $2{,}5$ en voor de snaarspanning bij $\beta=2{,}4$ op $L=12$.
3. **Numerieke aanwijzingen voor een massakloof**: nagaan of op de gesimuleerde roosters de glueballmassa $am$ en de snaarspanning $a^2\sigma$ binnen de foutmarge ongelijk aan nul zijn, en of de dimensieloze verhouding $m/\sqrt\sigma$ weinig verandert als het rooster fijner wordt ("schaling"), zoals verwacht als de continuümtheorie een kloof $m = c\cdot\Lambda$ heeft. Of en hoe goed dit gelukt is, staat in §7.3; een toets die niet slaagt wordt daar als zodanig gemeld. Uitkomst: de schaaltoets is in $D=3$ gehaald binnen 1 à 2 % en in $D=4$ niet gehaald.

### 7.2 Wat de simulaties níet aantonen

- **Geen bewijs.** Elk getal heeft een statistische fout en geldt voor één eindig rooster bij één eindige $\beta$.
- **Geen continuümlimiet.** Wij rekenen bij enkele waarden van $a$; de uitspraak van het probleem gaat over $a\to0$. Extrapolatie is een aanname, geen stelling.
- **Geen oneindig volume.** Er zijn drie volumevergelijkingen, elk met maar twee doosgroottes: bij $\beta=6$ in $D=3$, en bij $\beta=2{,}4$ en $\beta=2{,}5$ in $D=4$ (de laatste uit ronde 3, §7.3). Bij $\beta=2{,}3$ is er geen. Op het kleine rooster bij $\beta=2{,}5$ is een dooseffect gevonden (een torelonpaar vlak boven de glueball). Effecten van de eindige doos zijn dus maar beperkt gecontroleerd, en een extrapolatie naar oneindig volume is er niet.
- **Geen uitsluiting van lichtere toestanden** die zwak aan onze operatoren koppelen (§5.3).
- **Alleen SU(2).** Het probleem vraagt om alle compacte enkelvoudige groepen.
- **Niets over de axioma's** (bestaan van de theorie in de zin van §3).

### 7.3 Resultaten

De volledige uitkomsten, alle controles en alle spanningen staan in `REPORT.md`; de volledige tabellen in `results/summary.md` en `results/independent/COMPARISON.md`. Notatie: 1.1959(77) betekent 1,1959 ± 0,0077; de fouten zijn alleen statistisch. Alle massa's zijn variationele bovengrens-schattingen. "R5" is de vooraf vastgelegde plateauregel (waarvan de opgegeven fout te klein is, zie `README.md`); "t = 1" en "t = 2" zijn de effectieve massa's bij vaste tijd, zonder keuze achteraf.

| ensemble | D | β | rooster | a·m R5 [t\*] | a·m, t = 1 | a·m, t = 2 | a√σ, t = 1 | m/√σ R5 | m/√σ, t = 1 |
|---|---|---|---|---|---|---|---|---|---|
| d3_b6.0_L16 | 3 | 6 | 16³ | 1.1959(77) [1] | 1.1959(77) | 1.2035(259) | 0.25257(44) | 4.710(37) | 4.735(31) |
| d3_b6.0_L24 | 3 | 6 | 24³ | 1.1926(139) [1] | 1.1926(139) | 1.1819(449) | 0.2547(16) | geen meting | 4.682(61) |
| d3_b9.0_L24 (ronde 1) | 3 | 9 | 24³ | 0.8041(123) [2] | 0.7834(56) | 0.8041(123) | 0.16130(35) | 5.003(78) | 4.857(36) |
| d3_b9.0_L24r (herhaling) | 3 | 9 | 24³ | 0.7584(99) [2] | 0.7695(47) | 0.7584(99) | 0.16120(30) | 4.727(64) | 4.774(30) |
| d3_b9.0_L24_combined | 3 | 9 | 24³ | 0.7754(36) [1] | 0.7754(36) | 0.7773(77) | 0.16124(23) | 4.829(25) | 4.809(23) |
| d3_b12.0_L32 | 3 | 12 | 32³ | 0.5693(49) [1] | 0.5693(49) | 0.5696(83) | 0.11892(34) | 4.788(42) | 4.788(42) |
| d4_b2.3_L10 | 4 | 2,3 | 12×10³ | 1.1951(223) [1] | 1.1951(223) | 1.1492(704) | 0.3687(19) | 3.325(82) | 3.242(61) |
| d4_b2.4_L12 | 4 | 2,4 | 16×12³ | 0.9926(148) [1] | 0.9926(148) | 0.9809(404) | 0.26189(92) | 3.790(58) | 3.790(58) |
| d4_b2.4_L16 | 4 | 2,4 | 16⁴ | 0.9863(309) [1] | 0.9863(309) | 1.0215(850) | 0.2653(26) | 3.718(125) | 3.718(125) |
| d4_b2.5_L16 (ronde 1) | 4 | 2,5 | 16⁴ | 0.7420(216) [1] | 0.7420(216) | 0.7667(494) | 0.1873(15) | 3.962(112) | 3.962(112) |
| d4_b2.5_L16x (extra) | 4 | 2,5 | 16⁴ | 0.7713(260) [1] | 0.7713(260) | 0.7457(584) | 0.1864(16) | 4.256(135) | 4.139(129) |
| d4_b2.5_L16_combined | 4 | 2,5 | 16⁴ | 0.7531(170) [1] | 0.7531(170) | 0.7463(371) | 0.1866(11) | 4.036(87) | 4.036(87) |
| d4_b2.5_L20 (ronde 3) | 4 | 2,5 | 20⁴ | 0.7263(125) [1] | 0.7263(125) | 0.7186(263) | 0.1880(10) | 3.896(78) | 3.864(70) |

Herkomst: `results/<ensemble>.json` (uitvoer van `analyze.py`); de verhoudingen bij vaste t uit `results/independent/<ensemble>.json`. De regels "_combined" bevatten dezelfde data als de twee regels erboven. Bij $\beta=9$ is de herhaling het primaire getal: de R5-waarde van ronde 1 en de gecombineerde waarde bij t = 2 zijn door selectie naar boven vertekend (`REPORT.md` §4.4).

Ronde 3 (d4_b2.5_L20) is een volumecontrole op $20^4$ bij $\beta=2{,}5$; doel, voorspellingen en criterium zijn vooraf vastgelegd in `run_round3_production.sh`. Uitkomst: $am$ = 0.7263(125) bij t = 1, tegen 0.6024(136) als de kloof een zuiver dooseffect was ($m\propto1/L$) en 0.7531(170) op $16^4$. Volgens het vooraf vastgelegde criterium is de dooseffect-lezing daarmee bij $\beta=2{,}5$ uitgesloten (6,7σ); de waarde op $16^4$ ligt 1,3σ hoger en is niet als door het volume vertekend aangemerkt (`REPORT.md` §4.5).

**Wat geslaagd is.** De code reproduceert de exacte tweedimensionale formules van §5.6 en doorstaat de onafhankelijke controles (`REPORT.md` §2 en §4). In $D=3$ verandert $m/\sqrt\sigma$ bij vaste t = 1 maar 1,1 tot 1,5 % terwijl de roosterafstand een factor 2,1 verandert (met bij $\beta=9$ de herhaling of beide runs samen; met alleen ronde 1 is het 2,6 %), en $am$ verandert niet meetbaar (verschil 0.0033(159)) als het rooster bij $\beta=6$ van $16^3$ naar $24^3$ gaat.

**Wat niet geslaagd is.** (i) De vooraf vastgelegde waarde in $D=3$ bij $\beta=9$, 0.8041(123), kwam bij herhaling met nieuwe seeds niet terug (0.7584(99), een verschil van 2,9σ); de plateauregel had een toevalsfluctuatie gekozen. (ii) In $D=4$ is de schaaltoets van §7.1 punt 3 niet gehaald: $m/\sqrt\sigma$ loopt op van 3.325(82) naar 4.036(87) (5,9σ), terwijl $am\cdot L$ over de drie vooraf vastgelegde roosters constant is (11.951(223), 11.912(177), 11.871(345)). Dat laatste is het patroon van een kloof die alleen door de eindige doos ontstaat. Die lezing is wel met grotere roosters uitgesloten, bij $\beta=2{,}4$ (7,4σ) en bij $\beta=2{,}5$ (6,7σ, ronde 3), maar de stijging van $m/\sqrt\sigma$ blijft: op het grootste rooster per $\beta$ is de verhouding bij t = 1 gelijk aan 3.242(61), 3.718(125), 3.864(70). (iii) Punt 2 van §7.1 is voor $D=4$ maar ten dele gehaald: de glueballmassa ligt bij $\beta=2{,}4$ 2,1σ en bij $\beta=2{,}5$ 1,0 tot 3,9σ op $16^4$ en 0,2 tot 3,2σ op $20^4$ (afhankelijk van de referentie) boven literatuurwaarden, en de snaarspanning bij $\beta=2{,}4$ op het rooster $16\times12^3$ ligt 3,1σ onder de literatuurwaarde. Die literatuurwaarden zijn alleen in zoekfragmenten gezien.

**Conclusie.** Op elk gesimuleerd rooster is de kloof ongelijk aan nul, maar dat is op een eindig rooster vanzelfsprekend (§5.5). Als numeriek bewijsmateriaal voor een massakloof telt alleen de stabiliteit onder verfijning en vergroting van het rooster: die is er binnen 1 à 2 % in $D=3$. In $D=4$ is alleen het tweede aangetoond, bij $\beta=2{,}4$ en $\beta=2{,}5$: de kloof krimpt niet mee met de doos. Stabiliteit onder verfijning is in $D=4$ niet aangetoond, en een continuümwaarde voor $D=4$ geven wij niet. Niets hiervan is een bewijs. (De kanttekening over recente berichten in §1 is geschreven vóór de berichten van 9 tot 11 november 2026; zie `REPORT.md` §5.2.)

---

## 8. Waarom een AI of een simulatie het bewijs niet "even" kan leveren

**Een simulatie.** Het millenniumprobleem is een uitspraak over oneindig veel schalen tegelijk (alle $a\to0$, alle volumes). Een simulatie levert eindig veel getallen met statistische onzekerheid. Uit eindig veel benaderende getallen volgt logisch niets over een limiet, tenzij je vooraf *bewezen* foutgrenzen hebt — en die ontbreken hier juist (§5.5). Computerondersteunde bewijzen bestaan wel (vierkleurenstelling, vermoeden van Kepler), maar daar is het probleem eerst door een wiskundig argument teruggebracht tot een eindige, exact controleerbare berekening. Zo'n reductie is voor Yang–Mills niet bekend. Monte-Carlo-resultaten zijn bovendien kansuitspraken, geen zekerheden.

**Een AI-systeem.** Een taalmodel kan tekst produceren die eruitziet als een bewijs. Of zo'n tekst een bewijs *is*, hangt niet af van hoe overtuigend hij klinkt, maar van de vraag of elke stap klopt — en dat moet worden gecontroleerd door deskundigen of door een formeel bewijscontroleprogramma, waarbij ook nog moet worden nagegaan dat de geformaliseerde uitspraak werkelijk het bedoelde probleem is. De obstakels van §4 zijn inhoudelijk: volgens de experts zijn nieuwe wiskundige ideeën nodig. In deze sessie zijn zulke ideeën niet gevonden, en doen alsof zou oneerlijk zijn. De geschiedenis kent bovendien claims die de toetsing niet doorstonden (bijvoorbeeld een in 2007 als preprint verschenen claim van opsluiting voor alle koppelingen in SU(2)-roostertheorie, waar vakgenoten een lacune in aanwezen — uit het geheugen geciteerd). De in §1 genoemde berichten over een door AI geproduceerd bestaansbewijs illustreren hetzelfde punt: volgens die berichten bestaat er weliswaar een formalisering in een bewijscontroleprogramma, maar zijn bewijs en formalisering niet openbaar, moet het werk nog door vakgenoten worden gecontroleerd (inclusief de vraag of de geformaliseerde uitspraak werkelijk het bedoelde probleem is), en betreft het niet de massakloof.

**Hoe een echte oplossing eruit zou zien.**

1. Een constructie van de continuümtheorie in oneindig volume voor ijkinvariante grootheden, voor **elke** compacte enkelvoudige groep.
2. Een bewijs van de Osterwalder–Schrader- of Wightman-axioma's voor die constructie, inclusief niet-trivialiteit.
3. Een bewijs dat $\mathrm{Spec}(H)\subset\lbrace0\rbrace\cup[\Delta,\infty)$ met $\Delta\gt0$.
4. **Toetsing volgens de regels van het Clay-instituut** (herzien op 26 september 2018): publicatie in een gerefereerd wiskundig tijdschrift van wereldfaam, daarna **minstens twee jaar** waarin het bewijs de toetsing door de internationale wiskundige gemeenschap doorstaat, en algemene aanvaarding; pas dan neemt het instituut een beslissing.

Dit document en deze repository zijn geen van deze vier dingen.

---

## 9. Referenties

Legenda: ✔ = bibliografische gegevens (en waar vermeld de inhoud) op 11 november 2026 via een zoekmachine teruggevonden; de volledige tekst kon niet worden geopend omdat rechtstreekse toegang tot arxiv.org, claymath.org, openai.com en andere sites in deze sessie geblokkeerd was. ○ = uit het geheugen geciteerd; jaartal, band of paginanummer kan een fout bevatten. Dit document en `literature.json` zijn op dezelfde dag een tweede keer onafhankelijk nagelopen (formules opnieuw afgeleid, verwijzingen en getallen opnieuw opgezocht); ook die controle had alleen zoekresultaten tot haar beschikking.

**Recente berichtgeving bij de kanttekening in §1 (alleen als zoekresultaat gezien; geen van deze pagina's kon worden geopend, publicatiedata niet gecontroleerd)**

- ✔ *Scientific American*, "OpenAI just scooped human researchers on a million-dollar quantum math problem" (2026).
- ✔ *Science* (nieuwsredactie), "AI cracks a 27-year-old pillar of computer science, OpenAI and Anthropic claim" (2026); het uittreksel noemt ook de Yang–Mills-claim en de commissie onder David Gross.
- ✔ P. Woit, weblog *Not Even Wrong*, bericht "Secret Unified Physics Slop" (2026); kritisch commentaar.
- ✔ OpenAI, webpagina "Working with academic communities to build scientific understanding" (2026); alleen titel en uittreksel gezien.
- ✔ Kleinere nieuws- en blogsites met dezelfde strekking: Interesting Engineering, Let's Data Science, cloudmagazin, OfficeChai. Deze zijn geen zelfstandige bevestiging; zij geven de aankondiging van het bedrijf weer.

**Het probleem**

- ✔ A. Jaffe, E. Witten, "Quantum Yang–Mills Theory", officiële probleembeschrijving, Clay Mathematics Institute (2000). De probleemtekst is teruggevonden via Wikipedia en MathWorld, die de officiële tekst citeren. ○ Herdrukt in *The Millennium Prize Problems* (Clay Math. Inst./AMS, 2006), pp. 129–152.
- ✔ Clay Mathematics Institute, regels voor de Millennium Prize Problems, herzien 26 september 2018 (drie voorwaarden: publicatie in een "Qualifying Outlet", twee jaar, algemene aanvaarding).
- ✔ M. R. Douglas, "Report on the Status of the Yang–Mills Millennium Prize Problem". Alleen de titel is teruggevonden (○ jaartal 2004).
- ○ R. F. Streater, A. S. Wightman, *PCT, Spin and Statistics, and All That*, Benjamin (1964).
- ○ K. Osterwalder, R. Schrader, "Axioms for Euclidean Green's functions", Commun. Math. Phys. 31 (1973) 83–112; II: 42 (1975) 281–305.
- ○ C. N. Yang, R. L. Mills, "Conservation of isotopic spin and isotopic gauge invariance", Phys. Rev. 96 (1954) 191–195.

**Asymptotische vrijheid**

- ○ D. J. Gross, F. Wilczek, Phys. Rev. Lett. 30 (1973) 1343; H. D. Politzer, Phys. Rev. Lett. 30 (1973) 1346.
- ○ W. E. Caswell, Phys. Rev. Lett. 33 (1974) 244; D. R. T. Jones, Nucl. Phys. B75 (1974) 531 (twee-lus-coëfficiënt).
- ○ A. Hasenfratz, P. Hasenfratz, Phys. Lett. B93 (1980) 165 (verband tussen $\Lambda_L$ en continuümschema's).
- ○ M. Aizenman, H. Duminil-Copin, "Marginal triviality of the scaling limits of critical 4D Ising and $\phi^4_4$ models", Ann. of Math. 194 (2021) 163–235.

**Roostertheorie, rigoureus**

- ○ K. G. Wilson, "Confinement of quarks", Phys. Rev. D10 (1974) 2445.
- ✔ K. Osterwalder, E. Seiler, "Gauge field theories on a lattice", Ann. Phys. 110 (1978) 440–471.
- ○ M. Lüscher, "Construction of a selfadjoint, strictly positive transfer matrix for Euclidean lattice gauge theories", Commun. Math. Phys. 54 (1977) 283.
- ○ E. Seiler, *Gauge Theories as a Problem of Constructive Quantum Field Theory and Statistical Mechanics*, Lecture Notes in Physics 159, Springer (1982).
- ○ A. H. Guth, Phys. Rev. D21 (1980) 2291; J. Fröhlich, T. Spencer, Commun. Math. Phys. 83 (1982) 411.
- ○ M. Göpfert, G. Mack, Commun. Math. Phys. 82 (1982) 545; C. Borgs, E. Seiler, Commun. Math. Phys. 91 (1983) 329.
- ✔ H. Shen, R. Zhu, X. Zhu, "A stochastic analysis approach to lattice Yang–Mills at strong coupling", Commun. Math. Phys. 400 (2023) 805–851.
- ✔ A. Adhikari, S. Cao, "Correlation decay for finite lattice gauge theories at weak coupling", Ann. Probab. 53 (2025) 140–174.
- ✔ S. Chatterjee, "A probabilistic mechanism for quark confinement", Commun. Math. Phys. 385 (2021) 1007–1039.
- ✔ S. Chatterjee, "Yang–Mills for probabilists", in *Probability and Analysis in Interacting Physical Systems*, Springer (2019), pp. 1–16.
- ○ S. Chatterjee, "Rigorous solution of strongly coupled SO(N) lattice gauge theory in the large N limit", Commun. Math. Phys. 366 (2019) 203–268.
- ○ G. Münster, Nucl. Phys. B180 (1981) 23 en Nucl. Phys. B190 (1981) 439 (sterke-koppelingsreeksen voor snaarspanning en massakloof).
- ○ E. T. Tomboulis, arXiv:0707.2179 (2007); kritiek: K. R. Ito, E. Seiler, arXiv:0711.4930.

**Continuümlimiet in 3 en 4 dimensies**

- ✔ T. Bałaban, "Ultraviolet stability of three-dimensional lattice pure gauge field theories", Commun. Math. Phys. 102 (1985) 255–275.
- ✔ T. Bałaban, "Renormalization group approach to lattice gauge field theories I. Generation of effective actions in a small field approximation and a coupling constant renormalization in four dimensions", Commun. Math. Phys. 109 (1987) 249–301.
- ✔ T. Bałaban, "Large field renormalization II. Localization, exponentiation, and bounds for the R operation", Commun. Math. Phys. 122 (1989) 355–392 (deel I: 122 (1989) 175–202).
- ✔ J. Magnen, V. Rivasseau, R. Sénéor, "Construction of $\mathrm{YM}_4$ with an infrared cutoff", Commun. Math. Phys. 155 (1993) 325–383.
- ○ D. Brydges, J. Fröhlich, E. Seiler, "On the construction of quantized gauge fields" I: Ann. Phys. 121 (1979) 227; II: Commun. Math. Phys. 71 (1980) 159; III: 79 (1981) 353.

**Twee dimensies**

- ○ A. A. Migdal, "Recursion equations in gauge field theories", Sov. Phys. JETP 42 (1975) 413.
- ○ E. Witten, "On quantum gauge theories in two dimensions", Commun. Math. Phys. 141 (1991) 153–209.
- ✔ L. Gross, C. King, A. Sengupta, "Two-dimensional Yang–Mills theory via stochastic differential equations", Ann. Phys. 194 (1989) 65–112.
- ✔ B. K. Driver, "$\mathrm{YM}_2$: continuum expectations, lattice convergence, and lassos", Commun. Math. Phys. 123 (1989) 575–616.
- ○ A. Sengupta, "Gauge theory on compact surfaces", Mem. Amer. Math. Soc. 126 (1997), no. 600.
- ✔ T. Lévy, "Yang–Mills measure on compact surfaces", arXiv:math/0101239 (○ Mem. Amer. Math. Soc. 163 (2003), no. 790); ✔ "Two-dimensional Markovian holonomy fields", Astérisque 329 (2010).

**Stochastische kwantisatie**

- ✔ A. Chandra, I. Chevyrev, M. Hairer, H. Shen, "Langevin dynamic for the 2D Yang–Mills measure", Publ. Math. IHÉS 136 (2022) 1–147.
- ✔ A. Chandra, I. Chevyrev, M. Hairer, H. Shen, "Stochastic quantisation of Yang–Mills–Higgs in 3D", Invent. Math. 237 (2024) 541–696.
- ○ I. Chevyrev, H. Shen, "Invariant measure and universality of the 2D Yang–Mills Langevin dynamic", arXiv:2302.12160.

**Numerieke literatuur (zie `literature.json` voor de getallen en hun verificatiestatus)**

- ✔ M. Teper, "SU(N) gauge theories in 2+1 dimensions", Phys. Rev. D59 (1999) 014512, arXiv:hep-lat/9804008.
- ✔ M. Teper, "Glueball masses and other physical properties of SU(N) gauge theories in D=3+1: a review of lattice results for theorists", arXiv:hep-th/9812187.
- ✔ C. Michael, M. Teper, "Towards the continuum limit of SU(2) lattice gauge theory" (1987; titel en jaartal teruggevonden, ○ vindplaats Phys. Lett. B199 (1987) 95).
- ✔ B. Lucini, M. Teper, U. Wenger, "Glueballs and k-strings in SU(N) gauge theories: calculations with improved operators", JHEP 06 (2004) 012, arXiv:hep-lat/0404008.
- ✔ B. Lucini, M. Teper, U. Wenger, "The high temperature phase transition in SU(N) gauge theories", JHEP 01 (2004) 061, arXiv:hep-lat/0307017.
- ✔ A. Athenodorou, M. Teper, "SU(N) gauge theories in 2+1 dimensions: glueball spectra and k-string tensions", JHEP 02 (2017) 015, arXiv:1609.03873; "SU(N) gauge theories in 3+1 dimensions: glueball spectrum, string tensions and topology", JHEP 12 (2021) 082, arXiv:2106.00364.
- ✔ J. Fingberg, U. Heller, F. Karsch, "Scaling and asymptotic scaling in the SU(2) gauge theory", Nucl. Phys. B392 (1993) 493–517, arXiv:hep-lat/9208012.
- ✔ B. A. Berg, D. A. Clarke, "Deconfinement, gradient and cooling scales for pure SU(2) lattice gauge theory", Phys. Rev. D95 (2017) 094508, arXiv:1612.07347.
- ✔ A. Velytsky, "Finite temperature SU(2) gauge theory: critical coupling and universality class", arXiv:0711.0748 (○ Int. J. Mod. Phys. C19 (2008) 1079).
- ✔ G. S. Bali, K. Schilling, C. Schlichter, "Observing long colour flux tubes in SU(2) lattice gauge theory", arXiv:hep-lat/9409005 (○ Phys. Rev. D51 (1995) 5165).
- ✔ R. Lau, M. Teper, arXiv:1701.06941 (over SO(N)-ijktheorieën in 2+1 dimensies; alleen gebruikt als bron waarin de SU(2)-waarde van Athenodorou en Teper wordt aangehaald; ○ auteursnamen).
- ✔ B. Lucini, M. Teper, "SU(N) gauge theories in 2+1 dimensions – further results", arXiv:hep-lat/0206027 (○ Phys. Rev. D66 (2002) 097502); bron van de alternatieve continuümwaarde $m(0^{++})/\sqrt\sigma = 4{,}716(21)$ voor SU(2) in $D=3$.
- ✔ arXiv:hep-lat/9501036 ("Landau Ginzberg model and deconfinement transition for extended SU(2) action") en arXiv:1807.05295 ("Non-abelian lattice gauge theory with a topological action"): alleen gebruikt als bronnen waarin de kritieke koppelingen $\beta_c = 2{,}2986(6)$, $2{,}4265(30)$ en $2{,}5115(40)$ voor $N_t = 4, 6, 8$ worden aangehaald (de eerste schrijft ze toe aan Fingberg, Heller en Karsch).
- ✔ N. Yamanaka, H. Iida, A. Nakamura, M. Wakayama, "Interglueball potential in SU($N_c$) lattice gauge theory", PoS(LATTICE2019)013, arXiv:1911.03048; bron van de alternatieve waarde $am(0^{++}) = 0{,}6857(28)$ bij $\beta=2{,}5$ op $16^3\times24$ (alleen in een zoekresultaat gezien).
- ✔ J. D. Stack, R. Filipczyk, "Abelian Links, Monopoles and Glueballs in SU(2) Lattice Gauge Theory", arXiv:hep-lat/9809019; bron van de alternatieve waarde $am(0^{++}) = 0{,}72(3)$ bij $\beta=2{,}5$ (één keer in een zoekresultaat gezien).
- ✔ arXiv:hep-lat/9403027 ("The Spatial String Tension in High Temperature Lattice Gauge Theories"; auteurs niet in het zoekresultaat gezien): alleen gebruikt als bron waarin $T_c/\sqrt\sigma = 1{,}121(8)$ voor SU(2) in 2+1 dimensies wordt aangehaald.
- ○ M. Creutz, "Monte Carlo study of quantized SU(2) gauge theory", Phys. Rev. D21 (1980) 2308.
- ○ M. Lüscher, K. Symanzik, P. Weisz, Nucl. Phys. B173 (1980) 365; M. Lüscher, Nucl. Phys. B180 (1981) 317 (snaarcorrectie).

---

## Bijlage: door ons uitgevoerde controles van de formules in dit document

Alle onderstaande controles zijn op 11 november 2026 met een los Python-script uitgevoerd (exacte breuken met `fractions.Fraction`, numeriek met `scipy`); het zijn controles van algebra en rekenwerk, geen bewijzen van natuurkundige uitspraken. Een ingekorte versie van dat script staat onder de tabel, zodat iedereen de kern zelf kan narekenen.

| Bewering | Controle | Uitkomst |
|---|---|---|
| $b_0 = 11/(24\pi^2)$, $b_1 = 17/(96\pi^4)$ voor $N=2$ | exacte breuken | klopt |
| $b_1/(2b_0^2) = 51/121$ | exacte breuken | klopt |
| $b_0g^2 = 11/(6\pi^2\beta)$ en $1/(2b_0g^2) = 3\pi^2\beta/11$ | exacte breuken | klopt |
| roostervorm van $a\Lambda_L$ gelijk aan algemene formule | numeriek, $\beta = 2{,}2$ t/m $2{,}6$ | relatieve afwijking kleiner dan $10^{-12}$ |
| roostervorm gelijk aan `ym/exact.py::a_lambda_two_loop` | numeriek | identiek |
| $\Lambda$ onafhankelijk van $\mu$ (twee-lus-stroming) | numerieke integratie over 40 e-machten, start bij $g^2 = 4/2{,}2$ | exacte invariant constant tot $10^{-10}$; de genoemde formule verschuift 2,6 procent, precies de voorspelde factor $(1+b_1g^2/b_0)^{b_1/(2b_0^2)}$ |
| $x^{-n}e^{-1/(2b_0x)}\to0$ voor $x\downarrow0$ | numeriek voor $n=5$ en $n=20$ | klopt |
| $Z_1 = 2I_1(\beta)/\beta$ en $\langle\tfrac12\mathrm{Tr}U\rangle = I_2/I_1$ | numerieke integratie over de Haar-maat | klopt tot $10^{-10}$ |
| $u' = 1 - u^2 - 3u/\beta$ | numerieke afgeleide | klopt tot $10^{-8}$ |
| karaktercoëfficiënten $2(2j+1)I_{2j+1}(\beta)/\beta$ | numerieke integratie, $j = 0$ t/m $\tfrac32$ | klopt |
| $-\beta\ln u(\beta)\to\tfrac32$, dus $\sigma = \tfrac38g^2$ in 2D | numeriek bij $\beta = 50$ en $200$ | 1,515 en 1,504 |

Ingekort controlescript (draait in enkele seconden met `python3`; drukt "alle controles geslaagd" af):

```python
from fractions import Fraction as Fr
import numpy as np
from scipy.special import iv
from scipy.integrate import quad

# 1. beta-functie-coefficienten voor SU(2) als exacte breuken (machten van pi afgesplitst)
N = 2
b0 = Fr(11 * N, 48)                # b0 * pi^2
b1 = Fr(34, 3) * N**2 / 256        # b1 * pi^4
assert b0 == Fr(11, 24) and b1 == Fr(17, 96)
assert b1 / (2 * b0**2) == Fr(51, 121)
assert 4 * b0 == Fr(11, 6)         # b0 g^2 = 11/(6 pi^2 beta)  met g^2 = 4/beta
assert 1 / (8 * b0) == Fr(3, 11)   # 1/(2 b0 g^2) = 3 pi^2 beta/11

# 2. roostervorm van a*Lambda_L = algemene twee-lus-formule
B0, B1 = float(b0) / np.pi**2, float(b1) / np.pi**4
for beta in (2.2, 2.3, 2.4, 2.5, 2.6):
    g2 = 4 / beta
    general = (B0 * g2) ** (-B1 / (2 * B0**2)) * np.exp(-1 / (2 * B0 * g2))
    lattice = (6 * np.pi**2 * beta / 11) ** (51 / 121) * np.exp(-3 * np.pi**2 * beta / 11)
    assert abs(general / lattice - 1) < 1e-12

# 3. een-plaquette-integraal over de Haar-maat van SU(2), en de afgeleide van u
u = lambda b: iv(2, b) / iv(1, b)
haar = lambda f: quad(lambda t: 2 / np.pi * np.sin(t)**2 * f(t), 0, np.pi)[0]
for b in (0.5, 1.0, 2.5, 6.0):
    Z1 = haar(lambda t: np.exp(b * np.cos(t)))
    P = haar(lambda t: np.cos(t) * np.exp(b * np.cos(t))) / Z1
    assert abs(Z1 - 2 * iv(1, b) / b) < 1e-8 and abs(P - u(b)) < 1e-8
    h = 1e-5
    assert abs((u(b + h) - u(b - h)) / (2 * h) - (1 - u(b)**2 - 3 * u(b) / b)) < 1e-7
print("alle controles geslaagd")
```
