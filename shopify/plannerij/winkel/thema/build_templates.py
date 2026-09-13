"""Build the remaining Plannerij (Horizon) theme templates from the originals.

Reads Horizon's original templates from ORIG (saved from the theme copy), produces
Dutch, on-brand versions in OUT_DIR, and prints the list. Upload with themeFilesUpsert.
"""
import copy
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ORIG = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "_orig")
OUT_DIR = os.path.join(HERE, "templates")
os.makedirs(OUT_DIR, exist_ok=True)

SAGE, SAGE_DARK, LIGHT, SAND, DARK, WHITE = "#5F7A61", "#465C48", "#E8EFE6", "#F4EFE6", "#1F2A24", "#FFFFFF"
INDEX = json.load(open(os.path.join(HERE, "templates", "index.json")))


def orig(name):
    return json.load(open(os.path.join(ORIG, "templates__" + name)))


# ---------------------------------------------------------------- block helpers (settings copied from Horizon)
TEXT_BASE = {
    "width": "100%", "max_width": "normal", "alignment": "left", "type_preset": "rte",
    "font": "var(--font-body--family)", "font_size": "1rem", "line_height": "normal",
    "letter_spacing": "normal", "case": "none", "wrap": "pretty", "background": False,
    "background_color": "#00000026", "corner_radius": 0, "padding-block-start": 0,
    "padding-block-end": 0, "padding-inline-start": 0, "padding-inline-end": 0,
}


def text(html, preset="rte", width="100%", max_width="normal", align="left", color=None, **extra):
    s = dict(TEXT_BASE, text=html, type_preset=preset, width=width, max_width=max_width, alignment=align)
    if color:
        s["text_color"] = color
    s.update(extra)
    return {"type": "text", "settings": s, "blocks": {}}


def button(label, link, style="button", custom=None, width="fit-content"):
    s = {"label": label, "link": link, "open_in_new_tab": False, "style_class": style,
         "width": width, "custom_width": 100, "width_mobile": width, "custom_width_mobile": 100}
    if custom:
        s.update({"style_class": "button-custom", "custom_button_background": custom[0],
                  "custom_button_text": custom[1], "custom_button_border": custom[2]})
    return {"type": "button", "settings": s, "blocks": {}}


GROUP_BASE = {
    "content_direction": "column", "vertical_on_mobile": True, "horizontal_alignment": "flex-start",
    "vertical_alignment": "center", "align_baseline": False,
    "horizontal_alignment_flex_direction_column": "flex-start",
    "vertical_alignment_flex_direction_column": "center", "gap": 12, "width": "fill", "custom_width": 100,
    "width_mobile": "fill", "custom_width_mobile": 100, "height": "fit", "custom_height": 100,
    "background_media": "none", "video_position": "cover", "background_image_position": "cover",
    "toggle_overlay": False, "overlay_color": "#00000026", "overlay_style": "solid",
    "gradient_direction": "to top", "border": "none", "border_width": 1, "border_opacity": 100,
    "border_radius": 0, "open_in_new_tab": False, "padding-block-start": 0, "padding-block-end": 0,
    "padding-inline-start": 0, "padding-inline-end": 0,
}


def group(blocks, direction="column", gap=12, bg=None, radius=0, pad=0, valign="center", halign="flex-start"):
    s = dict(GROUP_BASE, content_direction=direction, gap=gap, border_radius=radius,
             vertical_alignment=valign, horizontal_alignment=halign)
    s["vertical_on_mobile"] = direction == "column" or True
    if bg:
        s["background_color"] = bg
    if pad:
        s.update({"padding-block-start": pad, "padding-block-end": pad, "padding-inline-start": pad, "padding-inline-end": pad})
    return {"type": "group", "settings": s, "blocks": blocks, "block_order": list(blocks.keys())}


def icon(name, color=SAGE, width=22):
    return {"type": "icon", "settings": {"icon": name, "width": width, "open_in_new_tab": False, "icon_color": color}, "blocks": {}}


