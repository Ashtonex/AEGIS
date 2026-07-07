# In a real environment, we would load a pickled model from scikit-learn
# from sklearn.ensemble import RandomForestClassifier
# import joblib
# model = joblib.load('leads_scoring_model.pkl')

class LeadScoringEngine:
    def __init__(self):
        # We simulate the initialization of the ML model
        pass

    def score_lead(self, sector: str, estimated_budget: float, lead_source: str) -> dict:
        """
        Calculates a propensity-to-convert score based on historical data.
        In a production scenario, this takes a pandas DataFrame and runs model.predict_proba(df).
        For this deterministic proxy, we use weighted coefficients.
        """
        # Feature Engineering (Simulated)
        score = 50 # Base score

        # Sector Weights
        if sector == 'Government':
            score += 25
            rationale_sector = "High historical win-rate in Government sector."
        elif sector == 'Mining':
            score += 20
            rationale_sector = "Mining sector has fast payment terms and high conversion."
        elif sector == 'Commercial':
            score -= 10
            rationale_sector = "Commercial sector historically yields low margins and high drop-off."
        else:
            rationale_sector = "Unknown sector performance."

        # Budget Weights
        if estimated_budget > 10000000:
            score += 15
            rationale_budget = "Budget matches our heavy-equipment capability profile."
        elif estimated_budget > 1000000:
            score += 10
            rationale_budget = "Solid mid-market budget."
        else:
            score -= 10
            rationale_budget = "Budget is below our optimal operational threshold."

        # Source Weights
        if lead_source == 'Government Gazette':
            score += 5
        elif lead_source == 'Website Enquiry':
            score += 10
        elif lead_source == 'Manual Entry':
            score -= 5

        # Normalize score between 0 and 100
        final_score = max(0, min(100, int(score)))

        rationale = f"{rationale_sector} {rationale_budget}"

        return {
            "ai_score": final_score,
            "ai_rationale": rationale
        }

ml_engine = LeadScoringEngine()

class RiskEngine:
    def __init__(self):
        pass
        
    def calculate_client_concentration(self, pipeline_value: float = 11800000):
        # Simulated algorithm for client concentration
        # In production, this clusters client_ids against total pipeline value
        return {
            "risk_score": 75,
            "level": "HIGH",
            "primary_dependency": "Government (65%)",
            "directive": "Increase private sector / Mining bids to dilute dependency.",
            "breakdown": [
                {"sector": "Government", "percentage": 65, "value": 7670000},
                {"sector": "Mining", "percentage": 25, "value": 2950000},
                {"sector": "Private Commercial", "percentage": 10, "value": 1180000}
            ]
        }
        
    def calculate_subcontractor_risk(self):
        # Simulated algorithm for subcontractor dependency
        # In production, uses NSSA clearance dates, past performance, and current pipeline allocations
        return {
            "risk_score": 82,
            "level": "CRITICAL",
            "primary_dependency": "ABC Civils (42%)",
            "directive": "ABC Civils has expiring NSSA clearance in 14 days. Do not award new contracts.",
            "breakdown": [
                {"name": "ABC Civils", "dependency": 42, "status": "Warning"},
                {"name": "ZimTrak Earthmovers", "dependency": 28, "status": "Stable"},
                {"name": "SteelWorks Ltd", "dependency": 15, "status": "Stable"}
            ]
        }
        
    def calculate_win_loss_diagnostic(self):
        # Simulated stage drop-off analysis
        return {
            "overall_win_rate": 28,
            "critical_drop_off_stage": "Final Quotation",
            "drop_off_rate": 65,
            "directive": "We win 80% of site visits but lose 65% at quotation. Diagnosis: Pricing is uncompetitive.",
            "stages": [
                {"stage": "Inquiry", "conversion": 95},
                {"stage": "Site Visit", "conversion": 80},
                {"stage": "Quotation", "conversion": 35},
                {"stage": "Negotiation", "conversion": 28}
            ]
        }

risk_engine = RiskEngine()
