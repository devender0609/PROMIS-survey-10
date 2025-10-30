
import type { VercelRequest, VercelResponse } from '@vercel/node';
import fs from 'fs';
import path from 'path';

type Domain = 'PF'|'PI'|'F'|'SR'|'A'|'D';

type LinearX = { type:'linear'; slope:number; intercept:number; clip?:[number,number]};
type PieceX  = { type:'piecewise'; a:number; b:number; c:number; d:number; knots:[number,number]; clip?:[number,number]};
type Xwalk   = LinearX | PieceX;

type ModelCfg = {
  version: string;
  domains: Domain[];
  mcid: Record<Domain, number>;
  routing: {
    gate_items_per_domain: number;
    min_items: Record<Domain, number>;
    max_items: Record<Domain, number>;
    stop_se_t: Record<Domain, number>;
    a_d_second_pass: { enabled:boolean; se_threshold:number; theta_hi_t:number; discordance_trigger:boolean; extra_items:number };
  };
  calibration: Record<Domain, { method:'linear'|'piecewise'; file:string }>;
  clip: [number, number];
};

function clip(val:number, rng:[number,number]) { return Math.min(Math.max(val, rng[0]), rng[1]); }

function load(): { cfg: ModelCfg; xw: Record<Domain, Xwalk> } {
  const cfg = JSON.parse(fs.readFileSync(path.join(process.cwd(),'model','model_config.json'),'utf8')) as ModelCfg;
  const xw: Record<Domain, Xwalk> = {} as any;
  for (const d of cfg.domains) {
    const f = path.join(process.cwd(), 'model', cfg.calibration[d].file);
    xw[d] = JSON.parse(fs.readFileSync(f, 'utf8')) as Xwalk;
  }
  return { cfg, xw };
}

function scoreOne(x: Xwalk, tSurvey: number, rng:[number,number]): number {
  if ((x as any).type === 'linear') {
    const xl = x as LinearX;
    return clip(xl.slope * tSurvey + xl.intercept, xl.clip ?? rng);
  }
  const xp = x as PieceX;
  const [k1,k2] = xp.knots;
  const h1 = Math.max(0, tSurvey - k1);
  const h2 = Math.max(0, tSurvey - k2);
  const y  = xp.a + xp.b*tSurvey + xp.c*h1 + xp.d*h2;
  return clip(y, xp.clip ?? rng);
}

export default function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const { cfg, xw } = load();

    if (req.method === 'GET') {
      return res.status(200).json({ ok:true, version: cfg.version, domains: cfg.domains });
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

    const action = String(req.body?.action ?? '');

    if (action === 'score') {
      const domain = String(req.body?.domain ?? '') as Domain;
      const survey_t = Number(req.body?.survey_t);
      if (!cfg.domains.includes(domain) || !Number.isFinite(survey_t)) {
        return res.status(400).json({ error: 'Invalid input' });
      }
      const calibrated_t = scoreOne(xw[domain], survey_t, cfg.clip);
      return res.status(200).json({ domain, survey_t, calibrated_t });
    }

    if (action === 'batch') {
      const items = Array.isArray(req.body?.items) ? req.body.items : [];
      const out = items.map((it:any) => {
        const d = String(it?.domain ?? '') as Domain;
        const st = Number(it?.survey_t);
        if (!cfg.domains.includes(d) || !Number.isFinite(st)) return { ...it, error:'invalid' };
        const y = scoreOne(xw[d], st, cfg.clip);
        return { ...it, calibrated_t: y };
      });
      return res.status(200).json(out);
    }

    if (action === 'route') {
      const domain = String(req.body?.domain ?? '') as Domain;
      if (!cfg.domains.includes(domain)) return res.status(400).json({ error:'Invalid domain' });
      const interim_se = Number(req.body?.interim_se ?? 0);
      const theta_t    = Number(req.body?.theta_t ?? 50);
      const discordant = !!req.body?.discordant;

      if ((domain === 'A' || domain === 'D') && cfg.routing.a_d_second_pass.enabled) {
        const rule = cfg.routing.a_d_second_pass;
        const need = (interim_se > rule.se_threshold) || (theta_t > rule.theta_hi_t) || (discordant && rule.discordance_trigger);
        return res.status(200).json({ domain, extra_items: need ? rule.extra_items : 0, reason: need ? 'second_pass' : 'stable' });
      }
      const stop_se = cfg.routing.stop_se_t[domain];
      const extra = interim_se > stop_se ? 1 : 0;
      return res.status(200).json({ domain, extra_items: extra, reason: extra ? 'high_se' : 'stable' });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (err:any) {
    return res.status(500).json({ error: 'FUNCTION_INVOCATION_FAILED', message: err?.message ?? String(err) });
  }
}