SECTION_BASE = {
    "content_direction": "column", "vertical_on_mobile": True, "horizontal_alignment": "flex-start",
    "vertical_alignment": "center", "align_baseline": False,
    "horizontal_alignment_flex_direction_column": "flex-start",
    "vertical_alignment_flex_direction_column": "center", "gap": 12, "section_width": "page-width",
    "section_height": "", "section_height_custom": 50, "background_media": "none",
    "video_position": "cover", "background_image_position": "cover", "toggle_overlay": False,
    "overlay_color": "#00000026", "overlay_style": "solid", "gradient_direction": "to top",
    "border": "none", "border_width": 1, "border_opacity": 100, "border_radius": 0,
    "padding-block-start": 48, "padding-block-end": 48, "background_color": WHITE,
}


def section(blocks, bg=WHITE, gap=12, pad=(48, 48), direction="column", halign="flex-start", width="page-width"):
    s = dict(SECTION_BASE, background_color=bg, gap=gap, content_direction=direction,
             horizontal_alignment=halign, section_width=width)
    s["padding-block-start"], s["padding-block-end"] = pad
    if halign == "center":
        s["horizontal_alignment_flex_direction_column"] = "center"
    return {"type": "section", "blocks": blocks, "block_order": list(blocks.keys()), "name": "t:names.section", "settings": s}


def accordion(rows, preset="h5"):
    blocks = {}
    for i, (q, a) in enumerate(rows, 1):
        blocks[f"row_{i}"] = {"type": "_accordion-row",
                              "settings": {"heading": q, "open_by_default": False, "icon": "none", "width": 20},
                              "blocks": {"text": text(f"<p>{a}</p>")}, "block_order": ["text"]}
    return {"type": "accordion", "settings": {"icon": "caret", "dividers": True,
                                              "divider_color": "{{ settings.color_palette.color2 }}",
                                              "type_preset": preset, "border": "none", "border_width": 1,
                                              "border_opacity": 100, "border_radius": 0, "padding-block-start": 0,
                                              "padding-block-end": 0, "padding-inline-start": 0,
                                              "padding-inline-end": 0},
            "blocks": blocks, "block_order": list(blocks.keys())}


def product_list(heading, label="Bekijk alles", collection="all", max_products=4, columns=4, bg=WHITE):
    pl = copy.deepcopy(INDEX["sections"]["product_list_fa6P9H"])
    pl["settings"].update({"collection": collection, "max_products": max_products, "columns": columns,
                           "background_color": bg})
    hdr = pl["blocks"]["static-header"]["blocks"]
    for k, v in hdr.items():
        if v["type"] == "_product-list-text":
            v["settings"]["text"] = f"<h3>{heading}</h3>"
        if v["type"] == "_product-list-button":
            v["settings"]["label"] = label
    return pl


def media_with_content(image, caption, heading, body, btn_label, btn_link, image_left=True):
    m = copy.deepcopy(INDEX["sections"]["media_with_content_nl"])
    m["blocks"]["media"]["settings"]["image"] = f"shopify://shop_images/{image}"
    c = m["blocks"]["content"]["blocks"]
    c["text_caption"]["settings"]["text"] = f"<p>{caption}</p>"
    c["text_heading"]["settings"]["text"] = f"<h2>{heading}</h2>"
    c["text_body"]["settings"]["text"] = f"<p>{body}</p>"
    for k, v in c.items():
        if v["type"] == "button":
            v["settings"]["label"] = btn_label
            v["settings"]["link"] = btn_link
    m["settings"]["media_position"] = "left" if image_left else "right"
    return m


def save(name, data):
    path = os.path.join(OUT_DIR, name)
    json.dump(data, open(path, "w"), indent=2, ensure_ascii=False)
    json.load(open(path))
    print("wrote", path)


