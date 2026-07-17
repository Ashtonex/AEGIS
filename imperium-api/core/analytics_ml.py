import numpy as np
import scipy.stats as stats
from typing import List, Dict, Any


class AnalyticsMLEngine:
    def __init__(self):
        # Initialize ML engine parameters
        pass

    def run_monte_carlo_schedule(
        self, tasks: List[Dict[str, Any]], iterations: int = 1000
    ) -> Dict[str, Any]:
        """
        Runs a Monte Carlo schedule simulation using PERT/Beta distribution.
        Each task must specify: 'name', 'a' (optimistic), 'm' (most likely), 'b' (pessimistic)
        """
        if not tasks:
            return {
                "success": False,
                "error": "No tasks provided for scheduling simulation.",
            }

        simulated_totals = np.zeros(iterations)

        for task in tasks:
            a = float(task.get("a", 1.0))
            m = float(task.get("m", 1.5))
            b = float(task.get("b", 3.0))

            # Beta distribution fitting
            range_val = b - a
            if range_val <= 0:
                simulated_durations = np.full(iterations, a)
            else:
                mean = (a + 4 * m + b) / 6.0
                var = ((b - a) / 6.0) ** 2

                # Check for statistical limits
                if var == 0 or mean == a or mean == b:
                    simulated_durations = np.full(iterations, m)
                else:
                    alpha = ((mean - a) / range_val) * (
                        ((mean - a) * (b - mean) / var) - 1
                    )
                    beta_param = alpha * (b - mean) / (mean - a)

                    if alpha <= 0 or beta_param <= 0:
                        # Fallback to triangular if beta parameters are degenerate
                        simulated_durations = stats.triang.rvs(
                            (m - a) / range_val, loc=a, scale=range_val, size=iterations
                        )
                    else:
                        simulated_durations = (
                            a
                            + stats.beta.rvs(alpha, beta_param, size=iterations)
                            * range_val
                        )

            simulated_totals += simulated_durations

        p50 = float(np.percentile(simulated_totals, 50))
        p90 = float(np.percentile(simulated_totals, 90))
        mean_dur = float(np.mean(simulated_totals))
        std_dur = float(np.std(simulated_totals))

        return {
            "success": True,
            "p50_duration_weeks": round(p50, 2),
            "p90_duration_weeks": round(p90, 2),
            "mean_duration_weeks": round(mean_dur, 2),
            "standard_deviation_weeks": round(std_dur, 2),
            "iterations_run": iterations,
        }

    def forecast_rate_trend(
        self, price_history: List[Dict[str, Any]], forecast_steps: int = 3
    ) -> Dict[str, Any]:
        """
        Calculates price trend forecasts using linear regression slopes over historical prices.
        History must be a list of dicts with 'date' and 'price'.
        """
        if not price_history or len(price_history) < 2:
            # Fallback for short histories
            last_price = float(price_history[0]["price"]) if price_history else 12.0
            return {
                "success": True,
                "forecast": [round(last_price, 2)] * forecast_steps,
                "trend_direction": "flat",
                "variance": 0.0,
            }

        # Extract prices and convert dates to sequential indexes
        prices = [float(item["price"]) for item in price_history]
        x = np.arange(len(prices))

        # Fit linear regression line
        slope, intercept = np.polyfit(x, prices, 1)

        forecast = []
        for i in range(forecast_steps):
            next_idx = len(prices) + i
            pred_price = slope * next_idx + intercept
            forecast.append(round(max(0.1, pred_price), 2))

        trend = "upward" if slope > 0.05 else "downward" if slope < -0.05 else "flat"
        variance = float(np.var(prices))

        return {
            "success": True,
            "forecast": forecast,
            "trend_direction": trend,
            "variance": round(variance, 4),
            "slope": round(float(slope), 4),
        }


ml_engine = AnalyticsMLEngine()
