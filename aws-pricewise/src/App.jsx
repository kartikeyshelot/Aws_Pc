import { useState, useMemo, useCallback } from "react";
import { REGIONS, REGION_KEYS, HOURS_PER_MONTH, SERVICE_KEYS, SERVICE_META, CATEGORY_ORDER, OS_OPTIONS } from "./constants";
import {
  PRICING, getEC2Instances, getEC2Price, getEC2Spec, getLambdaPricing,
  getS3Pricing, getEBSPricing, getEFSPricing, getRDSInstances, getRDSStorage,
  getAuroraPricing, getDynamoDBPricing, getElastiCacheNodes, getVPCPricing,
  getCloudFrontPricing, getRoute53Pricing, getFargatePricing, getEKSPricing,
  getSageMakerPricing,
} from "./data/pricing";
import "./App.css";

// ═══════════════════════════════════════════════════════════════════
// Formatting helpers
// ═══════════════════════════════════════════════════════════════════
const fmt = (n) => {
  if (n === null || n === undefined) return "N/A";
  if (n === 0) return "$0.00";
  if (n < 0.01) return `$${n.toFixed(6)}`;
  if (n < 1) return `$${n.toFixed(4)}`;
  if (n < 100) return `$${n.toFixed(2)}`;
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

// ═══════════════════════════════════════════════════════════════════
// Shared UI components
// ═══════════════════════════════════════════════════════════════════
function Select({ label, value, onChange, options, className = "" }) {
  return (
    <div className={`cfg-field ${className}`}>
      <label>{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => {
          const val = typeof o === "string" ? o : o.value;
          const lab = typeof o === "string" ? o : o.label;
          return <option key={val} value={val}>{lab}</option>;
        })}
      </select>
    </div>
  );
}

function NumberInput({ label, value, onChange, min = 0, max, step = 1, unit = "" }) {
  return (
    <div className="cfg-field">
      <label>{label}{unit ? ` (${unit})` : ""}</label>
      <input type="number" value={value} min={min} max={max} step={step}
        onChange={(e) => onChange(Number(e.target.value) || 0)} />
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
      ⚠ {message || "Pricing not available in current dataset."}
      {!PRICING.meta.isFetched && (
        <div className="not-available-hint">Run <code>npm run fetch-pricing</code> for complete regional data.</div>
      )}
    </div>
  );
}

function Divider() {
  return <hr className="cfg-divider" />;
}

function Checkbox({ label, checked, onChange }) {
  return (
    <div className="cfg-field">
      <label className="checkbox-label">
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        {label}
      </label>
    </div>
  );
}

const OS_DISPLAY = { linux: "Linux", windows: "Windows", rhel: "RHEL", suse: "SUSE" };