# ---------------------------------------------------------------- templates
def build_404():
    j = orig("404.json")
    m = j["sections"]["main"]["blocks"]
    m["text_GqmVFf"]["settings"]["text"] = "<h1>Deze pagina bestaat niet (meer)</h1>"
    m["text_Ua9XAW"]["settings"]["text"] = "<p>De link klopt misschien niet, of de pagina is verwijderd. Geen zorgen: onze planners staan gewoon klaar.</p>"
    m["button_PAQMwR"]["settings"].update({"label": "Bekijk alle producten", "link": "shopify://collections/all"})
    m["button_home"] = button("Naar de homepage", "/", style="button-secondary")
    j["sections"]["main"]["block_order"] = ["text_GqmVFf", "text_Ua9XAW", "button_PAQMwR", "button_home"]
    pl = j["sections"]["product_list_iA96Tq"]
    pl["settings"]["max_products"] = 4
    pl["blocks"]["static-header"]["blocks"]["text_WJEa9Q"]["settings"]["text"] = "<h3>Misschien zocht je dit</h3>"
    save("404.json", j)


def build_article():
    j = orig("article.json")
    j["sections"]["ook_handig"] = product_list("Ook handig", bg=SAND)
    j["sections"]["cta"] = section({
        "t": text("<h2>Nieuw hier?</h2>", "h3", width="fit-content"),
        "p": text("<p>Plannerij maakt Nederlandse planners, budgetplanners en AI-prompts die je direct downloadt. Gebruik code <strong>WELKOM10</strong> voor 10% korting op je eerste bestelling.</p>", max_width="narrow"),
        "b": button("Bekijk alle producten", "shopify://collections/all"),
    }, bg=LIGHT, gap=16)
    j["order"] = ["section", "ook_handig", "cta"]
    save("article.json", j)


def build_blog():
    j = orig("blog.json")
    save("blog.json", j)  # title comes from the blog ("Blog"); layout is fine as is


def build_cart():
    j = orig("cart.json")
    j["sections"]["cart-section"]["blocks"]["cart-page-title"]["settings"]["title"] = "Winkelwagen"
    pl = j["sections"]["product_list_NNFgcy"]
    pl["settings"]["max_products"] = 4
    for k, v in pl["blocks"]["static-header"]["blocks"].items():
        if v["type"] == "_product-list-text":
            v["settings"]["text"] = "<h3>Misschien ook interessant</h3>"
        if v["type"] == "_product-list-button":
            v["settings"]["label"] = "Bekijk alles"
    j["sections"]["digital_note"] = section({
        "g": group({"i": icon("lightning_bolt"), "t": text("<p><strong>Digitale producten:</strong> je ontvangt direct na betaling een downloadlink (ook per e-mail). Er wordt niets verzonden en je betaalt geen verzendkosten.</p>", max_width="narrow")}, direction="row", gap=12),
    }, bg=LIGHT, pad=(20, 20))
    j["order"] = ["cart-section", "digital_note", "product_list_NNFgcy"]
    save("cart.json", j)


def build_collection():
    j = orig("collection.json")
    hdr = j["sections"]["section"]
    hdr["settings"]["background_color"] = LIGHT
    hdr["settings"]["padding-block-start"] = 48
    hdr["settings"]["padding-block-end"] = 40
    main = j["sections"]["main"]
    f = main["blocks"]["filters"]["settings"]
    f.update({"enable_filtering": False, "enable_sorting": True, "enable_grid_density": False})
    j["sections"]["footer_note"] = section({
        "t": text("<h2>Alles direct te downloaden</h2>", "h3", width="fit-content"),
        "p": text("<p>Nederlands, mooi vormgegeven en eenmalig betalen. Na je bestelling staan je bestanden meteen klaar, ook per e-mail.</p>", max_width="narrow"),
        "b": button("Veelgestelde vragen", "shopify://pages/veelgestelde-vragen", style="button-secondary"),
    }, bg=SAND, gap=16)
    j["order"] = ["section", "main", "footer_note"]
    save("collection.json", j)


def build_list_collections():
    j = orig("list-collections.json")
    j["sections"]["collection_list_Wfgh3m"]["blocks"]["group_4FtiAg"]["blocks"]["text_fRMQMR"]["settings"]["text"] = "<h1>Shop per categorie</h1>"
    save("list-collections.json", j)


