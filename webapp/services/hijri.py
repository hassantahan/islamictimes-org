from __future__ import annotations

from dataclasses import dataclass

from islamic_times.time_equations import gregorian_to_hijri

from webapp.errors import ApiError
from webapp.validators import parse_iso_date

HIJRI_MONTH_NAMES = [
    "Muḥarram",
    "Ṣaffar",
    "Rabīʿ al-Awwal",
    "Rabīʿ al-Thānī",
    "Jumādā al-Ūlā",
    "Jumādā al-Thāniyah",
    "Rajab",
    "Shaʿbān",
    "Ramaḍān",
    "Shawwāl",
    "Dhū al-Qaʿdah",
    "Dhū al-Ḥijjah",
]


@dataclass(frozen=True)
class HijriDate:
    year: int
    month: int
    day: int

    @property
    def month_name(self) -> str:
        return HIJRI_MONTH_NAMES[self.month - 1]


def hijri_from_gregorian_date(date_str: str) -> HijriDate:
    dt = parse_iso_date(date_str)
    h_year, h_month, h_day = gregorian_to_hijri(dt.year, dt.month, dt.day)
    return HijriDate(year=h_year, month=h_month, day=h_day)


def upcoming_hijri_month(date_str: str) -> dict[str, int | str]:
    h = hijri_from_gregorian_date(date_str)

    month = h.month
    year = h.year

    # Existing product rule: hold current month through day 7.
    if h.day > 7:
        month += 1
        if month > 12:
            month = 1
            year += 1

    if not 1 <= month <= 12:
        raise ApiError("Computed Hijri month out of range.", status_code=500, code="hijri_error")

    return {
        "month": month,
        "month_name": HIJRI_MONTH_NAMES[month - 1],
        "year": year,
    }
