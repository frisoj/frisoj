# -*- coding: utf-8 -*-
"""Bouwt Plannerij-AI-Prompt-Pack.pdf (A4 staand) met reportlab. Twee passes voor de inhoudsopgave."""
import json, os
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_LEFT, TA_CENTER
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (BaseDocTemplate, PageTemplate, Frame, Paragraph, Spacer,
                                PageBreak, KeepTogether, Table, TableStyle, Flowable, NextPageTemplate)
from xml.sax.saxutils import escape

BASE = '/tmp/claude-0/-home-user-frisoj/b2406013-c3ca-5da6-8b93-0de4c5b2366a/scratchpad'
FONTS = os.path.join(BASE, 'build', 'fonts')
BUILD = os.path.join(BASE, 'build', 'prompts')
OUT = os.path.join(BASE, 'out', 'prompts', 'Plannerij-AI-Prompt-Pack.pdf')

for name, f in [('Inter', 'Inter-400.ttf'), ('Inter-Medium', 'Inter-500.ttf'), ('Inter-SemiBold', 'Inter-600.ttf'),
                ('Inter-Bold', 'Inter-700.ttf'), ('Playfair-SemiBold', 'PlayfairDisplay-600.ttf'),
                ('Playfair-Bold', 'PlayfairDisplay-700.ttf')]:
    pdfmetrics.registerFont(TTFont(name, os.path.join(FONTS, f)))
pdfmetrics.registerFontFamily('Inter', normal='Inter', bold='Inter-Bold', italic='Inter', boldItalic='Inter-Bold')

GREEN = colors.HexColor('#5F7A61'); LIGHT = colors.HexColor('#E8EFE6'); SAND = colors.HexColor('#F4EFE6')
DARK = colors.HexColor('#1F2A24'); GREY = colors.HexColor('#8A8F8B'); WHITE = colors.white
W, H = A4
M = 18 * mm
CW = W - 2 * M

items = json.load(open(os.path.join(BUILD, 'prompts.json'), encoding='utf-8'))
cats = json.load(open(os.path.join(BUILD, 'categories.json'), encoding='utf-8'))

# ---------- stijlen ----------
def S(name, **kw):
    base = dict(fontName='Inter', fontSize=10, leading=15, textColor=DARK)
    base.update(kw); return ParagraphStyle(name, **base)

st_body = S('body')
st_body_c = S('bodyc', alignment=TA_CENTER)
st_h1 = S('h1', fontName='Playfair-Bold', fontSize=26, leading=32, textColor=DARK)
st_h2 = S('h2', fontName='Playfair-SemiBold', fontSize=16, leading=21, textColor=DARK)
st_small = S('small', fontSize=8.5, leading=12, textColor=GREY)
st_kicker = S('kicker', fontName='Inter-SemiBold', fontSize=9, leading=12, textColor=GREEN)
st_card_title = S('ct', fontName='Inter-Bold', fontSize=11, leading=15, textColor=DARK)
st_prompt = S('pr', fontSize=9.5, leading=14, textColor=DARK)
st_tip = S('tip', fontName='Inter-Medium', fontSize=8.5, leading=12.5, textColor=GREY)
st_toc = S('toc', fontSize=11, leading=16)
st_tocnum = S('tocnum', fontName='Inter-SemiBold', fontSize=11, leading=16, textColor=GREEN)
st_tocpage = S('tocpage', fontName='Inter-Medium', fontSize=11, leading=16, textColor=GREY, alignment=2)

# ---------- pagina-achtergronden ----------
def footer(c, doc):
    c.saveState()
    c.setStrokeColor(LIGHT); c.setLineWidth(0.8)
    c.line(M, 14 * mm, W - M, 14 * mm)
    c.setFont('Inter-Medium', 8); c.setFillColor(GREY)
    c.drawString(M, 9 * mm, 'Plannerij  ·  AI Prompt Pack')
    c.drawRightString(W - M, 9 * mm, str(doc.page))
    c.restoreState()