def build_page():
    j = orig("page.json")
    j["sections"]["contact_cta"] = section({
        "t": text("<p>Vragen? We helpen je graag. Stuur ons een bericht en we reageren binnen 1-2 werkdagen.</p>", width="fit-content", max_width="narrow"),
        "b": button("Neem contact op", "shopify://pages/contact", style="button-secondary"),
    }, bg=SAND, gap=16, pad=(32, 32))
    j["order"] = ["main", "contact_cta"]
    save("page.json", j)


def build_contact():
    j = orig("page.contact.json")
    m = j["sections"]["main"]["blocks"]
    m["content"]["settings"]["text"] = "<p>We reageren binnen 1-2 werkdagen. Heb je een vraag over een bestelling? Vermeld dan je ordernummer. Downloadproblemen? Controleer eerst je spamfolder: de e-mail met downloadlinks komt daar soms terecht.</p>"
    form = j["sections"]["form"]
    form["blocks"]["contact_form_UwiCkQ"]["blocks"]["submit-button"]["settings"]["label"] = "Verstuur bericht"
    j["sections"]["help"] = section({
        "row": group({
            "c1": group({"i": icon("question_mark"), "t": text("<p><strong>Veelgestelde vragen</strong><br>Downloaden, apps, printen, retour en licentie.</p>"), "b": button("Naar de FAQ", "shopify://pages/veelgestelde-vragen", style="link")}, bg=SAND, radius=16, pad=24, gap=10),
            "c2": group({"i": icon("chat_bubble"), "t": text("<p><strong>Downloadlink niet ontvangen?</strong><br>Stuur je ordernummer mee, dan sturen we de links opnieuw.</p>"), "b": button("Leveringsinformatie", "shopify://pages/levering", style="link")}, bg=SAND, radius=16, pad=24, gap=10),
        }, direction="row", gap=20, valign="flex-start"),
    }, bg=WHITE, pad=(0, 64))
    j["order"] = ["main", "form", "help"]
    save("page.contact.json", j)


def build_password():
    j = orig("password.json")
    main = j["sections"]["main"]
    main["settings"]["background_color"] = SAGE
    b = main["blocks"]
    b["logo"]["settings"]["inverse"] = True
    b["text"]["settings"].update({"text": "<h1>Plannerij komt eraan</h1>", "text_color": WHITE, "alignment": "center", "width": "100%", "type_preset": "h2"})
    b["text-2"]["settings"].update({"text": "<p>Digitale planners, budgetplanners en AI-prompts. Nederlands, mooi vormgegeven en direct te downloaden. Laat je e-mailadres achter en hoor als eerste wanneer we open zijn.</p>", "text_color": WHITE, "alignment": "center", "width": "100%", "max_width": "narrow"})
    b["email-signup"]["settings"].update({"label": "Houd me op de hoogte", "input_background_color": WHITE, "input_text_color": DARK, "input_border_color": WHITE})
    save("password.json", j)


def build_search():
    j = orig("search.json")
    f = j["sections"]["main"]["blocks"]["filters"]["settings"]
    f.update({"enable_filtering": False, "enable_grid_density": False})
    save("search.json", j)


