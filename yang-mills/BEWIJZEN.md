# Yang–Mills en de massakloof: drie stellingen met volledig bewijs

**Wat dit document is.** Drie stellingen over de roosterversie van de Yang–Mills-theorie met ijkgroep SU(2), elk met een volledig uitgeschreven wiskundig bewijs. Samen laten ze zien wat er over de massakloof werkelijk te bewijzen valt.

**Wat dit document niet is.** Het is **geen bewijs van het millenniumprobleem** "Yang–Mills: bestaan en massakloof". Dat probleem is open. Hoofdstuk 5 zegt precies welke stap ontbreekt en waarom de methoden van dit document daar ophouden. Wie beweert dat de stellingen hieronder het millenniumprobleem oplossen, leest ze verkeerd.

**Niet nieuw.** De drie stellingen zijn bekende resultaten uit de jaren zeventig en tachtig (hoofdstuk 7). Wat dit document toevoegt, is dat de bewijzen in één notatie stap voor stap zijn uitgeschreven, met alleen de standaardresultaten uit de bijlage als voorkennis, en dat de stappen ook numeriek zijn nagerekend (hoofdstuk 6).

**Wie het heeft nagekeken.** De bewijzen zijn geschreven door een AI-systeem. Geen wiskundige heeft dit document beoordeeld. Hoofdstuk 6 zegt welke controles zijn gedaan en welke niet.

---

## 0. Samenvatting

### In gewone taal

De Yang–Mills-theorie beschrijft de sterke kernkracht. Het millenniumprobleem vraagt twee dingen: (1) een wiskundig sluitende definitie van die theorie in de gewone ruimte en tijd, zonder hulpmiddelen als een rooster, en (2) een bewijs dat het lichtste deeltje in die theorie een massa groter dan nul heeft. Dat tweede heet de **massakloof**: tussen de lege ruimte (het vacuüm) en de eerstvolgende toestand zit een eindige sprong in energie.

Op een **rooster** wordt ruimte en tijd in hokjes verdeeld, met afstand $a$ tussen naburige punten. Daar is de theorie wél sluitend gedefinieerd. Het echte probleem zit in de limiet $a \to 0$. Dit document bewijst wat er op het rooster te bewijzen valt:

- **Stelling A.** Op elk eindig rooster, bij elke sterkte van de koppeling, is er precies één toestand van laagste energie en ligt de eerstvolgende toestand een eindig stuk hoger. De kloof is dus groter dan nul. De stelling zegt niets over hoe groot de kloof blijft als het rooster groeit of fijner wordt.
- **Stelling B.** In twee dimensies (één ruimte- en één tijdrichting) is alles exact uit te rekenen: alle energieniveaus, de kloof, en de limiet $a \to 0$. Die limiet bestaat en heeft een kloof. Twee dimensies is wel een veel eenvoudiger wereld dan de onze.
- **Stelling C.** Bij sterke koppeling (kleine $\beta$) is de kloof in elke dimensie, ook in drie en vier, groter dan een expliciet getal dat **niet** afhangt van de grootte van het rooster. De kloof verdwijnt daar dus niet als het volume naar oneindig gaat.

Wat ontbreekt: de limiet $a \to 0$ in vier dimensies ligt bij $\beta \to \infty$. Stelling C werkt in vier dimensies alleen voor $\beta \lt 0{,}0556$. De simulaties in het rapport (`REPORT.md`) liggen bij $\beta$ tussen 2,2 en 2,5. Tussen "bewezen" en "nodig" zit dus het hele gebied waar het om gaat.

### Overzicht

| | geldt voor | uitspraak | wat het niet zegt |
|---|---|---|---|
| **Stelling A** | elke dimensie $D \geq 2$, elke $\beta \gt 0$, elk eindig rooster | positieve overdrachtsmatrix, uniek vacuüm, kloof $m \gt 0$ | geen ondergrens die standhoudt als het volume groeit |
| **Stelling B** | $D = 2$, elke $\beta \gt 0$, elke omtrek | exact spectrum; kloof $m = L \ln\big(I_1(\beta)/I_2(\beta)\big)$; continuümlimiet met kloof $\tfrac38 g^2 \ell$ | niets over $D = 3$ of $D = 4$ |
| **Stelling C** | elke $D \geq 2$, $\beta \lt \beta_0(D)$, elk volume | kloof $m \geq \ln\big(1/(6(D-1)\tanh\beta)\big)$, uniform in het volume; limiet van oneindig volume bestaat | niets voor $\beta \geq \beta_0(D)$, dus niets over de continuümlimiet |
| **Millenniumprobleem** | $D = 4$, continuüm ($\beta \to \infty$), oneindig volume | bestaan én kloof | **niet bewezen**, hier noch elders |

De grenswaarden zijn $\beta_0(2) = 0{,}1682$, $\beta_0(3) = 0{,}0835$ en $\beta_0(4) = 0{,}0556$.

---

## 1. Opzet en notatie

### 1.1 De groep

$G = \mathrm{SU}(2)$ is de groep van complexe $2\times2$-matrices $u$ met $u^\dagger u = 1$ en $\det u = 1$. Elke $u \in G$ heeft de vorm

```math
u = \begin{pmatrix} a & b \\ -\bar b & \bar a \end{pmatrix}, \qquad \lvert a\rvert^2 + \lvert b\rvert^2 = 1 .
```

Daaruit volgt wat we steeds gebruiken:

- **(G1)** $\operatorname{Tr} u = 2\ \mathrm{Re}\ a$ is reëel en ligt in $[-2, 2]$; verder is $\operatorname{Tr} u^{-1} = \operatorname{Tr} u^\dagger = \operatorname{Tr} u$ en $\operatorname{Tr}(g u g^{-1}) = \operatorname{Tr} u$.
- **(G2)** De complex geconjugeerde van een matrixelement van $u$ is op een teken na weer een matrixelement van $u$: $\overline{u_{11}} = u_{22}$ en $\overline{u_{12}} = -u_{21}$.
- **(G3)** Er is precies één kansmaat $dg$ op $G$, de **Haar-maat**, met $\int f(hg)\ dg = \int f(gh)\ dg = \int f(g)\ dg$ voor alle $h \in G$; voor die maat geldt ook $\int f(g^{-1})\ dg = \int f(g)\ dg$ (bijlage, S1).

### 1.2 Het rooster

Zij $D \geq 2$ en $\Lambda = \prod_{\mu=1}^{D} \mathbb{Z}/L_\mu$ een periodiek rooster met alle afmetingen $L_\mu \geq 3$. Een **link** (verbinding) is een paar $(x, \mu)$: de verbinding van het punt $x$ naar het buurpunt $x + \hat\mu$. De verzameling van alle links heet $\mathcal{L}$. Een **configuratie** kent aan elke link een groepselement $U_{x,\mu} \in G$ toe; de ruimte van configuraties is $G^{\mathcal{L}}$, met de productmaat $dU = \prod_{\ell \in \mathcal{L}} dU_\ell$ van Haar-maten.

Een **plaquette** is een elementair vierkant $p = (x; \mu, \nu)$ met $\mu \lt \nu$. De bijbehorende plaquettevariabele is

```math
U_p = U_{x,\mu}\, U_{x+\hat\mu,\nu}\, U_{x+\hat\nu,\mu}^{-1}\, U_{x,\nu}^{-1} .
```

De plaquette $p$ **bevat** de vier links $(x,\mu)$, $(x+\hat\mu,\nu)$, $(x+\hat\nu,\mu)$ en $(x,\nu)$. Omdat alle $L_\mu \geq 3$ zijn die vier verschillend, en geldt:

- **(R1)** Elke link $(x,\mu)$ ligt in precies $2(D-1)$ plaquettes: voor elke richting $\nu \neq \mu$ de twee plaquettes in het $(\mu,\nu)$-vlak aan weerszijden van de link.
- **(R2)** Voor twee links $\ell \neq k$ schrijven we $n_{\ell k}$ voor het aantal plaquettes dat beide bevat. Uit (R1) volgt $\sum_{k \neq \ell} n_{\ell k} = 3 \cdot 2(D-1) = 6(D-1)$: elke plaquette door $\ell$ bevat drie andere links.

Twee links heten **buren** als $n_{\ell k} \geq 1$. De **linkafstand** $d(k, \ell)$ is het kleinste aantal stappen van buur naar buur waarmee je van $k$ naar $\ell$ komt (oneindig als dat niet kan), en $d(k, B) = \min_{\ell \in B} d(k,\ell)$ voor een verzameling links $B$.

### 1.3 De maat

Voor $\beta \geq 0$ is het **gewicht** van een configuratie

```math
w(U) = \exp\Big( \frac{\beta}{2} \sum_{p} \operatorname{Tr} U_p \Big), \qquad Z = \int w(U)\, dU, \qquad \mu(f) = \frac{1}{Z} \int f(U)\, w(U)\, dU .
```

De som loopt over alle plaquettes. De Wilson-actie uit het rapport is $S = \beta \sum_p \big(1 - \tfrac12 \operatorname{Tr} U_p\big)$; dan is $e^{-S} = e^{-\beta \lvert\mathcal{P}\rvert}\  w$ met $\lvert\mathcal{P}\rvert$ het aantal plaquettes. De constante factor valt weg in $\mu$, dus $\mu$ is precies de kansmaat van de simulaties.

Omdat $w$ continu en strikt positief is op de compacte ruimte $G^{\mathcal{L}}$, is $0 \lt Z \lt \infty$ en is $\mu$ een goed gedefinieerde kansmaat, voor elk eindig rooster en elke $\beta$. **Het bestaan van de theorie op een eindig rooster is dus geen probleem**; alle moeilijkheden zitten in de limieten.

### 1.4 Koppeling en roosterafstand

In $D$ dimensies hangt $\beta$ samen met de koppeling $g$ en de roosterafstand $a$ via $\beta = 4/(g^2 a^{4-D})$. In $D = 4$ is $\beta = 4/g^2$, en de limiet $a \to 0$ komt overeen met $\beta \to \infty$ (`THEORY.md`, §4 en §5).

---

## 2. Stelling A: op een eindig rooster is er een uniek vacuüm en een kloof

### 2.1 Tijdlagen en ijktransformaties

Kies één richting als tijd: $\Lambda = \Lambda_s \times \mathbb{Z}/N$ met $\Lambda_s = \prod_{i=1}^{D-1} \mathbb{Z}/L_i$ het ruimtelijke rooster en $N \geq 3$ het aantal tijdlagen. Zij $E$ de verzameling ruimtelijke links $(x, i)$ van $\Lambda_s$. Een configuratie op $\Lambda$ bestaat dan uit

- voor elke tijd $t \in \mathbb{Z}/N$ een **ruimtelijke configuratie** $u^t \in \mathcal{C} := G^E$ (de links binnen tijdlaag $t$), en
- voor elke $t$ en elk ruimtelijk punt $x$ een **tijdlink** $v^t_x \in G$ van $(x, t)$ naar $(x, t+1)$.

De Hilbertruimte is $\mathcal{H} = L^2(\mathcal{C}, du)$ met inproduct $\langle f_1, f_2 \rangle = \int \overline{f_1(u)}\  f_2(u)\  du$.

Een **ijktransformatie** is een keuze $g = (g_x)_{x \in \Lambda_s} \in G^{\Lambda_s}$; zij werkt op $u \in \mathcal{C}$ door

```math
(u^g)_{(x,i)} = g_x\, u_{(x,i)}\, g_{x+\hat\imath}^{-1} .
```

Er geldt $(u^g)^h = u^{hg}$, en de maat $du$ verandert niet onder $u \mapsto u^g$ (wegens (G3), link voor link). De integraal $\int dg$ staat voor de Haar-maat op $G^{\Lambda_s}$.

### 2.2 De bouwstenen

Definieer voor $u, u' \in \mathcal{C}$ en $h \in G$:

```math
V(u) = -\frac{\beta}{2} \sum_{p \text{ ruimtelijk}} \operatorname{Tr} u_p, \qquad k(h) = \exp\Big(\frac{\beta}{2} \operatorname{Tr} h\Big), \qquad K(u, u') = \prod_{e \in E} k\big(u_e\, (u'_e)^{-1}\big),
```

en de drie operatoren op $\mathcal{H}$

```math
(\mathsf{M} f)(u) = e^{-V(u)/2} f(u), \qquad (\mathsf{K} f)(u) = \int K(u, u')\, f(u')\, du', \qquad (\mathsf{P} f)(u) = \int f(u^g)\, dg .
```

De **overdrachtsmatrix** is

```math
\mathsf{T} = \mathsf{M}\,\mathsf{K}\,\mathsf{P}\,\mathsf{M} .
```

We schrijven $\mathcal{H}_{\mathrm{inv}} = \mathsf{P}\mathcal{H}$ voor de ruimte van **ijkinvariante** toestanden.

### 2.3 De stelling