function RhelSuseWarning({ os }) {
  if (os !== "rhel" && os !== "suse") return null;
  if (PRICING.meta.isFetched) return null;
  return (
    <div className="not-available" style={{ marginBottom: 8 }}>
      ⚠ {OS_DISPLAY[os]} pricing changed to a per-vCPU model in July 2024. Seed data prices are approximate.
      <div className="not-available-hint">Run <code>npm run fetch-pricing</code> for exact current {OS_DISPLAY[os]} pricing from the AWS API.</div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// EC2 Config
// ═══════════════════════════════════════════════════════════════════
function EC2Config({ config, setConfig, region }) {
  const instances = getEC2Instances(region);
  const instanceTypes = Object.keys(instances).sort((a, b) => {
    const fam = (s) => s.split(".")[0];
    const size = (s) => {
      const sizes = ["nano","micro","small","medium","large","xlarge","2xlarge","4xlarge","8xlarge","9xlarge","12xlarge","16xlarge","24xlarge","48xlarge"];
      return sizes.indexOf(s.split(".")[1]) ?? 99;
    };
    return fam(a).localeCompare(fam(b)) || size(a) - size(b);
  });

  if (instanceTypes.length === 0) {
    return <NotAvailable message={`No EC2 pricing data for ${REGIONS[region]?.name || region}.`} />;
  }

  // Ensure selected instance exists in this region
  const inst = config.instance && instances[config.instance] ? config.instance : instanceTypes[0];
  const spec = instances[inst];
  const price = spec?.prices?.[config.os] ?? null;

  const instOptions = instanceTypes.map((t) => {
    const s = instances[t];
    return { value: t, label: `${t}  (${s.vcpu} vCPU, ${s.memory} GiB)` };
  });

  return (
    <div className="cfg-grid">
      <Select label="Instance Type" value={inst}
        onChange={(v) => setConfig({ ...config, instance: v })} options={instOptions} />
      <Select label="Operating System" value={config.os}
        onChange={(v) => setConfig({ ...config, os: v })} options={OS_OPTIONS} />
      <NumberInput label="Number of Instances" value={config.count}
        onChange={(v) => setConfig({ ...config, count: v })} min={1} max={10000} />
      <NumberInput label="Hours per Month" value={config.hours}
        onChange={(v) => setConfig({ ...config, hours: v })} min={0} max={HOURS_PER_MONTH} unit="hrs" />
      <div className="cfg-result">
        <RhelSuseWarning os={config.os} />
        {price === null ? (
          <NotAvailable message={`${OS_DISPLAY[config.os] || config.os} pricing not available for ${inst} in this region.`} />
        ) : (
          <>
            <PriceLine label="Per instance / hour" amount={price} />
            <Divider />
            <PriceLine label="Monthly estimate" amount={price * config.count * config.hours} />
          </>
        )}
      </div>
    </div>
  );
}
function ec2Cost(c, region) {
  // Use same fallback as UI: if config.instance doesn't exist in region, use first available
  const instances = getEC2Instances(region);
  const instKey = instances[c.instance] ? c.instance : Object.keys(instances)[0];
  if (!instKey) return 0;
  const price = instances[instKey]?.prices?.[c.os] ?? null;
  return price != null ? price * c.count * c.hours : 0;
}

// ═══════════════════════════════════════════════════════════════════
// Lambda Config
// ═══════════════════════════════════════════════════════════════════
function LambdaConfig({ config, setConfig, region }) {
  const p = getLambdaPricing(region);
  if (!p) return <NotAvailable message={`No Lambda pricing for ${REGIONS[region]?.name || region}.`} />;

  const billableReqs = Math.max(0, config.requests - p.freeRequests);
  const gbSec = (config.memoryMB / 1024) * (config.durationMs / 1000) * config.requests;
  const billableGBs = Math.max(0, gbSec - p.freeDurationGBs);
  const reqCost = billableReqs * p.requestPrice;
  const durCost = billableGBs * p.durationPriceGB;

  return (
    <div className="cfg-grid">
      <NumberInput label="Requests / month" value={config.requests}
        onChange={(v) => setConfig({ ...config, requests: v })} min={0} step={100000} />
      <NumberInput label="Memory Allocated" value={config.memoryMB}
        onChange={(v) => setConfig({ ...config, memoryMB: v })} min={128} max={10240} step={128} unit="MB" />
      <NumberInput label="Avg Duration" value={config.durationMs}
        onChange={(v) => setConfig({ ...config, durationMs: v })} min={1} max={900000} unit="ms" />
      <div className="cfg-result">
        <PriceLine label="Request cost" amount={reqCost} note={`${(billableReqs / 1e6).toFixed(1)}M billable`} />
        <PriceLine label="Duration cost" amount={durCost} note={`${(billableGBs / 1000).toFixed(0)}k GB-s`} />
        <Divider />
        <PriceLine label="Monthly estimate" amount={reqCost + durCost} />
      </div>
    </div>
  );
}
function lambdaCost(c, region) {
  const p = getLambdaPricing(region);
  if (!p) return 0;
  const br = Math.max(0, c.requests - p.freeRequests);
  const gbs = (c.memoryMB / 1024) * (c.durationMs / 1000) * c.requests;
  const bgbs = Math.max(0, gbs - p.freeDurationGBs);
  return br * p.requestPrice + bgbs * p.durationPriceGB;
}

// ═══════════════════════════════════════════════════════════════════
// S3 Config
// ═══════════════════════════════════════════════════════════════════
function S3Config({ config, setConfig, region }) {
  const p = getS3Pricing(region);
  if (!p) return <NotAvailable message={`No S3 pricing for ${REGIONS[region]?.name || region}.`} />;

  const tierMap = { standard: p.standard, intelligent: p.intelligent, standardIA: p.standardIA, oneZoneIA: p.oneZoneIA, glacier: p.glacier, glacierDeep: p.glacierDeep };
  const tierLabels = { standard: "Standard", intelligent: "Intelligent-Tiering", standardIA: "Standard-IA", oneZoneIA: "One Zone-IA", glacier: "Glacier Flexible", glacierDeep: "Glacier Deep Archive" };
  const storageCost = config.storageGB * (tierMap[config.tier] || 0);
  const putCost = (config.putRequests / 1000) * p.putPer1k;
  const getCost = (config.getRequests / 1000) * p.getPer1k;
  const transferCost = config.transferOutGB * p.transferPerGB;

  return (
    <div className="cfg-grid">
      <Select label="Storage Class" value={config.tier}
        onChange={(v) => setConfig({ ...config, tier: v })}
        options={Object.keys(tierMap).map(t => ({ value: t, label: tierLabels[t] || t }))} />
      <NumberInput label="Storage" value={config.storageGB} onChange={(v) => setConfig({ ...config, storageGB: v })} min={0} unit="GB" />
      <NumberInput label="PUT/COPY/POST/LIST Requests" value={config.putRequests}
        onChange={(v) => setConfig({ ...config, putRequests: v })} min={0} step={1000} />
      <NumberInput label="GET/SELECT Requests" value={config.getRequests}
        onChange={(v) => setConfig({ ...config, getRequests: v })} min={0} step={1000} />
      <NumberInput label="Data Transfer Out" value={config.transferOutGB}
        onChange={(v) => setConfig({ ...config, transferOutGB: v })} min={0} unit="GB" />
      <div className="cfg-result">
        <PriceLine label="Storage" amount={storageCost} />
        <PriceLine label="PUT requests" amount={putCost} />
        <PriceLine label="GET requests" amount={getCost} />
        <PriceLine label="Data transfer" amount={transferCost} />
        <Divider />
        <PriceLine label="Monthly estimate" amount={storageCost + putCost + getCost + transferCost} />
      </div>
    </div>
  );
}
function s3Cost(c, region) {
  const p = getS3Pricing(region);
  if (!p) return 0;
  const tiers = { standard: p.standard, intelligent: p.intelligent, standardIA: p.standardIA, oneZoneIA: p.oneZoneIA, glacier: p.glacier, glacierDeep: p.glacierDeep };
  return c.storageGB * (tiers[c.tier] || 0) + (c.putRequests / 1000) * p.putPer1k +
    (c.getRequests / 1000) * p.getPer1k + c.transferOutGB * p.transferPerGB;
}

// ═══════════════════════════════════════════════════════════════════
// EBS Config
// ═══════════════════════════════════════════════════════════════════
function EBSConfig({ config, setConfig, region }) {
  const p = getEBSPricing(region);
  if (!p) return <NotAvailable message={`No EBS pricing for ${REGIONS[region]?.name || region}.`} />;

  const volTypes = ["gp3", "gp2", "io1", "io2", "st1", "sc1"].filter(v => p[v] != null);
  const pricePerGB = p[config.volumeType] || 0;
  const storageCost = config.sizeGB * pricePerGB * config.count;
  const isProvIOPS = config.volumeType === "gp3" || config.volumeType === "io1" || config.volumeType === "io2";
  const iopsKey = config.volumeType === "gp3" ? "gp3IOPS" : (config.volumeType + "IOPS");
  const baseIOPS = config.volumeType === "gp3" ? 3000 : 0;
  const extraIOPS = isProvIOPS ? Math.max(0, config.iops - baseIOPS) : 0;
  const iopsCost = isProvIOPS && p[iopsKey] ? extraIOPS * p[iopsKey] * config.count : 0;
  const snapCost = config.snapshotGB * p.snapshots;

  return (
    <div className="cfg-grid">
      <Select label="Volume Type" value={config.volumeType}
        onChange={(v) => setConfig({ ...config, volumeType: v })} options={volTypes} />
      <NumberInput label="Size per Volume" value={config.sizeGB} onChange={(v) => setConfig({ ...config, sizeGB: v })} min={1} unit="GB" />
      <NumberInput label="Number of Volumes" value={config.count} onChange={(v) => setConfig({ ...config, count: v })} min={1} />
      {isProvIOPS && (
        <NumberInput label="Provisioned IOPS" value={config.iops} onChange={(v) => setConfig({ ...config, iops: v })} min={0} />
      )}
      <NumberInput label="Snapshot Storage" value={config.snapshotGB} onChange={(v) => setConfig({ ...config, snapshotGB: v })} min={0} unit="GB" />
      <div className="cfg-result">
        <PriceLine label="Storage" amount={storageCost} />
        {iopsCost > 0 && <PriceLine label="IOPS" amount={iopsCost} />}
        <PriceLine label="Snapshots" amount={snapCost} />
        <Divider />
        <PriceLine label="Monthly estimate" amount={storageCost + iopsCost + snapCost} />
      </div>
    </div>
  );
}
function ebsCost(c, region) {
  const p = getEBSPricing(region);
  if (!p) return 0;
  const sc = c.sizeGB * (p[c.volumeType] || 0) * c.count;
  const isProv = c.volumeType === "gp3" || c.volumeType === "io1" || c.volumeType === "io2";
  const iopsKey = c.volumeType === "gp3" ? "gp3IOPS" : (c.volumeType + "IOPS");
  const base = c.volumeType === "gp3" ? 3000 : 0;
  const extra = isProv ? Math.max(0, c.iops - base) : 0;
  const ic = isProv && p[iopsKey] ? extra * p[iopsKey] * c.count : 0;
  return sc + ic + c.snapshotGB * (p.snapshots || 0);
}

// ═══════════════════════════════════════════════════════════════════
// EFS Config
// ═══════════════════════════════════════════════════════════════════
function EFSConfig({ config, setConfig, region }) {
  const p = getEFSPricing(region);
  if (!p) return <NotAvailable message={`No EFS pricing for ${REGIONS[region]?.name || region}.`} />;

  const classMap = { standard: p.standard, ia: p.ia, archive: p.archive };
  const classLabels = { standard: "Standard", ia: "Infrequent Access", archive: "Archive" };
  const cost = config.storageGB * (classMap[config.storageClass] || 0);

  return (
    <div className="cfg-grid">
      <Select label="Storage Class" value={config.storageClass}
        onChange={(v) => setConfig({ ...config, storageClass: v })}
        options={Object.keys(classMap).map(c => ({ value: c, label: classLabels[c] }))} />
      <NumberInput label="Storage" value={config.storageGB} onChange={(v) => setConfig({ ...config, storageGB: v })} min={0} unit="GB" />
      <div className="cfg-result">
        <PriceLine label="Monthly estimate" amount={cost} />
      </div>
    </div>
  );
}
function efsCost(c, region) {
  const p = getEFSPricing(region);
  if (!p) return 0;
  const m = { standard: p.standard, ia: p.ia, archive: p.archive };
  return c.storageGB * (m[c.storageClass] || 0);
}

// ═══════════════════════════════════════════════════════════════════
// RDS Config
// ═══════════════════════════════════════════════════════════════════
function RDSConfig({ config, setConfig, region }) {
  const instances = getRDSInstances(region);
  const storagePrice = getRDSStorage(region);
  const types = Object.keys(instances);
  if (types.length === 0) return <NotAvailable message={`No RDS pricing for ${REGIONS[region]?.name || region}.`} />;

  const inst = instances[config.instance] || instances[types[0]];
  const instKey = instances[config.instance] ? config.instance : types[0];
  const engine = config.engine || "postgres";
  const hourly = inst?.prices?.[engine] ?? null;
  const m = config.multiAZ ? 2 : 1;
  const computeCost = hourly != null ? hourly * HOURS_PER_MONTH * m : null;
  const stCost = storagePrice ? config.storageGB * storagePrice * m : 0;

  return (
    <div className="cfg-grid">
      <Select label="Engine" value={engine}
        onChange={(v) => setConfig({ ...config, engine: v })}
        options={[{ value: "mysql", label: "MySQL" }, { value: "postgres", label: "PostgreSQL" }, { value: "mariadb", label: "MariaDB" }]} />
      <Select label="Instance Type" value={instKey}
        onChange={(v) => setConfig({ ...config, instance: v })}
        options={types.map(t => ({ value: t, label: `${t}  (${instances[t].vcpu} vCPU, ${instances[t].memory} GiB)` }))} />
      <NumberInput label="Storage (gp2)" value={config.storageGB} onChange={(v) => setConfig({ ...config, storageGB: v })} min={20} unit="GB" />
      <Checkbox label="Multi-AZ Deployment (2× compute + storage)" checked={config.multiAZ}
        onChange={(v) => setConfig({ ...config, multiAZ: v })} />
      <div className="cfg-result">
        {hourly == null ? (
          <NotAvailable message={`${engine} pricing not available for ${instKey} in this region.`} />
        ) : (
          <>
            <PriceLine label="Compute" amount={computeCost} note={config.multiAZ ? "Multi-AZ" : "Single-AZ"} />
            <PriceLine label="Storage" amount={stCost} />
            <Divider />
            <PriceLine label="Monthly estimate" amount={computeCost + stCost} />
          </>
        )}
      </div>
    </div>
  );
}
function rdsCost(c, region) {
  const instances = getRDSInstances(region);
  const instKey = instances[c.instance] ? c.instance : Object.keys(instances)[0];
  if (!instKey) return 0;
  const inst = instances[instKey];
  const sp = getRDSStorage(region);
  const h = inst?.prices?.[c.engine];
  if (h == null) return 0;
  const m = c.multiAZ ? 2 : 1;
  return h * HOURS_PER_MONTH * m + (sp ? c.storageGB * sp * m : 0);
}

// ═══════════════════════════════════════════════════════════════════
// Aurora Config
// ═══════════════════════════════════════════════════════════════════
function AuroraConfig({ config, setConfig, region }) {
  const p = getAuroraPricing(region);
  if (!p || !p.instances) return <NotAvailable message={`No Aurora pricing for ${REGIONS[region]?.name || region}.`} />;

  const types = Object.keys(p.instances);
  const instKey = p.instances[config.instance] ? config.instance : types[0];
  const inst = p.instances[instKey];
  const engine = config.engine || "postgres";
  const hourly = inst?.prices?.[engine] ?? null;
  const computeCost = hourly != null ? hourly * HOURS_PER_MONTH * config.replicas : null;
  const storageCost = config.storageGB * (p.storagePerGB || 0);
  const ioCost = (config.ioMillions || 0) * (p.ioPerMillion || 0);

  return (
    <div className="cfg-grid">
      <Select label="Compatibility" value={engine}
        onChange={(v) => setConfig({ ...config, engine: v })}
        options={[{ value: "mysql", label: "MySQL" }, { value: "postgres", label: "PostgreSQL" }]} />
      <Select label="Instance Type" value={instKey}
        onChange={(v) => setConfig({ ...config, instance: v })}
        options={types.map(t => ({ value: t, label: `${t}  (${p.instances[t].vcpu} vCPU, ${p.instances[t].memory} GiB)` }))} />
      <NumberInput label="Writer + Reader Instances" value={config.replicas}
        onChange={(v) => setConfig({ ...config, replicas: v })} min={1} max={15} />
      <NumberInput label="Storage" value={config.storageGB} onChange={(v) => setConfig({ ...config, storageGB: v })} min={10} unit="GB" />
      <NumberInput label="I/O Requests" value={config.ioMillions} onChange={(v) => setConfig({ ...config, ioMillions: v })} min={0} step={1} unit="millions" />
      <div className="cfg-result">
        {hourly == null ? <NotAvailable /> : (
          <>
            <PriceLine label="Compute" amount={computeCost} note={`${config.replicas} instance(s)`} />
            <PriceLine label="Storage" amount={storageCost} />
            <PriceLine label="I/O" amount={ioCost} />
            <Divider />
            <PriceLine label="Monthly estimate" amount={computeCost + storageCost + ioCost} />
          </>
        )}
      </div>
    </div>
  );
}
function auroraCost(c, region) {
  const p = getAuroraPricing(region);
  if (!p?.instances) return 0;
  const instKey = p.instances[c.instance] ? c.instance : Object.keys(p.instances)[0];
  if (!instKey) return 0;
  const h = p.instances[instKey].prices?.[c.engine];
  if (h == null) return 0;
  return h * HOURS_PER_MONTH * c.replicas + c.storageGB * (p.storagePerGB || 0) + (c.ioMillions || 0) * (p.ioPerMillion || 0);
}

// ═══════════════════════════════════════════════════════════════════
// DynamoDB Config
// ═══════════════════════════════════════════════════════════════════
function DynamoDBConfig({ config, setConfig, region }) {
  const p = getDynamoDBPricing(region);
  if (!p) return <NotAvailable message={`No DynamoDB pricing for ${REGIONS[region]?.name || region}.`} />;

  let readCost, writeCost;
  if (config.mode === "ondemand") {
    readCost = (config.readUnits / 1e6) * p.readPerM;
    writeCost = (config.writeUnits / 1e6) * p.writePerM;
  } else {
    readCost = config.readUnits * p.provRCU * HOURS_PER_MONTH;
    writeCost = config.writeUnits * p.provWCU * HOURS_PER_MONTH;
  }
  const freeGB = p.freeStorageGB || 25;
  const storageGB = Math.max(0, config.storageGB - freeGB);
  const storageCost = storageGB * p.storagePerGB;

  return (
    <div className="cfg-grid">
      <Select label="Capacity Mode" value={config.mode}
        onChange={(v) => setConfig({ ...config, mode: v })}
        options={[{ value: "ondemand", label: "On-Demand" }, { value: "provisioned", label: "Provisioned" }]} />
      <NumberInput label={config.mode === "ondemand" ? "Read Request Units / mo" : "Read Capacity Units"}
        value={config.readUnits} onChange={(v) => setConfig({ ...config, readUnits: v })} min={0} step={config.mode === "ondemand" ? 100000 : 1} />
      <NumberInput label={config.mode === "ondemand" ? "Write Request Units / mo" : "Write Capacity Units"}
        value={config.writeUnits} onChange={(v) => setConfig({ ...config, writeUnits: v })} min={0} step={config.mode === "ondemand" ? 100000 : 1} />
      <NumberInput label="Storage" value={config.storageGB} onChange={(v) => setConfig({ ...config, storageGB: v })} min={0} unit="GB" />
      <div className="cfg-result">
        <PriceLine label="Read" amount={readCost} />
        <PriceLine label="Write" amount={writeCost} />
        <PriceLine label="Storage" amount={storageCost} note={`${freeGB} GB free`} />
        <Divider />
        <PriceLine label="Monthly estimate" amount={readCost + writeCost + storageCost} />
      </div>
    </div>
  );
}
function dynamodbCost(c, region) {
  const p = getDynamoDBPricing(region);
  if (!p) return 0;
  let rc, wc;
  if (c.mode === "ondemand") { rc = (c.readUnits / 1e6) * p.readPerM; wc = (c.writeUnits / 1e6) * p.writePerM; }
  else { rc = c.readUnits * p.provRCU * HOURS_PER_MONTH; wc = c.writeUnits * p.provWCU * HOURS_PER_MONTH; }
  return rc + wc + Math.max(0, c.storageGB - (p.freeStorageGB || 25)) * p.storagePerGB;
}

// ═══════════════════════════════════════════════════════════════════
// ElastiCache Config
// ═══════════════════════════════════════════════════════════════════
function ElastiCacheConfig({ config, setConfig, region }) {
  const nodes = getElastiCacheNodes(region);
  const types = Object.keys(nodes);
  if (types.length === 0) return <NotAvailable message={`No ElastiCache pricing for ${REGIONS[region]?.name || region}.`} />;

  const nodeKey = nodes[config.nodeType] ? config.nodeType : types[0];
  const node = nodes[nodeKey];
  const monthly = node ? node.price * HOURS_PER_MONTH * config.numNodes : 0;

  return (
    <div className="cfg-grid">
      <Select label="Engine" value={config.engine}
        onChange={(v) => setConfig({ ...config, engine: v })} options={["Redis", "Memcached"]} />
      <Select label="Node Type" value={nodeKey}
        onChange={(v) => setConfig({ ...config, nodeType: v })}
        options={types.map(t => ({ value: t, label: `${t}  (${nodes[t].vcpu} vCPU, ${nodes[t].memory} GiB)` }))} />
      <NumberInput label="Number of Nodes" value={config.numNodes}
        onChange={(v) => setConfig({ ...config, numNodes: v })} min={1} max={40} />
      <div className="cfg-result">
        <PriceLine label="Per node / hour" amount={node?.price} />
        <Divider />
        <PriceLine label="Monthly estimate" amount={monthly} note={`${config.numNodes} node(s)`} />
      </div>
    </div>
  );
}
function elasticacheCost(c, region) {
  const nodes = getElastiCacheNodes(region);
  const nodeKey = nodes[c.nodeType] ? c.nodeType : Object.keys(nodes)[0];
  if (!nodeKey) return 0;
  const n = nodes[nodeKey];
  return n ? n.price * HOURS_PER_MONTH * c.numNodes : 0;
}

// ═══════════════════════════════════════════════════════════════════
// VPC Config
// ═══════════════════════════════════════════════════════════════════
function VPCConfig({ config, setConfig, region }) {
  const p = getVPCPricing(region);
  if (!p) return <NotAvailable message={`No VPC pricing for ${REGIONS[region]?.name || region}.`} />;

  const natCost = config.natGateways * p.natHourly * HOURS_PER_MONTH + config.natDataGB * p.natPerGB;
  const vpnCost = config.vpnConnections * p.vpnHourly * HOURS_PER_MONTH;
  const endpointCost = config.interfaceEndpoints * p.endpointHourly * HOURS_PER_MONTH;

  return (
    <div className="cfg-grid">
      <NumberInput label="NAT Gateways" value={config.natGateways} onChange={(v) => setConfig({ ...config, natGateways: v })} min={0} />
      <NumberInput label="NAT Data Processed" value={config.natDataGB} onChange={(v) => setConfig({ ...config, natDataGB: v })} min={0} unit="GB/mo" />
      <NumberInput label="VPN Connections" value={config.vpnConnections} onChange={(v) => setConfig({ ...config, vpnConnections: v })} min={0} />
      <NumberInput label="Interface Endpoints (per AZ)" value={config.interfaceEndpoints} onChange={(v) => setConfig({ ...config, interfaceEndpoints: v })} min={0} />
      <div className="cfg-result">
        <PriceLine label="NAT Gateways" amount={natCost} />
        <PriceLine label="VPN" amount={vpnCost} />
        <PriceLine label="Endpoints" amount={endpointCost} />
        <Divider />
        <PriceLine label="Monthly estimate" amount={natCost + vpnCost + endpointCost} />
      </div>
    </div>
  );
}
function vpcCost(c, region) {
  const p = getVPCPricing(region);
  if (!p) return 0;
  return c.natGateways * p.natHourly * HOURS_PER_MONTH + c.natDataGB * p.natPerGB +
    c.vpnConnections * p.vpnHourly * HOURS_PER_MONTH + c.interfaceEndpoints * p.endpointHourly * HOURS_PER_MONTH;
}

// ═══════════════════════════════════════════════════════════════════
// CloudFront Config (global pricing)
// ═══════════════════════════════════════════════════════════════════
function CloudFrontConfig({ config, setConfig }) {
  const p = getCloudFrontPricing();
  if (!p) return <NotAvailable />;

  const dt = p.dataTransfer;
  let tc = 0, rem = config.dataTransferTB * 1024;
  const tiers = [[10240, dt.first10TB], [40960, dt.next40TB], [102400, dt.next100TB], [358400, dt.next350TB], [536576, dt.next524TB], [4194304, dt.next4PB], [Infinity, dt.over5PB]];
  for (const [gb, rate] of tiers) { if (rem <= 0) break; const u = Math.min(rem, gb); tc += u * rate; rem -= u; }
  const httpCost = (config.httpRequests / 10000) * p.requestsHTTPper10k;
  const httpsCost = (config.httpsRequests / 10000) * p.requestsHTTPSper10k;

  return (
    <div className="cfg-grid">
      <NumberInput label="Data Transfer Out" value={config.dataTransferTB} onChange={(v) => setConfig({ ...config, dataTransferTB: v })} min={0} step={0.1} unit="TB/mo" />
      <NumberInput label="HTTP Requests" value={config.httpRequests} onChange={(v) => setConfig({ ...config, httpRequests: v })} min={0} step={10000} unit="/mo" />
      <NumberInput label="HTTPS Requests" value={config.httpsRequests} onChange={(v) => setConfig({ ...config, httpsRequests: v })} min={0} step={10000} unit="/mo" />
      <div className="cfg-result">
        <PriceLine label="Data transfer" amount={tc} />
        <PriceLine label="HTTP requests" amount={httpCost} />
        <PriceLine label="HTTPS requests" amount={httpsCost} />
        <Divider />
        <PriceLine label="Monthly estimate" amount={tc + httpCost + httpsCost} />
      </div>
    </div>
  );
}
function cloudfrontCost(c) {
  const p = getCloudFrontPricing();
  if (!p) return 0;
  const dt = p.dataTransfer;
  let tc = 0, rem = c.dataTransferTB * 1024;
  const tiers = [[10240, dt.first10TB], [40960, dt.next40TB], [102400, dt.next100TB], [358400, dt.next350TB], [536576, dt.next524TB], [4194304, dt.next4PB], [Infinity, dt.over5PB]];
  for (const [gb, rate] of tiers) { if (rem <= 0) break; const u = Math.min(rem, gb); tc += u * rate; rem -= u; }
  return tc + (c.httpRequests / 10000) * p.requestsHTTPper10k + (c.httpsRequests / 10000) * p.requestsHTTPSper10k;
}

// ═══════════════════════════════════════════════════════════════════
// Route 53 Config (global pricing)
// ═══════════════════════════════════════════════════════════════════
function Route53Config({ config, setConfig }) {
  const p = getRoute53Pricing();
  if (!p) return <NotAvailable />;

  const zoneCost = config.hostedZones * p.hostedZone;
  const qCost = (config.queries / 1e6) * p.standardQueryPerM;
  const hcCost = config.healthChecks * p.healthCheck;

  return (
    <div className="cfg-grid">
      <NumberInput label="Hosted Zones" value={config.hostedZones} onChange={(v) => setConfig({ ...config, hostedZones: v })} min={0} />
      <NumberInput label="Standard Queries" value={config.queries} onChange={(v) => setConfig({ ...config, queries: v })} min={0} step={100000} unit="/mo" />
      <NumberInput label="Health Checks" value={config.healthChecks} onChange={(v) => setConfig({ ...config, healthChecks: v })} min={0} />
      <div className="cfg-result">
        <PriceLine label="Hosted zones" amount={zoneCost} />
        <PriceLine label="Queries" amount={qCost} />
        <PriceLine label="Health checks" amount={hcCost} />
        <Divider />
        <PriceLine label="Monthly estimate" amount={zoneCost + qCost + hcCost} />
      </div>
    </div>
  );
}
function route53Cost(c) {
  const p = getRoute53Pricing();
  if (!p) return 0;
  return c.hostedZones * p.hostedZone + (c.queries / 1e6) * p.standardQueryPerM + c.healthChecks * p.healthCheck;
}

// ═══════════════════════════════════════════════════════════════════
// ECS / EKS / Fargate
// ═══════════════════════════════════════════════════════════════════
function ECSConfig() {
  return (
    <div className="cfg-grid">
      <div className="info-box">
        <strong>ECS has no additional charge.</strong> You pay for the underlying compute: EC2 instances or Fargate tasks. Configure those services separately.
      </div>
    </div>
  );
}
function ecsCost() { return 0; }

function EKSConfig({ config, setConfig, region }) {
  const p = getEKSPricing(region);
  if (!p) return <NotAvailable message={`No EKS pricing for ${REGIONS[region]?.name || region}.`} />;
  const cost = config.clusters * p.clusterHourly * HOURS_PER_MONTH;
  return (
    <div className="cfg-grid">
      <NumberInput label="EKS Clusters" value={config.clusters} onChange={(v) => setConfig({ ...config, clusters: v })} min={1} max={100} />
      <div className="cfg-result">
        <PriceLine label="Cluster control plane" amount={cost} note={`${config.clusters} × $${p.clusterHourly}/hr`} />
        <div className="note-text">Worker nodes billed via EC2 or Fargate.</div>
      </div>
    </div>
  );
}
function eksCost(c, region) {
  const p = getEKSPricing(region);
  return p ? c.clusters * p.clusterHourly * HOURS_PER_MONTH : 0;
}

function FargateConfig({ config, setConfig, region }) {
  const p = getFargatePricing(region);
  if (!p) return <NotAvailable message={`No Fargate pricing for ${REGIONS[region]?.name || region}.`} />;

  const cpuCost = config.vcpu * p.vcpuPerHour * config.hours * config.tasks;
  const memCost = config.memoryGB * p.memPerGBHour * config.hours * config.tasks;
  const ephCost = Math.max(0, config.ephemeralGB - p.freeEphGB) * p.ephPerGBHour * config.hours * config.tasks;

  return (
    <div className="cfg-grid">
      <NumberInput label="vCPU per Task" value={config.vcpu} onChange={(v) => setConfig({ ...config, vcpu: v })} min={0.25} max={16} step={0.25} unit="vCPU" />
      <NumberInput label="Memory per Task" value={config.memoryGB} onChange={(v) => setConfig({ ...config, memoryGB: v })} min={0.5} max={120} step={0.5} unit="GB" />
      <NumberInput label="Ephemeral Storage" value={config.ephemeralGB} onChange={(v) => setConfig({ ...config, ephemeralGB: v })} min={20} max={200} unit="GB" />
      <NumberInput label="Number of Tasks" value={config.tasks} onChange={(v) => setConfig({ ...config, tasks: v })} min={1} />
      <NumberInput label="Hours / Month" value={config.hours} onChange={(v) => setConfig({ ...config, hours: v })} min={0} max={HOURS_PER_MONTH} unit="hrs" />
      <div className="cfg-result">
        <PriceLine label="vCPU" amount={cpuCost} />
        <PriceLine label="Memory" amount={memCost} />
        {ephCost > 0 && <PriceLine label="Ephemeral storage" amount={ephCost} />}
        <Divider />
        <PriceLine label="Monthly estimate" amount={cpuCost + memCost + ephCost} />
      </div>
    </div>
  );
}
function fargateCost(c, region) {
  const p = getFargatePricing(region);
  if (!p) return 0;
  return c.vcpu * p.vcpuPerHour * c.hours * c.tasks +
    c.memoryGB * p.memPerGBHour * c.hours * c.tasks +
    Math.max(0, c.ephemeralGB - p.freeEphGB) * p.ephPerGBHour * c.hours * c.tasks;
}

// ═══════════════════════════════════════════════════════════════════
// SageMaker Config
// ═══════════════════════════════════════════════════════════════════
function SageMakerConfig({ config, setConfig, region }) {
  const p = getSageMakerPricing(region);
  if (!p) return <NotAvailable message={`No SageMaker pricing for ${REGIONS[region]?.name || region}.`} />;

  const nbInsts = Object.keys(p.notebooks || {});
  const trInsts = Object.keys(p.training || {});
  const infInsts = Object.keys(p.inference || {});
  const nbCost = (p.notebooks?.[config.notebookInstance] || 0) * config.notebookHours;
  const trCost = (p.training?.[config.trainingInstance] || 0) * config.trainingHours * config.trainingCount;
  const infCost = (p.inference?.[config.inferenceInstance] || 0) * config.inferenceHours * config.inferenceCount;

  return (
    <div className="cfg-grid">
      <div className="section-label">Notebook Instances</div>
      <Select label="Instance" value={config.notebookInstance}
        onChange={(v) => setConfig({ ...config, notebookInstance: v })} options={nbInsts.length ? nbInsts : ["N/A"]} />
      <NumberInput label="Hours / month" value={config.notebookHours} onChange={(v) => setConfig({ ...config, notebookHours: v })} min={0} max={HOURS_PER_MONTH} />

      <div className="section-label">Training Jobs</div>
      <Select label="Instance" value={config.trainingInstance}
        onChange={(v) => setConfig({ ...config, trainingInstance: v })} options={trInsts.length ? trInsts : ["N/A"]} />
      <NumberInput label="Hours per Job" value={config.trainingHours} onChange={(v) => setConfig({ ...config, trainingHours: v })} min={0} />
      <NumberInput label="Jobs / month" value={config.trainingCount} onChange={(v) => setConfig({ ...config, trainingCount: v })} min={0} />

      <div className="section-label">Inference Endpoints</div>
      <Select label="Instance" value={config.inferenceInstance}
        onChange={(v) => setConfig({ ...config, inferenceInstance: v })} options={infInsts.length ? infInsts : ["N/A"]} />
      <NumberInput label="Hours / month" value={config.inferenceHours} onChange={(v) => setConfig({ ...config, inferenceHours: v })} min={0} max={HOURS_PER_MONTH} />
      <NumberInput label="Endpoints" value={config.inferenceCount} onChange={(v) => setConfig({ ...config, inferenceCount: v })} min={0} />

      <div className="cfg-result full-width">
        <PriceLine label="Notebooks" amount={nbCost} />
        <PriceLine label="Training" amount={trCost} />
        <PriceLine label="Inference" amount={infCost} />
        <Divider />
        <PriceLine label="Monthly estimate" amount={nbCost + trCost + infCost} />
      </div>
    </div>
  );
}
function sagemakerCost(c, region) {
  const p = getSageMakerPricing(region);
  if (!p) return 0;
  // Use same fallback as UI: first available instance if selected doesn't exist in region
  const nbKey = p.notebooks?.[c.notebookInstance] != null ? c.notebookInstance : Object.keys(p.notebooks || {})[0];
  const trKey = p.training?.[c.trainingInstance] != null ? c.trainingInstance : Object.keys(p.training || {})[0];
  const infKey = p.inference?.[c.inferenceInstance] != null ? c.inferenceInstance : Object.keys(p.inference || {})[0];
  return (p.notebooks?.[nbKey] || 0) * c.notebookHours +
    (p.training?.[trKey] || 0) * c.trainingHours * c.trainingCount +
    (p.inference?.[infKey] || 0) * c.inferenceHours * c.inferenceCount;
}


// ═══════════════════════════════════════════════════════════════════
// SERVICE REGISTRY
// ═══════════════════════════════════════════════════════════════════
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
// MAIN APP
// ═══════════════════════════════════════════════════════════════════
export default function App() {
  const [region, setRegion] = useState("eu-west-1");
  const [enabled, setEnabled] = useState(new Set(["ec2", "s3", "rds"]));
  const [active, setActive] = useState("ec2");
  const [configs, setConfigs] = useState(() => {
    const c = {};
    for (const k of SERVICE_KEYS) c[k] = { ...REGISTRY[k].default };
    return c;
  });
  const [showSummary, setShowSummary] = useState(false);

  const toggle = useCallback((key) => {
    setEnabled(prev => {
      const next = new Set(prev);
      if (next.has(key)) { next.delete(key); if (active === key && next.size > 0) setActive([...next][0]); }
      else { next.add(key); setActive(key); }
      return next;
    });
  }, [active]);

  const setCfg = useCallback((key, val) => {
    setConfigs(prev => ({ ...prev, [key]: val }));
  }, []);

  const costs = useMemo(() => {
    const c = {};
    let total = 0;
    for (const k of SERVICE_KEYS) {
      if (enabled.has(k)) {
        const amt = REGISTRY[k].cost(configs[k], region);
        c[k] = amt;
        total += amt;
      }
    }
    c._total = total;
    return c;
  }, [configs, enabled, region]);

  const grouped = useMemo(() => {
    const g = {};
    for (const cat of CATEGORY_ORDER) g[cat] = [];
    for (const k of SERVICE_KEYS) {
      const cat = SERVICE_META[k]?.category || "Other";
      if (!g[cat]) g[cat] = [];
      g[cat].push(k);
    }
    return g;
  }, []);

  const ActiveComp = active ? REGISTRY[active]?.component : null;
  const isGlobal = active === "cloudfront" || active === "route53";

  return (
    <div className="pw-root">
      {/* ── Header ── */}
      <header className="pw-header">
        <div className="pw-logo">
          <div className="pw-logo-icon">PW</div>
          <div>
            <h1>AWS Price<span>Wise</span></h1>
            <div className="pw-subtitle">On-Demand Pricing Calculator</div>
          </div>
        </div>
        <div className="pw-header-right">
          <select className="region-select" value={region} onChange={(e) => setRegion(e.target.value)}>
            {REGION_KEYS.map(r => (
              <option key={r} value={r}>{REGIONS[r].flag} {REGIONS[r].name}</option>
            ))}
          </select>
          <div className="pw-meta">
            {PRICING.meta.isFetched ? "Live data" : "Seed data"} · {PRICING.meta.lastUpdated?.slice(0, 10)}
          </div>
        </div>
      </header>

      {/* ── Body ── */}
      <div className="pw-body">
        {/* Sidebar */}
        <nav className="pw-sidebar">
          {CATEGORY_ORDER.map(cat => (
            <div key={cat}>
              <div className="pw-cat-label">{cat}</div>
              {grouped[cat]?.map(key => {
                const isEnabled = enabled.has(key);
                const isActive = active === key;
                return (
                  <button key={key} className={`pw-svc-btn ${isActive ? "active" : ""}`}
                    onClick={() => { if (isEnabled) setActive(key); else toggle(key); }}>
                    <div className={`svc-check ${isEnabled ? "on" : ""}`}
                      onClick={(e) => { e.stopPropagation(); toggle(key); }}>
                      {isEnabled && <svg viewBox="0 0 12 12" width="10" height="10" fill="none" stroke="#0c0e12" strokeWidth="2"><path d="M2 6l3 3 5-5" /></svg>}
                    </div>
                    <span className="svc-label">{SERVICE_META[key]?.label || key}</span>
                    {isEnabled && costs[key] > 0 && <span className="svc-cost">{fmt(costs[key])}</span>}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>

        {/* Main panel */}
        <main className="pw-main">
          {active && enabled.has(active) ? (
            <>
              <div className="pw-main-header">
                <h2>{SERVICE_META[active]?.label}<span>{SERVICE_META[active]?.category}</span></h2>
                <div className="pw-region-badge">
                  {isGlobal ? "Global (edge)" : `${REGIONS[region]?.flag} ${REGIONS[region]?.shortName}`}
                </div>
              </div>
              {ActiveComp && (
                <ActiveComp
                  config={configs[active]}
                  setConfig={(c) => setCfg(active, c)}
                  region={region}
                />
              )}
            </>
          ) : (
            <div className="pw-empty">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" width="48" height="48" opacity="0.3">
                <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                <path d="M3.27 6.96L12 12.01l8.73-5.05M12 22.08V12" />
              </svg>
              <span>Select a service from the sidebar to begin</span>
            </div>
          )}
        </main>
      </div>

      {/* ── Total Bar ── */}
      <footer className="pw-total-bar">
        <div className="pw-total-left">
          <span className="pw-total-label">Estimated Monthly Total</span>
          <span className="pw-total-amount">{fmt(costs._total)} <small>/month</small></span>
        </div>
        <button className="pw-summary-btn" onClick={() => setShowSummary(true)}>View Breakdown</button>
      </footer>

      {/* ── Summary Modal ── */}
      {showSummary && (
        <div className="pw-overlay" onClick={() => setShowSummary(false)}>
          <div className="pw-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Monthly Cost Breakdown — {REGIONS[region]?.name}</h3>
            {SERVICE_KEYS.filter(k => enabled.has(k)).map(key => (
              <div key={key} className="pw-modal-row">
                <span className="modal-svc">{SERVICE_META[key]?.label}</span>
                <span className="modal-amt">{fmt(costs[key])}</span>
              </div>
            ))}
            <div className="pw-modal-total">
              <span>Total</span>
              <span className="modal-amt total">{fmt(costs._total)}</span>
            </div>
            <div className="pw-modal-disclaimer">{PRICING.meta.disclaimer}</div>
            <button className="pw-modal-close" onClick={() => setShowSummary(false)}>Close</button>
          </div>
        </div>
      )}
    </div>
  );
}
