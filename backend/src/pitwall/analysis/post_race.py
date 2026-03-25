"""
Post-Race Analysis Engine.

Takes a stored race session dataset and produces comprehensive analytics:
- Lap time history & pace graphs
- Tyre wear curves with cliff detection
- Fuel & ERS usage patterns
- Strategy decision evaluation
- Undercut/overcut success analysis
- Traffic impact quantification
- Vehicle balance (US/OS) trend over the race
"""
import logging
import math
from dataclasses import dataclass, field
from typing import Any

logger = logging.getLogger(__name__)


@dataclass
class LapAnalysis:
    lap: int
    lap_time_ms: int
    lap_time_s: float
    delta_to_best_s: float
    delta_to_avg_s: float
    position: int
    tyre_compound: str
    tyre_age: int
    fuel_remaining: float
    ers_level: float
    is_pit_lap: bool
    is_outlier: bool
    stint_number: int


@dataclass
class StintAnalysis:
    stint_number: int
    start_lap: int
    end_lap: int
    compound: str
    total_laps: int
    avg_lap_time_s: float
    best_lap_time_s: float
    degradation_rate_s: float  # seconds per lap of degradation
    tyre_cliff_detected: bool
    cliff_lap: int | None


@dataclass
class PitStopAnalysis:
    lap: int
    compound_before: str
    compound_after: str
    position_before: int
    position_after: int
    position_delta: int
    pit_duration_ms: int
    was_undercut: bool
    was_overcut: bool
    undercut_success: bool | None
    overcut_success: bool | None
    net_time_impact_s: float


@dataclass
class StrategyEvaluation:
    total_decisions: int
    pit_now_count: int
    stay_out_count: int
    correct_decisions: int
    accuracy_pct: float
    key_moments: list[dict]
    overall_verdict: str
    improvement_suggestions: list[str]


@dataclass
class TrafficImpact:
    total_laps_in_traffic: int
    estimated_time_lost_s: float
    worst_traffic_laps: list[dict]
    drs_opportunities_missed: int


@dataclass
class FuelErsPattern:
    fuel_consumption_per_lap: list[float]
    avg_fuel_per_lap: float
    fuel_critical_lap: int | None
    ers_usage_histogram: list[float]
    ers_deployment_efficiency: float


@dataclass
class BalanceTrendPoint:
    lap: int
    understeer_score: float
    oversteer_score: float
    dominant: str


@dataclass
class RaceAnalysisReport:
    """Complete post-race analysis report."""
    # Summary
    track: str
    session_type: str
    total_laps: int
    final_position: int
    best_lap_ms: int
    total_time_s: float
    
    # Detailed analytics
    lap_analysis: list[LapAnalysis] = field(default_factory=list)
    stint_analysis: list[StintAnalysis] = field(default_factory=list)
    pit_stop_analysis: list[PitStopAnalysis] = field(default_factory=list)
    strategy_evaluation: StrategyEvaluation | None = None
    traffic_impact: TrafficImpact | None = None
    fuel_ers_pattern: FuelErsPattern | None = None
    balance_trend: list[BalanceTrendPoint] = field(default_factory=list)
    
    # Timeline events
    timeline_events: list[dict] = field(default_factory=list)
    
    # Interpretation
    race_narrative: str = ""
    key_findings: list[str] = field(default_factory=list)


