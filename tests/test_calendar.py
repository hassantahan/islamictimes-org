import csv
from datetime import datetime, timedelta, timezone
from io import StringIO
import re
import unittest

from app import app


class CalendarTests(unittest.TestCase):
    def setUp(self):
        self.client = app.test_client()
        self.settings = {
            "lat": 43.65, "lon": -79.38,
            "start": "2026-03-07", "end": "2026-03-09",
            "method": "ISNA", "asr_type": 1,
            "profile": {"name": "Neighbourhood mosque", "offset_minutes": {"fajr": -90, "isha": 120}},
        }

    def test_pages_render_without_cookies_or_external_application_scripts(self):
        pages = (
            ("/", "Prayer Times"), ("/calendar", "Prayer Calendar"),
            ("/visibilities", "Crescent Visibility"), ("/methodology", "Methodology"),
        )
        for url, title in pages:
            with self.subTest(url=url):
                response = self.client.get(url)
                self.assertEqual(response.status_code, 200)
                self.assertIn(f"<title>{title} · Islamic Times</title>", response.get_data(as_text=True))
                self.assertNotIn("Set-Cookie", response.headers)
                self.assertNotRegex(response.get_data(as_text=True), r'<script[^>]+src="https?://')

    def test_preview_and_exports_match_across_daylight_saving(self):
        preview = self.client.post("/calendar/schedule", json=self.settings)
        self.assertEqual(preview.status_code, 200)
        payload = preview.get_json()
        self.assertEqual(payload["timezone"], "America/Toronto")
        self.assertEqual(payload["profile"], "Neighbourhood mosque")
        self.assertEqual(len(payload["days"]), 3)

        ics_response = self.client.post("/calendar/export/ics", json=self.settings)
        csv_response = self.client.post("/calendar/export/csv", json=self.settings)
        for response, ext, mime in ((ics_response, "ics", "text/calendar"), (csv_response, "csv", "text/csv")):
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.mimetype, mime)
            self.assertEqual(response.headers["Cache-Control"], "no-store")
            self.assertIn(f'prayer-calendar-2026-03-07-2026-03-09.{ext}', response.headers["Content-Disposition"])
            self.assertNotIn("Set-Cookie", response.headers)

        events = re.findall(r"^DTSTART:(\d{8}T\d{6}Z)\r$", ics_response.get_data(as_text=True), flags=re.MULTILINE)
        expected = [
            datetime.fromisoformat(day["prayers"][key]["time"]).astimezone(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
            for day in payload["days"]
            for key in ("fajr", "zuhr", "asr", "maghrib", "isha")
        ]
        self.assertCountEqual(events, expected)

        rows = list(csv.DictReader(StringIO(csv_response.get_data(as_text=True))))
        self.assertEqual(len(rows), 3)
        for day, row in zip(payload["days"], rows):
            self.assertEqual(day["prayers"]["fajr"]["time"], row["fajr"])
            self.assertEqual(day["prayers"]["isha"]["time"], row["isha"])
        self.assertTrue(rows[0]["fajr"].endswith("-05:00"))
        self.assertTrue(rows[-1]["fajr"].endswith("-04:00"))

        unadjusted = self.client.post("/calendar/schedule", json={**self.settings, "profile": {}}).get_json()
        for original, adjusted in zip(unadjusted["days"], payload["days"]):
            for prayer, minutes in (("fajr", -90), ("isha", 120)):
                before = datetime.fromisoformat(original["prayers"][prayer]["time"])
                after = datetime.fromisoformat(adjusted["prayers"][prayer]["time"])
                self.assertEqual(after - before, timedelta(minutes=minutes))

    def test_default_timetables_use_the_jafari_preset(self):
        calendar = self.client.post(
            "/calendar/schedule",
            json={"lat": 43.65, "lon": -79.38, "start": "2026-11-24", "end": "2026-11-24"},
        ).get_json()
        daily = self.client.post(
            "/prayer_times", json={"lat": 43.65, "lon": -79.38, "date": "2026-11-24"},
        ).get_json()
        self.assertIn("Jafari", calendar["method"])
        self.assertIn("Jafari", daily["method"]["name"])
        self.assertEqual(daily["method"]["midnight_type"], 1)
        self.assertEqual(daily["method"]["maghrib_angle"]["decimal"], 4)
        self.assertEqual(datetime.fromisoformat(daily["asr"]["time"]).isoformat(timespec="seconds"),
                         daily["fadilah"]["asr"]["start"])
        for key in ("fajr", "zuhr", "asr", "maghrib", "isha"):
            self.assertEqual(calendar["days"][0]["prayers"][key]["time"],
                             datetime.fromisoformat(daily[key]["time"]).isoformat(timespec="seconds"))

    def test_custom_angles_match_daily_and_calendar_exports(self):
        settings = {
            "lat": 43.65, "lon": -79.38, "start": "2026-11-24", "end": "2026-11-24",
            "method": "CUSTOM", "angles": {"fajr_angle": 17.2, "maghrib_angle": 5},
        }
        calendar = self.client.post("/calendar/schedule", json=settings)
        self.assertEqual(calendar.status_code, 200)
        daily = self.client.post(
            "/prayer_times", json={
                "lat": settings["lat"], "lon": settings["lon"], "date": settings["start"],
                "method": {"name": "CUSTOM", "midnight_type": "preset", **settings["angles"]},
            },
        ).get_json()
        self.assertEqual(daily["method"]["isha_angle"]["decimal"], 14)
        self.assertEqual(calendar.get_json()["method"], "Custom")
        exported = self.client.post("/calendar/export/csv", json=settings)
        self.assertEqual(exported.status_code, 200)
        row = next(csv.DictReader(StringIO(exported.get_data(as_text=True))))
        for key in ("fajr", "maghrib", "isha"):
            self.assertEqual(calendar.get_json()["days"][0]["prayers"][key]["time"], row[key])
            self.assertEqual(datetime.fromisoformat(daily[key]["time"]).isoformat(timespec="seconds"), row[key])

    def test_adjusted_event_can_cross_midnight(self):
        settings = {**self.settings, "lat": 59.33, "lon": 18.07, "start": "2026-06-17", "end": "2026-06-17",
                    "profile": {"name": "Stockholm timetable", "offset_minutes": {"isha": 180}}}
        response = self.client.post("/calendar/schedule", json=settings)
        self.assertEqual(response.status_code, 200)
        isha = response.get_json()["days"][0]["prayers"]["isha"]
        self.assertEqual(isha["day_offset"], 1)
        self.assertTrue(isha["time"].startswith("2026-06-18T"))

    def test_calendar_rejects_invalid_payloads(self):
        invalid = (
            {"lat": "NaN"}, {"lat": 91}, {"method": "unsupported"}, {"asr_type": True},
            {"start": "20260307"}, {"start": "1800-03-07"}, {"end": "2026-03-06"}, {"end": "2028-03-07"},
            {"profile": []}, {"profile": {"name": "line\nbreak"}},
            {"method": "CUSTOM", "angles": {"fajr_angle": 0}},
            {"method": "CUSTOM", "angles": {"isha_angle": "nan"}},
            {"method": "CUSTOM", "angles": {"asr_angle": 6}},
            {"angles": {"fajr_angle": 17}},
            {"profile": {"offset_minutes": {"sunrise": 4}}},
            {"profile": {"offset_minutes": {"fajr": 0.5}}},
            {"profile": {"offset_minutes": {"fajr": 181}}},
        )
        for changes in invalid:
            with self.subTest(changes=changes):
                response = self.client.post("/calendar/schedule", json={**self.settings, **changes})
                self.assertEqual(response.status_code, 400)
                self.assertEqual(response.get_json()["error"]["code"], "bad_request")
        self.assertEqual(self.client.post("/calendar/schedule", json=["settings"]).status_code, 400)
        self.assertEqual(self.client.post("/calendar/export/pdf", json=self.settings).status_code, 404)
        self.assertEqual(self.client.post("/calendar/schedule", json={"padding": "a" * 8192}).status_code, 413)
