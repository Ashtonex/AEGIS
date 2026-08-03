"""
Tests for the segregation-of-duties gate (core.security.is_self_certification)
and the SOP checklist enforcement built to answer: "how robust is the CCB
against being fooled, and can we enforce SOPs like site visits before a
quotation is allowed to be won."

Two self-certification gaps were found and closed:
1. routers/quotations.py decide_quotation - a quotation's own author could
   mark it won with no independent commercial sign-off.
2. routers/drawings.py set_checklist_item - the person who created a
   drawing revision could tick off its own review checklist, including the
   "approved by an authorised reviewer" item.

Both now share core.security.is_self_certification, tested once here
rather than duplicated per call site.
"""

import unittest

from core.security import is_self_certification


class IsSelfCertificationTests(unittest.TestCase):
    def test_same_user_id_is_self_certification(self):
        self.assertTrue(is_self_certification("user-123", "user-123"))

    def test_different_user_ids_is_not_self_certification(self):
        self.assertFalse(is_self_certification("user-123", "user-456"))

    def test_uuid_objects_compare_by_string_value(self):
        import uuid
        u = uuid.uuid4()
        # Same UUID value but different object identity/representation source
        # (e.g. one from a JWT claim as str, one from an asyncpg row as UUID).
        self.assertTrue(is_self_certification(str(u), u))

    def test_missing_creator_never_blocks(self):
        """An unattributed record (created_by is NULL, e.g. legacy data)
        must not be treated as a self-certification match - that would
        block a legitimate first sign-off with no way to resolve it."""
        self.assertFalse(is_self_certification("user-123", None))
        self.assertFalse(is_self_certification(None, "user-123"))
        self.assertFalse(is_self_certification(None, None))


if __name__ == "__main__":
    unittest.main()