> **Stelling A.** Zij $D \geq 2$, $\beta \gt 0$ en $\Lambda_s$ een eindig periodiek ruimtelijk rooster met alle afmetingen minstens 3. Dan geldt:
>
> 1. **(Overdrachtsmatrix.)** $\mathsf{T}$ is een compacte, zelfgeadjungeerde, positief semidefiniete operator op $\mathcal{H}$ met een continue, strikt positieve, symmetrische kern $\mathsf{T}(u,u')$, en voor elke $N \geq 3$ is $Z = \operatorname{Tr} \mathsf{T}^N$.
> 2. **(Spectrum.)** $\mathsf{T} = \mathsf{P}\mathsf{T} = \mathsf{T}\mathsf{P}$, en op $\mathcal{H}_{\mathrm{inv}}$ is $\mathsf{T}$ injectief. De eigenwaarden van $\mathsf{T}$ op $\mathcal{H}_{\mathrm{inv}}$ vormen een rij $\lambda_0 \geq \lambda_1 \geq \lambda_2 \geq \dots \gt 0$ met $\lambda_n \to 0$, met een orthonormale basis van continue, reële eigenfuncties $\psi_0, \psi_1, \dots$ van $\mathcal{H}_{\mathrm{inv}}$. Op het orthogonale complement van $\mathcal{H}_{\mathrm{inv}}$ is $\mathsf{T} = 0$.
> 3. **(Uniek vacuüm.)** De grootste eigenwaarde $\lambda_0$ is enkelvoudig, en de eigenfunctie $\Omega := \psi_0$ kan strikt positief worden gekozen: $\Omega(u) \gt 0$ voor alle $u$.
> 4. **(Kloof.)** $\lambda_1 \lt \lambda_0$. Met $H := -\ln\big(\mathsf{T}\vert_{\mathcal{H}_{\mathrm{inv}}}\big)$ en $E_n := -\ln \lambda_n$ is $H$ een zelfgeadjungeerde operator met zuiver discreet spectrum $E_0 \lt E_1 \leq E_2 \leq \dots \to \infty$, en de **massakloof**
>    $$m := E_1 - E_0 = \ln(\lambda_0/\lambda_1)$$
>    voldoet aan $0 \lt m \lt \infty$.
> 5. **(Correlaties.)** Voor begrensde meetbare $F_1, F_2 : \mathcal{C} \to \mathbb{C}$ en $1 \leq t \leq N-1$ is
>    $$\mu\big(F_1(u^0)\  F_2(u^t)\big) = \frac{\operatorname{Tr}\big(F_1 \mathsf{T}^t F_2 \mathsf{T}^{N-t}\big)}{\operatorname{Tr} \mathsf{T}^N},$$
>    waarin $F_1, F_2$ als vermenigvuldigingsoperatoren werken. Voor reële $F$ en vaste $t \geq 1$ geldt bij $N \to \infty$:
>    $$\mu\big(F(u^0) F(u^t)\big) - \mu\big(F(u^0)\big)^2 \ \longrightarrow\ C_F(t) := \sum_{n \geq 1} e^{-(E_n - E_0)\ t}\  \big\lvert \langle \psi_n, F\Omega \rangle \big\rvert^2 ,$$
>    en $0 \leq C_F(t) \leq \lVert F \rVert_\infty^2\  e^{-m t}$. Voor $F = \psi_1/\Omega$ is $C_F(t) \geq e^{-mt}$.

*In gewone taal.* Punt 1 zegt dat de kansverdeling van de simulatie precies overeenkomt met een kwantummechanisch systeem: de operator $\mathsf{T}$ schuift het systeem één tijdstap op. Punten 3 en 4 zeggen dat dat systeem één toestand van laagste energie heeft en dat de volgende toestand een eindig stuk $m$ hoger ligt. Punt 5 zegt dat $m$ precies de snelheid is waarmee correlaties in de tijdrichting uitdoven; dat is wat de simulaties meten. De stelling geeft geen getal voor $m$ en geen ondergrens die blijft gelden als het rooster groeit: de kloof kan in principe naar nul gaan als het volume naar oneindig gaat. Dat uitsluiten is het eigenlijke probleem.

### 2.4 Bewijs

**Stap 1: het gewicht per tijdlaag.** Er zijn twee soorten plaquettes. De ruimtelijke plaquettes in tijdlaag $t$ dragen samen $e^{-V(u^t)}$ bij aan $w$. Een tijdplaquette hoort bij een ruimtelijke link $e = (x,i)$ en een tijd $t$; volgens de definitie in §1.2 (met $\mu = i$ en $\nu$ de tijdrichting) is haar variabele

```math
u^t_e\; v^t_{x+\hat\imath}\; (u^{t+1}_e)^{-1}\; (v^t_x)^{-1} .
```

Omdat het spoor cyclisch is, is het spoor hiervan gelijk aan $\operatorname{Tr}\big[ (v^t_x)^{-1} u^t_e\  v^t_{x+\hat\imath}\  (u^{t+1}_e)^{-1} \big] = \operatorname{Tr}\big[ ((u^t)^{g^t})_e\  (u^{t+1}_e)^{-1} \big]$ met de ijktransformatie $g^t_x := (v^t_x)^{-1}$. Dus

```math
w(U) = \prod_{t \in \mathbb{Z}/N} e^{-V(u^t)}\; K\big( (u^t)^{g^t},\, u^{t+1} \big), \qquad g^t = (v^t)^{-1}. \tag{2.1}
```

**Stap 2: eigenschappen van $\mathsf{P}$, $\mathsf{M}$, $\mathsf{K}$.**

(a) *$\mathsf{P}$ is een orthogonale projectie.* Uit $(u^h)^g = u^{gh}$ en de translatie-invariantie van $dg$ volgt $(\mathsf{P}f)(u^h) = \int f(u^{gh})\ dg = (\mathsf{P}f)(u)$, en daarmee $\mathsf{P}^2 = \mathsf{P}$. Verder is, met de substitutie $u \mapsto u^{g^{-1}}$ (die $du$ behoudt) en de invariantie van $dg$ onder $g \mapsto g^{-1}$,

```math
\langle f_1, \mathsf{P} f_2 \rangle = \int\!\!\int \overline{f_1(u)}\, f_2(u^g)\, du\, dg = \int\!\!\int \overline{f_1(u^{g^{-1}})}\, f_2(u)\, du\, dg = \langle \mathsf{P} f_1, f_2 \rangle .
```

Dus $\mathsf{P} = \mathsf{P}^\ast = \mathsf{P}^2$.

(b) *$\mathsf{M}$ is begrensd, zelfgeadjungeerd, omkeerbaar, en verwisselt met $\mathsf{P}$.* De functie $e^{-V/2}$ is continu, reëel en strikt positief op de compacte ruimte $\mathcal{C}$, dus begrensd en van nul weg begrensd. Onder een ijktransformatie gaat een ruimtelijke plaquettevariabele $u_p$ met beginpunt $x$ over in $g_x u_p g_x^{-1}$, dus $V(u^g) = V(u)$ wegens (G1), en daarom $\mathsf{M}\mathsf{P} = \mathsf{P}\mathsf{M}$.

(c) *$K$ is reëel, symmetrisch en ijkinvariant.* Wegens (G1) is $\operatorname{Tr}(u_e (u'_e)^{-1})$ reëel en gelijk aan $\operatorname{Tr}\big((u_e (u'_e)^{-1})^{-1}\big) = \operatorname{Tr}(u'_e u_e^{-1})$, dus $K(u,u') = K(u',u) \gt 0$. Verder is $(u^g)_e\  (((u')^g)_e)^{-1} = g_x\  u_e (u'_e)^{-1}\  g_x^{-1}$, dus $K(u^g, (u')^g) = K(u, u')$. Hieruit volgt $\mathsf{K}\mathsf{P} = \mathsf{P}\mathsf{K}$:

```math
(\mathsf{K}\mathsf{P} f)(u) = \int\!\!\int K(u,u')\, f((u')^g)\, du'\, dg = \int\!\!\int K(u, (u')^{g^{-1}})\, f(u')\, du'\, dg = \int\!\!\int K(u^g, u')\, f(u')\, du'\, dg = (\mathsf{P}\mathsf{K} f)(u).
```

**Stap 3: $\mathsf{K}$ is positief semidefiniet en injectief.** Zij $\mathcal{J} = E \times \lbrace 1,2 \rbrace^2$ en voor $i = (e, a, b) \in \mathcal{J}$ zij $\varphi_i(u) = (u_e)_{ab}$ het matrixelement. Omdat $(u'_e)^{-1} = (u'_e)^\dagger$ is

```math
A(u,u') := \sum_{e \in E} \operatorname{Tr}\big(u_e (u'_e)^{-1}\big) = \sum_{i \in \mathcal{J}} \varphi_i(u)\, \overline{\varphi_i(u')} .
```

Voor een rijtje $I = (i_1, \dots, i_n) \in \mathcal{J}^n$ zij $\Phi_I = \varphi_{i_1} \cdots \varphi_{i_n}$ (en $\Phi_\emptyset = 1$ voor $n = 0$). Dan is $A(u,u')^n = \sum_{I \in \mathcal{J}^n} \Phi_I(u)\  \overline{\Phi_I(u')}$ en

```math
K(u,u') = e^{\frac{\beta}{2} A(u,u')} = \sum_{n=0}^{\infty} \frac{(\beta/2)^n}{n!} \sum_{I \in \mathcal{J}^n} \Phi_I(u)\, \overline{\Phi_I(u')} ,
```

waarbij de reeks uniform convergeert omdat $\lvert A \rvert \leq 2\lvert E\rvert$. Voor $f \in \mathcal{H}$ mag de reeks dus term voor term worden geïntegreerd, en

```math
\langle f, \mathsf{K} f \rangle = \sum_{n=0}^{\infty} \frac{(\beta/2)^n}{n!} \sum_{I \in \mathcal{J}^n} \big\lvert \langle \Phi_I, f \rangle \big\rvert^2 \ \geq\ 0 . \tag{2.2}
```

Dus $\mathsf{K} \geq 0$. Stel nu $\langle f, \mathsf{K} f\rangle = 0$. Omdat $\beta \gt 0$ zijn alle coëfficiënten in (2.2) strikt positief, dus $\langle \Phi_I, f \rangle = 0$ voor elk monoom $\Phi_I$. De lineaire combinaties van de monomen $\Phi_I$ vormen een algebra $\mathcal{A}$ van continue functies op $\mathcal{C}$ die de constanten bevat, punten scheidt (de matrixelementen zijn coördinaten op $\mathcal{C}$) en wegens (G2) gesloten is onder complexe conjugatie. Volgens de stelling van Stone–Weierstrass (S4) ligt $\mathcal{A}$ dicht in de continue functies met de supremumnorm, dus ook dicht in $\mathcal{H}$. Dus $f = 0$. Samengevat:

```math
\mathsf{K} \geq 0, \qquad \langle f, \mathsf{K} f \rangle = 0 \ \Longrightarrow\ f = 0 . \tag{2.3}
```

**Stap 4: de kern van $\mathsf{T}$ en de formule $Z = \operatorname{Tr}\mathsf{T}^N$.** Definieer

```math
T_0(u,u') = \int K(u^g, u')\, dg, \qquad \mathsf{T}(u,u') = e^{-V(u)/2}\; T_0(u,u')\; e^{-V(u')/2} .
```

