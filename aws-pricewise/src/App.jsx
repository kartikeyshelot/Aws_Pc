import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { REGIONS, REGION_KEYS, HOURS_PER_MONTH, SERVICE_KEYS, SERVICE_META, CATEGORY_ORDER, OS_OPTIONS } from "./constants";
import {
  PRICING, getEC2Instances, getEC2Price, getEC2Spec, getLambdaPricing,
  getS3Pricing, getEBSPricing, getEFSPricing, getRDSInstances, getRDSStorage,
  getAuroraPricing, getDynamoDBPricing, getElastiCacheNodes, getVPCPricing,
  getCloudFrontPricing, getRoute53Pricing, getFargatePricing, getEKSPricing,
  getSageMakerPricing,
} from "./data/pricing";
import "./App.css";

const fmt = (n) => {
  if (n === null || n === undefined) return "N/A";
  if (n === 0) return "$0.00";
  if (n < 0.01) return "$" + n.toFixed(6);
  if (n < 1) return "$" + n.toFixed(4);
  if (n < 100) return "$" + n.toFixed(2);
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

let _cid = 0;
const nextId = () => ++_cid;
const OS_DISPLAY = { linux: "Linux", windows: "Windows", rhel: "RHEL", suse: "SUSE" };

const CAT_COLORS = {
  Compute: "#0ea5e9", Storage: "#10b981", Database: "#8b5cf6",
  Networking: "#06b6d4", Container: "#f97316", ML: "#ec4899",
};

const SIZE_ORDER = ["nano","micro","small","medium","large","xlarge","2xlarge","4xlarge","8xlarge","9xlarge","12xlarge","16xlarge","24xlarge","32xlarge","48xlarge","metal"];

function exportCSV(cart, total) {
  const rows = [
    ["Service", "Configuration", "Region", "Monthly ($)", "Annual ($)"],
    ...cart.map(i => [SERVICE_META[i.service]?.label || i.service, i.label, i.region, i.cost.toFixed(4), (i.cost * 12).toFixed(4)]),
    ["", "", "TOTAL", total.toFixed(4), (total * 12).toFixed(4)],
  ];
  const csv = rows.map(r => r.map(c => '"' + String(c).replace(/"/g, '""') + '"').join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "aws-estimate-" + new Date().toISOString().slice(0, 10) + ".csv";
  a.click();
  URL.revokeObjectURL(url);
}

// ── SearchSelect ────────────────────────────────────────────────────
function SearchSelect({ label, value, onChange, options, placeholder }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef(null);
  const iref = useRef(null);
  const norm = useMemo(() => options.map(o => typeof o === "string" ? { value: o, label: o } : o), [options]);
  const filtered = useMemo(() => {
    if (!q) return norm;
    const lq = q.toLowerCase();
    return norm.filter(o => o.label.toLowerCase().includes(lq) || o.value.toLowerCase().includes(lq));
  }, [norm, q]);
  const selLabel = norm.find(o => o.value === value)?.label || value;
  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) { setOpen(false); setQ(""); } };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  return (
    <div className="cfg-field" ref={ref}>
      <label>{label}</label>
      <div className="ss">
        <button type="button" className="ss-trigger" onClick={() => { setOpen(!open); setQ(""); setTimeout(() => iref.current?.focus(), 50); }}>
          <span className="ss-val">{selLabel}</span>
          <svg viewBox="0 0 12 12" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="1.5"><path d={open ? "M2 8l4-4 4 4" : "M2 4l4 4 4-4"} /></svg>
        </button>
        {open && (
          <div className="ss-drop">
            <div className="ss-search">
              <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="7" cy="7" r="5" /><path d="M11 11l3.5 3.5" /></svg>
              <input ref={iref} type="text" value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder || "Search..."} autoFocus />
            </div>
            <div className="ss-list">
              {filtered.length === 0 ? <div className="ss-empty">No matches</div> : filtered.map(o => (
                <button key={o.value} type="button" className={"ss-opt" + (o.value === value ? " sel" : "")}
                  onClick={() => { onChange(o.value); setOpen(false); setQ(""); }}>
                  {o.label}
                  {o.value === value && <svg viewBox="0 0 12 12" width="11" height="11" fill="none" stroke="var(--accent)" strokeWidth="2"><path d="M2 6l3 3 5-5" /></svg>}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Basic UI ────────────────────────────────────────────────────────
function Select({ label, value, onChange, options }) {
  const norm = options.map(o => typeof o === "string" ? { value: o, label: o } : o);
  if (norm.length > 10) return <SearchSelect label={label} value={value} onChange={onChange} options={norm} />;
  return (
    <div className="cfg-field"><label>{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {norm.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}
function NumberInput({ label, value, onChange, min = 0, max, step = 1, unit = "" }) {
  return (
    <div className="cfg-field">
      <label>{label}{unit && <span className="field-unit">{unit}</span>}</label>
      <input type="number" value={value} min={min} max={max} step={step} onChange={(e) => onChange(Number(e.target.value) || 0)} />
    </div>
  );
}
function PriceLine({ label, amount, note }) {
  return (
    <div className="price-line">
      <span className="price-label">{label}</span>
      {note && <span className="price-note">{note}</span>}
      <span className="price-amount">{fmt(amount)}</span>
    </div>
  );
}
function NotAvailable({ message }) {
  return (
    <div className="not-available">
      <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ flexShrink: 0 }}>
        <path d="M8 2l6 12H2L8 2z" /><path d="M8 7v3" /><circle cx="8" cy="12.5" r=".5" fill="currentColor" />
      </svg>
      <span>{message || "Pricing not available in current dataset."}</span>
      {!PRICING.meta.isFetched && <div className="not-available-hint">Run <code>npm run fetch-pricing</code> for complete data.</div>}
    </div>
  );
}
function Divider() { return <hr className="cfg-divider" />; }
function Checkbox({ label, checked, onChange }) {
  return (
    <div className="cfg-field">
      <label className="checkbox-label"><input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />{label}</label>
    </div>
  );
}
function RhelWarn({ os }) {
  if ((os !== "rhel" && os !== "suse") || PRICING.meta.isFetched) return null;
  return <div className="not-available" style={{ marginBottom: 8 }}>{OS_DISPLAY[os] + " pricing changed to per-vCPU model July 2024. Seed data approximate."}</div>;
}

function makeLabel(svc, c, region) {
  const r = REGIONS[region]?.shortName || region;
  const labels = {
    ec2: () => c.instance + " x" + c.count + " (" + (OS_DISPLAY[c.os] || c.os) + ") — " + r,
    lambda: () => (c.requests / 1e6).toFixed(1) + "M req, " + c.memoryMB + "MB — " + r,
    s3: () => c.storageGB + " GB " + c.tier + " — " + r,
    ebs: () => c.volumeType + " " + c.sizeGB + "GB x" + c.count + " — " + r,
    efs: () => c.storageGB + " GB " + c.storageClass + " — " + r,
    rds: () => c.instance + " " + c.engine + (c.multiAZ ? " Multi-AZ" : "") + " — " + r,
    aurora: () => c.instance + " " + c.engine + " x" + c.replicas + " — " + r,
    dynamodb: () => c.mode + " " + c.storageGB + "GB — " + r,
    elasticache: () => c.nodeType + " x" + c.numNodes + " (" + c.engine + ") — " + r,
    vpc: () => c.natGateways + " NAT GW — " + r,
    cloudfront: () => c.dataTransferTB + " TB out — Global",
    route53: () => c.hostedZones + " zones — Global",
    ecs: () => "ECS (free) — " + r,
    eks: () => c.clusters + " cluster(s) — " + r,
    fargate: () => c.vcpu + " vCPU, " + c.memoryGB + "GB x" + c.tasks + " — " + r,
    sagemaker: () => "Notebook+Training+Inference — " + r,
  };
  return (labels[svc] || (() => SERVICE_META[svc]?.label + " — " + r))();
}

// ═══════════════════════════════════════════════════════════════════
// SERVICE CONFIGS
// ═══════════════════════════════════════════════════════════════════

function EC2Config({ config: c, setConfig: s, region }) {
  const ins = getEC2Instances(region);
  const types = Object.keys(ins).sort((a, b) => {
    const f = x => x.split(".")[0];
    const sz = x => SIZE_ORDER.indexOf(x.split(".")[1]);
    return f(a).localeCompare(f(b)) || sz(a) - sz(b);
  });
  if (!types.length) return <NotAvailable message={"No EC2 data for " + (REGIONS[region]?.name || region)} />;
  const inst = ins[c.instance] ? c.instance : types[0];
  const price = ins[inst]?.prices?.[c.os] ?? null;
  return (
    <div className="cfg-grid">
      <SearchSelect label="Instance Type" value={inst} onChange={v => s({ ...c, instance: v })}
        options={types.map(t => ({ value: t, label: t + "  (" + ins[t].vcpu + " vCPU, " + ins[t].memory + " GiB)" }))} placeholder="e.g. m5, c6i, r5, g4dn..." />
      <Select label="Operating System" value={c.os} onChange={v => s({ ...c, os: v })} options={OS_OPTIONS} />
      <NumberInput label="Instances" value={c.count} onChange={v => s({ ...c, count: v })} min={1} max={10000} />
      <NumberInput label="Hours / Month" value={c.hours} onChange={v => s({ ...c, hours: v })} min={0} max={HOURS_PER_MONTH} unit="hrs" />
      <div className="cfg-result">
        <RhelWarn os={c.os} />
        {price === null ? <NotAvailable message={(OS_DISPLAY[c.os] || c.os) + " not available for " + inst} /> : (
          <><PriceLine label="Per instance / hour" amount={price} /><Divider /><PriceLine label="Monthly estimate" amount={price * c.count * c.hours} /></>
        )}
      </div>
    </div>
  );
}
function ec2Cost(c, r) { const ins = getEC2Instances(r); const k = ins[c.instance] ? c.instance : Object.keys(ins)[0]; if (!k) return 0; const p = ins[k]?.prices?.[c.os] ?? null; return p != null ? p * c.count * c.hours : 0; }

function LambdaConfig({ config: c, setConfig: s, region }) { const p = getLambdaPricing(region); if (!p) return <NotAvailable message={"No Lambda data for " + region} />; const br = Math.max(0, c.requests - p.freeRequests); const gs = (c.memoryMB / 1024) * (c.durationMs / 1000) * c.requests; const bg = Math.max(0, gs - p.freeDurationGBs); const rc = br * p.requestPrice, dc = bg * p.durationPriceGB; return (<div className="cfg-grid"><NumberInput label="Requests/mo" value={c.requests} onChange={v => s({ ...c, requests: v })} min={0} step={100000} /><NumberInput label="Memory" value={c.memoryMB} onChange={v => s({ ...c, memoryMB: v })} min={128} max={10240} step={128} unit="MB" /><NumberInput label="Avg Duration" value={c.durationMs} onChange={v => s({ ...c, durationMs: v })} min={1} max={900000} unit="ms" /><div className="cfg-result"><PriceLine label="Requests" amount={rc} note={(br / 1e6).toFixed(1) + "M billable"} /><PriceLine label="Duration" amount={dc} /><Divider /><PriceLine label="Monthly estimate" amount={rc + dc} /></div></div>); }
function lambdaCost(c, r) { const p = getLambdaPricing(r); if (!p) return 0; return Math.max(0, c.requests - p.freeRequests) * p.requestPrice + Math.max(0, (c.memoryMB / 1024) * (c.durationMs / 1000) * c.requests - p.freeDurationGBs) * p.durationPriceGB; }

function S3Config({ config: c, setConfig: s, region }) { const p = getS3Pricing(region); if (!p) return <NotAvailable />; const tm = { standard: p.standard, intelligent: p.intelligent, standardIA: p.standardIA, oneZoneIA: p.oneZoneIA, glacier: p.glacier, glacierDeep: p.glacierDeep }; const tl = { standard: "Standard", intelligent: "Intelligent-Tiering", standardIA: "Standard-IA", oneZoneIA: "One Zone-IA", glacier: "Glacier", glacierDeep: "Glacier Deep" }; const sc = c.storageGB * (tm[c.tier] || 0), pc = (c.putRequests / 1000) * p.putPer1k, gc = (c.getRequests / 1000) * p.getPer1k, tc = c.transferOutGB * p.transferPerGB; return (<div className="cfg-grid"><Select label="Storage Class" value={c.tier} onChange={v => s({ ...c, tier: v })} options={Object.keys(tm).filter(k => tm[k] != null).map(t => ({ value: t, label: tl[t] || t }))} /><NumberInput label="Storage" value={c.storageGB} onChange={v => s({ ...c, storageGB: v })} min={0} unit="GB" /><NumberInput label="PUT/COPY/POST/LIST" value={c.putRequests} onChange={v => s({ ...c, putRequests: v })} min={0} step={1000} unit="req" /><NumberInput label="GET/SELECT" value={c.getRequests} onChange={v => s({ ...c, getRequests: v })} min={0} step={1000} unit="req" /><NumberInput label="Transfer Out" value={c.transferOutGB} onChange={v => s({ ...c, transferOutGB: v })} min={0} unit="GB" /><div className="cfg-result"><PriceLine label="Storage" amount={sc} /><PriceLine label="PUT" amount={pc} /><PriceLine label="GET" amount={gc} /><PriceLine label="Transfer" amount={tc} /><Divider /><PriceLine label="Monthly estimate" amount={sc + pc + gc + tc} /></div></div>); }
function s3Cost(c, r) { const p = getS3Pricing(r); if (!p) return 0; const t = { standard: p.standard, intelligent: p.intelligent, standardIA: p.standardIA, oneZoneIA: p.oneZoneIA, glacier: p.glacier, glacierDeep: p.glacierDeep }; return c.storageGB * (t[c.tier] || 0) + (c.putRequests / 1000) * p.putPer1k + (c.getRequests / 1000) * p.getPer1k + c.transferOutGB * p.transferPerGB; }

function EBSConfig({ config: c, setConfig: s, region }) { const p = getEBSPricing(region); if (!p) return <NotAvailable />; const vt = ["gp3", "gp2", "io1", "io2", "st1", "sc1"].filter(v => p[v] != null); const sc = c.sizeGB * (p[c.volumeType] || 0) * c.count; const isProv = c.volumeType === "gp3" || c.volumeType === "io1" || c.volumeType === "io2"; const ik = c.volumeType === "gp3" ? "gp3IOPS" : (c.volumeType + "IOPS"); const base = c.volumeType === "gp3" ? 3000 : 0; const ei = isProv ? Math.max(0, c.iops - base) : 0; const ic = isProv && p[ik] ? ei * p[ik] * c.count : 0; const snc = c.snapshotGB * (p.snapshots || 0); return (<div className="cfg-grid"><Select label="Volume Type" value={c.volumeType} onChange={v => s({ ...c, volumeType: v })} options={vt} /><NumberInput label="Size/Volume" value={c.sizeGB} onChange={v => s({ ...c, sizeGB: v })} min={1} unit="GB" /><NumberInput label="Volumes" value={c.count} onChange={v => s({ ...c, count: v })} min={1} />{isProv && <NumberInput label="Provisioned IOPS" value={c.iops} onChange={v => s({ ...c, iops: v })} min={0} />}<NumberInput label="Snapshots" value={c.snapshotGB} onChange={v => s({ ...c, snapshotGB: v })} min={0} unit="GB" /><div className="cfg-result"><PriceLine label="Storage" amount={sc} />{ic > 0 && <PriceLine label="IOPS" amount={ic} />}<PriceLine label="Snapshots" amount={snc} /><Divider /><PriceLine label="Monthly estimate" amount={sc + ic + snc} /></div></div>); }
function ebsCost(c, r) { const p = getEBSPricing(r); if (!p) return 0; const sc = c.sizeGB * (p[c.volumeType] || 0) * c.count; const isProv = c.volumeType === "gp3" || c.volumeType === "io1" || c.volumeType === "io2"; const ik = c.volumeType === "gp3" ? "gp3IOPS" : (c.volumeType + "IOPS"); const base = c.volumeType === "gp3" ? 3000 : 0; return sc + (isProv && p[ik] ? Math.max(0, c.iops - base) * p[ik] * c.count : 0) + c.snapshotGB * (p.snapshots || 0); }

function EFSConfig({ config: c, setConfig: s, region }) { const p = getEFSPricing(region); if (!p) return <NotAvailable />; const cm = { standard: p.standard, ia: p.ia, archive: p.archive }; const cl = { standard: "Standard", ia: "Infrequent Access", archive: "Archive" }; const cost = c.storageGB * (cm[c.storageClass] || 0); return (<div className="cfg-grid"><Select label="Storage Class" value={c.storageClass} onChange={v => s({ ...c, storageClass: v })} options={Object.keys(cm).map(k => ({ value: k, label: cl[k] }))} /><NumberInput label="Storage" value={c.storageGB} onChange={v => s({ ...c, storageGB: v })} min={0} unit="GB" /><div className="cfg-result"><PriceLine label="Monthly estimate" amount={cost} /></div></div>); }
function efsCost(c, r) { const p = getEFSPricing(r); if (!p) return 0; return c.storageGB * ({ standard: p.standard, ia: p.ia, archive: p.archive }[c.storageClass] || 0); }

function RDSConfig({ config: c, setConfig: s, region }) { const ins = getRDSInstances(region); const sp = getRDSStorage(region); const types = Object.keys(ins); if (!types.length) return <NotAvailable message={"No RDS data for " + region} />; const ik = ins[c.instance] ? c.instance : types[0]; const eng = c.engine || "postgres"; const h = ins[ik]?.prices?.[eng] ?? null; const m = c.multiAZ ? 2 : 1; const cc = h != null ? h * HOURS_PER_MONTH * m : null; const stc = sp ? c.storageGB * sp * m : 0; return (<div className="cfg-grid"><Select label="Engine" value={eng} onChange={v => s({ ...c, engine: v })} options={[{ value: "mysql", label: "MySQL" }, { value: "postgres", label: "PostgreSQL" }, { value: "mariadb", label: "MariaDB" }]} /><SearchSelect label="Instance" value={ik} onChange={v => s({ ...c, instance: v })} options={types.map(t => ({ value: t, label: t + " (" + ins[t].vcpu + " vCPU, " + ins[t].memory + " GiB)" }))} placeholder="Search db instances..." /><NumberInput label="Storage (gp2)" value={c.storageGB} onChange={v => s({ ...c, storageGB: v })} min={20} unit="GB" /><Checkbox label="Multi-AZ (2x compute+storage)" checked={c.multiAZ} onChange={v => s({ ...c, multiAZ: v })} /><div className="cfg-result">{h == null ? <NotAvailable message={eng + " not available for " + ik} /> : (<><PriceLine label="Compute" amount={cc} note={c.multiAZ ? "Multi-AZ" : "Single-AZ"} /><PriceLine label="Storage" amount={stc} /><Divider /><PriceLine label="Monthly estimate" amount={cc + stc} /></>)}</div></div>); }
function rdsCost(c, r) { const ins = getRDSInstances(r); const k = ins[c.instance] ? c.instance : Object.keys(ins)[0]; if (!k) return 0; const h = ins[k]?.prices?.[c.engine]; if (h == null) return 0; const m = c.multiAZ ? 2 : 1; const sp = getRDSStorage(r); return h * HOURS_PER_MONTH * m + (sp ? c.storageGB * sp * m : 0); }

function AuroraConfig({ config: c, setConfig: s, region }) { const p = getAuroraPricing(region); if (!p?.instances) return <NotAvailable message={"No Aurora data for " + region} />; const types = Object.keys(p.instances); const ik = p.instances[c.instance] ? c.instance : types[0]; const eng = c.engine || "postgres"; const h = p.instances[ik]?.prices?.[eng] ?? null; const cc = h != null ? h * HOURS_PER_MONTH * c.replicas : null; const sc = c.storageGB * (p.storagePerGB || 0); const io = (c.ioMillions || 0) * (p.ioPerMillion || 0); return (<div className="cfg-grid"><Select label="Compatibility" value={eng} onChange={v => s({ ...c, engine: v })} options={[{ value: "mysql", label: "MySQL" }, { value: "postgres", label: "PostgreSQL" }]} /><SearchSelect label="Instance" value={ik} onChange={v => s({ ...c, instance: v })} options={types.map(t => ({ value: t, label: t + " (" + p.instances[t].vcpu + " vCPU, " + p.instances[t].memory + " GiB)" }))} placeholder="Search Aurora instances..." /><NumberInput label="Writer+Readers" value={c.replicas} onChange={v => s({ ...c, replicas: v })} min={1} max={15} /><NumberInput label="Storage" value={c.storageGB} onChange={v => s({ ...c, storageGB: v })} min={10} unit="GB" /><NumberInput label="I/O Requests" value={c.ioMillions} onChange={v => s({ ...c, ioMillions: v })} min={0} step={1} unit="millions" /><div className="cfg-result">{h == null ? <NotAvailable /> : (<><PriceLine label="Compute" amount={cc} note={c.replicas + " inst"} /><PriceLine label="Storage" amount={sc} /><PriceLine label="I/O" amount={io} /><Divider /><PriceLine label="Monthly estimate" amount={cc + sc + io} /></>)}</div></div>); }
function auroraCost(c, r) { const p = getAuroraPricing(r); if (!p?.instances) return 0; const k = p.instances[c.instance] ? c.instance : Object.keys(p.instances)[0]; if (!k) return 0; const h = p.instances[k].prices?.[c.engine]; if (h == null) return 0; return h * HOURS_PER_MONTH * c.replicas + c.storageGB * (p.storagePerGB || 0) + (c.ioMillions || 0) * (p.ioPerMillion || 0); }

function DynamoDBConfig({ config: c, setConfig: s, region }) { const p = getDynamoDBPricing(region); if (!p) return <NotAvailable />; let rc, wc; if (c.mode === "ondemand") { rc = (c.readUnits / 1e6) * p.readPerM; wc = (c.writeUnits / 1e6) * p.writePerM; } else { rc = c.readUnits * p.provRCU * HOURS_PER_MONTH; wc = c.writeUnits * p.provWCU * HOURS_PER_MONTH; } const fg = p.freeStorageGB || 25; const sc = Math.max(0, c.storageGB - fg) * p.storagePerGB; return (<div className="cfg-grid"><Select label="Capacity" value={c.mode} onChange={v => s({ ...c, mode: v })} options={[{ value: "ondemand", label: "On-Demand" }, { value: "provisioned", label: "Provisioned" }]} /><NumberInput label={c.mode === "ondemand" ? "Read RU/mo" : "Read CU"} value={c.readUnits} onChange={v => s({ ...c, readUnits: v })} min={0} step={c.mode === "ondemand" ? 100000 : 1} /><NumberInput label={c.mode === "ondemand" ? "Write RU/mo" : "Write CU"} value={c.writeUnits} onChange={v => s({ ...c, writeUnits: v })} min={0} step={c.mode === "ondemand" ? 100000 : 1} /><NumberInput label="Storage" value={c.storageGB} onChange={v => s({ ...c, storageGB: v })} min={0} unit="GB" /><div className="cfg-result"><PriceLine label="Read" amount={rc} /><PriceLine label="Write" amount={wc} /><PriceLine label="Storage" amount={sc} note={fg + "GB free"} /><Divider /><PriceLine label="Monthly estimate" amount={rc + wc + sc} /></div></div>); }
function dynamodbCost(c, r) { const p = getDynamoDBPricing(r); if (!p) return 0; let rc, wc; if (c.mode === "ondemand") { rc = (c.readUnits / 1e6) * p.readPerM; wc = (c.writeUnits / 1e6) * p.writePerM; } else { rc = c.readUnits * p.provRCU * HOURS_PER_MONTH; wc = c.writeUnits * p.provWCU * HOURS_PER_MONTH; } return rc + wc + Math.max(0, c.storageGB - (p.freeStorageGB || 25)) * p.storagePerGB; }

function ElastiCacheConfig({ config: c, setConfig: s, region }) { const nodes = getElastiCacheNodes(region); const types = Object.keys(nodes); if (!types.length) return <NotAvailable />; const nk = nodes[c.nodeType] ? c.nodeType : types[0]; const n = nodes[nk]; const mo = n ? n.price * HOURS_PER_MONTH * c.numNodes : 0; return (<div className="cfg-grid"><Select label="Engine" value={c.engine} onChange={v => s({ ...c, engine: v })} options={["Redis", "Memcached"]} /><SearchSelect label="Node Type" value={nk} onChange={v => s({ ...c, nodeType: v })} options={types.map(t => ({ value: t, label: t + " (" + nodes[t].vcpu + " vCPU, " + nodes[t].memory + " GiB)" }))} placeholder="Search cache nodes..." /><NumberInput label="Nodes" value={c.numNodes} onChange={v => s({ ...c, numNodes: v })} min={1} max={40} /><div className="cfg-result"><PriceLine label="Per node/hr" amount={n?.price} /><Divider /><PriceLine label="Monthly estimate" amount={mo} note={c.numNodes + " node(s)"} /></div></div>); }
function elasticacheCost(c, r) { const nodes = getElastiCacheNodes(r); const k = nodes[c.nodeType] ? c.nodeType : Object.keys(nodes)[0]; if (!k) return 0; return (nodes[k]?.price || 0) * HOURS_PER_MONTH * c.numNodes; }

function VPCConfig({ config: c, setConfig: s, region }) { const p = getVPCPricing(region); if (!p) return <NotAvailable />; const nc = c.natGateways * p.natHourly * HOURS_PER_MONTH + c.natDataGB * p.natPerGB; const vc = c.vpnConnections * p.vpnHourly * HOURS_PER_MONTH; const ec = c.interfaceEndpoints * p.endpointHourly * HOURS_PER_MONTH; return (<div className="cfg-grid"><NumberInput label="NAT Gateways" value={c.natGateways} onChange={v => s({ ...c, natGateways: v })} min={0} /><NumberInput label="NAT Data" value={c.natDataGB} onChange={v => s({ ...c, natDataGB: v })} min={0} unit="GB/mo" /><NumberInput label="VPN Connections" value={c.vpnConnections} onChange={v => s({ ...c, vpnConnections: v })} min={0} /><NumberInput label="Interface Endpoints" value={c.interfaceEndpoints} onChange={v => s({ ...c, interfaceEndpoints: v })} min={0} /><div className="cfg-result"><PriceLine label="NAT" amount={nc} /><PriceLine label="VPN" amount={vc} /><PriceLine label="Endpoints" amount={ec} /><Divider /><PriceLine label="Monthly estimate" amount={nc + vc + ec} /></div></div>); }
function vpcCost(c, r) { const p = getVPCPricing(r); if (!p) return 0; return c.natGateways * p.natHourly * HOURS_PER_MONTH + c.natDataGB * p.natPerGB + c.vpnConnections * p.vpnHourly * HOURS_PER_MONTH + c.interfaceEndpoints * p.endpointHourly * HOURS_PER_MONTH; }

function CloudFrontConfig({ config: c, setConfig: s }) { const p = getCloudFrontPricing(); if (!p) return <NotAvailable />; const dt = p.dataTransfer; let tc = 0, rem = c.dataTransferTB * 1024; for (const [gb, rate] of [[10240, dt.first10TB], [40960, dt.next40TB], [102400, dt.next100TB], [358400, dt.next350TB], [536576, dt.next524TB], [4194304, dt.next4PB], [Infinity, dt.over5PB]]) { if (rem <= 0) break; const u = Math.min(rem, gb); tc += u * rate; rem -= u; } const hc = (c.httpRequests / 10000) * p.requestsHTTPper10k, hsc = (c.httpsRequests / 10000) * p.requestsHTTPSper10k; return (<div className="cfg-grid"><NumberInput label="Transfer Out" value={c.dataTransferTB} onChange={v => s({ ...c, dataTransferTB: v })} min={0} step={0.1} unit="TB/mo" /><NumberInput label="HTTP Requests" value={c.httpRequests} onChange={v => s({ ...c, httpRequests: v })} min={0} step={10000} unit="/mo" /><NumberInput label="HTTPS Requests" value={c.httpsRequests} onChange={v => s({ ...c, httpsRequests: v })} min={0} step={10000} unit="/mo" /><div className="cfg-result"><PriceLine label="Transfer" amount={tc} /><PriceLine label="HTTP" amount={hc} /><PriceLine label="HTTPS" amount={hsc} /><Divider /><PriceLine label="Monthly estimate" amount={tc + hc + hsc} /></div></div>); }
function cloudfrontCost(c) { const p = getCloudFrontPricing(); if (!p) return 0; const dt = p.dataTransfer; let tc = 0, rem = c.dataTransferTB * 1024; for (const [gb, rate] of [[10240, dt.first10TB], [40960, dt.next40TB], [102400, dt.next100TB], [358400, dt.next350TB], [536576, dt.next524TB], [4194304, dt.next4PB], [Infinity, dt.over5PB]]) { if (rem <= 0) break; const u = Math.min(rem, gb); tc += u * rate; rem -= u; } return tc + (c.httpRequests / 10000) * p.requestsHTTPper10k + (c.httpsRequests / 10000) * p.requestsHTTPSper10k; }

function Route53Config({ config: c, setConfig: s }) { const p = getRoute53Pricing(); if (!p) return <NotAvailable />; const zc = c.hostedZones * p.hostedZone, qc = (c.queries / 1e6) * p.standardQueryPerM, hc = c.healthChecks * p.healthCheck; return (<div className="cfg-grid"><NumberInput label="Hosted Zones" value={c.hostedZones} onChange={v => s({ ...c, hostedZones: v })} min={0} /><NumberInput label="Queries" value={c.queries} onChange={v => s({ ...c, queries: v })} min={0} step={100000} unit="/mo" /><NumberInput label="Health Checks" value={c.healthChecks} onChange={v => s({ ...c, healthChecks: v })} min={0} /><div className="cfg-result"><PriceLine label="Zones" amount={zc} /><PriceLine label="Queries" amount={qc} /><PriceLine label="Health checks" amount={hc} /><Divider /><PriceLine label="Monthly estimate" amount={zc + qc + hc} /></div></div>); }
function route53Cost(c) { const p = getRoute53Pricing(); if (!p) return 0; return c.hostedZones * p.hostedZone + (c.queries / 1e6) * p.standardQueryPerM + c.healthChecks * p.healthCheck; }

function ECSConfig() { return (<div className="cfg-grid"><div className="info-box"><strong>ECS has no charge.</strong> You pay for EC2 instances or Fargate tasks underneath. Add those services separately.</div></div>); }
function ecsCost() { return 0; }

function EKSConfig({ config: c, setConfig: s, region }) { const p = getEKSPricing(region); if (!p) return <NotAvailable />; return (<div className="cfg-grid"><NumberInput label="Clusters" value={c.clusters} onChange={v => s({ ...c, clusters: v })} min={1} max={100} /><div className="cfg-result"><PriceLine label="Control plane" amount={c.clusters * p.clusterHourly * HOURS_PER_MONTH} note={c.clusters + "× $" + p.clusterHourly + "/hr"} /><div className="note-text">Workers billed via EC2 or Fargate.</div></div></div>); }
function eksCost(c, r) { const p = getEKSPricing(r); return p ? c.clusters * p.clusterHourly * HOURS_PER_MONTH : 0; }

function FargateConfig({ config: c, setConfig: s, region }) { const p = getFargatePricing(region); if (!p) return <NotAvailable />; const cc = c.vcpu * p.vcpuPerHour * c.hours * c.tasks, mc = c.memoryGB * p.memPerGBHour * c.hours * c.tasks, ec = Math.max(0, c.ephemeralGB - p.freeEphGB) * p.ephPerGBHour * c.hours * c.tasks; return (<div className="cfg-grid"><NumberInput label="vCPU/Task" value={c.vcpu} onChange={v => s({ ...c, vcpu: v })} min={0.25} max={16} step={0.25} unit="vCPU" /><NumberInput label="Memory/Task" value={c.memoryGB} onChange={v => s({ ...c, memoryGB: v })} min={0.5} max={120} step={0.5} unit="GB" /><NumberInput label="Ephemeral" value={c.ephemeralGB} onChange={v => s({ ...c, ephemeralGB: v })} min={20} max={200} unit="GB" /><NumberInput label="Tasks" value={c.tasks} onChange={v => s({ ...c, tasks: v })} min={1} /><NumberInput label="Hours/Month" value={c.hours} onChange={v => s({ ...c, hours: v })} min={0} max={HOURS_PER_MONTH} unit="hrs" /><div className="cfg-result"><PriceLine label="vCPU" amount={cc} /><PriceLine label="Memory" amount={mc} />{ec > 0 && <PriceLine label="Ephemeral" amount={ec} />}<Divider /><PriceLine label="Monthly estimate" amount={cc + mc + ec} /></div></div>); }
function fargateCost(c, r) { const p = getFargatePricing(r); if (!p) return 0; return c.vcpu * p.vcpuPerHour * c.hours * c.tasks + c.memoryGB * p.memPerGBHour * c.hours * c.tasks + Math.max(0, c.ephemeralGB - p.freeEphGB) * p.ephPerGBHour * c.hours * c.tasks; }

function SageMakerConfig({ config: c, setConfig: s, region }) { const p = getSageMakerPricing(region); if (!p) return <NotAvailable />; const ni = Object.keys(p.notebooks || {}), ti = Object.keys(p.training || {}), ii = Object.keys(p.inference || {}); const nc = (p.notebooks?.[c.notebookInstance] || 0) * c.notebookHours, tc2 = (p.training?.[c.trainingInstance] || 0) * c.trainingHours * c.trainingCount, ic = (p.inference?.[c.inferenceInstance] || 0) * c.inferenceHours * c.inferenceCount; return (<div className="cfg-grid"><div className="section-label">Notebooks</div><Select label="Instance" value={c.notebookInstance} onChange={v => s({ ...c, notebookInstance: v })} options={ni.length ? ni : ["N/A"]} /><NumberInput label="Hours/mo" value={c.notebookHours} onChange={v => s({ ...c, notebookHours: v })} min={0} max={HOURS_PER_MONTH} /><div className="section-label">Training</div><Select label="Instance" value={c.trainingInstance} onChange={v => s({ ...c, trainingInstance: v })} options={ti.length ? ti : ["N/A"]} /><NumberInput label="Hrs/Job" value={c.trainingHours} onChange={v => s({ ...c, trainingHours: v })} min={0} /><NumberInput label="Jobs/mo" value={c.trainingCount} onChange={v => s({ ...c, trainingCount: v })} min={0} /><div className="section-label">Inference</div><Select label="Instance" value={c.inferenceInstance} onChange={v => s({ ...c, inferenceInstance: v })} options={ii.length ? ii : ["N/A"]} /><NumberInput label="Hours/mo" value={c.inferenceHours} onChange={v => s({ ...c, inferenceHours: v })} min={0} max={HOURS_PER_MONTH} /><NumberInput label="Endpoints" value={c.inferenceCount} onChange={v => s({ ...c, inferenceCount: v })} min={0} /><div className="cfg-result full-width"><PriceLine label="Notebooks" amount={nc} /><PriceLine label="Training" amount={tc2} /><PriceLine label="Inference" amount={ic} /><Divider /><PriceLine label="Monthly estimate" amount={nc + tc2 + ic} /></div></div>); }
function sagemakerCost(c, r) { const p = getSageMakerPricing(r); if (!p) return 0; const nk = p.notebooks?.[c.notebookInstance] != null ? c.notebookInstance : Object.keys(p.notebooks || {})[0]; const tk = p.training?.[c.trainingInstance] != null ? c.trainingInstance : Object.keys(p.training || {})[0]; const ik = p.inference?.[c.inferenceInstance] != null ? c.inferenceInstance : Object.keys(p.inference || {})[0]; return (p.notebooks?.[nk] || 0) * c.notebookHours + (p.training?.[tk] || 0) * c.trainingHours * c.trainingCount + (p.inference?.[ik] || 0) * c.inferenceHours * c.inferenceCount; }

const REGISTRY = {
  ec2:         { component: EC2Config,         cost: ec2Cost,         default: { instance: "t3.medium", os: "linux", count: 1, hours: HOURS_PER_MONTH } },
  lambda:      { component: LambdaConfig,      cost: lambdaCost,      default: { requests: 1000000, memoryMB: 512, durationMs: 200 } },
  s3:          { component: S3Config,          cost: s3Cost,          default: { tier: "standard", storageGB: 100, putRequests: 10000, getRequests: 100000, transferOutGB: 10 } },
  ebs:         { component: EBSConfig,         cost: ebsCost,         default: { volumeType: "gp3", sizeGB: 100, count: 1, iops: 3000, snapshotGB: 50 } },
  efs:         { component: EFSConfig,         cost: efsCost,         default: { storageClass: "standard", storageGB: 50 } },
  rds:         { component: RDSConfig,         cost: rdsCost,         default: { engine: "postgres", instance: "db.m5.large", storageGB: 100, multiAZ: false } },
  aurora:      { component: AuroraConfig,      cost: auroraCost,      default: { engine: "postgres", instance: "db.r5.large", replicas: 1, storageGB: 100, ioMillions: 10 } },
  dynamodb:    { component: DynamoDBConfig,    cost: dynamodbCost,    default: { mode: "ondemand", readUnits: 1000000, writeUnits: 500000, storageGB: 25 } },
  elasticache: { component: ElastiCacheConfig, cost: elasticacheCost, default: { engine: "Redis", nodeType: "cache.m5.large", numNodes: 2 } },
  vpc:         { component: VPCConfig,         cost: vpcCost,         default: { natGateways: 2, natDataGB: 100, vpnConnections: 0, interfaceEndpoints: 3 } },
  cloudfront:  { component: CloudFrontConfig,  cost: cloudfrontCost,  default: { dataTransferTB: 1, httpRequests: 1000000, httpsRequests: 5000000 } },
  route53:     { component: Route53Config,     cost: route53Cost,     default: { hostedZones: 3, queries: 5000000, healthChecks: 4 } },
  ecs:         { component: ECSConfig,         cost: ecsCost,         default: {} },
  eks:         { component: EKSConfig,         cost: eksCost,         default: { clusters: 1 } },
  fargate:     { component: FargateConfig,     cost: fargateCost,     default: { vcpu: 1, memoryGB: 2, ephemeralGB: 20, tasks: 3, hours: HOURS_PER_MONTH } },
  sagemaker:   { component: SageMakerConfig,   cost: sagemakerCost,   default: { notebookInstance: "ml.t3.medium", notebookHours: 160, trainingInstance: "ml.m5.xlarge", trainingHours: 4, trainingCount: 5, inferenceInstance: "ml.m5.large", inferenceHours: HOURS_PER_MONTH, inferenceCount: 1 } },
};

// ═══════════════════════════════════════════════════════════════════
// EC2 FAMILY COMPARISON
// ═══════════════════════════════════════════════════════════════════
function EC2FamilyCompare({ region, currentConfig, onSelectInstance }) {
  const ins = getEC2Instances(region);

  const { families, familyNames } = useMemo(() => {
    const f = {};
    for (const [key, data] of Object.entries(ins)) {
      const fam = key.split(".")[0];
      if (!f[fam]) f[fam] = [];
      f[fam].push({ instance: key, size: key.split(".")[1], vcpu: data.vcpu, memory: data.memory, prices: data.prices });
    }
    for (const fam of Object.keys(f)) {
      f[fam].sort((a, b) => SIZE_ORDER.indexOf(a.size) - SIZE_ORDER.indexOf(b.size));
    }
    return { families: f, familyNames: Object.keys(f).sort() };
  }, [ins]);

  const [family, setFamily] = useState(() => {
    const cur = currentConfig?.instance?.split(".")[0];
    return (cur && familyNames.includes(cur)) ? cur : (familyNames.includes("t3") ? "t3" : familyNames[0] || "");
  });
  const [os, setOs] = useState(currentConfig?.os || "linux");

  const rows = families[family] || [];
  const validPrices = rows.map(r => r.prices?.[os]).filter(p => p != null && p > 0);
  const minPrice = validPrices.length ? Math.min(...validPrices) : 0;
  const maxPrice = validPrices.length ? Math.max(...validPrices) : 1;

  return (
    <div className="fc-wrap">
      {/* Controls */}
      <div className="fc-controls">
        <div className="fc-families">
          {familyNames.map(f => (
            <button key={f} className={"fc-chip" + (f === family ? " active" : "")} onClick={() => setFamily(f)}>
              {f}
            </button>
          ))}
        </div>
        <div className="fc-os-group">
          {OS_OPTIONS.map(o => (
            <button key={o.value} className={"fc-os" + (o.value === os ? " active" : "")} onClick={() => setOs(o.value)}>
              {o.label}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="fc-table-wrap">
        <table className="fc-table">
          <thead>
            <tr>
              <th>Instance</th>
              <th>vCPU</th>
              <th>RAM</th>
              <th>/ hr</th>
              <th>/ mo</th>
              <th className="fc-th-bar"></th>
              <th>×</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(row => {
              const price = row.prices?.[os] ?? null;
              const na = price === null || price === 0;
              const isCheapest = !na && price === minPrice;
              const isSelected = row.instance === currentConfig?.instance;
              const barPct = (!na && maxPrice > 0) ? (price / maxPrice) * 100 : 0;
              const mult = (!na && minPrice > 0) ? price / minPrice : null;

              return (
                <tr
                  key={row.instance}
                  className={"fc-row" + (isCheapest ? " fc-cheapest" : "") + (isSelected ? " fc-selected" : "") + (na ? " fc-na" : "")}
                  onClick={() => !na && onSelectInstance(row.instance, os)}
                  title={na ? "Not available for this OS" : "Click to configure"}
                >
                  <td className="fc-name">{row.instance}</td>
                  <td className="fc-spec">{row.vcpu}</td>
                  <td className="fc-spec">{row.memory}</td>
                  {na ? (
                    <td colSpan={4} className="fc-unavail">—</td>
                  ) : (
                    <>
                      <td className="fc-price">{fmt(price)}</td>
                      <td className="fc-monthly">{fmt(price * 730)}</td>
                      <td className="fc-bar-cell">
                        <div className="fc-bar">
                          <div className="fc-bar-fill" style={{ width: Math.max(2, barPct) + "%" }} />
                        </div>
                      </td>
                      <td className="fc-mult">
                        {isCheapest
                          ? <span className="fc-base">base</span>
                          : <span className="fc-x">{mult < 10 ? mult.toFixed(1) : Math.round(mult)}×</span>
                        }
                      </td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="fc-hint">Click a row to load that instance into the calculator</div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// REGION COMPARE PANEL
// ═══════════════════════════════════════════════════════════════════
function RegionCompare({ service, config, currentRegion, onSelect, onClose }) {
  const rows = useMemo(() =>
    REGION_KEYS
      .map(r => ({ key: r, ...REGIONS[r], cost: REGISTRY[service]?.cost(config, r) ?? 0 }))
      .filter(r => r.cost > 0)
      .sort((a, b) => a.cost - b.cost),
    [service, config]
  );
  const min = rows[0]?.cost ?? 0;
  const max = rows[rows.length - 1]?.cost ?? 0;
  const range = max - min;
  const currentCost = rows.find(r => r.key === currentRegion)?.cost ?? 0;
  const savings = currentCost - min;

  return (
    <div className="rc-wrap">
      <div className="rc-head">
        <div>
          <div className="rc-title">Region Comparison</div>
          <div className="rc-sub">{SERVICE_META[service]?.label} · same configuration</div>
        </div>
        <button className="rc-back" onClick={onClose}>
          <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10 3L5 8l5 5" /></svg>
          Back
        </button>
      </div>

      {savings > 0.005 && (
        <div className="rc-tip">
          Switch to <strong>{rows[0]?.shortName}</strong> to save <strong className="rc-tip-val">{fmt(savings)}/mo</strong> · {fmt(savings * 12)}/yr
        </div>
      )}

      <div className="rc-table-wrap">
        <table className="rc-table">
          <thead>
            <tr><th>Region</th><th>Monthly</th><th>Annual</th><th>vs cheapest</th><th></th></tr>
          </thead>
          <tbody>
            {rows.map(({ key, flag, name, cost }) => {
              const isCurrent = key === currentRegion;
              const isCheapest = cost === min;
              return (
                <tr key={key} className={"rc-row" + (isCurrent ? " rc-current" : "")}>
                  <td className="rc-region">
                    <span>{flag}</span>
                    <span className="rc-rname">{name}</span>
                    {isCurrent && <span className="rc-cur-tag">current</span>}
                  </td>
                  <td className="rc-cost">
                    <span className={isCheapest ? "rc-cheapest-val" : ""}>{fmt(cost)}</span>
                    <div className="rc-bar">
                      <div className="rc-bar-f" style={{ width: (range > 0 ? ((cost - min) / range) * 100 : 0) + "%" }} />
                    </div>
                  </td>
                  <td className="rc-annual">{fmt(cost * 12)}</td>
                  <td className="rc-diff">
                    {isCheapest ? <span className="rc-cheap">✓ cheapest</span> : <span className="rc-over">+{fmt(cost - min)}/mo</span>}
                  </td>
                  <td>
                    <button className={"rc-use" + (isCurrent ? " rc-used" : "")} disabled={isCurrent} onClick={() => { if (!isCurrent) onSelect(key); }}>
                      {isCurrent ? "Active" : "Use"}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// MAIN APP
// ═══════════════════════════════════════════════════════════════════
export default function App() {
  const [region, setRegion] = useState("eu-west-1");
  const [active, setActive] = useState("ec2");
  const [configs, setConfigs] = useState(() => {
    const c = {};
    for (const k of SERVICE_KEYS) c[k] = { ...REGISTRY[k].default };
    return c;
  });
  const [cart, setCart] = useState([]);
  const [showSummary, setShowSummary] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [view, setView] = useState("config"); // "config" | "family" | "regions"
  const [toast, setToast] = useState(null);

  // localStorage restore
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("pw-state") || "null");
      if (!saved) return;
      if (saved.cart?.length) { setCart(saved.cart); _cid = Math.max(_cid, ...saved.cart.map(i => i.id)); }
      if (saved.configs) setConfigs(prev => { const n = { ...prev }; for (const k of SERVICE_KEYS) { if (saved.configs[k]) n[k] = { ...REGISTRY[k].default, ...saved.configs[k] }; } return n; });
      if (saved.region) setRegion(saved.region);
    } catch { /* ignore */ }
  }, []);

  // localStorage persist
  useEffect(() => {
    const t = setTimeout(() => localStorage.setItem("pw-state", JSON.stringify({ cart, configs, region })), 400);
    return () => clearTimeout(t);
  }, [cart, configs, region]);

  const fireToast = useCallback((msg) => {
    setToast({ msg, key: Date.now() });
    setTimeout(() => setToast(null), 2500);
  }, []);

  const setCfg = useCallback((k, v) => setConfigs(p => ({ ...p, [k]: v })), []);
  const curCost = useMemo(() => active && REGISTRY[active] ? REGISTRY[active].cost(configs[active], region) : 0, [active, configs, region]);
  const cartTotal = useMemo(() => cart.reduce((s, i) => s + i.cost, 0), [cart]);

  const commitCart = useCallback(() => {
    if (!active || !REGISTRY[active]) return;
    const cost = REGISTRY[active].cost(configs[active], region);
    if (editingId !== null) {
      setCart(p => p.map(item => item.id === editingId ? { ...item, config: { ...configs[active] }, cost, region, label: makeLabel(active, configs[active], region) } : item));
      setEditingId(null);
      fireToast("Item updated");
    } else {
      setCart(p => [...p, { id: nextId(), service: active, region, config: { ...configs[active] }, cost, label: makeLabel(active, configs[active], region) }]);
      fireToast(SERVICE_META[active]?.label + " added");
    }
  }, [active, configs, region, editingId, fireToast]);

  const startEdit = useCallback((item) => {
    setActive(item.service);
    setRegion(item.region);
    setConfigs(prev => ({ ...prev, [item.service]: { ...item.config } }));
    setEditingId(item.id);
    setView("config");
  }, []);

  const grouped = useMemo(() => {
    const g = {};
    for (const cat of CATEGORY_ORDER) g[cat] = [];
    for (const k of SERVICE_KEYS) { const cat = SERVICE_META[k]?.category || "Other"; if (!g[cat]) g[cat] = []; g[cat].push(k); }
    return g;
  }, []);

  const ActiveComp = active ? REGISTRY[active]?.component : null;
  const isGlobal = active === "cloudfront" || active === "route53";
  const canCompareRegions = !isGlobal && active !== "ecs";

  const switchService = (key) => { setActive(key); setView("config"); if (editingId !== null) setEditingId(null); };

  return (
    <div className="pw-root">
      {toast && (
        <div key={toast.key} className="toast">
          <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="var(--accent)" strokeWidth="2"><path d="M3 8l4 4 6-6" /></svg>
          {toast.msg}
        </div>
      )}

      {/* Header */}
      <header className="pw-header">
        <div className="pw-header-right">
          <select className="region-select" value={region} onChange={e => setRegion(e.target.value)}>
            {REGION_KEYS.map(r => <option key={r} value={r}>{REGIONS[r].flag} {REGIONS[r].name}</option>)}
          </select>
        </div>
      </header>

      <div className="pw-body">
        {/* Sidebar */}
        <nav className="pw-sidebar">
          {CATEGORY_ORDER.map(cat => (
            <div key={cat} className="pw-cat-group">
              <div className="pw-cat-label" style={{ "--cat": CAT_COLORS[cat] }}>
                <span className="cat-pip" />
                {cat}
              </div>
              {grouped[cat]?.map(key => {
                const n = cart.filter(i => i.service === key).length;
                return (
                  <button key={key}
                    className={"pw-svc-btn" + (active === key ? " active" : "")}
                    style={{ "--cat": CAT_COLORS[SERVICE_META[key]?.category] }}
                    onClick={() => switchService(key)}
                  >
                    <span className="svc-label">{SERVICE_META[key]?.label}</span>
                    {n > 0 && <span className="svc-badge">{n}</span>}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>

        {/* Main */}
        <main className="pw-main">
          {active && ActiveComp && (
            <>
              {/* Main header */}
              <div className="pw-main-hd">
                <div className="pw-main-hd-left">
                  <span className="pw-svc-dot" style={{ background: CAT_COLORS[SERVICE_META[active]?.category] }} />
                  <h2>{SERVICE_META[active]?.label}</h2>
                  {!isGlobal && <span className="pw-region-chip">{REGIONS[region]?.flag} {REGIONS[region]?.shortName}</span>}
                  {isGlobal && <span className="pw-region-chip">🌐 Global</span>}
                </div>
                <div className="pw-main-hd-right">
                  {active === "ec2" && (
                    <button className={"view-btn" + (view === "family" ? " active" : "")} onClick={() => setView(v => v === "family" ? "config" : "family")}>
                      <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <rect x="1" y="1" width="6" height="6" rx="1" /><rect x="9" y="1" width="6" height="6" rx="1" />
                        <rect x="1" y="9" width="6" height="6" rx="1" /><rect x="9" y="9" width="6" height="6" rx="1" />
                      </svg>
                      Family
                    </button>
                  )}
                  {canCompareRegions && (
                    <button className={"view-btn" + (view === "regions" ? " active" : "")} onClick={() => setView(v => v === "regions" ? "config" : "regions")}>
                      <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <circle cx="8" cy="8" r="6" /><path d="M2 8h12M8 2a10 10 0 0 1 0 12M8 2a10 10 0 0 0 0 12" />
                      </svg>
                      Regions
                    </button>
                  )}
                </div>
              </div>

              {editingId !== null && (
                <div className="edit-banner">
                  <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M11.5 2.5l2 2L5 13H3v-2L11.5 2.5z" /></svg>
                  Editing cart item
                  <button className="edit-cancel" onClick={() => setEditingId(null)}>Cancel</button>
                </div>
              )}

              <div key={view} className="panel-fade">
                {view === "family" && active === "ec2" ? (
                  <EC2FamilyCompare
                    region={region}
                    currentConfig={configs.ec2}
                    onSelectInstance={(instance, os) => {
                      setCfg("ec2", { ...configs.ec2, instance, os });
                      setView("config");
                    }}
                  />
                ) : view === "regions" && canCompareRegions ? (
                  <RegionCompare
                    service={active}
                    config={configs[active]}
                    currentRegion={region}
                    onSelect={(r) => { setRegion(r); setView("config"); }}
                    onClose={() => setView("config")}
                  />
                ) : (
                  <ActiveComp config={configs[active]} setConfig={c => setCfg(active, c)} region={region} />
                )}
              </div>

              {/* ATC bar */}
              <div className="atc-bar">
                <div className="atc-costs">
                  <div className="atc-grp">
                    <span className="atc-lbl">Monthly</span>
                    <span className="atc-amt">{fmt(curCost)}</span>
                  </div>
                  <div className="atc-sep" />
                  <div className="atc-grp">
                    <span className="atc-lbl">Annual</span>
                    <span className="atc-yr">{fmt(curCost * 12)}</span>
                  </div>
                </div>
                <button className={"atc-btn" + (editingId !== null ? " update" : "")} onClick={commitCart}>
                  {editingId !== null ? (
                    <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 8l4 4 6-6" /></svg>
                  ) : (
                    <svg viewBox="0 0 20 20" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="8" cy="18" r="1.5" /><circle cx="17" cy="18" r="1.5" /><path d="M1 1h3l2.5 12h11l2-8H6" /></svg>
                  )}
                  {editingId !== null ? "Update" : "Add to cart"}
                </button>
              </div>
            </>
          )}
        </main>

        {/* Cart */}
        <aside className="pw-cart">
          <div className="cart-hd">
            <span className="cart-title">Estimate{cart.length > 0 && <span className="cart-n">{cart.length}</span>}</span>
            {cart.length > 0 && <button className="cart-clr" onClick={() => { setCart([]); setEditingId(null); }}>Clear</button>}
          </div>

          {cart.length === 0 ? (
            <div className="cart-empty">
              <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" strokeWidth="1.2" opacity="0.2">
                <circle cx="9" cy="21" r="1" /><circle cx="20" cy="21" r="1" />
                <path d="M1 1h4l2.7 13.4a2 2 0 0 0 2 1.6h9.7a2 2 0 0 0 2-1.6L23 6H6" />
              </svg>
              <p>Add services to build<br />your estimate</p>
            </div>
          ) : (
            <>
              <div className="cart-list">
                {cart.map(item => {
                  const pct = cartTotal > 0 ? (item.cost / cartTotal) * 100 : 0;
                  const isEditing = item.id === editingId;
                  const cc = CAT_COLORS[SERVICE_META[item.service]?.category] || "#0ea5e9";
                  return (
                    <div key={item.id} className={"cart-item" + (isEditing ? " editing" : "")}>
                      <div className="ci-main">
                        <div className="ci-info">
                          <div className="ci-svc"><span className="ci-dot" style={{ background: cc }} />{SERVICE_META[item.service]?.label}</div>
                          <div className="ci-label">{item.label}</div>
                        </div>
                        <div className="ci-right">
                          <span className="ci-cost">{fmt(item.cost)}</span>
                          <div className="ci-actions">
                            <button className="ci-edit" onClick={() => startEdit(item)} title="Edit">
                              <svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M11.5 2.5l2 2L5 13H3v-2L11.5 2.5z" /></svg>
                            </button>
                            <button className="ci-rm" onClick={() => { setCart(p => p.filter(i => i.id !== item.id)); if (isEditing) setEditingId(null); }} title="Remove">
                              <svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M4 4l8 8M12 4l-8 8" /></svg>
                            </button>
                          </div>
                        </div>
                      </div>
                      <div className="ci-bar"><div className="ci-bar-f" style={{ width: pct + "%", background: cc }} /></div>
                    </div>
                  );
                })}
              </div>

              <div className="cart-foot">
                <div className="cart-total-row">
                  <div>
                    <div className="cart-total-lbl">Monthly total</div>
                    <div className="cart-total-yr">{fmt(cartTotal * 12)}/yr</div>
                  </div>
                  <span className="cart-total-amt">{fmt(cartTotal)}</span>
                </div>
                <button className="cart-breakdown" onClick={() => setShowSummary(true)}>Breakdown &amp; Export</button>
              </div>
            </>
          )}
        </aside>
      </div>

      {/* Modal */}
      {showSummary && (
        <div className="pw-overlay" onClick={() => setShowSummary(false)}>
          <div className="pw-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-hd">
              <div>
                <h3>Cost Breakdown</h3>
                <div className="modal-sub">{cart.length} item{cart.length !== 1 ? "s" : ""} · {fmt(cartTotal)}/mo · {fmt(cartTotal * 12)}/yr</div>
              </div>
              <button className="modal-export" onClick={() => exportCSV(cart, cartTotal)}>
                <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M8 2v8M5 7l3 4 3-4M2 13h12" /></svg>
                CSV
              </button>
            </div>

            {cart.map(item => {
              const pct = cartTotal > 0 ? (item.cost / cartTotal) * 100 : 0;
              const cc = CAT_COLORS[SERVICE_META[item.service]?.category] || "#0ea5e9";
              return (
                <div key={item.id} className="modal-row">
                  <div className="modal-row-l">
                    <div className="modal-svc"><span className="ci-dot" style={{ background: cc }} />{SERVICE_META[item.service]?.label}</div>
                    <div className="modal-detail">{item.label}</div>
                    <div className="modal-bar"><div className="modal-bar-f" style={{ width: pct + "%", background: cc }} /></div>
                  </div>
                  <div className="modal-row-r">
                    <span className="modal-amt">{fmt(item.cost)}</span>
                    <span className="modal-pct">{pct.toFixed(1)}%</span>
                  </div>
                </div>
              );
            })}

            <div className="modal-total">
              <span>Total</span>
              <div className="modal-total-r">
                <span className="modal-yr">{fmt(cartTotal * 12)} / yr</span>
                <span className="modal-total-amt">{fmt(cartTotal)} / mo</span>
              </div>
            </div>
            <div className="modal-disc">{PRICING.meta.disclaimer}</div>
            <button className="modal-close" onClick={() => setShowSummary(false)}>Close</button>
          </div>
        </div>
      )}
    </div>
  );
}
