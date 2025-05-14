from datetime import datetime

# --- helper ---------------------------------------------------------------
def _jdn_to_gregorian(jdn: int) -> datetime:
    """Fliegel‒Van Flandern integer algorithm (valid for any positive JDN)."""
    l = jdn + 68569
    n = (4 * l) // 146097
    l = l - (146097 * n + 3) // 4
    i = (4000 * (l + 1)) // 1461001
    l = l - (1461 * i) // 4 + 31
    j = (80 * l) // 2447
    day = l - (2447 * j) // 80
    l = j // 11
    month = j + 2 - 12 * l
    year = 100 * (n - 49) + i + l
    return datetime(year, month, day, 0, 0, 0, 0)

# --- main -----------------------------------------------------------------
def hijri_to_gregorian(h_year: int, h_month: int, h_day: int) -> datetime:
    """
    Convert an arithmetical (tabular-Islamic) Hijri date to its proleptic
    Gregorian equivalent.

    Parameters
    ----------
    h_year  : Islamic year  (AH); 1 ≤ year
    h_month : Islamic month (1—12)
    h_day   : Islamic day   (1—29/30)

    Returns
    -------
    datetime.date  ——  Gregorian calendar date

    Notes
    -----
    * The arithmetic calendar assumes a fixed 30-year cycle with leap years
      in years 2, 5, 7, 10, 13, 16, 18, 21, 24, 26, 29.
    * Real-world (observational) or Saudi Umm-al-Qura dates can differ by ±1 day.
    """
    # Days from completed lunar years:
    days = (h_year - 1) * 354 + (3 + 11 * h_year) // 30        # leap days
    # Days from completed months:
    days += (h_month - 1) * 29 + (h_month // 2)                # 30-day months
    # Days within current month:
    days += h_day - 1

    # Islamic epoch: Friday 1 Muḥarram 1 AH → 19 Jul 622 (Gregorian) = JDN 1948440
    jdn = 1_948_440 + days
    return _jdn_to_gregorian(jdn)

# quick self-test
if __name__ == "__main__":
    assert hijri_to_gregorian(1, 1, 1) == datetime(622, 7, 19, 0, 0, 0, 0)     # epoch
    assert hijri_to_gregorian(1446, 1, 1) == datetime(2024, 7, 8, 0, 0, 0, 0)  # sanity check