Dan is $(\mathsf{P}\mathsf{K} f)(u) = \int\int K(u^g,u') f(u')\ du'\ dg = \int T_0(u,u') f(u')\ du'$, dus $\mathsf{T} = \mathsf{M}\mathsf{K}\mathsf{P}\mathsf{M} = \mathsf{M}\mathsf{P}\mathsf{K}\mathsf{M}$ is de integraaloperator met kern $\mathsf{T}(u,u')$. Deze kern is continu en strikt positief (een integraal van een continue, strikt positieve functie over een compacte ruimte), en symmetrisch: met stap 2(c) en $g \mapsto g^{-1}$ is

```math
T_0(u',u) = \int K((u')^g, u)\,dg = \int K(u, (u')^g)\,dg = \int K(u^{g^{-1}}, u')\,dg = T_0(u,u') .
```

Integreer nu (2.1) over de tijdlinks. In de factor van tijd $t$ komt $v^t$ alleen voor via $g^t = (v^t)^{-1}$, en $\int F((v)^{-1})\ dv = \int F(g)\ dg$ wegens (G3). Dus

```math
Z = \int \prod_t du^t \prod_t e^{-V(u^t)}\, T_0(u^t, u^{t+1}) = \int \prod_t du^t \prod_{t \in \mathbb{Z}/N} \mathsf{T}(u^t, u^{t+1}) = \operatorname{Tr} \mathsf{T}^N .
```

De middelste gelijkheid verdeelt elke factor $e^{-V(u^t)}$ in twee helften over de twee kernen waarin $u^t$ voorkomt. De laatste gelijkheid is de formule voor het spoor van een product van integraaloperatoren met continue kernen op een compacte ruimte (S3), geldig voor $N \geq 2$.

Omdat $\mathsf{P}$ met $\mathsf{M}$ en $\mathsf{K}$ verwisselt, is ook $\mathsf{T} = \mathsf{P}\ (\mathsf{M}\mathsf{K}\mathsf{M})\ \mathsf{P}$. Dus $\mathsf{T} = \mathsf{P}\mathsf{T} = \mathsf{T}\mathsf{P}$, $\mathsf{T}$ is zelfgeadjungeerd, en met (2.3)

```math
\langle f, \mathsf{T} f \rangle = \langle \mathsf{M}\mathsf{P} f,\ \mathsf{K}\, \mathsf{M}\mathsf{P} f \rangle \ \geq\ 0 . \tag{2.4}
```

Een integraaloperator met continue kern op een compacte ruimte met eindige maat is een Hilbert–Schmidt-operator en dus compact (S3). Dit bewijst punt 1.

**Stap 5: spectrum (punt 2).** Volgens de spectraalstelling voor compacte zelfgeadjungeerde operatoren (S3) heeft $\mathcal{H}$ een orthonormale basis van eigenvectoren van $\mathsf{T}$, met reële eigenwaarden die alleen in 0 kunnen ophopen; wegens (2.4) zijn ze $\geq 0$. Omdat de kern reëel is, zijn het reële en het imaginaire deel van een eigenfunctie weer eigenfuncties, dus de basis kan reëel worden gekozen. Is $\mathsf{T}f = \lambda f$ met $\lambda \neq 0$, dan is $f = \lambda^{-1}\mathsf{T}f$ continu (de kern is uniform continu) en $f = \lambda^{-1}\mathsf{P}\mathsf{T}f \in \mathcal{H}_{\mathrm{inv}}$. Op $\mathcal{H}_{\mathrm{inv}}^\perp$ is $\mathsf{T} = \mathsf{T}\mathsf{P} = 0$.

*Injectief op $\mathcal{H}_{\mathrm{inv}}$.* Zij $f \in \mathcal{H}_{\mathrm{inv}}$ met $\mathsf{T}f = 0$. Dan is $\mathsf{P}f = f$ en volgens (2.4) $\langle \mathsf{M}f, \mathsf{K}\mathsf{M}f \rangle = 0$, dus $\mathsf{M}f = 0$ volgens (2.3), dus $f = 0$ omdat $\mathsf{M}$ omkeerbaar is.

*$\mathcal{H}_{\mathrm{inv}}$ is oneindig-dimensionaal.* Kies een gesloten lus $C$ in $\Lambda_s$ (voor $D \geq 3$ een ruimtelijke plaquette, voor $D = 2$ de lus rond de hele ring) en zij $W(u)$ het spoor van het product van de linkvariabelen langs $C$. Dan is $W$ ijkinvariant en neemt $W$ alle waarden in $[-2,2]$ aan, dus de functies $1, W, W^2, \dots$ zijn lineair onafhankelijke elementen van $\mathcal{H}_{\mathrm{inv}}$.

Een compacte, injectieve, positief semidefiniete operator op een oneindig-dimensionale ruimte heeft oneindig veel eigenwaarden, alle strikt positief, met limiet 0. Dit bewijst punt 2.

**Stap 6: uniek vacuüm (punt 3).** Omdat de kern continu en strikt positief is op de compacte ruimte $\mathcal{C} \times \mathcal{C}$, bestaat er een $c \gt 0$ met $\mathsf{T}(u,u') \geq c$ voor alle $u, u'$. Zij $\lambda_0 = \lVert \mathsf{T} \rVert \gt 0$ de grootste eigenwaarde en $f$ een reële eigenfunctie bij $\lambda_0$ met $\lVert f \rVert = 1$; $f$ is continu (stap 5).

Omdat $\mathsf{T}(u,u') \gt 0$ is

```math
\langle \lvert f\rvert, \mathsf{T} \lvert f\rvert \rangle - \langle f, \mathsf{T} f \rangle = \int\!\!\int \mathsf{T}(u,u')\, \big[ \lvert f(u)\rvert\, \lvert f(u')\rvert - f(u) f(u') \big]\, du\, du' \ \geq\ 0 . \tag{2.5}
```

Anderzijds is $\langle \lvert f\rvert, \mathsf{T}\lvert f\rvert\rangle \leq \lambda_0 \lVert f\rVert^2 = \langle f, \mathsf{T}f\rangle$. Dus in (2.5) geldt gelijkheid, en twee dingen volgen.

(i) $\langle \lvert f\rvert, (\lambda_0 - \mathsf{T}) \lvert f\rvert \rangle = 0$. De operator $\lambda_0 - \mathsf{T}$ is positief semidefiniet, en voor een positief semidefiniete operator $B$ volgt uit $\langle h, Bh\rangle = 0$ dat $Bh = 0$ (Cauchy–Schwarz voor de vorm $\langle\cdot, B\ \cdot\rangle$: $\lvert\langle g, Bh\rangle\rvert^2 \leq \langle g, Bg\rangle\langle h, Bh\rangle$). Dus $\mathsf{T}\lvert f\rvert = \lambda_0 \lvert f\rvert$, en daarmee voor alle $u$:

```math
\lvert f(u)\rvert = \frac{1}{\lambda_0} \int \mathsf{T}(u,u')\, \lvert f(u')\rvert\, du' \ \geq\ \frac{c}{\lambda_0} \int \lvert f(u')\rvert\, du' \ \gt\ 0 .
```

(ii) De integrand in (2.5) is continu en $\geq 0$, en de Haar-maat geeft elke open verzameling positieve maat. Dus de integrand is overal nul: $f(u) f(u') = \lvert f(u)\rvert \lvert f(u')\rvert \gt 0$ voor alle $u, u'$. Dus $f$ heeft overal hetzelfde teken.

Elke reële eigenfunctie bij $\lambda_0$ is dus overal strikt positief of overal strikt negatief. Stel dat de eigenruimte bij $\lambda_0$ dimensie minstens 2 heeft. Dan bevat zij twee reële eigenfuncties $f_1, f_2 \neq 0$ met $\langle f_1, f_2\rangle = 0$. Maar $f_1 f_2$ is overal strikt positief of overal strikt negatief, dus $\int f_1 f_2\  du \neq 0$: tegenspraak. Dus $\lambda_0$ is enkelvoudig, en $\Omega := \lvert f\rvert$ is de strikt positieve eigenfunctie. Dit bewijst punt 3.

**Stap 7: de kloof (punt 4).** Uit punt 3 volgt $\lambda_1 \lt \lambda_0$, en uit punt 2 volgt $\lambda_1 \gt 0$. Dus $m = \ln(\lambda_0/\lambda_1) \in (0, \infty)$. Op $\mathcal{H}_{\mathrm{inv}}$ is $\mathsf{T}$ diagonaal in de basis $(\psi_n)$ met eigenwaarden $\lambda_n \gt 0$, dus $H\psi_n := E_n \psi_n$ met $E_n = -\ln\lambda_n$ definieert een zelfgeadjungeerde operator met $\mathsf{T}\vert_{\mathcal{H}_{\mathrm{inv}}} = e^{-H}$; omdat $\lambda_n \to 0$ gaat $E_n \to \infty$.

**Stap 8: correlaties (punt 5).** Voor $1 \leq t \leq N-1$ zijn $F_1\mathsf{T}^t$ en $F_2\mathsf{T}^{N-t}$ Hilbert–Schmidt-operatoren met kernen $F_1(u)\ \mathsf{T}^{(t)}(u,u')$ en $F_2(u)\ \mathsf{T}^{(N-t)}(u,u')$, waarin $\mathsf{T}^{(t)}$ de $t$-voudig geïtereerde kern is. Het spoor van hun product is de integraal van het product van de kernen (S3), dus precies zoals in stap 4

```math
\operatorname{Tr}\big(F_1 \mathsf{T}^t F_2 \mathsf{T}^{N-t}\big) = \int \prod_s du^s\; F_1(u^0)\, F_2(u^t) \prod_{s \in \mathbb{Z}/N} \mathsf{T}(u^s, u^{s+1}) = \int F_1(u^0)\, F_2(u^t)\, w(U)\, dU .
```

Delen door $Z = \operatorname{Tr}\mathsf{T}^N$ geeft de eerste formule.

Voor de limiet rekenen we het spoor uit in de eigenbasis. Zij $(\psi_n)$ de eigenbasis van $\mathcal{H}_{\mathrm{inv}}$; de overige basisvectoren liggen in de kern van $\mathsf{T}$ en dragen niet bij. Dan is

```math
\frac{\operatorname{Tr}\big(F_1 \mathsf{T}^t F_2 \mathsf{T}^{N-t}\big)}{\lambda_0^N} = \sum_n \Big(\frac{\lambda_n}{\lambda_0}\Big)^{N-t} \frac{\langle \psi_n, F_1 \mathsf{T}^t F_2 \psi_n \rangle}{\lambda_0^t} = \frac{\langle \Omega, F_1 \mathsf{T}^t F_2\, \Omega\rangle}{\lambda_0^t} + r_N ,
```

met $\lvert r_N\rvert \leq \lVert F_1\rVert_\infty \lVert F_2\rVert_\infty \sum_{n \geq 1} (\lambda_n/\lambda_0)^{N-t}$. Omdat $\mathsf{T}$ een Hilbert–Schmidt-operator is, is $\sum_n \lambda_n^2 \lt \infty$, en voor $N - t \geq 2$ is $\sum_{n\geq1} (\lambda_n/\lambda_0)^{N-t} \leq (\lambda_1/\lambda_0)^{N-t-2} \sum_{n} (\lambda_n/\lambda_0)^2 \to 0$ als $N \to \infty$. Op dezelfde manier gaat $\operatorname{Tr}\mathsf{T}^N/\lambda_0^N \to 1$ en $\mu(F(u^0)) = \operatorname{Tr}(F\mathsf{T}^N)/\operatorname{Tr}\mathsf{T}^N \to \langle\Omega, F\Omega\rangle$. Dus

```math
\lim_{N\to\infty} \mu\big(F_1(u^0) F_2(u^t)\big) = \big\langle \Omega,\ F_1\, (\mathsf{T}/\lambda_0)^t\, F_2\, \Omega \big\rangle . \tag{2.6}
```

Zij nu $F$ reëel en begrensd. Ontwikkel $F\Omega = \sum_n a_n \psi_n + \eta$ met $a_n = \langle\psi_n, F\Omega\rangle$ en $\eta \in \mathcal{H}_{\mathrm{inv}}^\perp$, dus $\mathsf{T}\eta = 0$. Voor $t \geq 1$ is dan $\langle F\Omega, (\mathsf{T}/\lambda_0)^t F\Omega\rangle = \sum_n (\lambda_n/\lambda_0)^t \lvert a_n\rvert^2$. De term $n = 0$ is $\lvert a_0\rvert^2 = \langle\Omega, F\Omega\rangle^2$, de limiet van $\mu(F(u^0))^2$. Dus

```math
C_F(t) = \sum_{n\geq1} \Big(\frac{\lambda_n}{\lambda_0}\Big)^t \lvert a_n\rvert^2 = \sum_{n \geq 1} e^{-(E_n - E_0)t}\, \lvert\langle\psi_n, F\Omega\rangle\rvert^2 .
```

Elke term is $\geq 0$, en $C_F(t) \leq e^{-mt} \sum_n \lvert a_n\rvert^2 \leq e^{-mt}\lVert F\Omega\rVert^2 \leq e^{-mt}\lVert F\rVert_\infty^2$ omdat $\lVert\Omega\rVert = 1$. Ten slotte is $F = \psi_1/\Omega$ continu en reëel (want $\Omega$ is continu en strikt positief en $\psi_1$ is continu en reëel), en voor deze $F$ is $a_1 = \langle\psi_1,\psi_1\rangle = 1$, dus $C_F(t) \geq (\lambda_1/\lambda_0)^t = e^{-mt}$. $\blacksquare$

**Opmerking (reflectiepositiviteit).** De ongelijkheid (2.4) is de roostervorm van reflectiepositiviteit, één van de axioma's van Osterwalder en Schrader: zij maakt van de kansmaat $\mu$ een kwantumtheorie met een Hilbertruimte en een Hamiltoniaan $H$ waarvan het spectrum naar beneden begrensd is. Stelling A levert die structuur voor elk eindig rooster.

**Opmerking (wat stelling A niet geeft).** De kloof $m$ in stelling A hangt af van $\beta$ en van het ruimtelijke rooster, en het bewijs geeft geen ondergrens die uniform is in het volume. Het argument in stap 6 gebruikt de constante $c = \min \mathsf{T}(u,u')$, en die gaat exponentieel snel naar nul als het aantal links groeit. Voor het millenniumprobleem is juist een ondergrens nodig die standhoudt bij oneindig volume én bij $a \to 0$.

---

## 3. Stelling B: in twee dimensies is alles exact

### 3.1 Opzet

In $D = 2$ is het ruimtelijke rooster een ring van $L \geq 3$ punten $1, \dots, L$ (met $L + 1 \equiv 1$), en $u_i \in G$ is de link van punt $i$ naar punt $i+1$. Er zijn geen ruimtelijke plaquettes, dus $V = 0$, $\mathsf{M} = 1$ en $\mathsf{T} = \mathsf{K}\mathsf{P}$. De ijktransformaties zijn $(u^g)_i = g_i u_i g_{i+1}^{-1}$. De **holonomie** rond de ring is

```math
h(u) = u_1 u_2 \cdots u_L \in G, \qquad h(u^g) = g_1\, h(u)\, g_1^{-1} .
```

Een **klassefunctie** is een functie $\phi$ op $G$ met $\phi(g h g^{-1}) = \phi(h)$. We gebruiken de volgende standaardfeiten over SU(2) (bijlage, S5):

- De irreducibele unitaire representaties zijn $D^j$ met $j \in \lbrace 0, \tfrac12, 1, \tfrac32, \dots \rbrace$, van dimensie $d_j = 2j+1$. Het **karakter** is $\chi_j(g) = \operatorname{Tr} D^j(g)$; heeft $g$ eigenwaarden $e^{\pm i\theta}$ met $\theta \in [0,\pi]$, dan is $\chi_j(g) = \sin\big((2j+1)\theta\big)/\sin\theta$. In het bijzonder is $\chi_j$ reëel, $\chi_0 = 1$ en $\chi_{1/2}(g) = \operatorname{Tr} g = 2\cos\theta$.
- Voor een klassefunctie $\phi$ is $\int_G \phi\  dg = \frac{2}{\pi}\int_0^\pi \phi(\theta)\  \sin^2\theta\  d\theta$.
- De karakters $\chi_j$ vormen een orthonormale basis van de ruimte $L^2_{\mathrm{kl}}(G)$ van kwadratisch integreerbare klassefuncties.
- **Lemma van Schur:** een matrix die met alle $D^j(g)$ verwisselt, is een veelvoud van de eenheidsmatrix.

Verder is $I_\nu$ de gemodificeerde Besselfunctie van de eerste soort (bijlage, S6).

### 3.2 De stelling

> **Stelling B.** Zij $D = 2$, $\beta \gt 0$ en $L \geq 3$. Dan geldt:
>
> 1. **(IJkinvariante toestanden.)** $\mathcal{H}_{\mathrm{inv}} = \lbrace \phi \circ h : \phi \in L^2_{\mathrm{kl}}(G) \rbrace$, en $\phi \mapsto \phi \circ h$ behoudt de norm. De functies $\chi_j \circ h$, $j = 0, \tfrac12, 1, \dots$, vormen dus een orthonormale basis van $\mathcal{H}_{\mathrm{inv}}$.
> 2. **(Exact spectrum.)** $\mathsf{T}\ (\chi_j \circ h) = \Lambda_j\  (\chi_j \circ h)$ met
>    $$\Lambda_j = \Big( \frac{2}{\beta}\  I_{2j+1}(\beta) \Big)^{L} .$$
> 3. **(Ordening en kloof.)** $\Lambda_0 \gt \Lambda_{1/2} \gt \Lambda_1 \gt \dots \gt 0$. Het vacuüm is $\Omega = \chi_0 \circ h = 1$, de energieën zijn
>    $$E_j - E_0 = L\  \ln\frac{I_1(\beta)}{I_{2j+1}(\beta)},$$
>    en de massakloof is
>    $$m = E_{1/2} - E_0 = L\  \ln\frac{I_1(\beta)}{I_2(\beta)} \ \gt\ 0 .$$
> 4. **(Toestandssom.)** $Z = \sum_{j} \big( \tfrac{2}{\beta} I_{2j+1}(\beta) \big)^{LN}$, met de som over $j = 0, \tfrac12, 1, \dots$
> 5. **(Continuümlimiet.)** Houd de koppeling $g \gt 0$ en de fysische omtrek $\ell \gt 0$ vast, en zet $a = \ell/L$ en $\beta = 4/(g^2a^2)$. Dan geldt voor elke $j$
>    $$\lim_{L\to\infty} \frac{E_j - E_0}{a} = \frac{g^2\ell}{2}\  j(j+1), \qquad \text{in het bijzonder} \qquad \lim_{L \to \infty} \frac{m}{a} = \frac{3}{8}\  g^2 \ell .$$
>    Is bovendien $\tau \gt 0$ en $N = N(L)$ een rij gehele getallen met $Na \to \tau$, dan convergeert $(\mathsf{T}/\Lambda_0)^N$, opgevat als operator op $L^2_{\mathrm{kl}}(G)$ via punt 1, in operatornorm naar $e^{-\tau H_{\mathrm{c}}}$, waarin $H_{\mathrm{c}}$ de operator is met $H_{\mathrm{c}}\chi_j = \tfrac{g^2\ell}{2}\  j(j+1)\  \chi_j$.

*In gewone taal.* In twee dimensies is de enige vrijheidsgraad die overblijft de holonomie: wat een deeltje "voelt" als het één keer de ring rondgaat. De toestanden zijn genummerd door $j$, en toestand $j$ is een buis van flux die om de ring gewikkeld is. De energie is evenredig met de lengte $L$ van de ring; de evenredigheidsconstante $\ln(I_1/I_2)$ voor $j = \tfrac12$ is precies de snaarspanning $a^2\sigma = -\ln u(\beta)$ uit het rapport. In de limiet $a \to 0$ blijft er een eindige kloof $\tfrac38 g^2\ell$ over. Voor twee dimensies is het probleem "bestaan en kloof" op een ring daarmee volledig opgelost. Maar let op de kanttekening in §3.4.

### 3.3 Bewijs

**Punt 1.** De afbeelding $u \mapsto (w_1, \dots, w_{L-1}, h)$ met $w_i = u_1 u_2 \cdots u_i$ en $h = u_1 \cdots u_L$ is een homeomorfisme van $G^L$ op zichzelf, met inverse $u_1 = w_1$, $u_i = w_{i-1}^{-1} w_i$ voor $2 \leq i \leq L-1$, en $u_L = w_{L-1}^{-1} h$. Zij behoudt de maat: integreer eerst over $u_L$ bij vaste $u_1, \dots, u_{L-1}$; dan is $h = w_{L-1} u_L$ een translatie van $u_L$ en dus Haar-verdeeld; daarna over $u_{L-1}$, enzovoort (G3). Schrijf $f(u) = \tilde f(w, h)$. In de nieuwe coördinaten werkt een ijktransformatie als

```math
w_i \mapsto g_1\, w_i\, g_{i+1}^{-1} \quad (1 \leq i \leq L-1), \qquad h \mapsto g_1\, h\, g_1^{-1} .
```

Dus

```math
(\mathsf{P} f)(u) = \int dg_1 \int \prod_{i=2}^{L} dg_i\ \tilde f\big( g_1 w_1 g_2^{-1}, \dots, g_1 w_{L-1} g_L^{-1},\ g_1 h g_1^{-1} \big) = \int dg_1 \int \prod_{i=1}^{L-1} dw_i'\ \tilde f\big( w', g_1 h g_1^{-1} \big) =: \phi_f(h),
```

waarbij bij vaste $g_1$ de substitutie $w_i' = g_1 w_i g_{i+1}^{-1}$ in de variabele $g_{i+1}$ is gebruikt (G3). De functie $\phi_f$ hangt alleen van $h$ af en is een klassefunctie: $\phi_f(s h s^{-1}) = \phi_f(h)$ volgt uit de substitutie $g_1 \mapsto g_1 s^{-1}$. Dus $\mathsf{P}f = \phi_f \circ h$. Omgekeerd: is $\phi$ een klassefunctie, dan is $f = \phi \circ h$ ijkinvariant, want $h(u^g) = g_1 h(u) g_1^{-1}$; dus $\mathsf{P}f = f$. Omdat $h$ één van de nieuwe coördinaten is, is $\int \lvert\phi(h(u))\rvert^2\  du = \int_G \lvert\phi(h)\rvert^2\  dh$. Dit bewijst punt 1.

**Punt 2.** Zij $f = \chi_j \circ h$. Omdat $f \in \mathcal{H}_{\mathrm{inv}}$ is $\mathsf{T}f = \mathsf{K}\mathsf{P}f = \mathsf{K}f$, dus

```math
(\mathsf{T} f)(u) = \int \prod_{i=1}^{L} du_i'\ \prod_{i=1}^{L} k\big(u_i\, (u_i')^{-1}\big)\ \chi_j\big( u_1' u_2' \cdots u_L' \big) .
```

Substitueer $a_i = u_i\  (u_i')^{-1}$, dus $u_i' = a_i^{-1} u_i$; wegens (G3) is $du_i' = da_i$. Omdat $\chi_j = \operatorname{Tr} D^j$ en $D^j$ een representatie is, wordt dit

```math
(\mathsf{T} f)(u) = \operatorname{Tr}\Big[ \prod_{i=1}^{L} \Big( \int k(a)\, D^j(a^{-1})\, da \Big)\, D^j(u_i) \Big] = \operatorname{Tr}\Big[ \prod_{i=1}^{L} A_j\, D^j(u_i) \Big], \qquad A_j := \int k(a)\, D^j(a^{-1})\, da .
```

De matrix $A_j$ verwisselt met elke $D^j(g)$: met de substitutie $b = g a g^{-1}$ en omdat $k$ een klassefunctie is,

```math
D^j(g)\, A_j\, D^j(g)^{-1} = \int k(a)\, D^j\big( (g a g^{-1})^{-1} \big)\, da = \int k(g^{-1} b g)\, D^j(b^{-1})\, db = A_j .
```

Volgens het lemma van Schur is $A_j = \gamma_j \cdot 1$ met $\gamma_j\  d_j = \operatorname{Tr} A_j = \int k(a)\  \chi_j(a^{-1})\  da = \int k(a)\  \chi_j(a)\  da =: c_j$ (want $\chi_j(a^{-1}) = \overline{\chi_j(a)} = \chi_j(a)$). Dus

```math
(\mathsf{T} f)(u) = \Big(\frac{c_j}{d_j}\Big)^{L} \operatorname{Tr} D^j(u_1 \cdots u_L) = \Big(\frac{c_j}{d_j}\Big)^{L} \chi_j(h(u)) .
```

Rest de berekening van $c_j$. Met $k(a) = e^{\frac{\beta}{2}\operatorname{Tr} a} = e^{\beta\cos\theta}$, de integratieformule voor klassefuncties en $2\sin(n\theta)\sin\theta = \cos((n-1)\theta) - \cos((n+1)\theta)$ voor $n = 2j+1$ is

```math
c_j = \frac{2}{\pi}\int_0^\pi e^{\beta\cos\theta}\, \sin\big((2j+1)\theta\big)\, \sin\theta\ d\theta = \frac{1}{\pi}\int_0^\pi e^{\beta\cos\theta} \big[ \cos(2j\theta) - \cos((2j+2)\theta) \big]\, d\theta = I_{2j}(\beta) - I_{2j+2}(\beta) ,
```

volgens de integraalvoorstelling $I_n(\beta) = \frac{1}{\pi}\int_0^\pi e^{\beta\cos\theta}\cos(n\theta)\ d\theta$ voor gehele $n$ (S6). De recurrentie $I_{\nu-1}(\beta) - I_{\nu+1}(\beta) = \frac{2\nu}{\beta} I_\nu(\beta)$ met $\nu = 2j+1 = d_j$ geeft

```math
c_j = \frac{2\, d_j}{\beta}\, I_{2j+1}(\beta), \qquad \frac{c_j}{d_j} = \frac{2}{\beta}\, I_{2j+1}(\beta) . \tag{3.1}
```

Dit bewijst punt 2.

**Punt 3.** We hebben nodig:

> **Lemma B.1.** Voor elke $x \gt 0$ en elk geheel getal $n \geq 0$ is $0 \lt I_{n+1}(x) \lt I_n(x)$.

*Bewijs.* Positiviteit volgt uit de machtreeks $I_n(x) = \sum_{k \geq 0} (x/2)^{2k+n}/(k!\ (k+n)!)$. Zij $r(x) = I_{n+1}(x)/I_n(x) \gt 0$. Uit de afgeleide-relaties $I_n' = I_{n+1} + \frac{n}{x} I_n$ en $I_{n+1}' = I_n - \frac{n+1}{x} I_{n+1}$ (S6) volgt

```math
r'(x) = \frac{I_{n+1}'}{I_n} - r\, \frac{I_n'}{I_n} = 1 - r(x)^2 - \frac{2n+1}{x}\, r(x) . \tag{3.2}
```

Uit de machtreeks volgt $r(x) \to 0$ voor $x \downarrow 0$. Stel dat $r(x_1) \geq 1$ voor zekere $x_1 \gt 0$, en zij $x_0 = \inf\lbrace x \gt 0 : r(x) \geq 1 \rbrace$. Dan is $x_0 \gt 0$, $r(x_0) = 1$ en $r \lt 1$ op $(0, x_0)$, dus $r'(x_0) \geq 0$. Maar (3.2) geeft $r'(x_0) = -(2n+1)/x_0 \lt 0$. Tegenspraak. $\square$

Uit lemma B.1 en punt 2 volgt $\Lambda_0 \gt \Lambda_{1/2} \gt \Lambda_1 \gt \dots \gt 0$. Volgens punt 1 zijn de $\chi_j \circ h$ een basis van $\mathcal{H}_{\mathrm{inv}}$, dus dit zijn alle eigenwaarden van $\mathsf{T}$ op $\mathcal{H}_{\mathrm{inv}}$, elk enkelvoudig. Met $E_j = -\ln\Lambda_j$ volgen de formules van punt 3. (Dit is in overeenstemming met stelling A: de eigenfunctie $\chi_0 \circ h = 1$ bij de grootste eigenwaarde is strikt positief.)

**Punt 4.** $Z = \operatorname{Tr}\mathsf{T}^N = \sum_j \Lambda_j^N$ volgens stelling A, punt 1 en 2.

**Punt 5.** Voor vaste $\nu$ en $x \to \infty$ geldt (S6)

```math
I_\nu(x) = \frac{e^x}{\sqrt{2\pi x}} \Big[ 1 - \frac{4\nu^2 - 1}{8x} + O(x^{-2}) \Big], \qquad \text{dus} \qquad \ln\frac{I_1(x)}{I_\nu(x)} = \frac{\nu^2 - 1}{2x} + O(x^{-2}) . \tag{3.3}
```

Met $\nu = 2j+1$ is $\nu^2 - 1 = 4j(j+1)$. Met $L = \ell/a$ en $\beta = 4/(g^2a^2)$ volgt

```math
\frac{E_j - E_0}{a} = \frac{\ell}{a^2}\, \ln\frac{I_1(\beta)}{I_{2j+1}(\beta)} = \frac{\ell}{a^2} \Big[ \frac{4j(j+1)}{2}\cdot\frac{g^2a^2}{4} + O(a^4) \Big] \ \longrightarrow\ \frac{g^2\ell}{2}\, j(j+1) .
```

Voor $j = \tfrac12$ is dit $\tfrac38 g^2\ell$.

Voor de convergentie van operatoren: in de basis $(\chi_j)$ zijn zowel $(\mathsf{T}/\Lambda_0)^N$ als $e^{-\tau H_{\mathrm{c}}}$ diagonaal, met eigenwaarden $q_j(L) := (\Lambda_j/\Lambda_0)^N = \exp\big(-Na \cdot (E_j - E_0)/a\big)$ en $q_j := \exp\big(-\tau \tfrac{g^2\ell}{2} j(j+1)\big)$. Het voorgaande geeft $q_j(L) \to q_j$ voor elke vaste $j$. De operatornorm van het verschil is $\sup_j \lvert q_j(L) - q_j\rvert$. Zij $\varepsilon \gt 0$ en kies $J$ met $q_J \lt \varepsilon$. Beide rijen zijn dalend in $j$ (lemma B.1), dus voor $j \geq J$ is $\lvert q_j(L) - q_j\rvert \leq \max(q_J(L), q_J)$, en dat is kleiner dan $2\varepsilon$ zodra $L$ zo groot is dat $\lvert q_J(L) - q_J\rvert \lt \varepsilon$. Voor de eindig veel $j \lt J$ geldt gewone convergentie. Dus $\sup_j\lvert q_j(L) - q_j\rvert \to 0$. $\blacksquare$

### 3.4 Kanttekeningen

**Verband met de snaarspanning.** In de notatie van het rapport is $u(\beta) = I_2(\beta)/I_1(\beta)$ en is de snaarspanning in twee dimensies $a^2\sigma = -\ln u(\beta)$. Stelling B zegt dus $m = L\  a^2\sigma$ in roostereenheden: de lichtste toestand is één fluxbuis rond de ring, met energie snaarspanning maal lengte. Dat is de toestand die in het rapport "torelon" heet. In het continuüm is $\sigma = \tfrac38 g^2$.

**Waarom dit het millenniumprobleem niet raakt.** De kloof $\tfrac38 g^2\ell$ is evenredig met de omtrek $\ell$ en gaat naar oneindig als $\ell \to \infty$. In oneindig volume blijft alleen het vacuüm over: er zijn in twee dimensies geen lokale vrijheidsgraden, geen gluonen en geen glueballs. De moeilijkheden van vier dimensies (oneindig veel gekoppelde vrijheidsgraden op alle lengteschalen, een koppeling die met de schaal meeloopt) komen in twee dimensies eenvoudig niet voor. Stelling B is een volledig antwoord op een veel makkelijkere vraag.

---

## 4. Stelling C: bij sterke koppeling is de kloof uniform in het volume

Stelling A geeft een kloof voor elk eindig rooster, maar geen ondergrens die standhoudt als het rooster groeit. Dit hoofdstuk bewijst zo'n ondergrens voor kleine $\beta$, in elke dimensie. Het idee: bij kleine $\beta$ hangt de verdeling van één link maar zwak af van zijn buren. Dan dooft de invloed van een verandering op één plek exponentieel uit met de afstand, met een snelheid die niet van de roostergrootte afhangt.

### 4.1 De stelling

Zet voor $D \geq 2$ en $\beta \geq 0$

```math
\alpha(\beta, D) = 6(D-1)\tanh\beta, \qquad \beta_0(D) = \operatorname{artanh}\frac{1}{6(D-1)} = \frac12 \ln\frac{6D-5}{6D-7} ,
```

zodat $\alpha(\beta, D) \lt 1$ precies als $\beta \lt \beta_0(D)$. Voor een begrensde functie $f$ op een configuratieruimte en een link $k$ definiëren we de **schommeling in $k$**, de **totale schommeling** en de **schommeling**:

```math
\delta_k(f) = \sup\big\lbrace \lvert f(U) - f(U')\rvert : U, U' \text{ verschillen alleen op link } k \big\rbrace, \qquad \Delta(f) = \sum_k \delta_k(f), \qquad \operatorname{osc}(f) = \sup f - \inf f .
```

> **Stelling C.** Zij $D \geq 2$ en $0 \lt \beta \lt \beta_0(D)$, en schrijf $\alpha = \alpha(\beta, D)$. Zij $\theta$ een getal met $0 \lt \theta \lt \ln(1/\alpha)$ en $C_\theta = e^\theta/(1 - \alpha e^\theta)$.
>
> 1. **(Exponentieel verval van correlaties.)** Zij $\Lambda$ een periodiek rooster met alle afmetingen minstens 3, en $A, B \subset \mathcal{L}$ disjuncte verzamelingen links. Zij $f$ een begrensde meetbare reële functie die alleen van de links in $A$ afhangt, en $g$ een begrensde meetbare reële functie die alleen van de links in $B$ afhangt. Dan is
>    $$\big\lvert \mu(fg) - \mu(f)\mu(g) \big\rvert \ \leq\ C_\theta\ \frac{\operatorname{osc}(g)}{2}\ \sum_{k \in A} e^{-\theta\  d(k, B)}\  \delta_k(f) \ \leq\ C_\theta\ \frac{\operatorname{osc}(g)}{2}\ \Delta(f)\ e^{-\theta\  d(A,B)} .$$
>    De constanten $C_\theta$ en $\theta$ hangen niet af van het rooster.
> 2. **(Kloof uniform in het volume.)** Voor elk ruimtelijk rooster $\Lambda_s$ met alle afmetingen minstens 3 voldoet de massakloof $m$ van stelling A aan
>    $$m \ \geq\ \ln\frac{1}{\alpha(\beta, D)} = -\ln\big( 6(D-1)\tanh\beta \big) \ \gt\ 0 .$$
> 3. **(Oneindig volume.)** Zij $f$ een begrensde meetbare functie van eindig veel linkvariabelen van het oneindige rooster $\mathbb{Z}^D$, en $\mu_L$ de maat op het periodieke rooster $(\mathbb{Z}/L)^D$. Dan bestaat $\langle f\rangle := \lim_{L\to\infty}\mu_L(f)$, en de ongelijkheid van punt 1 geldt ook voor $\langle\cdot\rangle$, met $d$ de linkafstand in $\mathbb{Z}^D$.

*In gewone taal.* Punt 2 is de kern: voor $\beta$ onder de grens $\beta_0(D)$ is de kloof minstens $\ln(1/\alpha)$, hoe groot het rooster ook is. Punt 3 zegt dat de theorie in oneindig volume dan bestaat, en punt 1 dat correlaties daar exponentieel uitdoven. Enkele waarden van de ondergrens:

| $D$ | $\beta_0(D)$ | $\beta$ | $\alpha(\beta,D)$ | ondergrens $\ln(1/\alpha)$ |
|---|---|---|---|---|
| 2 | 0,1682 | 0,05 | 0,2998 | 1,2048 |
| 2 | | 0,10 | 0,5980 | 0,5142 |
| 2 | | 0,15 | 0,8933 | 0,1128 |
| 3 | 0,0835 | 0,02 | 0,2400 | 1,4273 |
| 3 | | 0,05 | 0,5995 | 0,5117 |
| 3 | | 0,08 | 0,9580 | 0,0430 |
| 4 | 0,0556 | 0,01 | 0,1800 | 1,7148 |
| 4 | | 0,03 | 0,5398 | 0,6165 |
| 4 | | 0,05 | 0,8993 | 0,1062 |

De ondergrens is niet scherp. De werkelijke kloof is in dit gebied veel groter (voor $D = 4$ bij $\beta = 0{,}03$ in de orde van 20 in roostereenheden, volgens de leidende term van de sterke-koppelingsreeks in `THEORY.md` §5.6), en de werkelijke kloof gaat niet naar nul bij $\beta_0(D)$: daar houdt alleen deze bewijsmethode op.

### 4.2 Algemeen kader: één link opnieuw trekken

De lemma's van deze paragraaf gelden voor elk eindig systeem van de volgende vorm; we passen ze straks toe op het hele rooster en op delen ervan met vastgehouden rand.

**Kader.** Zij $R$ een eindige verzameling ("links"), $X = G^R$ en $\pi$ een kansmaat op $X$ met een continue, strikt positieve dichtheid $p$ ten opzichte van de productmaat $dU$. Voor $U \in X$, $\ell \in R$ en $V \in G$ is $U^{\ell \to V}$ de configuratie $U$ met $U_\ell$ vervangen door $V$. De **voorwaardelijke dichtheid** van link $\ell$ gegeven de rest, en de bijbehorende operator op begrensde meetbare functies, zijn

```math
\rho_\ell(V \mid U) = \frac{p(U^{\ell\to V})}{\int p(U^{\ell\to V'})\, dV'}, \qquad (\Pi_\ell f)(U) = \int f(U^{\ell\to V})\, \rho_\ell(V \mid U)\, dV .
```

$\rho_\ell(\cdot \mid U)$ hangt niet af van $U_\ell$ en is een kansdichtheid op $G$. De operator $\Pi_\ell$ is wat een simulatie doet bij een warmtebadstap op link $\ell$: de link wordt opnieuw getrokken uit zijn voorwaardelijke verdeling. Direct uit de definitie volgt:

- **(K1)** $\Pi_\ell f$ hangt niet af van $U_\ell$; $\Pi_\ell 1 = 1$; $\inf f \leq \Pi_\ell f \leq \sup f$.
- **(K2)** $\pi(\Pi_\ell f) = \pi(f)$. *Bewijs:* de noemer $z_\ell(U) = \int p(U^{\ell\to V'})\ dV'$ hangt niet af van $U_\ell$, en $\int p(U)\  dU_\ell = z_\ell(U)$. Integreer in $\pi(\Pi_\ell f) = \int p(U) \int f(U^{\ell\to V})\  p(U^{\ell\to V})\  z_\ell(U)^{-1}\  dV\  dU$ eerst over $U_\ell$; dat geeft $\int\int f(U^{\ell\to V})\  p(U^{\ell\to V})\  dV \prod_{k\neq\ell} dU_k = \pi(f)$.

De **totale-variatieafstand** tussen twee kansmaten $\nu, \nu'$ is $d_{\mathrm{TV}}(\nu,\nu') = \sup_S \lvert\nu(S) - \nu'(S)\rvert$, met het supremum over meetbare verzamelingen. Twee feiten:

- **(TV1)** Hebben $\nu, \nu'$ dichtheden $q, q'$, dan is $d_{\mathrm{TV}}(\nu,\nu') = \tfrac12\int\lvert q - q'\rvert$.
- **(TV2)** Voor begrensde meetbare $F$ is $\lvert\nu(F) - \nu'(F)\rvert \leq \operatorname{osc}(F)\  d_{\mathrm{TV}}(\nu,\nu')$. *Bewijs:* met $c = \tfrac12(\sup F + \inf F)$ is $\lvert F - c\rvert \leq \tfrac12\operatorname{osc}(F)$ en $\nu(F) - \nu'(F) = \int (F - c)(q - q')$, dus $\lvert\nu(F) - \nu'(F)\rvert \leq \tfrac12\operatorname{osc}(F)\int\lvert q - q'\rvert$.

De **afhankelijkheidscoëfficiënten** (naar Dobrushin) zijn, voor $\ell \neq k$,

```math
c_{\ell k} = \sup\big\lbrace d_{\mathrm{TV}}\big( \rho_\ell(\cdot \mid U),\ \rho_\ell(\cdot \mid U') \big) : U, U' \text{ verschillen alleen op link } k \big\rbrace, \qquad c_{\ell\ell} = 0 .
```

Het getal $c_{\ell k}$ meet hoe sterk de verdeling van link $\ell$ kan veranderen als alleen link $k$ wordt veranderd.

> **Lemma C.1 (afstand na kantelen).** Zij $\nu$ een kansmaat, $\varphi$ een begrensde meetbare reële functie en $\nu'$ de kansmaat met $\nu'(S) = \nu(e^\varphi 1_S)/\nu(e^\varphi)$. Dan is
> $$d_{\mathrm{TV}}(\nu, \nu') \ \leq\ \tanh\Big( \frac{\operatorname{osc}(\varphi)}{4} \Big) .$$

*Bewijs.* Zij $S$ meetbaar, $a = \nu(S)$, $M = \sup\varphi$, $m_\varphi = \inf\varphi$ en $s = e^{(M - m_\varphi)/2} \geq 1$. Is $s = 1$, dan is $\varphi$ constant en $\nu' = \nu$. Zij dus $s \gt 1$. Omdat $x/(x+y)$ stijgt in $x$ en daalt in $y$ (voor $x, y \geq 0$, niet beide nul) is

```math
\nu'(S) = \frac{\nu(e^\varphi 1_S)}{\nu(e^\varphi 1_S) + \nu(e^\varphi 1_{S^c})} \ \leq\ \frac{e^M a}{e^M a + e^{m_\varphi}(1-a)} = \frac{s^2 a}{s^2 a + (1 - a)} ,
```

dus

```math
\nu'(S) - \nu(S) \ \leq\ \frac{s^2 a}{s^2 a + 1 - a} - a = \frac{(s^2 - 1)\, a (1-a)}{s^2 a + 1 - a} .
```

We beweren dat het rechterlid hoogstens $(s-1)/(s+1)$ is. Na delen door $s - 1 \gt 0$ en kruiselings vermenigvuldigen is dat gelijkwaardig met $(s+1)^2 a(1-a) \leq s^2 a + (1-a)$, en met $b = 1 - a$ is

```math
s^2 a + b - (s+1)^2 ab = s^2 a (1 - b) + b(1 - a) - 2sab = s^2a^2 - 2sab + b^2 = (sa - b)^2 \ \geq\ 0 .
```

Dus $\nu'(S) - \nu(S) \leq (s-1)/(s+1) = \tanh\big(\tfrac14\operatorname{osc}(\varphi)\big)$ voor elke $S$. Toegepast op $S^c$ geeft dit $\nu(S) - \nu'(S) = \nu'(S^c) - \nu(S^c) \leq \tanh\big(\tfrac14\operatorname{osc}(\varphi)\big)$. $\square$

> **Lemma C.2 (één stap).** In het kader hierboven geldt voor elke begrensde meetbare $f$ en alle $\ell, k \in R$:
> $$\delta_\ell(\Pi_\ell f) = 0, \qquad \delta_k(\Pi_\ell f) \ \leq\ \delta_k(f) + c_{\ell k}\  \delta_\ell(f) \quad (k \neq \ell).$$

*Bewijs.* De eerste bewering is (K1). Zij $k \neq \ell$ en laat $U, U'$ alleen op link $k$ verschillen. Dan is

```math
(\Pi_\ell f)(U) - (\Pi_\ell f)(U') = \int \big[ f(U^{\ell\to V}) - f((U')^{\ell\to V}) \big]\, \rho_\ell(V \mid U)\, dV \ +\ \int f((U')^{\ell\to V})\, \big[ \rho_\ell(V \mid U) - \rho_\ell(V \mid U') \big]\, dV .
```

In de eerste term verschillen $U^{\ell\to V}$ en $(U')^{\ell\to V}$ alleen op link $k$, dus de term is in absolute waarde hoogstens $\delta_k(f)$. In de tweede term heeft de functie $V \mapsto f((U')^{\ell\to V})$ schommeling hoogstens $\delta_\ell(f)$, dus volgens (TV2) en de definitie van $c_{\ell k}$ is de term hoogstens $\delta_\ell(f)\  c_{\ell k}$. $\square$

> **Lemma C.3 (gewogen krimp).** Zij $w = (w_k)_{k\in R}$ met $w_k \geq 0$ en $\lambda \in [0, 1]$ zo dat
> $$\sum_{k \in R} c_{\ell k}\  w_k \ \leq\ \lambda\  w_\ell \qquad \text{voor alle } \ell \in R, \tag{4.1}$$
> en zet $W(f) = \sum_k w_k\  \delta_k(f)$. Dan geldt:
>
> (a) $W(\Pi_\ell f) \leq W(f) - (1-\lambda)\  w_\ell\  \delta_\ell(f)$ voor elke $\ell$.
>
> (b) Zij $\ell_1, \ell_2, \dots$ een willekeurige rij links, $f_0 = f$ en $f_i = \Pi_{\ell_i} f_{i-1}$. Dan is $\ (1 - \lambda) \sum_{i \geq 1} w_{\ell_i}\  \delta_{\ell_i}(f_{i-1}) \leq W(f)$.
>
> (c) Zij $\ell_1, \dots, \ell_n$ een opsomming van $R$ waarin elke link precies één keer voorkomt, en $\mathcal{S} f = \Pi_{\ell_n} \cdots \Pi_{\ell_2}\Pi_{\ell_1} f$ (eerst $\Pi_{\ell_1}$) een **ronde**. Dan is $W(\mathcal{S} f) \leq \lambda\  W(f)$.

*Bewijs.* (a) Volgens lemma C.2 en (4.1), en omdat $c_{\ell\ell} = 0$,

```math
W(\Pi_\ell f) = \sum_{k\neq\ell} w_k\, \delta_k(\Pi_\ell f) \ \leq\ \sum_{k \neq \ell} w_k\, \delta_k(f) + \delta_\ell(f) \sum_{k} c_{\ell k}\, w_k \ \leq\ W(f) - w_\ell\, \delta_\ell(f) + \lambda\, w_\ell\, \delta_\ell(f) .
```

(b) Tel (a) op over $i = 1, \dots, n$: $(1-\lambda)\sum_{i=1}^n w_{\ell_i}\delta_{\ell_i}(f_{i-1}) \leq W(f_0) - W(f_n) \leq W(f)$, en laat $n \to \infty$.

(c) Voor een vector $x = (x_k)_{k \in R}$ met $x_k \geq 0$ definieer de lineaire afbeelding $\mathsf{A}_i$ door $(\mathsf{A}_i x)_{\ell_i} = 0$ en $(\mathsf{A}_i x)_k = x_k + c_{\ell_i k}\  x_{\ell_i}$ voor $k \neq \ell_i$. Lemma C.2 zegt $\delta(f_i) \leq \mathsf{A}_i\  \delta(f_{i-1})$ componentsgewijs, waarin $\delta(f)$ de vector $(\delta_k(f))_k$ is. Omdat $\mathsf{A}_i$ niet-negatieve coëfficiënten heeft, volgt $\delta(\mathcal{S}f) \leq \mathsf{A}_n \cdots \mathsf{A}_1\  \delta(f)$. Het is dus voldoende te bewijzen dat $w \cdot (\mathsf{A}_n \cdots \mathsf{A}_1 e_j) \leq \lambda\  w_j$ voor elke eenheidsvector $e_j$, $j \in R$; hierin is $w \cdot x = \sum_k w_k x_k$.

Zij $i_0$ de index met $\ell_{i_0} = j$, en $x^{(0)} = e_j$, $x^{(i)} = \mathsf{A}_i x^{(i-1)}$. Voor $i \lt i_0$ is $\ell_i \neq j$ en dus $(x^{(i-1)})_{\ell_i} = 0$, zodat $\mathsf{A}_i$ niets verandert: $x^{(i)} = e_j$. Voor $i = i_0$ is $x^{(i_0)} = (c_{jk})_{k\in R}$, dus $w \cdot x^{(i_0)} = \sum_k c_{jk} w_k \leq \lambda w_j$ volgens (4.1). Voor $i \gt i_0$ geeft dezelfde berekening als in (a)

```math
w \cdot (\mathsf{A}_i x) = w\cdot x - w_{\ell_i} x_{\ell_i} + x_{\ell_i} \sum_k c_{\ell_i k}\, w_k \ \leq\ w \cdot x - (1-\lambda)\, w_{\ell_i} x_{\ell_i} \ \leq\ w \cdot x .
```

Dus $w \cdot x^{(n)} \leq w \cdot x^{(i_0)} \leq \lambda w_j$. $\square$

> **Lemma C.4 (convergentie).** Zij in het kader hierboven $\alpha_\pi := \max_\ell \sum_k c_{\ell k} \lt 1$, en $\mathcal{S}$ een ronde. Dan geldt voor elke begrensde meetbare $f$ en elke $n \geq 0$:
> $$\big\lVert \mathcal{S}^n f - \pi(f) \big\rVert_\infty \ \leq\ \alpha_\pi^{\ n}\  \Delta(f) .$$

*Bewijs.* Neem $w_k = 1$ en $\lambda = \alpha_\pi$ in lemma C.3(c): $\Delta(\mathcal{S}^n f) \leq \alpha_\pi^n \Delta(f)$. Voor elke begrensde $h$ is $\operatorname{osc}(h) \leq \Delta(h)$: twee configuraties gaan in elkaar over door de links één voor één te veranderen. Verder is $\pi(\mathcal{S}^n f) = \pi(f)$ volgens (K2), en een functie $h$ wijkt overal hoogstens $\operatorname{osc}(h)$ af van haar gemiddelde $\pi(h)$. Dus $\lVert \mathcal{S}^n f - \pi(f)\rVert_\infty \leq \operatorname{osc}(\mathcal{S}^n f) \leq \Delta(\mathcal{S}^n f)$. $\square$

### 4.3 De coëfficiënten van de ijktheorie

Zij $\Lambda$ een periodiek rooster als in §1.2, $B \subset \mathcal{L}$ een (mogelijk lege) verzameling **vastgehouden** links en $R = \mathcal{L}\setminus B$. Voor een **randvoorwaarde** $\omega \in G^B$ is $\mu^\omega$ de kansmaat op $G^R$ met dichtheid

```math
p^\omega(U_R) = \frac{w(U_R, \omega)}{Z(\omega)}, \qquad Z(\omega) = \int w(U_R, \omega)\, dU_R .
```

Dit is de voorwaardelijke verdeling van de links in $R$ onder $\mu$, gegeven dat de links in $B$ de waarde $\omega$ hebben; preciezer: $\mu(F) = \int \mu_B(d\omega)\  \mu^\omega\big(F(\cdot, \omega)\big)$ met $\mu_B(d\omega) = Z(\omega)\  d\omega / Z$ de verdeling van de links in $B$ (stelling van Fubini). Voor $B = \emptyset$ is $\mu^\omega = \mu$. Het paar $(R, \mu^\omega)$ valt onder het kader van §4.2; we schrijven $\Pi^\omega_\ell$ en $c^\omega_{\ell k}$ voor de bijbehorende operatoren en coëfficiënten.

> **Lemma C.5.** Voor elke $B$, elke $\omega \in G^B$ en alle $\ell \neq k$ in $R$ is
> $$c^\omega_{\ell k} \ \leq\ \tanh(\beta\  n_{\ell k}) \ \leq\ n_{\ell k} \tanh\beta, \qquad \text{dus} \qquad \sum_{k \in R} c^\omega_{\ell k} \ \leq\ 6(D-1)\tanh\beta = \alpha(\beta, D) .$$

*Bewijs.* De voorwaardelijke dichtheid van link $\ell$ is $\rho_\ell(V \mid U) = w(U^{\ell\to V})/\int w(U^{\ell\to V'})\ dV'$, met $U = (U_R, \omega)$. Laat $U, U'$ alleen op link $k \in R$ verschillen. In het quotiënt $w((U')^{\ell\to V})/w(U^{\ell\to V})$ vallen alle plaquettes weg die $k$ niet bevatten. De plaquettes die $k$ wel maar $\ell$ niet bevatten, geven een factor die niet van $V$ afhangt. Er blijven de $n_{\ell k}$ plaquettes die zowel $\ell$ als $k$ bevatten:

```math
\rho_\ell(V \mid U') = \frac{e^{\varphi(V)}\, \rho_\ell(V \mid U)}{\int e^{\varphi(V')}\, \rho_\ell(V' \mid U)\, dV'}, \qquad \varphi(V) = \frac{\beta}{2} \sum_{p \ni \ell, k} \Big[ \operatorname{Tr} (U')^{\ell\to V}_p - \operatorname{Tr} U^{\ell\to V}_p \Big] .
```

Wegens (G1) ligt elk verschil van sporen in $[-4, 4]$, dus $\varphi$ neemt waarden aan in $[-2\beta n_{\ell k},\  2\beta n_{\ell k}]$ en $\operatorname{osc}(\varphi) \leq 4\beta n_{\ell k}$. Lemma C.1 geeft $c^\omega_{\ell k} \leq \tanh(\beta n_{\ell k})$. De functie $\tanh$ is concaaf op $[0,\infty)$ met $\tanh 0 = 0$, dus $\tanh(n x) \leq n\tanh x$ voor $x \geq 0$ en gehele $n \geq 0$. Sommeren over $k$ met (R2) geeft de laatste bewering. $\square$

### 4.4 De invloed van de rand

> **Propositie C.6 (invloed van de rand).** Zij $0 \lt \beta \lt \beta_0(D)$, $\alpha = \alpha(\beta, D)$, $0 \lt \theta \lt \ln(1/\alpha)$ en $B \subset \mathcal{L}$ niet leeg, $R = \mathcal{L}\setminus B$. Dan geldt voor alle randvoorwaarden $\omega, \omega' \in G^B$ en elke begrensde meetbare $f$ op $G^R$:
> $$\big\lvert \mu^{\omega}(f) - \mu^{\omega'}(f) \big\rvert \ \leq\ \frac{e^\theta}{1 - \alpha e^\theta} \sum_{k \in R} e^{-\theta\  d(k, B)}\  \delta_k(f) .$$

*In gewone taal.* Verander je de vastgehouden links in $B$, dan verandert het gemiddelde van een grootheid $f$ hoogstens met een bedrag dat exponentieel klein is in de afstand tussen $B$ en de links waar $f$ van afhangt.

*Bewijs.* Zet $w_k = e^{-\theta d(k,B)}$ voor $k \in R$ (met $w_k = 0$ als $d(k,B) = \infty$) en $\lambda = \alpha e^\theta \lt 1$.

*Stap 1: (4.1) geldt.* Is $c^\omega_{\ell k} \neq 0$, dan zijn $\ell$ en $k$ buren (lemma C.5), dus $d(k, B) \geq d(\ell, B) - 1$ en $w_k \leq e^\theta w_\ell$. Met lemma C.5 volgt $\sum_k c^\omega_{\ell k} w_k \leq e^\theta w_\ell \sum_k c^\omega_{\ell k} \leq \alpha e^\theta w_\ell$. Hetzelfde geldt voor $\omega'$.

*Stap 2: twee randvoorwaarden vergelijken.* Zij $\partial B = \lbrace \ell \in R : d(\ell, B) = 1 \rbrace$ de verzameling links in $R$ met een buur in $B$. Voor $\ell \notin \partial B$ bevat geen plaquette door $\ell$ een link van $B$, dus $\rho_\ell(\cdot\mid U_R, \omega)$ hangt niet van $\omega$ af en $\Pi^\omega_\ell = \Pi^{\omega'}_\ell$. Voor $\ell \in \partial B$ geeft (TV2), met $d_{\mathrm{TV}} \leq 1$,

```math
\big\lVert \Pi^{\omega}_\ell h - \Pi^{\omega'}_\ell h \big\rVert_\infty \ \leq\ \delta_\ell(h) \qquad \text{voor elke begrensde meetbare } h . \tag{4.2}
```

*Stap 3: telescoopsom.* Zij $\ell_1, \ell_2, \dots$ de rij die een vaste opsomming van $R$ steeds herhaalt, en $f_0 = f$, $f_i = \Pi^\omega_{\ell_i} f_{i-1}$. Na $n$ ronden is $f_{n\lvert R\rvert} = \mathcal{S}^n f$, en volgens lemma C.4 en lemma C.5 convergeert dit uniform naar de constante $\mu^\omega(f)$. Omdat $\mu^{\omega'}$ een kansmaat is, volgt $\mu^{\omega'}(f_{n\lvert R\rvert}) \to \mu^\omega(f)$. Verder is $\mu^{\omega'}(f_{i-1}) = \mu^{\omega'}(\Pi^{\omega'}_{\ell_i} f_{i-1})$ volgens (K2) voor $\mu^{\omega'}$. Dus

```math
\mu^{\omega'}(f) - \mu^{\omega}(f) = \lim_{n\to\infty} \sum_{i=1}^{n\lvert R\rvert} \mu^{\omega'}\big( f_{i-1} - f_i \big) = \lim_{n\to\infty} \sum_{i=1}^{n\lvert R\rvert} \mu^{\omega'}\big( \Pi^{\omega'}_{\ell_i} f_{i-1} - \Pi^{\omega}_{\ell_i} f_{i-1} \big) .
```

Met stap 2, $w_\ell = e^{-\theta}$ op $\partial B$, en lemma C.3(b) (toegepast op het systeem $(R, \mu^\omega)$ met de gewichten van stap 1):

```math
\big\lvert \mu^{\omega'}(f) - \mu^{\omega}(f) \big\rvert \ \leq\ \sum_{i \geq 1,\ \ell_i \in \partial B} \delta_{\ell_i}(f_{i-1}) = e^{\theta} \sum_{i \geq 1,\ \ell_i \in \partial B} w_{\ell_i}\, \delta_{\ell_i}(f_{i-1}) \ \leq\ e^\theta \sum_{i\geq1} w_{\ell_i}\, \delta_{\ell_i}(f_{i-1}) \ \leq\ \frac{e^\theta}{1-\lambda}\, W(f) .
```

Dit is de bewering. $\square$

### 4.5 Bewijs van stelling C

**Punt 1.** Zet $R = \mathcal{L}\setminus B$; dan is $A \subset R$ en is $f$ een functie op $G^R$ met $\delta_k(f) = 0$ voor $k \notin A$. Met de ontbinding van §4.3 is $\mu(fg) = \int \mu_B(d\omega)\  g(\omega)\  \mu^\omega(f)$ en $\mu(f) = \int\mu_B(d\omega')\  \mu^{\omega'}(f)$. Voor elke constante $c$ is dus

```math
\mu(fg) - \mu(f)\mu(g) = \int \mu_B(d\omega)\, \big( g(\omega) - c \big) \Big[ \mu^\omega(f) - \int \mu_B(d\omega')\, \mu^{\omega'}(f) \Big] .
```

De term tussen rechte haken is in absolute waarde hoogstens $\sup_{\omega,\omega'}\lvert\mu^\omega(f) - \mu^{\omega'}(f)\rvert$. Kies $c = \tfrac12(\sup g + \inf g)$, zodat $\lvert g - c\rvert \leq \tfrac12\operatorname{osc}(g)$, en pas propositie C.6 toe. Dat geeft de eerste ongelijkheid; de tweede volgt uit $d(k,B) \geq d(A,B)$ voor $k \in A$.

**Punt 2.** Zij $\Lambda_s$ een ruimtelijk rooster, $N \geq 3$, en gebruik de notatie van hoofdstuk 2. Geef elke link een tijdcoördinaat: een ruimtelijke link in tijdlaag $s$ krijgt $s$, een tijdlink van laag $s$ naar laag $s+1$ krijgt $s + \tfrac12$. De links van een ruimtelijke plaquette hebben dezelfde tijdcoördinaat; die van een tijdplaquette hebben $s$, $s + \tfrac12$, $s + \tfrac12$ en $s+1$. Twee buren verschillen dus hoogstens 1 in tijdcoördinaat (gemeten langs de cirkel $\mathbb{Z}/N$). Zij $A$ de verzameling ruimtelijke links in tijdlaag 0 en $B$ die in tijdlaag $t$, met $1 \leq t \leq N/2$. Dan is $d(A, B) \geq t$.

Zij $F : \mathcal{C} \to \mathbb{R}$ continu. Punt 1 met $f = F(u^0)$ en $g = F(u^t)$ geeft, voor elke $N \geq 2t$ en elke $\theta$ met $0 \lt \theta \lt \ln(1/\alpha)$,

```math
\Big\lvert \mu\big(F(u^0)F(u^t)\big) - \mu\big(F(u^0)\big)\,\mu\big(F(u^t)\big) \Big\rvert \ \leq\ C_\theta\ \frac{\operatorname{osc}(F)}{2}\ \Delta(F)\ e^{-\theta t} ,
```

met een rechterlid dat niet van $N$ afhangt. Wegens de translatie-invariantie in de tijd is $\mu(F(u^t)) = \mu(F(u^0))$. Laat $N \to \infty$: volgens stelling A, punt 5, convergeert het linkerlid naar $C_F(t) = \sum_{n\geq1} (\lambda_n/\lambda_0)^t \lvert\langle\psi_n, F\Omega\rangle\rvert^2$. Alle termen zijn $\geq 0$, dus

```math
\Big(\frac{\lambda_1}{\lambda_0}\Big)^{t}\, \big\lvert\langle\psi_1, F\Omega\rangle\big\rvert^2 \ \leq\ C_\theta\ \frac{\operatorname{osc}(F)}{2}\ \Delta(F)\ e^{-\theta t} \qquad \text{voor alle } t \geq 1 .
```

Kies $F = \psi_1/\Omega$; deze is continu en reëel en $\langle\psi_1, F\Omega\rangle = 1$ (stelling A, punt 5). Trek de $t$-de-machtswortel en laat $t \to \infty$: $\lambda_1/\lambda_0 \leq e^{-\theta}$. Dit geldt voor elke $\theta \lt \ln(1/\alpha)$, dus $\lambda_1/\lambda_0 \leq \alpha$ en $m = \ln(\lambda_0/\lambda_1) \geq \ln(1/\alpha)$.

**Punt 3.** Voor een link $k$ van $\mathbb{Z}^D$ zij $\varrho(k)$ het maximum van de coördinaten (in absolute waarde) van zijn twee eindpunten, en voor $r \geq 1$ zij $R_r$ de verzameling links met $\varrho(k) \leq r$: de links binnen de kubus $Q_r = \lbrace -r, \dots, r\rbrace^D$. Buren verschillen hoogstens 1 in $\varrho$. Zij $L \geq 2r + 3$. Dan is de projectie $\mathbb{Z}^D \to (\mathbb{Z}/L)^D$ injectief op $Q_{r+1}$, en elke plaquette van het periodieke rooster die een link van $R_r$ bevat, heeft al haar hoekpunten in het beeld van $Q_{r+1}$. De plaquettes die $R_r$ raken, en de links daarin, zijn dus voor elke $L \geq 2r+3$ dezelfde als in $\mathbb{Z}^D$.

Pas §4.3 toe op het periodieke rooster met $R = R_r$ en $B$ het complement. De dichtheid $p^\omega$ hangt alleen af van de plaquettes die $R_r$ raken, dus alleen van $\omega$ op de links van $B$ die een buur in $R_r$ hebben, en de familie maten $\lbrace\mu^\omega\rbrace$ op $G^{R_r}$ is voor elke $L \geq 2r+3$ dezelfde. Zij $f$ een functie van de links in $R_{r_0}$, met $r_0 \lt r$. Een pad van buren van een link $k \in R_r$ naar $B$ verlaat $R_r$ pas na minstens $r + 1 - \varrho(k)$ stappen, dus $d(k, B) \geq r + 1 - \varrho(k)$. Omdat $\mu_L(f) = \int\mu_{L,B}(d\omega)\ \mu^\omega(f)$ een gemiddelde is van de getallen $\mu^\omega(f)$, geeft propositie C.6 voor alle $L, L' \geq 2r+3$:

```math
\big\lvert \mu_L(f) - \mu_{L'}(f) \big\rvert \ \leq\ \sup_{\omega,\omega'} \big\lvert\mu^\omega(f) - \mu^{\omega'}(f)\big\rvert \ \leq\ C_\theta\, \Delta(f)\, e^{-\theta(r + 1 - r_0)} .
```

Het rechterlid gaat naar nul als $r \to \infty$, dus $(\mu_L(f))_L$ is een Cauchy-rij en de limiet $\langle f\rangle$ bestaat. Voor functies $f, g$ van eindig veel links met disjuncte dragers $A, B$ geldt de ongelijkheid van punt 1 voor elke voldoende grote $L$ (dan is de linkafstand tussen $A$ en $B$ in het periodieke rooster gelijk aan die in $\mathbb{Z}^D$), met een rechterlid dat niet van $L$ afhangt. De limiet $L \to \infty$ van $\mu_L(fg)$, $\mu_L(f)$ en $\mu_L(g)$ geeft de ongelijkheid voor $\langle\cdot\rangle$. $\blacksquare$

### 4.6 Opmerkingen

**Hoe ver dit reikt.** Het bewijs gebruikt van de groep alleen dat $\operatorname{Tr}$ reëel is met $\lvert\operatorname{Tr}\rvert \leq 2$ en dat de Haar-maat bestaat. Het werkt daarom met dezelfde vorm voor andere compacte ijkgroepen, met een aangepaste constante. Het werkt niet voor grote $\beta$: zodra $\alpha(\beta,D) \geq 1$ is er geen krimp meer in lemma C.3, en geen enkele verfijning van dit argument kan dat herstellen voor $\beta \to \infty$, omdat de linkvariabelen daar werkelijk sterk van hun buren afhangen.

**Toets aan stelling B.** In $D = 2$ geeft stelling B de exacte kloof $m = L\ln(I_1(\beta)/I_2(\beta))$ met $L \geq 3$, en stelling C de ondergrens $\ln(1/(6\tanh\beta))$ voor $\beta \lt 0{,}1682$. Bij $\beta = 0{,}1$ en $L = 3$ is de exacte kloof $3 \times 3{,}689 = 11{,}07$ en de ondergrens $0{,}514$. De ondergrens klopt en is ruim.

**Verband met clusterontwikkelingen.** Het klassieke bewijs van een kloof bij sterke koppeling (Osterwalder en Seiler, 1978) gebruikt een convergente clusterontwikkeling en geeft ook de oppervlaktewet voor Wilson-lussen (opsluiting). Het bewijs hierboven volgt de techniek van Dobrushin voor zwak gekoppelde systemen; het is korter, maar geeft alleen het verval van correlaties en de kloof, niet de oppervlaktewet.

---

## 5. Wat niet bewezen is, en waarom deze methoden daar ophouden

### 5.1 Wat het millenniumprobleem vraagt

De officiële probleemstelling (Jaffe en Witten, 2000) vraagt: bewijs dat voor elke compacte enkelvoudige ijkgroep een kwantum-Yang–Mills-theorie op $\mathbb{R}^4$ bestaat die voldoet aan axioma's minstens zo sterk als die van Wightman of Osterwalder–Schrader, en dat die theorie een massakloof $\Delta \gt 0$ heeft. Langs de weg van het rooster betekent dat voor SU(2) (zie `THEORY.md` §5.5):

1. De limiet $a \to 0$ (dus $\beta \to \infty$) en het oneindige volume van de correlatiefuncties bestaan, en de limiet is niet triviaal.
2. De limiet voldoet aan de axioma's, waaronder volledige draai-invariantie, die het rooster niet heeft.
3. De kloof blijft in fysische eenheden van nul weg: er is een $c \gt 0$ met
   $$m(\beta) \ \geq\ c \cdot a\Lambda_L(\beta), \qquad a\Lambda_L(\beta) = \Big(\frac{6\pi^2\beta}{11}\Big)^{51/121} \exp\Big(-\frac{3\pi^2\beta}{11}\Big),$$
   voor alle voldoende grote $\beta$, uniform in het volume. Hierin is $m(\beta)$ de kloof in roostereenheden en is $a\Lambda_L$ de schaal van asymptotische vrijheid. In roostereenheden moet de kloof dus naar nul gaan, maar niet sneller dan deze formule.
4. Hetzelfde voor elke compacte enkelvoudige groep.

### 5.2 Wat de drie stellingen daarvan leveren

| vereiste | geleverd door | onder welke voorwaarde | voor $D = 4$, $\beta \to \infty$ |
|---|---|---|---|
| theorie op een eindig rooster bestaat | §1.3 | altijd | ja, maar dat is niet de vraag |
| Hilbertruimte en Hamiltoniaan (reflectiepositiviteit) | stelling A | elk eindig rooster, elke $\beta$ | ja, op elk eindig rooster |
| kloof groter dan nul | stelling A | elk eindig rooster, elke $\beta$ | ja, maar zonder ondergrens |
| kloof uniform in het volume | stelling C | alleen $\beta \lt \beta_0(D)$ | **nee** |
| oneindig volume bestaat | stelling C | alleen $\beta \lt \beta_0(D)$ | **nee** |
| continuümlimiet bestaat | stelling B | alleen $D = 2$ | **nee** |
| kloof in het continuüm | stelling B | alleen $D = 2$ | **nee** |
| axioma's in het continuüm, alle groepen | geen | | **nee** |

De vier regels met "nee" zijn samen het millenniumprobleem. Geen daarvan wordt in dit document bewezen.

### 5.3 Waar de methoden ophouden

**De afstand tussen "bewezen" en "nodig".** Stelling C geldt in vier dimensies voor $\beta \lt 0{,}0556$. De simulaties van het rapport liggen bij $\beta = 2{,}2$ tot $2{,}5$; de continuümlimiet ligt bij $\beta \to \infty$. In het gebied van stelling C is de correlatielengte (de afstand waarover de velden elkaar voelen, $1/m$) een kleine fractie van één roosterafstand. Voor de continuümlimiet moet de correlatielengte in roostereenheden juist naar oneindig gaan: volgens de formule in §5.1 verdubbelt zij telkens als $\beta$ met ongeveer $0{,}26$ toeneemt. Een bewijs moet de correlaties beheersen over al die schalen tegelijk.

**Waarom stelling C daar niet komt.** Het bewijs van stelling C berust op zwakke afhankelijkheid: de verdeling van één link verandert weinig als één buur verandert, en de som van die invloeden over alle buren is kleiner dan 1. Voor grote $\beta$ is dat eenvoudig niet waar: de afhankelijkheidscoëfficiënt tussen twee buren nadert dan 1, en de som nadert $6(D-1)$. De methode heeft dus geen "betere constante" nodig; haar uitgangspunt vervalt.

**Waarom een algemeen argument niet kan volstaan.** Het bewijs van stelling C gebruikt van de groep alleen dat het spoor begrensd is. Het werkt daarom letterlijk ook voor de ijkgroep U(1), de roosterversie van het elektromagnetisme. Maar voor U(1) in vier dimensies is bewezen dat de theorie zich bij zwakke koppeling anders gedraagt dan bij sterke koppeling: er is dan geen opsluiting (Guth 1980; Fröhlich en Spencer 1982). Een bewijs van de kloof voor SU(2) bij alle $\beta$ moet dus iets gebruiken wat SU(2) van U(1) onderscheidt. Stelling C doet dat niet, en kan daarom nooit tot alle $\beta$ worden opgerekt.

**Waarom stelling A niet helpt.** Stelling A geldt voor elke $\beta$, maar het bewijs gebruikt alleen dat de kern van $\mathsf{T}$ op een compacte ruimte strikt positief is. De ondergrens van die kern gaat exponentieel naar nul met het aantal links, en daarmee elke ondergrens voor de kloof die uit dit argument te halen is. Stelling A sluit niet uit dat de kloof naar nul gaat bij groeiend volume. Ook dat is geen detail: hetzelfde bewijs geldt voor U(1).

**Waarom stelling B niet helpt.** In twee dimensies zijn de plaquettes onafhankelijk van elkaar en blijft alleen de holonomie over. In drie en vier dimensies zijn de plaquettes rond elk kubusje aan elkaar gekoppeld; daardoor zijn er lokale vrijheidsgraden die zich voortplanten, en is er geen exacte oplossing bekend.

### 5.4 Wat er wel zou moeten gebeuren

Een bewijs langs het rooster heeft een methode nodig die de theorie schaal voor schaal volgt van de roosterafstand tot de correlatielengte, en die op elke schaal de effectieve koppeling beheerst: een rigoureuze renormalisatiegroep. Het verst gevorderde werk in die richting (Bałaban, 1984–1989) bewijst dat de toestandssom in een vast fysisch volume begrensd blijft als $a \to 0$. Dat is een resultaat over de korte afstanden. Over de lange afstanden, waar de kloof zit, zegt het niets. De stap van "beheerste korte afstanden" naar "een kloof op lange afstanden" is precies het open deel van het probleem, en dit document draagt daar niets aan bij.

### 5.5 Verhouding tot de simulaties

Stelling A zegt dat het getal dat de simulaties in het rapport schatten, de kloof $m$ van de overdrachtsmatrix op het gesimuleerde rooster, bestaat en groter dan nul is. De simulaties schatten dat getal bij $\beta = 2{,}2$ tot $2{,}5$ (vier dimensies) en vinden waarden die verenigbaar zijn met een kloof die bij groeiend volume niet verdwijnt. Dat is numeriek bewijsmateriaal voor eindig veel roosters; het is geen bewijs, en het zegt niets over $\beta \to \infty$. De stellingen van dit document veranderen daar niets aan: zij gelden óf voor elk afzonderlijk eindig rooster (A), óf in twee dimensies (B), óf ver weg van het gebied van de simulaties (C).

---

## 6. Numerieke controles van de bewijzen

*(Dit hoofdstuk wordt ingevuld nadat de controles zijn gedraaid.)*

---

## 7. Herkomst en literatuur

De stellingen in dit document zijn bekend. De bewijzen zijn hier opnieuw uitgeschreven; de schrijver heeft de oorspronkelijke artikelen in deze sessie niet kunnen openen, dus de toeschrijvingen hieronder berusten op het geheugen van het AI-systeem en op zoekresultaten. Legenda: ✔ = titel en vindplaats via een zoekmachine teruggevonden; ○ = uit het geheugen geciteerd, niet opnieuw gecontroleerd (jaartal, band of pagina kan een fout bevatten).

**Stelling A (overdrachtsmatrix, reflectiepositiviteit, uniek vacuüm).**

- ○ M. Lüscher, "Construction of a selfadjoint, strictly positive transfer matrix for Euclidean lattice gauge theories", Commun. Math. Phys. 54 (1977) 283.
- ✔ K. Osterwalder, E. Seiler, "Gauge field theories on a lattice", Ann. Phys. 110 (1978) 440–471.
- ○ M. Creutz, "Gauge fixing, the transfer matrix, and confinement on a lattice", Phys. Rev. D15 (1977) 1128.
- ○ E. Seiler, *Gauge Theories as a Problem of Constructive Quantum Field Theory and Statistical Mechanics*, Lecture Notes in Physics 159, Springer (1982).
- De uniciteit van het vacuüm volgt uit de stelling van Perron–Frobenius in de vorm van Jentzsch voor integraaloperatoren met positieve kern; zie bijvoorbeeld ○ M. Reed, B. Simon, *Methods of Modern Mathematical Physics IV*, Academic Press (1978), §XIII.12.

**Stelling B (twee dimensies).**

- ○ A. A. Migdal, "Recursion equations in gauge field theories", Sov. Phys. JETP 42 (1975) 413.
- ○ D. J. Gross, E. Witten, "Possible third-order phase transition in the large-N lattice gauge theory", Phys. Rev. D21 (1980) 446 (de één-plaquette-integraal en de karakterontwikkeling).
- ○ E. Witten, "On quantum gauge theories in two dimensions", Commun. Math. Phys. 141 (1991) 153–209.
- ✔ B. K. Driver, "$\mathrm{YM}_2$: continuum expectations, lattice convergence, and lassos", Commun. Math. Phys. 123 (1989) 575–616; ✔ L. Gross, C. King, A. Sengupta, "Two-dimensional Yang–Mills theory via stochastic differential equations", Ann. Phys. 194 (1989) 65–112 (rigoureuze constructie van de continuümtheorie in twee dimensies).

**Stelling C (sterke koppeling).**

- ✔ K. Osterwalder, E. Seiler (1978), hierboven: kloof en opsluiting bij sterke koppeling met een clusterontwikkeling.
- ○ R. L. Dobrushin, "The description of a random field by means of conditional probabilities and conditions of its regularity", Theory Probab. Appl. 13 (1968) 197–224; "Prescribing a system of random variables by conditional distributions", Theory Probab. Appl. 15 (1970) 458–486 (de uniciteitsvoorwaarde waarop §4 berust).
- ○ H. Föllmer, "A covariance estimate for Gibbs measures", J. Funct. Anal. 46 (1982) 387–395; ○ H. Künsch, "Decay of correlations under Dobrushin's uniqueness condition and its applications", Commun. Math. Phys. 84 (1982) 207–222.
- ○ B. Simon, *The Statistical Mechanics of Lattice Gases*, vol. 1, Princeton University Press (1993), hoofdstuk V; ○ H.-O. Georgii, *Gibbs Measures and Phase Transitions*, de Gruyter (1988), hoofdstuk 8.
- ✔ H. Shen, R. Zhu, X. Zhu, "A stochastic analysis approach to lattice Yang–Mills at strong coupling", Commun. Math. Phys. 400 (2023) 805–851 (een recent bewijs van de kloof bij sterke koppeling met expliciete grens, langs een andere weg).

**Het open probleem en de gedeeltelijke resultaten (hoofdstuk 5).**

- ✔ A. Jaffe, E. Witten, "Quantum Yang–Mills Theory", officiële probleembeschrijving, Clay Mathematics Institute (2000).
- ○ A. H. Guth, Phys. Rev. D21 (1980) 2291; ○ J. Fröhlich, T. Spencer, Commun. Math. Phys. 83 (1982) 411 (U(1) in vier dimensies bij zwakke koppeling).
- ✔ T. Bałaban, "Renormalization group approach to lattice gauge field theories I", Commun. Math. Phys. 109 (1987) 249–301, en de overige artikelen van de reeks (zie `THEORY.md` §9).

De volledige lijst met de numerieke literatuur staat in `THEORY.md` §9 en `literature.json`.

---

## Bijlage: gebruikte standaardresultaten

De bewijzen in dit document gebruiken de volgende resultaten uit de standaardleerboeken zonder bewijs.

- **(S1) Haar-maat.** Op een compacte groep bestaat precies één kansmaat die invariant is onder links- en rechtsvermenigvuldiging; zij is ook invariant onder $g \mapsto g^{-1}$ en geeft elke niet-lege open verzameling positieve maat.
- **(S2) Stelling van Fubini.** Voor begrensde meetbare functies op een product van kansruimten mag de volgorde van integratie worden verwisseld.
- **(S3) Integraaloperatoren.** Zij $X$ een compacte metrische ruimte met een eindige maat en $k$ een continue functie op $X \times X$. De operator $(\mathsf{A}f)(x) = \int k(x,y) f(y)\  dy$ op $L^2(X)$ is een Hilbert–Schmidt-operator en dus compact, en $\mathsf{A}f$ is continu voor elke $f \in L^2(X)$. Het product van twee zulke operatoren heeft als kern $\int k_1(x,z)\  k_2(z,y)\  dz$, en $\operatorname{Tr}(\mathsf{A}_1\mathsf{A}_2) = \int\int k_1(x,y)\  k_2(y,x)\  dx\  dy$. Een compacte zelfgeadjungeerde operator heeft een orthonormale basis van eigenvectoren met reële eigenwaarden die alleen in 0 kunnen ophopen; is hij positief semidefiniet, dan is zijn norm de grootste eigenwaarde. Voor een Hilbert–Schmidt-operator is $\sum_n \lambda_n^2 \lt \infty$.
- **(S4) Stelling van Stone–Weierstrass.** Een algebra van continue complexe functies op een compacte ruimte die de constanten bevat, punten scheidt en gesloten is onder complexe conjugatie, ligt dicht in de ruimte van alle continue functies met de supremumnorm.
- **(S5) Representaties van SU(2).** De feiten van §3.1: de irreducibele representaties $D^j$, hun karakters, de integratieformule voor klassefuncties, de volledigheid van de karakters in $L^2_{\mathrm{kl}}(G)$ (stelling van Peter–Weyl), en het lemma van Schur.
- **(S6) Gemodificeerde Besselfuncties.** Voor gehele $n \geq 0$ en $x \gt 0$: de machtreeks $I_n(x) = \sum_{k\geq0} (x/2)^{2k+n}/(k!\ (k+n)!)$; de integraalvoorstelling $I_n(x) = \frac1\pi\int_0^\pi e^{x\cos\theta}\cos(n\theta)\  d\theta$; de recurrentie $I_{n-1}(x) - I_{n+1}(x) = \frac{2n}{x} I_n(x)$; de afgeleiden $I_n' = I_{n+1} + \frac{n}{x}I_n = I_{n-1} - \frac{n}{x} I_n$; en voor vaste $n$ de asymptotiek $I_n(x) = \frac{e^x}{\sqrt{2\pi x}}\big[1 - \frac{4n^2-1}{8x} + O(x^{-2})\big]$ voor $x \to \infty$. (NIST Digital Library of Mathematical Functions, §10.25, §10.29, §10.32 en §10.40.)