def cover_bg(c, doc):
    c.saveState()
    c.setFillColor(WHITE); c.rect(0, 0, W, H, stroke=0, fill=1)
    # groot groen vlak onderaan met schuine bovenrand
    c.setFillColor(GREEN)
    p = c.beginPath(); p.moveTo(0, 0); p.lineTo(W, 0); p.lineTo(W, H * 0.40); p.lineTo(0, H * 0.31); p.close()
    c.drawPath(p, stroke=0, fill=1)
    # lichte cirkel als decoratie
    c.setFillColor(LIGHT); c.circle(W - 38 * mm, H - 52 * mm, 34 * mm, stroke=0, fill=1)
    c.setFillColor(SAND); c.circle(W - 52 * mm, H - 66 * mm, 14 * mm, stroke=0, fill=1)
    # tekst
    c.setFillColor(GREEN); c.setFont('Inter-SemiBold', 12)
    c.drawString(M, H - 28 * mm, 'P L A N N E R I J')
    c.setFillColor(DARK); c.setFont('Playfair-Bold', 58)
    c.drawString(M, H * 0.60, 'AI Prompt')
    c.drawString(M, H * 0.60 - 62, 'Pack')
    c.setFont('Inter', 14); c.setFillColor(DARK)
    c.drawString(M, H * 0.60 - 62 - 34, '200 Nederlandse prompts voor')
    c.drawString(M, H * 0.60 - 62 - 34 - 20, 'ChatGPT, Claude & Gemini')
    # in het groene vlak
    c.setFillColor(WHITE); c.setFont('Inter-SemiBold', 11)
    c.drawString(M, H * 0.31 - 22 * mm, '10 categorieën  ·  Ondernemen, marketing, content, e-mail, productiviteit,')
    c.setFont('Inter', 11)
    c.drawString(M, H * 0.31 - 22 * mm - 16, 'studie, carrière, geld, persoonlijke groei en gezin.')
    c.setFont('Inter', 9); c.setFillColor(LIGHT)
    c.drawString(M, 16 * mm, 'Editie 2026  ·  plannerij')
    c.restoreState()

def divider_bg(c, doc):
    c.saveState()
    c.setFillColor(LIGHT); c.rect(0, 0, W, H, stroke=0, fill=1)
    c.setFillColor(GREEN); c.rect(0, 0, 12 * mm, H, stroke=0, fill=1)
    c.setFillColor(SAND); c.circle(W - 30 * mm, 40 * mm, 42 * mm, stroke=0, fill=1)
    c.restoreState()
    footer(c, doc)

