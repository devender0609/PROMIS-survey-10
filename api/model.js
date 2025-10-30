// api/model.js
import fs from "fs";
import path from "path";

function clip(v, r) { return Math.min(Math.max(v, r[0]), r[1]); }

function load() {
  const cfg = JSON.parse(fs.readFileSync(path.join(process.cwd(), "model", "model_config.json"), "utf8"));
  const xw = {};
  for (const d of cfg.domains) {
    const f = path.join(process.cwd(), "model", cfg.calibration[d].file);
    xw[d] = JSON.parse(fs.readFileSync(f, "utf8"));
  }
  return { cfg, xw };
}

function scoreOne(x, t, rng) {
  if (x.type === "linear") return clip(x.slope * t + x.intercept, x.clip || rng);
  const [k1, k2] = x.knots;
  const h1 = Math.max(0, t - k1), h2 = Math.max(0, t - k2);
  return clip(x.a + x.b*t + x.c*h1 + x.d*h2, x.clip || rng);
}

export default function handler(req, res) {
  try {
    const { cfg, xw } = load();
    if (req.method === "GET") return res.status(200).json({ ok: true, version: cfg.version, domains: cfg.domains });
    if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

    const action = String(req.body?.action ?? "");
    if (action === "score") {
      const d = String(req.body?.domain ?? "");
      const st = Number(req.body?.survey_t);
      if (!cfg.domains.includes(d) || !Number.isFinite(st)) return res.status(400).json({ error: "Invalid input" });
      return res.status(200).json({ domain: d, survey_t: st, calibrated_t: scoreOne(xw[d], st, cfg.clip) });
    }
    if (action === "batch") {
      const items = Array.isArray(req.body?.items) ? req.body.items : [];
      return res.status(200).json(items.map(it => {
        const d = String(it?.domain ?? ""); const st = Number(it?.survey_t);
        return (!cfg.domains.includes(d) || !Number.isFinite(st)) ? { ...it, error: "invalid" }
          : { ...it, calibrated_t: scoreOne(xw[d], st, cfg.clip) };
      }));
    }
    if (action === "route") {
      const d = String(req.body?.domain ?? "");
      if (!cfg.domains.includes(d)) return res.status(400).json({ error: "Invalid domain" });
      const se = Number(req.body?.interim_se ?? 0), tT = Number(req.body?.theta_t ?? 50), disc = !!req.body?.discordant;
      if ((d === "A" || d === "D") && cfg.routing.a_d_second_pass.enabled) {
        const r = cfg.routing.a_d_second_pass;
        const need = (se > r.se_threshold) || (tT > r.theta_hi_t) || (disc && r.discordance_trigger);
        return res.status(200).json({ domain: d, extra_items: need ? r.extra_items : 0, reason: need ? "second_pass" : "stable" });
      }
      const stop = cfg.routing.stop_se_t[d];
      return res.status(200).json({ domain: d, extra_items: se > stop ? 1 : 0, reason: se > stop ? "high_se" : "stable" });
    }
    return res.status(400).json({ error: "Unknown action" });
  } catch (err) {
    return res.status(500).json({ error: "FUNCTION_INVOCATION_FAILED", message: err?.message ?? String(err) });
  }
}