"""Automated tests for Project Scheduling CPM (Critical Path Method) and Dependencies."""

from datetime import date
import unittest

from app.services.project_cpm import calculate_cpm_schedule, CyclicDependencyError


class TestProjectScheduleCPM(unittest.TestCase):
    def test_linear_dependency_chain(self):
        """Tests linear chain: A (5d) -> B (10d) -> C (3d).
        All three should be on the critical path with float 0.
        """
        start_d = date(2026, 11, 1)
        milestones = [
            {"id": "A", "name": "Excavation", "duration_days": 5, "baseline_date": start_d, "forecast_date": start_d},
            {"id": "B", "name": "Foundations", "duration_days": 10, "predecessor_id": "A"},
            {"id": "C", "name": "Slab", "duration_days": 3, "predecessor_id": "B"},
        ]

        result = calculate_cpm_schedule(milestones, default_start_date=start_d)
        res_by_id = {m["id"]: m for m in result}

        # A: ES = 2026-11-01, EF = 2026-11-06 (dur 5)
        self.assertEqual(res_by_id["A"]["early_start"], date(2026, 11, 1))
        self.assertEqual(res_by_id["A"]["early_finish"], date(2026, 11, 6))
        self.assertTrue(res_by_id["A"]["is_critical"])
        self.assertEqual(res_by_id["A"]["total_float"], 0)

        # B: ES = 2026-11-06, EF = 2026-11-16 (dur 10)
        self.assertEqual(res_by_id["B"]["early_start"], date(2026, 11, 6))
        self.assertEqual(res_by_id["B"]["early_finish"], date(2026, 11, 16))
        self.assertTrue(res_by_id["B"]["is_critical"])
        self.assertEqual(res_by_id["B"]["total_float"], 0)

        # C: ES = 2026-11-16, EF = 2026-11-19 (dur 3)
        self.assertEqual(res_by_id["C"]["early_start"], date(2026, 11, 16))
        self.assertEqual(res_by_id["C"]["early_finish"], date(2026, 11, 19))
        self.assertTrue(res_by_id["C"]["is_critical"])
        self.assertEqual(res_by_id["C"]["total_float"], 0)

    def test_parallel_paths_and_float(self):
        """Tests branching:
        Start -> A (5d) -> C (4d) -> End
        Start -> B (2d) -> C (4d) -> End
        Path A->C takes 9 days (critical).
        Path B has float of 3 days and is NOT critical.
        """
        start_d = date(2026, 11, 1)
        milestones = [
            {"id": "A", "name": "Long Task", "duration_days": 5, "forecast_date": start_d},
            {"id": "B", "name": "Short Task", "duration_days": 2, "forecast_date": start_d},
            {"id": "C", "name": "Merge Task", "duration_days": 4},
        ]
        deps = [
            {"milestone_id": "C", "predecessor_id": "A", "lag_days": 0, "dependency_type": "FS"},
            {"milestone_id": "C", "predecessor_id": "B", "lag_days": 0, "dependency_type": "FS"},
        ]

        result = calculate_cpm_schedule(milestones, dependencies=deps, default_start_date=start_d)
        res_by_id = {m["id"]: m for m in result}

        # Project completion is 2026-11-01 + 5 + 4 = 2026-11-10
        self.assertTrue(res_by_id["A"]["is_critical"])
        self.assertEqual(res_by_id["A"]["total_float"], 0)

        self.assertTrue(res_by_id["C"]["is_critical"])
        self.assertEqual(res_by_id["C"]["total_float"], 0)

        # B finishes at 2026-11-03, but C doesn't start until 2026-11-06 -> B has 3 days float!
        self.assertFalse(res_by_id["B"]["is_critical"])
        self.assertEqual(res_by_id["B"]["total_float"], 3)

    def test_cycle_detection(self):
        """Tests that circular dependency (A -> B -> C -> A) raises CyclicDependencyError."""
        start_d = date(2026, 11, 1)
        milestones = [
            {"id": "A", "name": "Task A", "duration_days": 2, "predecessor_id": "C"},
            {"id": "B", "name": "Task B", "duration_days": 2, "predecessor_id": "A"},
            {"id": "C", "name": "Task C", "duration_days": 2, "predecessor_id": "B"},
        ]

        with self.assertRaises(CyclicDependencyError):
            calculate_cpm_schedule(milestones, default_start_date=start_d)

    def test_lag_days(self):
        """Tests that lag days push Early Start forward."""
        start_d = date(2026, 11, 1)
        milestones = [
            {"id": "A", "name": "Concrete Pour", "duration_days": 1, "forecast_date": start_d},
            {"id": "B", "name": "Stripping Formwork", "duration_days": 2, "predecessor_id": "A", "lag_days": 7},
        ]

        result = calculate_cpm_schedule(milestones, default_start_date=start_d)
        res_by_id = {m["id"]: m for m in result}

        # A: 2026-11-01 -> 2026-11-02
        # B: starts 7 days after A finishes = 2026-11-02 + 7 = 2026-11-09
        self.assertEqual(res_by_id["A"]["early_finish"], date(2026, 11, 2))
        self.assertEqual(res_by_id["B"]["early_start"], date(2026, 11, 9))
        self.assertEqual(res_by_id["B"]["early_finish"], date(2026, 11, 11))


if __name__ == "__main__":
    unittest.main()