def build_over_ons():
    j = orig("page.json")
    main = j["sections"]["main"]
    main["settings"]["background_color"] = SAND
    main["settings"]["padding-block-end"] = 48
    hb = main["blocks"]
    hb["heading"]["settings"]["text"] = "<h1>Rust in je hoofd begint met overzicht.</h1>"
    hb["eyebrow"] = text("<p>Over Plannerij</p>", "h6", width="fit-content", color=SAGE)
    hb["intro"] = text("<p>Plannerij maakt digitale planners, budgetplanners en slimme templates voor mensen die rust in hun hoofd willen. Geen overvolle apps, geen dertig tabbladen die je nooit gebruikt. Gewoon overzichtelijke, mooi vormgegeven bestanden die je vandaag downloadt en morgen gebruikt.</p>", max_width="narrow")
    main["block_order"] = ["eyebrow", "heading", "intro"]
    j["sections"]["waarom"] = media_with_content(
        "planner-1-hero.png", "Waarom Plannerij", "Nederlandse planners, zonder gedoe",
        "De meeste planners zijn óf te druk, óf gemaakt voor de Amerikaanse markt: weken die op zondag beginnen, feestdagen die hier niet bestaan, dollars in plaats van euro's. Plannerij is Nederlands: weekstart op maandag, weeknummers, Nederlandse en Belgische feestdagen, euro's en gewone taal.",
        "Bekijk de Digitale Planner 2027", "shopify://products/digitale-planner-2027")
    vals = [("lightning_bolt", "Direct downloaden", "Na je betaling ontvang je meteen je bestanden, ook per e-mail."),
            ("star", "Rustig ontwerp", "Eén stijl, veel witruimte, geen afleiding. Ook fijn als je snel overprikkeld raakt."),
            ("clipboard", "Werkt overal", "GoodNotes, Notability, Samsung Notes, Excel, Google Sheets, Numbers of gewoon je printer."),
            ("price_tag", "Eerlijke prijs", "Je betaalt één keer en gebruikt het bestand zo vaak als je wilt.")]
    cards = {}
    for i, (ic, t, d) in enumerate(vals, 1):
        cards[f"card_{i}"] = group({"i": icon(ic, width=28), "t": text(f"<h3>{t}</h3>", "h5"), "d": text(f"<p>{d}</p>")},
                                   bg=SAND, radius=16, pad=24, gap=10, valign="flex-start")
    j["sections"]["waarden"] = section({"h": text("<h2>Wat je van ons mag verwachten</h2>", "h3", width="fit-content"),
                                        "row": group(cards, direction="row", gap=20, valign="flex-start")}, gap=24)
    j["sections"]["producten"] = media_with_content(
        "budget-1-hero.png", "Onze producten", "Gemaakt in Nederland, voor Nederland en België",
        "Een gedateerde Digitale Planner 2027 voor tablet én printer, een Budgetplanner voor Excel en Google Sheets, een AI Prompt Pack met 200 Nederlandse prompts en een bundel ongedateerde printables. Alles in dezelfde rustige stijl, en samen voordelig in de Complete Bundel.",
        "Bekijk alle producten", "shopify://collections/all", image_left=False)
    j["sections"]["cta"] = section({
        "t": text("<h2>Vragen of een idee voor een template?</h2>", "h3", width="fit-content", color=WHITE),
        "p": text("<p>We lezen alles en reageren binnen 1-2 werkdagen.</p>", color=WHITE, max_width="narrow"),
        "b": button("Neem contact op", "shopify://pages/contact", custom=(WHITE, SAGE_DARK, WHITE)),
    }, bg=SAGE, gap=16)
    j["order"] = ["main", "waarom", "waarden", "producten", "cta"]
    save("page.over-ons.json", j)