class PostRaceAnalyser:
    """Analyses a complete race session dataset."""

    def analyse(self, session_data: dict) -> dict:
        """Run full post-race analysis and return serializable report."""
        meta = session_data.get("metadata", {})
        laps_raw = session_data.get("laps", [])
        pit_events = session_data.get("pit_events", [])
        strategy_decisions = session_data.get("strategy_decisions", [])
        position_changes = session_data.get("position_changes", [])
        snapshots = session_data.get("snapshots", [])
        leaderboard_history = session_data.get("leaderboard_history", [])

        # ── Lap Analysis ──
        lap_analysis = self._analyse_laps(laps_raw)

        # ── Stint Analysis ──
        stint_analysis = self._analyse_stints(laps_raw, pit_events)

        # ── Pit Stop Analysis ──
        pit_analysis = self._analyse_pit_stops(pit_events, laps_raw, leaderboard_history)

        # ── Strategy Evaluation ──
        strat_eval = self._evaluate_strategy(strategy_decisions, laps_raw, pit_events)

        # ── Traffic Impact ──
        traffic = self._analyse_traffic(snapshots, leaderboard_history, laps_raw)

        # ── Fuel & ERS ──
        fuel_ers = self._analyse_fuel_ers(laps_raw, snapshots)

        # ── Balance Trend ──
        balance_trend = self._analyse_balance_trend(snapshots)

        # ── Timeline Events ──
        timeline = self._build_timeline(laps_raw, pit_events, position_changes, strategy_decisions)

        # ── Race Narrative ──
        narrative, findings = self._generate_narrative(
            meta, lap_analysis, stint_analysis, pit_analysis, strat_eval, traffic
        )

        total_time = sum(l.get("lap_time_ms", 0) for l in laps_raw if l.get("lap_time_ms", 0) > 0) / 1000.0

        report = {
            "track": meta.get("track", "UNKNOWN"),
            "session_type": meta.get("session_type", "UNKNOWN"),
            "total_laps": meta.get("total_laps", 0),
            "final_position": meta.get("final_position", 0),
            "best_lap_ms": meta.get("best_lap_ms", 0),
            "total_time_s": round(total_time, 3),
            "lap_analysis": lap_analysis,
            "stint_analysis": stint_analysis,
            "pit_stop_analysis": pit_analysis,
            "strategy_evaluation": strat_eval,
            "traffic_impact": traffic,
            "fuel_ers_pattern": fuel_ers,
            "balance_trend": balance_trend,
            "timeline_events": timeline,
            "race_narrative": narrative,
            "key_findings": findings,
        }
        return report

    def _analyse_laps(self, laps_raw: list[dict]) -> list[dict]:
        """Build per-lap analysis with delta calculations."""
        if not laps_raw:
            return []

        valid_times = [l["lap_time_ms"] for l in laps_raw if l.get("lap_time_ms", 0) > 0]
        if not valid_times:
            return []

        best_ms = min(valid_times)
        avg_ms = sum(valid_times) / len(valid_times)
        best_s = best_ms / 1000.0
        avg_s = avg_ms / 1000.0

        # Outlier detection (>107% of best lap)
        outlier_threshold = best_ms * 1.07

        # Stint numbering
        stint = 1
        result = []
        for i, lap in enumerate(laps_raw):
            lt_ms = lap.get("lap_time_ms", 0)
            lt_s = lt_ms / 1000.0
            is_pit = lap.get("is_pit_in_lap", False) or lap.get("is_pit_out_lap", False)

            if i > 0 and laps_raw[i - 1].get("is_pit_in_lap", False):
                stint += 1

            result.append({
                "lap": lap.get("lap_number", i + 1),
                "lap_time_ms": lt_ms,
                "lap_time_s": round(lt_s, 3),
                "delta_to_best_s": round(lt_s - best_s, 3) if lt_ms > 0 else 0,
                "delta_to_avg_s": round(lt_s - avg_s, 3) if lt_ms > 0 else 0,
                "position": lap.get("position", 0),
                "tyre_compound": lap.get("tyre_compound", ""),
                "tyre_age": lap.get("tyre_age", 0),
                "fuel_remaining": round(lap.get("fuel_remaining", 0), 2),
                "ers_level": round(lap.get("ers_level_norm", 0), 3),
                "is_pit_lap": is_pit,
                "is_outlier": lt_ms > outlier_threshold if lt_ms > 0 else False,
                "stint_number": stint,
            })

        return result

    def _analyse_stints(self, laps_raw: list[dict], pit_events: list[dict]) -> list[dict]:
        """Analyse each stint for degradation and tyre cliff."""
        if not laps_raw:
            return []

        # Split laps into stints
        stints: list[list[dict]] = [[]]
        for i, lap in enumerate(laps_raw):
            stints[-1].append(lap)
            if lap.get("is_pit_in_lap", False) and i < len(laps_raw) - 1:
                stints.append([])

        result = []
        for stint_num, stint_laps in enumerate(stints, 1):
            valid = [l for l in stint_laps if l.get("lap_time_ms", 0) > 0
                     and not l.get("is_pit_in_lap", False)
                     and not l.get("is_pit_out_lap", False)]
            if not valid:
                continue

            times_s = [l["lap_time_ms"] / 1000.0 for l in valid]
            avg_time = sum(times_s) / len(times_s)
            best_time = min(times_s)

            # Degradation rate: linear slope of lap times
            deg_rate = 0.0
            cliff_detected = False
            cliff_lap = None

            if len(times_s) >= 3:
                # Simple linear regression
                n = len(times_s)
                x_mean = (n - 1) / 2.0
                y_mean = avg_time
                num = sum((i - x_mean) * (t - y_mean) for i, t in enumerate(times_s))
                den = sum((i - x_mean) ** 2 for i in range(n))
                deg_rate = num / den if den > 0 else 0.0

                # Cliff detection: sudden >1.5s jump
                for j in range(1, len(times_s)):
                    if times_s[j] - times_s[j - 1] > 1.5:
                        cliff_detected = True
                        cliff_lap = valid[j].get("lap_number", j + stint_laps[0].get("lap_number", 1))
                        break

            compound = stint_laps[0].get("tyre_compound", "UNKNOWN") if stint_laps else "UNKNOWN"
            result.append({
                "stint_number": stint_num,
                "start_lap": stint_laps[0].get("lap_number", 0),
                "end_lap": stint_laps[-1].get("lap_number", 0),
                "compound": compound,
                "total_laps": len(stint_laps),
                "avg_lap_time_s": round(avg_time, 3),
                "best_lap_time_s": round(best_time, 3),
                "degradation_rate_s": round(deg_rate, 4),
                "tyre_cliff_detected": cliff_detected,
                "cliff_lap": cliff_lap,
            })

        return result

    def _analyse_pit_stops(self, pit_events: list[dict], laps_raw: list[dict],
                           leaderboard_history: list[dict]) -> list[dict]:
        """Analyse each pit stop for undercut/overcut effectiveness."""
        result = []
        pit_ins = [e for e in pit_events if e.get("event_type") == "PIT_IN"]
        pit_outs = [e for e in pit_events if e.get("event_type") == "PIT_OUT"]

        for i, pit_in in enumerate(pit_ins):
            pit_out = pit_outs[i] if i < len(pit_outs) else None
            pos_before = pit_in.get("position_before", 0)
            pos_after = pit_out.get("position_after", pos_before) if pit_out else pos_before
            duration = pit_out.get("pit_duration_ms", 0) if pit_out else 0

            # Undercut: pitted before rivals who were close
            was_undercut = False
            undercut_success = None
            was_overcut = False
            overcut_success = None

            if pos_after < pos_before:
                # Gained position(s) through pit stop — likely undercut
                was_undercut = True
                undercut_success = True
            elif pos_after > pos_before:
                if pos_after > pos_before + 1:
                    # Lost more than 1 position — likely poor overcut attempt
                    was_overcut = True
                    overcut_success = False
                else:
                    # Lost exactly 1 position — marginal, could be either strategy
                    was_overcut = True
                    overcut_success = None

            # Net time impact estimation
            net_impact = duration / 1000.0 if duration > 0 else 22.0
            if pos_after < pos_before:
                net_impact = -net_impact  # gained positions → negative = good

            result.append({
                "lap": pit_in.get("lap", 0),
                "compound_before": pit_in.get("tyre_compound_before", ""),
                "compound_after": pit_out.get("tyre_compound_after", "") if pit_out else "",
                "position_before": pos_before,
                "position_after": pos_after,
                "position_delta": pos_after - pos_before,
                "pit_duration_ms": duration,
                "was_undercut": was_undercut,
                "was_overcut": was_overcut,
                "undercut_success": undercut_success,
                "overcut_success": overcut_success,
                "net_time_impact_s": round(net_impact, 2),
            })

        return result

    def _evaluate_strategy(self, decisions: list[dict], laps_raw: list[dict],
                           pit_events: list[dict]) -> dict:
        """Evaluate strategy decisions against actual outcomes."""
        if not decisions:
            return {
                "total_decisions": 0, "pit_now_count": 0, "stay_out_count": 0,
                "correct_decisions": 0, "accuracy_pct": 0,
                "key_moments": [], "overall_verdict": "No strategy data available.",
                "improvement_suggestions": [],
            }

        total = len(decisions)
        pit_now_count = sum(1 for d in decisions if d.get("action") == "PIT_NOW")
        stay_out_count = sum(1 for d in decisions if d.get("action") == "STAY_OUT")

        # Build a set of actual pit laps
        actual_pit_laps = {e.get("lap", 0) for e in pit_events if e.get("event_type") == "PIT_IN"}

        correct = 0
        key_moments = []
        for d in decisions:
            action = d.get("action", "")
            lap = d.get("lap", 0)
            confidence = d.get("confidence", "low")

            # A "PIT_NOW" decision on a lap where we actually pitted (or ±1) = correct
            # A "STAY_OUT" decision on a non-pit lap = correct
            actually_pitted = any(abs(lap - pl) <= 1 for pl in actual_pit_laps)

            if action == "PIT_NOW" and actually_pitted:
                correct += 1
            elif action in ("PIT_IN_1", "PIT_IN_2") and actually_pitted:
                correct += 1
            elif action == "STAY_OUT" and not actually_pitted:
                correct += 1

            if confidence == "high":
                key_moments.append({
                    "lap": lap,
                    "action": action,
                    "confidence": confidence,
                    "was_correct": actually_pitted if "PIT" in action else not actually_pitted,
                    "reason": d.get("reason", ""),
                })

        accuracy = (correct / total * 100) if total > 0 else 0

        # Generate verdict
        if accuracy >= 80:
            verdict = "Excellent strategy execution. Decisions aligned well with race outcomes."
        elif accuracy >= 60:
            verdict = "Good overall strategy. Some decisions could have been optimized."
        elif accuracy >= 40:
            verdict = "Mixed strategy performance. Review pit window timing and tyre management."
        else:
            verdict = "Strategy needs improvement. Consider earlier/later pit stops and traffic awareness."

        # Suggestions
        suggestions = []
        if pit_now_count > total * 0.5:
            suggestions.append("Too many PIT_NOW calls — may indicate reactive rather than proactive strategy.")
        if stay_out_count > total * 0.8:
            suggestions.append("Very conservative strategy. Consider more aggressive undercut opportunities.")
        if any(d.get("confidence") == "low" for d in decisions[-5:]):
            suggestions.append("Low confidence in late-race decisions. Improve ERS and fuel data inputs.")

        return {
            "total_decisions": total,
            "pit_now_count": pit_now_count,
            "stay_out_count": stay_out_count,
            "correct_decisions": correct,
            "accuracy_pct": round(accuracy, 1),
            "key_moments": key_moments[:10],
            "overall_verdict": verdict,
            "improvement_suggestions": suggestions,
        }

    def _analyse_traffic(self, snapshots: list[dict], leaderboard_history: list[dict],
                         laps_raw: list[dict]) -> dict:
        """Quantify traffic impact on race performance."""
        traffic_lap_count = 0
        est_time_lost = 0.0
        worst = []

        if not laps_raw:
            return {
                "total_laps_in_traffic": 0,
                "estimated_time_lost_s": 0,
                "worst_traffic_laps": [],
                "drs_opportunities_missed": 0,
            }

        valid_times = [l["lap_time_ms"] for l in laps_raw if l.get("lap_time_ms", 0) > 0]
        if not valid_times:
            return {
                "total_laps_in_traffic": 0,
                "estimated_time_lost_s": 0,
                "worst_traffic_laps": [],
                "drs_opportunities_missed": 0,
            }

        median_time = sorted(valid_times)[len(valid_times) // 2]

        for lap in laps_raw:
            lt = lap.get("lap_time_ms", 0)
            if lt <= 0:
                continue
            # Heuristic: if lap is >1.5s slower than median AND not a pit lap → traffic
            delta = lt - median_time
            if delta > 1500 and not lap.get("is_pit_in_lap") and not lap.get("is_pit_out_lap"):
                traffic_lap_count += 1
                lost = delta / 1000.0
                est_time_lost += lost
                worst.append({
                    "lap": lap.get("lap_number", 0),
                    "time_lost_s": round(lost, 2),
                    "lap_time_ms": lt,
                })

        worst.sort(key=lambda x: x["time_lost_s"], reverse=True)

        return {
            "total_laps_in_traffic": traffic_lap_count,
            "estimated_time_lost_s": round(est_time_lost, 2),
            "worst_traffic_laps": worst[:5],
            "drs_opportunities_missed": 0,  # Would need DRS zone data
        }

    def _analyse_fuel_ers(self, laps_raw: list[dict], snapshots: list[dict]) -> dict:
        """Analyse fuel consumption and ERS patterns."""
        fuel_per_lap = []
        ers_levels = []

        prev_fuel = None
        for lap in laps_raw:
            fuel = lap.get("fuel_remaining", 0)
            ers = lap.get("ers_level_norm", 0)
            ers_levels.append(round(ers, 3))

            if prev_fuel is not None and fuel > 0:
                consumption = prev_fuel - fuel
                if consumption > 0:
                    fuel_per_lap.append(round(consumption, 3))
            prev_fuel = fuel

        avg_fuel = sum(fuel_per_lap) / len(fuel_per_lap) if fuel_per_lap else 0

        # Find critical fuel lap (projected to run out)
        fuel_critical = None
        if avg_fuel > 0 and laps_raw:
            last_fuel = laps_raw[-1].get("fuel_remaining", 0)
            laps_left = last_fuel / avg_fuel if avg_fuel > 0 else 999
            total_laps = laps_raw[-1].get("lap_number", 0)
            if laps_left < 5:
                fuel_critical = total_laps + int(laps_left)

        # ERS efficiency
        ers_eff = 0.0
        if ers_levels:
            # Higher average = better management
            ers_eff = sum(ers_levels) / len(ers_levels)

        return {
            "fuel_consumption_per_lap": fuel_per_lap,
            "avg_fuel_per_lap": round(avg_fuel, 3),
            "fuel_critical_lap": fuel_critical,
            "ers_usage_histogram": ers_levels,
            "ers_deployment_efficiency": round(ers_eff, 3),
        }

    def _analyse_balance_trend(self, snapshots: list[dict]) -> list[dict]:
        """Build a per-lap balance trend from snapshot tyre temperatures."""
        if not snapshots:
            return []

        # Group snapshots by lap
        by_lap: dict[int, list[dict]] = {}
        for s in snapshots:
            lap = s.get("lap", 0)
            if lap > 0:
                by_lap.setdefault(lap, []).append(s)

        trend = []
        for lap in sorted(by_lap.keys()):
            samples = by_lap[lap]
            us_sum = 0.0
            os_sum = 0.0
            count = 0

            for s in samples:
                front_temps = s.get("tyre_surface_temps", [0, 0, 0, 0])
                if len(front_temps) < 4:
                    continue
                f_avg = (front_temps[0] + front_temps[1]) / 2.0
                r_avg = (front_temps[2] + front_temps[3]) / 2.0
                diff = f_avg - r_avg
                if diff > 3:
                    us_sum += min(1.0, diff / 20.0)
                elif diff < -3:
                    os_sum += min(1.0, abs(diff) / 20.0)
                count += 1

            if count > 0:
                us = round(us_sum / count, 3)
                os = round(os_sum / count, 3)
                dominant = "understeer" if us > os + 0.05 else ("oversteer" if os > us + 0.05 else "neutral")
                trend.append({
                    "lap": lap,
                    "understeer_score": us,
                    "oversteer_score": os,
                    "dominant": dominant,
                })

        return trend

    def _build_timeline(self, laps: list[dict], pit_events: list[dict],
                        position_changes: list[dict], strategy_decisions: list[dict]) -> list[dict]:
        """Build a unified timeline of race events."""
        events = []

        for lap in laps:
            if lap.get("is_pit_in_lap"):
                events.append({
                    "type": "pit_in",
                    "lap": lap.get("lap_number", 0),
                    "timestamp": lap.get("timestamp", 0),
                    "detail": f"Pit in on lap {lap.get('lap_number', 0)}",
                })

        for pc in position_changes:
            if abs(pc.get("new_position", 0) - pc.get("old_position", 0)) >= 2:
                events.append({
                    "type": "position_change",
                    "lap": pc.get("lap", 0),
                    "timestamp": pc.get("timestamp", 0),
                    "detail": f"P{pc.get('old_position')} → P{pc.get('new_position')} ({pc.get('event', '')})",
                })

        for d in strategy_decisions:
            if d.get("confidence") == "high":
                events.append({
                    "type": "strategy_call",
                    "lap": d.get("lap", 0),
                    "timestamp": d.get("timestamp", 0),
                    "detail": f"{d.get('action', '')} (confidence: high)",
                })

        events.sort(key=lambda e: (e.get("lap", 0), e.get("timestamp", 0)))
        return events

    def _generate_narrative(self, meta: dict, laps: list[dict], stints: list[dict],
                            pit_stops: list[dict], strategy: dict, traffic: dict) -> tuple[str, list[str]]:
        """Generate a narrative explanation of the race and key findings."""
        parts = []
        findings = []

        track = meta.get("track", "Unknown")
        pos = meta.get("final_position", 0)
        parts.append(f"Race at {track}, finished P{pos}.")

        if stints:
            parts.append(f"Completed {len(stints)} stint(s).")
            for s in stints:
                if s.get("tyre_cliff_detected"):
                    findings.append(
                        f"Tyre cliff detected on stint {s['stint_number']} "
                        f"at lap {s.get('cliff_lap', '?')} ({s.get('compound', '?')})."
                    )
                if s.get("degradation_rate_s", 0) > 0.15:
                    findings.append(
                        f"High degradation ({s['degradation_rate_s']:.2f}s/lap) "
                        f"on stint {s['stint_number']} ({s.get('compound', '?')})."
                    )

        if pit_stops:
            undercuts = [p for p in pit_stops if p.get("was_undercut")]
            if undercuts:
                success = sum(1 for u in undercuts if u.get("undercut_success"))
                findings.append(f"Undercut attempts: {len(undercuts)}, successful: {success}.")

        accuracy = strategy.get("accuracy_pct", 0) if strategy else 0
        if accuracy > 0:
            findings.append(f"Strategy decision accuracy: {accuracy:.0f}%.")

        if traffic:
            lost = traffic.get("estimated_time_lost_s", 0)
            if lost > 3:
                findings.append(f"Estimated {lost:.1f}s lost to traffic over {traffic.get('total_laps_in_traffic', 0)} laps.")

        narrative = " ".join(parts)
        return narrative, findings
