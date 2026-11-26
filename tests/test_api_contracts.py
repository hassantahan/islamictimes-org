import unittest
from datetime import datetime
from unittest import mock

from app import app
from requests import RequestException


class ApiContractTests(unittest.TestCase):
    def setUp(self):
        self.client = app.test_client()

    def test_healthz(self):
        response = self.client.get("/healthz")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json(), {"status": "ok"})

    def test_hijri_month_grid_matches_the_leap_day_timetable(self):
        month = self.client.get("/hijri_month/2028/2")
        daily = self.client.post(
            "/prayer_times", json={"lat": 43.65, "lon": -79.38, "date": "2028-02-29"},
        )
        self.assertEqual(month.status_code, 200)
        self.assertEqual(daily.status_code, 200)
        self.assertEqual(len(month.get_json()), 29)
        self.assertEqual(month.get_json()[-1], daily.get_json()["hijri"])

    def test_hijri_month_grid_validates_bounds(self):
        for route in ("/hijri_month/1899/12", "/hijri_month/2101/1", "/hijri_month/2026/13"):
            with self.subTest(route=route):
                self.assertEqual(self.client.get(route).status_code, 400)

    def test_hijri_month_grid_and_timetable_include_the_hijri_leap_day(self):
        month = self.client.get("/hijri_month/2026/6").get_json()
        daily = self.client.post("/prayer_times", json={"lat": 43.65, "lon": -79.38, "date": "2026-06-16"})
        self.assertEqual(daily.status_code, 200)
        self.assertEqual(month[15], daily.get_json()["hijri"])
        self.assertEqual((month[15]["year"], month[15]["month"], month[15]["day"]), (1447, 12, 30))
        self.assertEqual((month[16]["year"], month[16]["month"], month[16]["day"]), (1448, 1, 1))

    def test_cautions_describe_affected_prayers(self):
        payload = {"lat": 69.65, "lon": 18.96, "date": "2026-06-21"}
        makkah = self.client.post("/prayer_times", json={**payload, "method": {"name": "MAKKAH"}})
        self.assertEqual(makkah.status_code, 200)
        self.assertEqual(makkah.json["isha"]["caution"], {
            "kind": "estimated", "detail": "90 min after estimated Maghrib.",
        })
        self.assertNotIn("caution", makkah.json["zuhr"])
        jafari = self.client.post("/prayer_times", json=payload)
        self.assertEqual(jafari.status_code, 200)
        self.assertEqual(jafari.json["isha"]["caution"]["kind"], "unavailable")

    def test_prayer_times_missing_fields_returns_400(self):
        response = self.client.post("/prayer_times", json={})
        self.assertEqual(response.status_code, 400)
        payload = response.get_json()
        self.assertEqual(payload["error"]["code"], "bad_request")

    def test_prayer_times_includes_qibla_payload(self):
        response = self.client.post(
            "/prayer_times",
            json={
                "lat": 43.7,
                "lon": -79.4,
                "date": "2026-02-26",
                "method": {"name": "ISNA"},
            },
        )
        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertIn("qibla", payload)
        self.assertIn("angle_decimal", payload["qibla"])
        self.assertIn("cardinal", payload["qibla"])
        self.assertIn("distance_km", payload["qibla"])
        self.assertIn("distance_mi", payload["qibla"])
        self.assertIsInstance(payload["qibla"]["angle_decimal"], float)
        self.assertGreaterEqual(payload["qibla"]["angle_decimal"], 0.0)
        self.assertLessEqual(payload["qibla"]["angle_decimal"], 360.0)
        self.assertIsInstance(payload["qibla"]["cardinal"], str)
        self.assertGreater(payload["qibla"]["distance_km"], 0.0)
        self.assertGreater(payload["qibla"]["distance_mi"], 0.0)

    def test_shia_timetables_include_sistani_windows(self):
        coordinates = {"lat": 43.65, "lon": -79.38, "date": "2026-11-24"}
        for method in ("JAFARI", "TEHRAN", "CUSTOM"):
            with self.subTest(method=method):
                response = self.client.post(
                    "/prayer_times", json={**coordinates, "method": {"name": method, "midnight_type": "preset"}},
                )
                self.assertEqual(response.status_code, 200)
                data = response.get_json()
                windows = data["fadilah"]
                self.assertEqual(set(windows), {"fajr", "zuhr", "asr", "maghrib", "isha"})
                fajr = windows["fajr"]
                self.assertEqual(fajr["end_sign"], "whole_horizon_lit")
                self.assertTrue(fajr["estimated"])
                start = datetime.fromisoformat(fajr["start"])
                end = datetime.fromisoformat(fajr["end"])
                sunrise = datetime.fromisoformat(data["sunrise"]["time"])
                self.assertLess(start, end)
                self.assertLess(end, sunrise)
                self.assertEqual(data["method"]["western_redness_model"], "seasonal")
                self.assertEqual(windows["zuhr"]["preferred_by"], windows["asr"]["start"])
                self.assertEqual(windows["zuhr"]["end"], windows["asr"]["preferred_by"])
                self.assertLess(datetime.fromisoformat(windows["asr"]["start"]),
                                datetime.fromisoformat(windows["asr"]["end"]))
                self.assertTrue(data["method"]["use_isha_fadilah"])
                self.assertEqual(
                    datetime.fromisoformat(data["isha"]["time"]).isoformat(timespec="seconds"),
                    windows["isha"]["start"],
                )
        response = self.client.post("/prayer_times", json={**coordinates, "method": {"name": "ISNA"}})
        self.assertNotIn("fadilah", response.get_json())

    def test_local_fajr_end_and_experimental_evening_blend(self):
        payload = {"lat": 43.65, "lon": -79.38, "date": "2026-11-26"}
        baseline = self.client.post("/prayer_times", json=payload).get_json()
        custom_start = {"name": "CUSTOM", "midnight_type": "preset", "fajr_angle": 18}
        changed = self.client.post("/prayer_times", json={**payload, "method": custom_start}).get_json()
        self.assertNotEqual(changed["fadilah"]["fajr"]["start"], baseline["fadilah"]["fajr"]["start"])
        self.assertEqual(changed["fadilah"]["fajr"]["end"], baseline["fadilah"]["fajr"]["end"])
        method = {"name": "JAFARI", "midnight_type": "preset",
                  "western_redness_model": "blend", "fajr_fadilah_end_degrees": 10}
        data = self.client.post("/prayer_times", json={**payload, "method": method}).get_json()
        self.assertEqual(data["fajr"]["time"], baseline["fajr"]["time"])
        self.assertTrue(data["fadilah"]["fajr"]["estimated"])
        self.assertLess(data["fadilah"]["fajr"]["start"], data["fadilah"]["fajr"]["end"])
        self.assertNotEqual(data["fadilah"]["fajr"]["end"], baseline["fadilah"]["fajr"]["end"])
        self.assertEqual(data["fadilah"]["maghrib"]["end"], data["fadilah"]["isha"]["start"])
        self.assertNotEqual(data["isha"]["time"], baseline["isha"]["time"])
        for invalid in ({"western_redness_model": "unknown"}, {"fajr_fadilah_end_degrees": 16}):
            response = self.client.post("/prayer_times", json={**payload, "method": {**method, **invalid}})
            self.assertEqual(response.status_code, 400)

    def test_evening_fadilah_shares_twilight_and_uses_elapsed_dawn_fraction(self):
        method = {"name": "CUSTOM", "isha_angle": 18, "midnight_type": 0}
        coordinates = {"lat": 43.65, "lon": -79.38}
        first = self.client.post(
            "/prayer_times", json={**coordinates, "date": "2026-03-07", "method": method},
        ).get_json()
        second = self.client.post(
            "/prayer_times", json={**coordinates, "date": "2026-03-08", "method": method},
        ).get_json()
        maghrib, isha = first["fadilah"]["maghrib"], first["fadilah"]["isha"]
        self.assertTrue(maghrib["estimated"])
        self.assertTrue(isha["estimated"])
        self.assertFalse(first["method"]["use_isha_fadilah"])
        self.assertNotIn("preferred_by", isha)
        self.assertEqual(maghrib["start"], datetime.fromisoformat(first["maghrib"]["time"]).isoformat(timespec="seconds"))
        self.assertEqual(maghrib["end"], isha["start"])
        self.assertLess(datetime.fromisoformat(isha["start"]), datetime.fromisoformat(first["isha"]["time"]))

        sunset = datetime.fromisoformat(first["sunset"]["time"])
        dawn = datetime.fromisoformat(second["fajr"]["time"])
        self.assertNotEqual(sunset.utcoffset(), dawn.utcoffset())
        self.assertAlmostEqual(
            (datetime.fromisoformat(isha["end"]) - sunset).total_seconds(),
            (dawn - sunset).total_seconds() / 3, delta=1,
        )

    def test_evening_fadilah_omits_unavailable_or_reversed_windows(self):
        cases = (
            {"lat": 69.65, "lon": 18.96, "date": "2026-06-21", "method": {"name": "JAFARI"}},
            {"lat": 43.65, "lon": -79.38, "date": "2026-11-25",
             "method": {"name": "CUSTOM", "maghrib_angle": 15}},
        )
        for payload in cases:
            with self.subTest(payload=payload):
                response = self.client.post("/prayer_times", json=payload)
                self.assertEqual(response.status_code, 200)
                windows = response.get_json()["fadilah"]
                self.assertNotIn("maghrib", windows)
                self.assertNotIn("isha", windows)

    def test_prayer_times_preset_method_honors_midnight_override(self):
        response = self.client.post(
            "/prayer_times",
            json={
                "lat": 43.7,
                "lon": -79.4,
                "date": "2026-02-28",
                "method": {
                    "name": "ISNA",
                    "asr_type": 0,
                    "midnight_type": 1,
                },
            },
        )
        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertEqual(payload["method"]["name"], "ISNA")
        self.assertEqual(payload["method"]["midnight_type"], 1)
        self.assertIsInstance(payload["method"]["fajr_angle"]["decimal"], float)
        self.assertIsInstance(payload["method"]["maghrib_angle"]["decimal"], float)
        self.assertIsInstance(payload["method"]["isha_angle"]["decimal"], float)

    def test_prayer_times_invalid_lat_returns_400(self):
        response = self.client.post(
            "/prayer_times",
            json={
                "lat": 999,
                "lon": 10,
                "date": "2026-02-26",
                "method": {"name": "ISNA"},
            },
        )
        self.assertEqual(response.status_code, 400)

    def test_prayer_times_invalid_date_returns_400(self):
        response = self.client.post(
            "/prayer_times",
            json={
                "lat": 43.7,
                "lon": -79.4,
                "date": "bad-date",
                "method": {"name": "ISNA"},
            },
        )
        self.assertEqual(response.status_code, 400)

    def test_prayer_times_invalid_method_returns_400(self):
        response = self.client.post(
            "/prayer_times",
            json={
                "lat": 43.7,
                "lon": -79.4,
                "date": "2026-02-26",
                "method": {"name": "BAD"},
            },
        )
        self.assertEqual(response.status_code, 400)

    def test_upcoming_hijri_requires_date(self):
        response = self.client.get("/upcoming_hijri")
        self.assertEqual(response.status_code, 400)

    def test_upcoming_hijri_invalid_date_returns_400(self):
        response = self.client.get("/upcoming_hijri?date=not-a-date")
        self.assertEqual(response.status_code, 400)

    def test_vis_calc_invalid_month_returns_400(self):
        response = self.client.post(
            "/vis_calc",
            json={
                "lat": 43.7,
                "lon": -79.4,
                "hijri_month": 99,
                "hijri_year": 1447,
            },
        )
        self.assertEqual(response.status_code, 400)

    def test_generate_map_is_gone(self):
        response = self.client.post("/generate_map", json={})
        self.assertEqual(response.status_code, 410)

    def test_debug_route_hidden_by_default(self):
        response = self.client.get("/__debug/gunicorn_args")
        self.assertEqual(response.status_code, 404)

    @mock.patch("webapp.services.maps.requests.get")
    def test_maps_index_upstream_failure_returns_503(self, mock_get):
        mock_get.side_effect = RequestException("boom")
        response = self.client.get("/maps_index")
        self.assertEqual(response.status_code, 503)


if __name__ == "__main__":
    unittest.main()