# ---------- kaart-flowable ----------
class PromptCard(Flowable):
    """Eén promptkaart: accentbalk links, nummer + titel, zand kader met prompt, tip eronder."""
    PAD = 4.5 * mm; BAR = 2.2 * mm; INNER = 3.5 * mm
    def __init__(self, it):
        Flowable.__init__(self); self.it = it
    def wrap(self, aw, ah):
        self.aw = aw
        inner_w = aw - self.PAD * 2 - self.BAR
        self.p_title = Paragraph(f'<font color="#5F7A61">{self.it["id"]:03d}</font>&nbsp;&nbsp;{escape(self.it["titel"])}', st_card_title)
        self.p_prompt = Paragraph(escape(self.it['prompt']), st_prompt)
        self.p_tip = Paragraph(f'<font color="#5F7A61"><b>Tip:</b></font> {escape(self.it["tip"])}', st_tip)
        _, self.h_title = self.p_title.wrap(inner_w, ah)
        _, self.h_prompt = self.p_prompt.wrap(inner_w - 2 * self.INNER, ah)
        _, self.h_tip = self.p_tip.wrap(inner_w, ah)
        self.box_h = self.h_prompt + 2 * self.INNER
        self.height = self.PAD + self.h_title + 2.5 * mm + self.box_h + 2.5 * mm + self.h_tip + self.PAD
        self.width = aw
        return aw, self.height
    def draw(self):
        c = self.canv; h = self.height; w = self.width
        c.setFillColor(WHITE); c.setStrokeColor(LIGHT); c.setLineWidth(0.8)
        c.roundRect(0, 0, w, h, 3 * mm, stroke=1, fill=1)
        c.setFillColor(GREEN); c.roundRect(0, 0, self.BAR + 1.5 * mm, h, 3 * mm, stroke=0, fill=1)
        c.setFillColor(WHITE); c.rect(self.BAR, 0.4, 2 * mm, h - 0.8, stroke=0, fill=1)  # rechte binnenkant balk
        x = self.PAD + self.BAR; y = h - self.PAD - self.h_title
        self.p_title.drawOn(c, x, y)
        y -= 2.5 * mm + self.box_h
        inner_w = w - self.PAD * 2 - self.BAR
        c.setFillColor(SAND); c.roundRect(x, y, inner_w, self.box_h, 2 * mm, stroke=0, fill=1)
        self.p_prompt.drawOn(c, x + self.INNER, y + self.INNER)
        y -= 2.5 * mm + self.h_tip
        self.p_tip.drawOn(c, x, y)

