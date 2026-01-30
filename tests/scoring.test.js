const { describe, it, expect } = require("vitest");
const Scoring = require("../scoring.module.js");

describe("scoring stats and zScore", () => {
  it("computes mean and sample sd", () => {
    const stats = Scoring.computeStats([1, 2, 3]);
    expect(stats.mean).toBeCloseTo(2, 6);
    expect(stats.sd).toBeCloseTo(1, 6);
  });

  it("returns z=0 when sd is 0 or value is missing", () => {
    const stats = Scoring.computeStats([5, 5, 5]);
    expect(stats.sd).toBe(0);
    expect(Scoring.zScore(5, stats)).toBe(0);
    expect(Scoring.zScore(null, stats)).toBe(0);
  });
});

describe("ranking order", () => {
  it("ranks by balanced score when metrics are monotonic", () => {
    const candidates = [
      { name: "A", scores: { "AUTOEFF_TOT": 100, "NPOQ-R": 10, "BIDR6_TOT": 10 } },
      { name: "B", scores: { "AUTOEFF_TOT": 90, "NPOQ-R": 20, "BIDR6_TOT": 20 } },
      { name: "C", scores: { "AUTOEFF_TOT": 80, "NPOQ-R": 30, "BIDR6_TOT": 30 } },
      { name: "D", scores: { "AUTOEFF_TOT": 70, "NPOQ-R": 40, "BIDR6_TOT": 40 } }
    ];
    const stats = Scoring.computeStatsByMetric(candidates, ["AUTOEFF_TOT", "NPOQ-R", "BIDR6_TOT"]);
    const ranked = Scoring.rankCandidates(candidates, stats, "balanced");
    expect(ranked.map((c) => c.name)).toEqual(["A", "B", "C", "D"]);
  });
});

describe("tie-break rules", () => {
  const baseStats = {
    "AUTOEFF_TOT": { mean: 100, sd: 100 },
    "NPOQ-R": { mean: 30, sd: 100 },
    "BIDR6_TOT": { mean: 50, sd: 100 }
  };

  it("prefers lower BIDR6_TOT when scores are within threshold", () => {
    const candidates = [
      {
        name: "A",
        scores: { "AUTOEFF_TOT": 100, "NPOQ-R": 30, "BIDR6_TOT": 40, "AUTOEFF_ANA_CON": 10 }
      },
      {
        name: "B",
        scores: { "AUTOEFF_TOT": 106, "NPOQ-R": 30, "BIDR6_TOT": 45, "AUTOEFF_ANA_CON": 10 }
      }
    ];
    const scoreA = Scoring.computeCandidateScore(candidates[0], baseStats, "balanced").score;
    const scoreB = Scoring.computeCandidateScore(candidates[1], baseStats, "balanced").score;
    expect(Math.abs(scoreA - scoreB)).toBeLessThan(0.05);
    const ranked = Scoring.rankCandidates(candidates, baseStats, "balanced");
    expect(ranked[0].name).toBe("A");
  });

  it("prefers lower NPOQ-R when BIDR6_TOT ties", () => {
    const candidates = [
      {
        name: "A",
        scores: { "AUTOEFF_TOT": 100, "NPOQ-R": 26, "BIDR6_TOT": 50, "AUTOEFF_ANA_CON": 10 }
      },
      {
        name: "B",
        scores: { "AUTOEFF_TOT": 106, "NPOQ-R": 30, "BIDR6_TOT": 50, "AUTOEFF_ANA_CON": 10 }
      }
    ];
    const scoreA = Scoring.computeCandidateScore(candidates[0], baseStats, "balanced").score;
    const scoreB = Scoring.computeCandidateScore(candidates[1], baseStats, "balanced").score;
    expect(Math.abs(scoreA - scoreB)).toBeLessThan(0.05);
    const ranked = Scoring.rankCandidates(candidates, baseStats, "balanced");
    expect(ranked[0].name).toBe("A");
  });

  it("uses AUTOEFF_ANA_CON as final tie-break", () => {
    const candidates = [
      {
        name: "A",
        scores: { "AUTOEFF_TOT": 100, "NPOQ-R": 30, "BIDR6_TOT": 50, "AUTOEFF_ANA_CON": 25 }
      },
      {
        name: "B",
        scores: { "AUTOEFF_TOT": 100, "NPOQ-R": 30, "BIDR6_TOT": 50, "AUTOEFF_ANA_CON": 20 }
      }
    ];
    const ranked = Scoring.rankCandidates(candidates, baseStats, "balanced");
    expect(ranked[0].name).toBe("A");
  });
});
