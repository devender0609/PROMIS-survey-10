// api/model.js
import fs from "fs";
import path from "path";

function clip(val, rng) { return Math.min(Math.max(val, rng[0]), rng[1]); }

function load() {
  const cfg = JSON.parse(fs.readFileSync(path.join(process.cwd(), "model", "model_config.json"), "utf8"));
  const xw = {};
  for (const d of cfg.domains) {
    const f = path.join(process.cwd(), "model", cfg.calibration[d].file);
    xw[d] = JSON.parse(fs.readFileSync(f, "utf8"));
  }
  return { cfg, xw };
}

function scoreOne(x, tSurvey, rng) {
  if (x.type === "linear") return clip(x.slope * tSurvey + x.intercept, x.clip || rng);
  const [k1, k2] = x.knots;
  const h1 = Math.max(0, tSurvey - k1);
  const h2 = Math.max(0, tSurvey - k2);
  return clip(x.a + x.b * tSurvey + x.c * h1 + x.d * h2, x.clip || rng);
}

export default function handler(req, res) {
  try {
    const { cfg, xw } = load();

    if (req.method === "GET") return res.status(200).json({ ok: true, version: cfg.version, domains: cfg.domains });
    if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

    const action = String(req.body?.action ?? "");

    if (action === "score") {
      const domain = String(req.body?.domain ?? "");
      const survey_t = Number(req.body?.survey_t);
      if (!cfg.domains.includes(domain) || !Number.isFinite(survey_t)) return res.status(400).json({ error: "Invalid input" });
      const calibrated_t = scoreOne(xw[domain], survey_t, cfg.clip);
      return res.status(200).json({ domain, survey_t, calibrated_t });
    }

    if (action === "batch") {
      const items = Array.isArray(req.body?.items) ? req.body.items : [];
      const out = items.map((it) => {
        const d = String(it?.domain ?? "");
        const st = Number(it?.survey_t);
        if (!cfg.domains.includes(d) || !Number.isFinite(st)) return { ...it, error: "invalid" };
        return { ...it, calibrated_t: scoreOne(xw[d], st, cfg.clip) };
      });
      return res.status(200).json(out);
    }

    if (action === "route") {
      const domain = String(req.body?.domain ?? "");
      if (!cfg.domains.includes(domain)) return res.status(400).json({ error: "Invalid domain" });
      const interim_se = Number(req.body?.interim_se ?? 0);
      const theta_t = Number(req.body?.theta_t ?? 50);
      const discordant = !!req.body?.discordant;
      if ((domain === "A" || domain === "D") && cfg.routing.a_d_second_pass.enabled) {
        const rule = cfg.routing.a_d_second_pass;
        const need = interim_se > rule.se_threshold || theta_t > rule.theta_hi_t || (discordant && rule.discordance_trigger);
        return res.status(200).json({ domain, extra_items: need ? rule.extra_items : 0, reason: need ? "second_pass" : "stable" });
      }
      const stop_se = cfg.routing.stop_se_t[domain];
      const extra = interim_se > stop_se ? 1 : 0;
      return res.status(200).json({ domain, extra_items: extra, reason: extra ? "high_se" : "stable" });
    }

    return res.status(400).json({ error: "Unknown action" });
  } catch (err) {
    return res.status(500).json({ error: "FUNCTION_INVOCATION_FAILED", message: err?.message ?? String(err) });
  }
}