# ---------- document ----------
class Doc(BaseDocTemplate):
    def __init__(self, path, toc_pages):
        BaseDocTemplate.__init__(self, path, pagesize=A4, leftMargin=M, rightMargin=M, topMargin=16 * mm, bottomMargin=19 * mm,
                                 title='Plannerij – AI Prompt Pack', author='Plannerij', subject='200 Nederlandse prompts voor ChatGPT, Claude & Gemini')
        self.toc_pages = toc_pages; self.cat_pages = {}
        fr = Frame(M, 19 * mm, CW, H - 35 * mm, id='f', leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
        self.addPageTemplates([PageTemplate(id='cover', frames=[fr], onPage=cover_bg),
                               PageTemplate(id='normal', frames=[fr], onPage=footer),
                               PageTemplate(id='divider', frames=[fr], onPage=divider_bg)])
    def afterFlowable(self, fl):
        if hasattr(fl, '_cat_marker'):
            self.cat_pages[fl._cat_marker] = self.page

def cat_items(cat): return [i for i in items if i['categorie'] == cat]

def build(toc_pages):
    doc = Doc(OUT, toc_pages)
    story = []
    # (a) omslag – tekst staat in de achtergrond
    story += [NextPageTemplate('normal'), PageBreak()]

    # (b) Zo gebruik je dit pakket
    story.append(Paragraph('HANDLEIDING', st_kicker)); story.append(Spacer(1, 2 * mm))
    story.append(Paragraph('Zo gebruik je dit pakket', st_h1)); story.append(Spacer(1, 4 * mm))
    story.append(Paragraph('Elke prompt in dit pakket is een kant-en-klare opdracht voor ChatGPT, Claude of Gemini. Kopieer de tekst uit het zandkleurige kader, vul de haken in en plak hem in je AI-tool. Zes tips om er het meeste uit te halen:', st_body))
    story.append(Spacer(1, 5 * mm))
    tips = [('Vul de haken in', 'Alles tussen [vierkante haken] vervang je door je eigen situatie. Hoe concreter, hoe beter: niet [doelgroep] maar "drukke ouders met kinderen onder de zes in Utrecht".'),
            ('Geef context', 'Plak gerust extra informatie onder de prompt: een eerdere tekst, cijfers, een vacature, een klantmail. De AI wordt scherper naarmate hij meer van jouw situatie weet.'),
            ('Vraag om een formaat', 'De prompts vragen om tabellen, kopjes of een maximaal aantal woorden. Pas dat aan naar wat jij nodig hebt: een opsomming, een e-mail, een script of een stappenplan.'),
            ('Itereer', 'Het eerste antwoord is een begin, geen eindresultaat. Zeg wat je wél en niet goed vindt: "korter", "minder formeel", "geef drie alternatieven voor de opening". Je kunt blijven bijsturen.'),
            ('Controleer feiten', 'AI kan cijfers, regels, bronnen en namen verzinnen. Alles over belasting, wetgeving, gezondheid en geld controleer je bij een officiële bron of een adviseur voordat je erop handelt.'),
            ('Bewaar je favorieten', 'Sla de prompts die voor jou werken op, inclusief jouw ingevulde versie. Het CSV-bestand in dit pakket kun je importeren in Notion of Excel en zelf uitbreiden.')]
    rows = []
    for n, (t, d) in enumerate(tips, 1):
        rows.append([Paragraph(f'<font color="#5F7A61">{n}</font>', S('n', fontName='Playfair-Bold', fontSize=20, leading=22)),
                     Paragraph(f'<b>{t}</b><br/>{d}', S('tipb', fontSize=9.5, leading=14))])
    t = Table(rows, colWidths=[12 * mm, CW - 12 * mm])
    t.setStyle(TableStyle([('VALIGN', (0, 0), (-1, -1), 'TOP'), ('BOTTOMPADDING', (0, 0), (-1, -1), 5), ('TOPPADDING', (0, 0), (-1, -1), 3),
                           ('LINEBELOW', (0, 0), (-1, -2), 0.5, LIGHT)]))
    story.append(t); story.append(Spacer(1, 6 * mm))
    story.append(Paragraph('ChatGPT, Claude of Gemini?', st_h2)); story.append(Spacer(1, 2 * mm))
    tools = [('ChatGPT (OpenAI)', 'De bekendste en meest veelzijdige. Sterk in brainstormen, snelle teksten en gesprekken. Kan afbeeldingen maken en heeft veel uitbreidingen.'),
             ('Claude (Anthropic)', 'Schrijft natuurlijk en genuanceerd Nederlands, is sterk in lange teksten, analyses en het verwerken van grote documenten. Fijn voor zorgvuldig redactiewerk.'),
             ('Gemini (Google)', 'Verbonden met Google-diensten zoals Gmail, Drive en Zoeken. Handig als je met actuele informatie werkt of je documenten in Google Workspace staan.')]
    rows = [[Paragraph(f'<b>{a}</b>', S('ta', fontSize=9.5, leading=13)), Paragraph(b, S('tb', fontSize=9.5, leading=13))] for a, b in tools]
    t = Table(rows, colWidths=[38 * mm, CW - 38 * mm])
    t.setStyle(TableStyle([('VALIGN', (0, 0), (-1, -1), 'TOP'), ('BACKGROUND', (0, 0), (-1, -1), SAND), ('BOX', (0, 0), (-1, -1), 0, SAND),
                           ('TOPPADDING', (0, 0), (-1, -1), 6), ('BOTTOMPADDING', (0, 0), (-1, -1), 6), ('LEFTPADDING', (0, 0), (-1, -1), 8)]))
    story.append(t); story.append(Spacer(1, 3 * mm))
    story.append(Paragraph('Alle prompts werken in alle drie de tools. De verschillen zitten in toon en details; probeer dezelfde prompt gerust in twee tools en kies het beste antwoord.', st_small))
    story.append(PageBreak())

    # (c) inhoudsopgave
    story.append(Paragraph('OVERZICHT', st_kicker)); story.append(Spacer(1, 2 * mm))
    story.append(Paragraph('Inhoudsopgave', st_h1)); story.append(Spacer(1, 6 * mm))
    rows = []
    for n, c in enumerate(cats, 1):
        pg = toc_pages.get(c['categorie'], '')
        rows.append([Paragraph(f'{n:02d}', st_tocnum), Paragraph(f'{escape(c["categorie"])}<br/><font size="8.5" color="#8A8F8B">Prompts {(n-1)*20+1} – {n*20}</font>', st_toc), Paragraph(str(pg), st_tocpage)])
    t = Table(rows, colWidths=[12 * mm, CW - 12 * mm - 16 * mm, 16 * mm])
    t.setStyle(TableStyle([('VALIGN', (0, 0), (-1, -1), 'TOP'), ('TOPPADDING', (0, 0), (-1, -1), 7), ('BOTTOMPADDING', (0, 0), (-1, -1), 7),
                           ('LINEBELOW', (0, 0), (-1, -1), 0.6, LIGHT)]))
    story.append(t); story.append(Spacer(1, 8 * mm))
    story.append(Paragraph('Achterin: Licentie en gebruiksvoorwaarden.', st_small))

    # (d) categorieën
    for n, c in enumerate(cats, 1):
        story += [NextPageTemplate('divider'), PageBreak()]
        story.append(Spacer(1, 55 * mm))
        k = Paragraph(f'CATEGORIE {n:02d}  ·  PROMPTS {(n-1)*20+1} – {n*20}', st_kicker); k._cat_marker = c['categorie']
        story.append(k); story.append(Spacer(1, 3 * mm))
        story.append(Paragraph(escape(c['categorie']), S('dh', fontName='Playfair-Bold', fontSize=34, leading=40)))
        story.append(Spacer(1, 6 * mm))
        story.append(Paragraph(escape(c['intro']), S('di', fontSize=11.5, leading=18)))
        story += [NextPageTemplate('normal'), PageBreak()]
        story.append(Paragraph(f'{n:02d}  ·  {escape(c["categorie"]).upper()}', st_kicker)); story.append(Spacer(1, 3 * mm))
        for it in cat_items(c['categorie']):
            story.append(KeepTogether([PromptCard(it), Spacer(1, 3.5 * mm)]))

    # licentie
    story += [NextPageTemplate('normal'), PageBreak()]
    story.append(Paragraph('VOORWAARDEN', st_kicker)); story.append(Spacer(1, 2 * mm))
    story.append(Paragraph('Licentie', st_h1)); story.append(Spacer(1, 5 * mm))
    lic = ['Dit pakket is bedoeld voor <b>persoonlijk gebruik</b> door de koper. Je mag de prompts onbeperkt gebruiken, aanpassen en de resultaten inzetten voor je eigen werk, bedrijf of studie, ook commercieel.',
           'Het is <b>niet toegestaan</b> om dit pakket of delen ervan door te verkopen, weg te geven, te delen, te publiceren of op te nemen in een ander product, cursus of abonnement, in welke vorm dan ook (PDF, CSV, tekst, schermafbeelding).',
           'De prompts zijn hulpmiddelen. Antwoorden van AI-tools kunnen fouten bevatten. Plannerij is niet aansprakelijk voor beslissingen die je neemt op basis van de uitkomsten; controleer juridische, fiscale, financiële en medische informatie altijd bij een deskundige.',
           'Vragen, fouten gevonden of een prompt die je mist? We horen het graag; zo wordt de volgende editie beter.']
    for p in lic:
        story.append(Paragraph(p, st_body)); story.append(Spacer(1, 3 * mm))
    story.append(Spacer(1, 8 * mm))
    story.append(Paragraph('© Plannerij 2026 · Alle rechten voorbehouden', S('c', fontName='Inter-SemiBold', fontSize=10, textColor=GREEN)))
    story.append(Paragraph('AI Prompt Pack · Editie 2026 · 200 prompts · 10 categorieën', st_small))
    doc.build(story)
    return doc.cat_pages, doc.page

if __name__ == '__main__':
    pages, _ = build({})            # pass 1: paginanummers verzamelen
    pages2, total = build(pages)    # pass 2: inhoudsopgave gevuld
    assert pages == pages2, 'paginanummers verschoven tussen passes'
    print('OK', OUT, 'pagina\'s:', total, pages)
