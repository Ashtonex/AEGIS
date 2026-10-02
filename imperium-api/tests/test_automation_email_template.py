import unittest

from app.services.crm.automation_engine import render_template


class AutomationEmailTemplateTests(unittest.TestCase):
    def test_company_name_falls_back_to_contact_name(self):
        event = {"contact_name": "Muchabayawi", "lead_source": "Manual Log"}
        self.assertEqual(render_template("New CRM lead: {{company_name}}", event), "New CRM lead: Muchabayawi")

    def test_company_name_used_when_present(self):
        event = {"company_name": "Troutbeck", "contact_name": "Jane"}
        self.assertEqual(render_template("New CRM lead: {{company_name}}", event), "New CRM lead: Troutbeck")

    def test_missing_and_none_fields_render_blank(self):
        self.assertEqual(render_template("Sector: {{sector}}|{{ budget }}", {"budget": None}), "Sector: |")

    def test_body_values_are_html_escaped(self):
        self.assertEqual(render_template("<b>{{contact_name}}</b>", {"contact_name": "A & <B>"}, escape=True), "<b>A &amp; &lt;B&gt;</b>")


if __name__ == "__main__":
    unittest.main()
