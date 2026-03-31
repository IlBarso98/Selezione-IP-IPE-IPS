/* eslint-disable */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.Scoring = api;
  }
})(typeof window !== "undefined" ? window : globalThis, function () {
  const METRIC_KEYS = {
    AUTOEFF_TOT: "AUTOEFF_TOT",
    AUTOEFF_MAT_EMO: "AUTOEFF_MAT_EMO",
    AUTOEFF_FIN_AZI: "AUTOEFF_FIN_AZI",
    AUTOEFF_FLU_REL: "AUTOEFF_FLU_REL",
    AUTOEFF_ANA_CON: "AUTOEFF_ANA_CON",
    NPOQ_R: "NPOQ-R",
    BIDR_TOT: "BIDR6_TOT",
    BIDR_SDE: "BIDR_SDE",
    BIDR_IM: "BIDR_IM"
  };

  const AUTOEFF_SUBS = [
    METRIC_KEYS.AUTOEFF_MAT_EMO,
    METRIC_KEYS.AUTOEFF_FIN_AZI,
    METRIC_KEYS.AUTOEFF_FLU_REL,
    METRIC_KEYS.AUTOEFF_ANA_CON
  ];

  const INVERT_KEYS = new Set([METRIC_KEYS.NPOQ_R, METRIC_KEYS.BIDR_TOT, METRIC_KEYS.BIDR_SDE, METRIC_KEYS.BIDR_IM]);

  const RANGE_BY_KEY = {
    [METRIC_KEYS.AUTOEFF_TOT]: [24, 120],
    [METRIC_KEYS.AUTOEFF_MAT_EMO]: [6, 30],
    [METRIC_KEYS.AUTOEFF_FIN_AZI]: [6, 30],
    [METRIC_KEYS.AUTOEFF_FLU_REL]: [6, 30],
    [METRIC_KEYS.AUTOEFF_ANA_CON]: [6, 30],
    [METRIC_KEYS.NPOQ_R]: [0, 60],
    [METRIC_KEYS.BIDR_TOT]: [0, 120],
    [METRIC_KEYS.BIDR_SDE]: [8, 48],
    [METRIC_KEYS.BIDR_IM]: [8, 48]
  };

  const MODE_DEFS = {
    balanced: { label: "Balanced", weights: { autoeff: 0.55, npoq: 0.25, bidr: 0.2 } },
    performance: { label: "Performance-only", weights: { autoeff: 1, npoq: 0, bidr: 0 } },
    credibility: { label: "Credibility-first", weights: { autoeff: 0.45, npoq: 0.2, bidr: 0.35 } }
  };

  function isValidNumber(value) {
    return typeof value === "number" && Number.isFinite(value);
  }

  function computeStats(values) {
    const clean = values.filter((value) => isValidNumber(value));
    if (!clean.length) return { mean: 0, sd: 0 };
    const mean = clean.reduce((sum, value) => sum + value, 0) / clean.length;
    if (clean.length === 1) return { mean, sd: 0 };
    const variance =
      clean.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) / (clean.length - 1);
    return { mean, sd: Math.sqrt(variance) };
  }

  function zScore(value, stats) {
    if (!isValidNumber(value)) return 0;
    if (!stats || !isValidNumber(stats.sd) || stats.sd === 0) return 0;
    return (value - stats.mean) / stats.sd;
  }

  function computeStatsByMetric(candidates, metricKeys) {
    const statsByMetric = {};
    metricKeys.forEach((key) => {
      const values = candidates.map((candidate) => candidate.scores[key]).filter((v) => isValidNumber(v));
      statsByMetric[key] = computeStats(values);
    });
    return statsByMetric;
  }

  function computeCandidateScore(candidate, statsByMetric, mode) {
    const modeDef = MODE_DEFS[mode] || MODE_DEFS.balanced;
    const weights = modeDef.weights;
    const z = {};
    const zInv = {};
    const missing = new Set();

    function computeZ(key) {
      if (Object.prototype.hasOwnProperty.call(z, key)) return z[key];
      const raw = candidate.scores ? candidate.scores[key] : null;
      if (!isValidNumber(raw)) {
        missing.add(key);
        z[key] = 0;
        return 0;
      }
      const stats = statsByMetric && statsByMetric[key] ? statsByMetric[key] : { mean: 0, sd: 0 };
      const value = zScore(raw, stats);
      z[key] = value;
      return value;
    }

    function computeZInv(key) {
      if (Object.prototype.hasOwnProperty.call(zInv, key)) return zInv[key];
      const value = -computeZ(key);
      zInv[key] = value;
      return value;
    }

    const autoeffZ = computeZ(METRIC_KEYS.AUTOEFF_TOT);
    const npoqInv = computeZInv(METRIC_KEYS.NPOQ_R);
    const bidrInv = computeZInv(METRIC_KEYS.BIDR_TOT);

    AUTOEFF_SUBS.forEach((key) => computeZ(key));
    computeZ(METRIC_KEYS.BIDR_SDE);
    computeZ(METRIC_KEYS.BIDR_IM);

    const autoeffSubAvg =
      AUTOEFF_SUBS.reduce((sum, key) => sum + (z[key] || 0), 0) / AUTOEFF_SUBS.length;

    const score = weights.autoeff * autoeffZ + weights.npoq * npoqInv + weights.bidr * bidrInv;

    const components = {
      autoeff: weights.autoeff * autoeffZ,
      npoq: weights.npoq * npoqInv,
      bidr: weights.bidr * bidrInv
    };

    return {
      score,
      mode: modeDef.label,
      components,
      z,
      zInv,
      autoeffSubAvg,
      missingMetrics: Array.from(missing)
    };
  }

  function safeNumber(value, fallback) {
    return isValidNumber(value) ? value : fallback;
  }

  function rankCandidates(candidates, statsByMetric, mode) {
    const scored = candidates.map((candidate) => ({
      ...candidate,
      scoring: computeCandidateScore(candidate, statsByMetric, mode)
    }));

    const epsilon = 0.05;
    scored.sort((a, b) => {
      const diff = b.scoring.score - a.scoring.score;
      if (Math.abs(diff) >= epsilon) return diff;

      const bidrA = safeNumber(a.scores[METRIC_KEYS.BIDR_TOT], Infinity);
      const bidrB = safeNumber(b.scores[METRIC_KEYS.BIDR_TOT], Infinity);
      if (bidrA !== bidrB) return bidrA - bidrB;

      const npoqA = safeNumber(a.scores[METRIC_KEYS.NPOQ_R], Infinity);
      const npoqB = safeNumber(b.scores[METRIC_KEYS.NPOQ_R], Infinity);
      if (npoqA !== npoqB) return npoqA - npoqB;

      const anaA = safeNumber(a.scores[METRIC_KEYS.AUTOEFF_ANA_CON], -Infinity);
      const anaB = safeNumber(b.scores[METRIC_KEYS.AUTOEFF_ANA_CON], -Infinity);
      if (anaA !== anaB) return anaB - anaA;

      const nameA = String(a.name || "");
      const nameB = String(b.name || "");
      return nameA.localeCompare(nameB);
    });

    return scored;
  }

  function formatSigned(value) {
    if (!isValidNumber(value)) return "0.00";
    return value >= 0 ? `+${value.toFixed(2)}` : value.toFixed(2);
  }

  function explainCandidate(candidate, statsByMetric, mode, options) {
    const opts = options || {};
    const scoring = opts.scoring || computeCandidateScore(candidate, statsByMetric, mode);
    const labelsByKey = opts.labelsByKey || {};

    function labelFor(key) {
      return labelsByKey[key] || key;
    }

    const drivers = [
      { key: "autoeff", label: "AUTOEFF_TOT", value: scoring.components.autoeff, z: scoring.z[METRIC_KEYS.AUTOEFF_TOT] },
      { key: "npoq", label: "NPOQ-R basso", value: scoring.components.npoq, z: scoring.zInv[METRIC_KEYS.NPOQ_R] },
      { key: "bidr", label: "BIDR basso", value: scoring.components.bidr, z: scoring.zInv[METRIC_KEYS.BIDR_TOT] }
    ];

    drivers.sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
    const driver = drivers[0];
    const driverText = `Driver: ${driver.label} (${formatSigned(driver.z)})`;

    const strengths = AUTOEFF_SUBS.filter((key) => (scoring.z[key] || 0) >= 0.5).sort(
      (a, b) => (scoring.z[b] || 0) - (scoring.z[a] || 0)
    );
    const topStrengths = strengths.slice(0, 2);
    const strengthsText = topStrengths.length
      ? `Punti di forza: ${topStrengths
          .map((key) => `${labelFor(key)} (${formatSigned(scoring.z[key] || 0)})`)
          .join(", ")}`
      : "Punti di forza: nessuna sottoscala AUTOEFF >= +0.5";

    const warnings = [];
    const bidrInv = scoring.zInv[METRIC_KEYS.BIDR_TOT] ?? 0;
    const bidrImInv = scoring.zInv[METRIC_KEYS.BIDR_IM] ?? -scoring.z[METRIC_KEYS.BIDR_IM] ?? 0;
    const npoqInv = scoring.zInv[METRIC_KEYS.NPOQ_R] ?? 0;

    if (bidrInv <= -0.5) warnings.push("Credibilita: BIDR alto");
    if (bidrImInv <= -0.5) warnings.push("Credibilita: BIDR_IM alto");
    if (npoqInv <= -0.5) warnings.push("Rischio: NPOQ-R alto");

    if (scoring.missingMetrics.length) {
      warnings.push(`Dati mancanti: ${scoring.missingMetrics.map((key) => labelFor(key)).join(", ")}`);
    }

    const warningsText = warnings.length ? warnings.join("; ") : "Warning: nessuno rilevante";

    const areasToProbe = AUTOEFF_SUBS.filter((key) => (scoring.z[key] || 0) <= -0.5).sort(
      (a, b) => (scoring.z[a] || 0) - (scoring.z[b] || 0)
    );

    return {
      driverText,
      strengthsText,
      warningsText,
      strengths: topStrengths,
      areasToProbe,
      autoeffSubAvg: scoring.autoeffSubAvg,
      missingMetrics: scoring.missingMetrics
    };
  }

  function validateRanges(candidates, rangeByKey) {
    const warnings = [];
    const ranges = rangeByKey || RANGE_BY_KEY;
    candidates.forEach((candidate) => {
      Object.keys(ranges).forEach((key) => {
        const value = candidate.scores ? candidate.scores[key] : null;
        if (!isValidNumber(value)) return;
        const range = ranges[key];
        if (!range) return;
        const min = range[0];
        const max = range[1];
        if (value < min || value > max) {
          warnings.push({
            id: `${candidate.index || candidate.name || "candidate"}-${key}`,
            message: `Out of range: ${key}=${value} (${min}-${max}) for ${candidate.name || "candidate"}`
          });
        }
      });
    });
    return warnings;
  }

  return {
    METRIC_KEYS,
    AUTOEFF_SUBS,
    RANGE_BY_KEY,
    MODE_DEFS,
    computeStats,
    zScore,
    computeStatsByMetric,
    computeCandidateScore,
    rankCandidates,
    explainCandidate,
    validateRanges
  };
});