FAQ = {
    "Bestellen en downloaden": [
        ("Hoe ontvang ik mijn bestanden?", "Direct na je betaling kom je op een downloadpagina. Je ontvangt ook een e-mail met downloadlinks. Controleer je spamfolder als je die e-mail niet ziet."),
        ("Hoe vaak kan ik downloaden?", "Je downloadlink blijft beschikbaar, dus je kunt het bestand later opnieuw downloaden op een ander apparaat."),
        ("Wordt er iets opgestuurd?", "Nee. Al onze producten zijn digitaal (PDF, XLSX, CSV, TXT). Je betaalt geen verzendkosten en er komt niets per post."),
        ("Welke betaalmethoden accepteren jullie?", "iDEAL, Bancontact, creditcard, PayPal, Apple Pay en Google Pay, afhankelijk van je apparaat."),
        ("Krijg ik een factuur?", "Je orderbevestiging geldt als betaalbewijs. Heb je een factuur met bedrijfsgegevens nodig? Stuur een bericht met je ordernummer."),
    ],
    "Gebruik": [
        ("In welke apps werkt de digitale planner?", "In elke app die PDF-annotatie ondersteunt: GoodNotes, Notability, Noteshelf, Samsung Notes, Xodo, Penly en meer. Op iPad, Android-tablet en Windows (Surface). De tabbladen en datums zijn klikbaar."),
        ("Werkt de budgetplanner in Google Sheets?", "Ja. Upload het XLSX-bestand naar Google Drive en open het met Google Sheets; alle formules werken. Ook Apple Numbers en LibreOffice openen het bestand."),
        ("Kan ik op A5 printen?", "Ja, je krijgt een A4- en een A5-versie. Tip: print de A4-versie met de instelling '2 pagina's per vel' voor een compacte planner."),
        ("Kan ik de bestanden bewerken?", "De PDF's zijn bedoeld om in te schrijven of te printen. De budgetplanner is volledig bewerkbaar; categorieën pas je aan op het tabblad Instellingen."),
        ("Werkt het op mijn telefoon?", "De PDF's kun je op je telefoon openen en lezen. De budgetplanner werkt het prettigst op een laptop of tablet."),
    ],
    "Retour en licentie": [
        ("Kan ik een digitaal product retourneren?", "Omdat je het bestand direct ontvangt, vervalt het wettelijke herroepingsrecht zodra de download beschikbaar is; je stemt daar bij het afrekenen mee in. Is er iets mis met je bestand? Neem contact op, dan lossen we het op."),
        ("Mag ik bestanden delen of doorverkopen?", "Nee. Je koopt een licentie voor persoonlijk gebruik. Je mag de bestanden niet delen, doorverkopen of als eigen product aanbieden. Zie de pagina Licentie en gebruik."),
        ("Ik heb een probleem met mijn bestand", "Stuur binnen 14 dagen een bericht met je ordernummer en een korte beschrijving. We sturen een nieuw bestand of betalen terug als we het niet kunnen oplossen."),
    ],
}


def build_faq():
    j = orig("page.json")
    main = j["sections"]["main"]
    main["settings"]["padding-block-end"] = 8
    hb = main["blocks"]
    hb["intro"] = text("<p>Alles over bestellen, downloaden, gebruik en licentie. Staat je vraag er niet bij? Stuur ons een bericht.</p>", max_width="narrow")
    main["block_order"] = ["heading", "intro"]
    order = ["main"]
    for i, (cat, rows) in enumerate(FAQ.items(), 1):
        j["sections"][f"faq_{i}"] = section({"h": text(f"<h2>{cat}</h2>", "h4", width="fit-content"),
                                             "acc": accordion(rows)}, bg=WHITE if i % 2 else LIGHT, gap=20, pad=(40, 40))
        order.append(f"faq_{i}")
    j["sections"]["cta"] = section({
        "t": text("<h2>Staat je vraag er niet bij?</h2>", "h3", width="fit-content"),
        "b": button("Stuur ons een bericht", "shopify://pages/contact"),
    }, bg=SAND, gap=16)
    j["sections"]["producten"] = product_list("Bekijk onze producten")
    order += ["cta", "producten"]
    j["order"] = order
    save("page.veelgestelde-vragen.json", j)


def fix_index():
    idx = INDEX
    row = idx["sections"]["section_faq"]["blocks"]["accordion_faq"]["blocks"]["row_2"]["blocks"]["text"]["settings"]
    row["text"] = "<p>Ja. Je ontvangt een Excel-bestand (.xlsx). Upload het naar Google Drive en open het met Google Sheets; alle formules werken in beide programma's, en ook in Apple Numbers.</p>"
    save("index.json", idx)


if __name__ == "__main__":
    for fn in (build_404, build_article, build_blog, build_cart, build_collection, build_list_collections,
               build_page, build_contact, build_password, build_search, build_over_ons, build_faq, fix_index):
        fn()
