"""2027 calendar data for the Netherlands / Belgium (Dutch language)."""
import datetime as dt

YEAR = 2027

MAANDEN = ["januari", "februari", "maart", "april", "mei", "juni", "juli",
           "augustus", "september", "oktober", "november", "december"]
MAANDEN_KORT = ["jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec"]
DAGEN = ["maandag", "dinsdag", "woensdag", "donderdag", "vrijdag", "zaterdag", "zondag"]
DAGEN_KORT = ["ma", "di", "wo", "do", "vr", "za", "zo"]


def easter(year):
    a = year % 19
    b = year // 100
    c = year % 100
    d = b // 4
    e = b % 4
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i = c // 4
    k = c % 4
    l = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * l) // 451
    month = (h + l - 7 * m + 114) // 31
    day = ((h + l - 7 * m + 114) % 31) + 1
    return dt.date(year, month, day)


def holidays(year=YEAR):
    e = easter(year)
    h = {
        dt.date(year, 1, 1): "Nieuwjaarsdag",
        e - dt.timedelta(days=2): "Goede Vrijdag",
        e: "Eerste Paasdag",
        e + dt.timedelta(days=1): "Tweede Paasdag",
        dt.date(year, 4, 27): "Koningsdag",
        dt.date(year, 5, 4): "Dodenherdenking",
        dt.date(year, 5, 5): "Bevrijdingsdag",
        e + dt.timedelta(days=39): "Hemelvaartsdag",
        e + dt.timedelta(days=49): "Eerste Pinksterdag",
        e + dt.timedelta(days=50): "Tweede Pinksterdag",
        dt.date(year, 12, 5): "Sinterklaas",
        dt.date(year, 12, 24): "Kerstavond",
        dt.date(year, 12, 25): "Eerste Kerstdag",
        dt.date(year, 12, 26): "Tweede Kerstdag",
        dt.date(year, 12, 31): "Oudejaarsdag",
    }
    # Belgian extras
    h[dt.date(year, 7, 21)] = "Nationale feestdag (BE)"
    h[dt.date(year, 8, 15)] = "O.L.V. Hemelvaart (BE)"
    h[dt.date(year, 11, 1)] = "Allerheiligen (BE)"
    h[dt.date(year, 11, 11)] = "Wapenstilstand (BE)"
    h[dt.date(year, 5, 1)] = "Dag van de Arbeid (BE)"
    # Fun / seasonal
    h[dt.date(year, 2, 14)] = "Valentijnsdag"
    mothers = dt.date(year, 5, 1)
    while mothers.weekday() != 6:
        mothers += dt.timedelta(days=1)
    mothers += dt.timedelta(days=7)
    h[mothers] = "Moederdag"
    fathers = dt.date(year, 6, 1)
    while fathers.weekday() != 6:
        fathers += dt.timedelta(days=1)
    fathers += dt.timedelta(days=14)
    h[fathers] = "Vaderdag"
    h[dt.date(year, 10, 4)] = "Dierendag"
    return h


HOLIDAYS = holidays()
OFFICIAL = {"Nieuwjaarsdag", "Goede Vrijdag", "Eerste Paasdag", "Tweede Paasdag", "Koningsdag",
            "Bevrijdingsdag", "Hemelvaartsdag", "Eerste Pinksterdag", "Tweede Pinksterdag",
            "Eerste Kerstdag", "Tweede Kerstdag"}


def weeks(year=YEAR):
    """All Monday-start weeks that touch the year. Returns list of (iso_year, iso_week, monday)."""
    first = dt.date(year, 1, 1)
    monday = first - dt.timedelta(days=first.weekday())
    out = []
    while monday.year <= year and not (monday.year == year + 1):
        if monday + dt.timedelta(days=6) < first:
            monday += dt.timedelta(days=7)
            continue
        iso = monday.isocalendar()
        out.append((iso[0], iso[1], monday))
        monday += dt.timedelta(days=7)
    return out


WEEKS = weeks()
WEEK_INDEX = {w[2]: i for i, w in enumerate(WEEKS)}


def week_of(date):
    monday = date - dt.timedelta(days=date.weekday())
    return WEEK_INDEX.get(monday)


def month_grid(month, year=YEAR):
    """Rows of 7 dates (Mon..Sun) covering the month, includes spill-over days."""
    first = dt.date(year, month, 1)
    start = first - dt.timedelta(days=first.weekday())
    rows = []
    d = start
    while True:
        row = [d + dt.timedelta(days=i) for i in range(7)]
        rows.append(row)
        d += dt.timedelta(days=7)
        if d.month != month or d.year != year:
            break
    return rows


def weeks_in_month(month, year=YEAR):
    """Week indices whose Thursday (ISO anchor) falls in the month; plus first week if it holds day 1."""
    idx = []
    for i, (iy, iw, monday) in enumerate(WEEKS):
        thu = monday + dt.timedelta(days=3)
        if thu.year == year and thu.month == month:
            idx.append(i)
    return idx


def fmt_date(d):
    return f"{d.day} {MAANDEN[d.month - 1]} {d.year}"


def fmt_range(monday):
    sunday = monday + dt.timedelta(days=6)
    if monday.month == sunday.month:
        return f"{monday.day} – {sunday.day} {MAANDEN[monday.month - 1]} {monday.year}"
    if monday.year == sunday.year:
        return f"{monday.day} {MAANDEN[monday.month - 1]} – {sunday.day} {MAANDEN[sunday.month - 1]} {monday.year}"
    return f"{monday.day} {MAANDEN[monday.month - 1]} {monday.year} – {sunday.day} {MAANDEN[sunday.month - 1]} {sunday.year}"
