# In a real environment, we would load a pickled model from scikit-learn
# from sklearn.ensemble import RandomForestClassifier
# import joblib
# model = joblib.load('leads_scoring_model.pkl')


class LeadScoringEngine:
    def __init__(self):
        # We simulate the initialization of the ML model
        pass

    def score_lead(
        self, sector: str, estimated_budget: float, lead_source: str
    ) -> dict:
        """
        Calculates a propensity-to-convert score based on historical data.
        In a production scenario, this takes a pandas DataFrame and runs model.predict_proba(df).
        For this deterministic proxy, we use weighted coefficients.
        """
        # Feature Engineering (Simulated)
        score = 50  # Base score

        # Sector Weights
        if sector == "Government":
            score += 25
            rationale_sector = "High historical win-rate in Government sector."
        elif sector == "Mining":
            score += 20
            rationale_sector = (
                "Mining sector has fast payment terms and high conversion."
            )
        elif sector == "Commercial":
            score -= 10
            rationale_sector = (
                "Commercial sector historically yields low margins and high drop-off."
            )
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
        if lead_source == "Government Gazette":
            score += 5
        elif lead_source == "Website Enquiry":
            score += 10
        elif lead_source == "Manual Entry":
            score -= 5

        # Normalize score between 0 and 100
        final_score = max(0, min(100, int(score)))

        rationale = f"{rationale_sector} {rationale_budget}"

        return {"ai_score": final_score, "ai_rationale": rationale}


ml_engine = LeadScoringEngine()
