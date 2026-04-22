#!/usr/bin/env node
/**
 * AWS PriceWise — Pricing Data Fetcher
 *
 * Downloads exact on-demand pricing from AWS's public Bulk Pricing API
 * and writes compact JSON files into public/data/.
 *
 * Usage:
 *   node scripts/fetch-pricing.mjs                # Fetch all services
 *   node scripts/fetch-pricing.mjs --service ec2   # Fetch one service
 *   node scripts/fetch-pricing.mjs --region eu-west-1  # Fetch one region
 *
 * AWS Bulk Pricing API base:
 *   https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/
 *
 * No AWS credentials required — this is a public, unauthenticated API.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import https from "https";
import { createGunzip } from "zlib";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.join(__dirname, "..", "src", "data", "generated");

// ─── Target Regions ──────────────────────────────────────────────────
const TARGET_REGIONS = [
  "us-east-1",
  "eu-west-1",
  "eu-west-2",
  "eu-west-3",
  "eu-central-1",
  "eu-central-2",
  "eu-north-1",
  "eu-south-1",
  "eu-south-2",
  "ca-central-1",
  "ca-west-1",
];

const REGION_NAMES = {
  "us-east-1": "US East (N. Virginia)",
  "eu-west-1": "Europe (Ireland)",
  "eu-west-2": "Europe (London)",
  "eu-west-3": "Europe (Paris)",
  "eu-central-1": "Europe (Frankfurt)",
  "eu-central-2": "Europe (Zurich)",
  "eu-north-1": "Europe (Stockholm)",
  "eu-south-1": "Europe (Milan)",
  "eu-south-2": "Europe (Spain)",
  "ca-central-1": "Canada (Central)",
  "ca-west-1": "Canada West (Calgary)",
};

// ─── AWS Pricing API helpers ─────────────────────────────────────────

const PRICING_BASE = "https://pricing.us-east-1.amazonaws.com";

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    const options = {
      headers: { "Accept-Encoding": "gzip" },
    };
    https
      .get(url, options, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return httpsGet(res.headers.location).then(resolve, reject);
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        }

        let stream = res;
        if (res.headers["content-encoding"] === "gzip") {
          stream = res.pipe(createGunzip());
        }

        const chunks = [];
        stream.on("data", (c) => chunks.push(c));
        stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
        stream.on("error", reject);
      })
      .on("error", reject);
  });
}

async function fetchJSON(url) {
  const text = await httpsGet(url);
  return JSON.parse(text);
}

// ─── Service fetchers ────────────────────────────────────────────────

const OS_MAP = {
  Linux: "linux",
  Windows: "windows",
  RHEL: "rhel",
  SUSE: "suse",
  "Red Hat Enterprise Linux": "rhel",
  "Red Hat Enterprise Linux with HA": "rhel_ha",
  "SUSE Linux": "suse",
  "Ubuntu Pro": "ubuntu_pro",
};

function parseHourlyPrice(terms, sku) {
  const onDemand = terms?.OnDemand?.[sku];
  if (!onDemand) return null;
  const offerKey = Object.keys(onDemand)[0];
  if (!offerKey) return null;
  const dims = onDemand[offerKey]?.priceDimensions;
  if (!dims) return null;
  const dimKey = Object.keys(dims)[0];
  if (!dimKey) return null;
  const usd = parseFloat(dims[dimKey]?.pricePerUnit?.USD);
  return isNaN(usd) ? null : usd;
}

async function fetchEC2(region) {
  console.log(`  [EC2] Fetching ${region}...`);
  const url = `${PRICING_BASE}/offers/v1.0/aws/AmazonEC2/current/${region}/index.json`;
  const data = await fetchJSON(url);

  const instances = {};

  for (const [sku, product] of Object.entries(data.products || {})) {
    const attr = product.attributes || {};

    // Only Compute instances, shared tenancy, on-demand, no pre-installed SW
    if (
      attr.servicecode !== "AmazonEC2" ||
      product.productFamily !== "Compute Instance" ||
      attr.tenancy !== "Shared" ||
      attr.capacitystatus !== "Used" ||
      (attr.preInstalledSw && attr.preInstalledSw !== "NA")
    )
      continue;

    const instanceType = attr.instanceType;
    const osRaw = attr.operatingSystem;
    const osKey = OS_MAP[osRaw];
    if (!instanceType || !osKey) continue;

    const price = parseHourlyPrice(data.terms, sku);
    if (price === null || price === 0) continue;

    if (!instances[instanceType]) {
      instances[instanceType] = {
        vcpu: parseInt(attr.vcpu) || 0,
        memory: parseFloat(attr.memory?.replace(" GiB", "").replace(",", "")) || 0,
        prices: {},
      };
    }
    instances[instanceType].prices[osKey] = price;
  }

  return instances;
}

async function fetchLambda(region) {
  console.log(`  [Lambda] Fetching ${region}...`);
  const url = `${PRICING_BASE}/offers/v1.0/aws/AWSLambda/current/${region}/index.json`;
  const data = await fetchJSON(url);

  const result = {
    requestPrice: null,
    durationPriceGB: null,
    armRequestPrice: null,
    armDurationPriceGB: null,
  };

  for (const [sku, product] of Object.entries(data.products || {})) {
    const attr = product.attributes || {};
    const group = attr.group;
    const price = parseHourlyPrice(data.terms, sku);
    if (price === null) continue;

    if (group === "AWS-Lambda-Requests" && !attr.usagetype?.includes("ARM")) {
      result.requestPrice = price;
    } else if (group === "AWS-Lambda-Duration" && !attr.usagetype?.includes("ARM")) {
      result.durationPriceGB = price;
    } else if (group === "AWS-Lambda-Requests" && attr.usagetype?.includes("ARM")) {
      result.armRequestPrice = price;
    } else if (group === "AWS-Lambda-Duration" && attr.usagetype?.includes("ARM")) {
      result.armDurationPriceGB = price;
    }
  }

  return result;
}

async function fetchRDS(region) {
  console.log(`  [RDS] Fetching ${region}...`);
  const url = `${PRICING_BASE}/offers/v1.0/aws/AmazonRDS/current/${region}/index.json`;
  const data = await fetchJSON(url);

  const ENGINE_MAP = {
    MySQL: "mysql",
    PostgreSQL: "postgres",
    MariaDB: "mariadb",
    Oracle: "oracle",
    "SQL Server": "sqlserver",
    Aurora: null, // skip aurora in RDS
  };

  const instances = {};
  const storage = {};

  for (const [sku, product] of Object.entries(data.products || {})) {
    const attr = product.attributes || {};
    const price = parseHourlyPrice(data.terms, sku);
    if (price === null) continue;

    if (product.productFamily === "Database Instance") {
      const instanceType = attr.instanceType;
      const dbEngine = attr.databaseEngine;
      const deployment = attr.deploymentOption; // Single-AZ or Multi-AZ
      const engineKey = ENGINE_MAP[dbEngine];
      if (!instanceType || !engineKey) continue;
      if (dbEngine?.includes("Aurora")) continue;

      const isSingleAZ = deployment === "Single-AZ";
      if (!isSingleAZ) continue; // store single-AZ prices, derive multi-AZ

      if (!instances[instanceType]) {
        instances[instanceType] = {
          vcpu: parseInt(attr.vcpu) || 0,
          memory: parseFloat(attr.memory?.replace(" GiB", "").replace(",", "")) || 0,
          prices: {},
        };
      }
      instances[instanceType].prices[engineKey] = price;
    }

    if (product.productFamily === "Database Storage") {
      const volType = attr.volumeType;
      if (volType && price > 0) {
        storage[volType] = price;
      }
    }
  }

  return { instances, storage };
}

async function fetchAurora(region) {
  console.log(`  [Aurora] Fetching ${region}...`);
  const url = `${PRICING_BASE}/offers/v1.0/aws/AmazonRDS/current/${region}/index.json`;
  const data = await fetchJSON(url);

  const instances = {};
  let storagePerGB = null;
  let ioPerMillion = null;

  for (const [sku, product] of Object.entries(data.products || {})) {
    const attr = product.attributes || {};
    const price = parseHourlyPrice(data.terms, sku);
    if (price === null) continue;

    if (product.productFamily === "Database Instance" && attr.databaseEngine?.includes("Aurora")) {
      const instanceType = attr.instanceType;
      if (!instanceType) continue;
      const isMysql = attr.databaseEngine.includes("MySQL");
      const isPostgres = attr.databaseEngine.includes("PostgreSQL");
      const deployment = attr.deploymentOption;
      if (deployment !== "Single-AZ") continue;

      if (!instances[instanceType]) {
        instances[instanceType] = {
          vcpu: parseInt(attr.vcpu) || 0,
          memory: parseFloat(attr.memory?.replace(" GiB", "").replace(",", "")) || 0,
          prices: {},
        };
      }
      if (isMysql) instances[instanceType].prices.mysql = price;
      if (isPostgres) instances[instanceType].prices.postgres = price;
    }

    if (product.productFamily === "Database Storage" && attr.databaseEngine?.includes("Aurora")) {
      if (attr.usagetype?.includes("Aurora:StorageUsage")) {
        storagePerGB = price;
      }
    }

    if (product.productFamily === "System Operation" && attr.databaseEngine?.includes("Aurora")) {
      if (attr.group === "Aurora I/O Operation") {
        ioPerMillion = price * 1000000;
      }
    }
  }

  return { instances, storagePerGB, ioPerMillion };
}

async function fetchEBS(region) {
  console.log(`  [EBS] Fetching ${region}...`);
  const url = `${PRICING_BASE}/offers/v1.0/aws/AmazonEC2/current/${region}/index.json`;
  const data = await fetchJSON(url);

  const volumes = {};
  let snapshotPrice = null;

  for (const [sku, product] of Object.entries(data.products || {})) {
    const attr = product.attributes || {};
    const price = parseHourlyPrice(data.terms, sku);
    if (price === null || price === 0) continue;

    if (product.productFamily === "Storage") {
      const volType = attr.volumeApiName || attr.volumeType;
      if (volType && !volumes[volType]) {
        volumes[volType] = { pricePerGB: price };
      }
    }

    if (product.productFamily === "Storage Snapshot") {
      snapshotPrice = price;
    }
  }

  return { volumes, snapshotPrice };
}

async function fetchS3(region) {
  console.log(`  [S3] Fetching ${region}...`);
  const url = `${PRICING_BASE}/offers/v1.0/aws/AmazonS3/current/${region}/index.json`;
  const data = await fetchJSON(url);

  const storage = {};
  const requests = {};

  for (const [sku, product] of Object.entries(data.products || {})) {
    const attr = product.attributes || {};
    const price = parseHourlyPrice(data.terms, sku);
    if (price === null) continue;

    if (product.productFamily === "Storage") {
      const tier = attr.volumeType || attr.storageClass;
      if (tier) storage[tier] = price;
    }

    if (product.productFamily === "API Request") {
      const group = attr.group;
      if (group) requests[group] = price;
    }
  }

  return { storage, requests };
}

async function fetchElastiCache(region) {
  console.log(`  [ElastiCache] Fetching ${region}...`);
  const url = `${PRICING_BASE}/offers/v1.0/aws/AmazonElastiCache/current/${region}/index.json`;
  const data = await fetchJSON(url);

  const nodes = {};

  for (const [sku, product] of Object.entries(data.products || {})) {
    const attr = product.attributes || {};
    const price = parseHourlyPrice(data.terms, sku);
    if (price === null || price === 0) continue;

    if (product.productFamily === "Cache Instance") {
      const nodeType = attr.instanceType;
      const engine = attr.cacheEngine;
      if (!nodeType) continue;

      if (!nodes[nodeType]) {
        nodes[nodeType] = {
          vcpu: parseInt(attr.vcpu) || 0,
          memory: parseFloat(attr.memory?.replace(" GiB", "").replace(",", "")) || 0,
          prices: {},
        };
      }
      if (engine) nodes[nodeType].prices[engine.toLowerCase()] = price;
    }
  }

  return { nodes };
}

async function fetchFargate(region) {
  console.log(`  [Fargate] Fetching ${region}...`);
  const url = `${PRICING_BASE}/offers/v1.0/aws/AmazonECS/current/${region}/index.json`;
  const data = await fetchJSON(url);

  const result = { vcpuPerHour: null, memoryPerGBHour: null };

  for (const [sku, product] of Object.entries(data.products || {})) {
    const attr = product.attributes || {};
    const price = parseHourlyPrice(data.terms, sku);
    if (price === null || price === 0) continue;

    if (attr.usagetype?.includes("Fargate-vCPU") && !attr.usagetype?.includes("Spot")) {
      result.vcpuPerHour = price;
    }
    if (attr.usagetype?.includes("Fargate-GB") && !attr.usagetype?.includes("Spot")) {
      result.memoryPerGBHour = price;
    }
  }

  return result;
}

async function fetchEKS(region) {
  console.log(`  [EKS] Fetching ${region}...`);
  const url = `${PRICING_BASE}/offers/v1.0/aws/AmazonEKS/current/${region}/index.json`;
  const data = await fetchJSON(url);

  let clusterHourly = null;

  for (const [sku, product] of Object.entries(data.products || {})) {
    const price = parseHourlyPrice(data.terms, sku);
    if (price !== null && price > 0) {
      clusterHourly = price;
      break;
    }
  }

  return { clusterHourly };
}

async function fetchSageMaker(region) {
  console.log(`  [SageMaker] Fetching ${region}...`);
  const url = `${PRICING_BASE}/offers/v1.0/aws/AmazonSageMaker/current/${region}/index.json`;
  const data = await fetchJSON(url);

  const notebooks = {};
  const training = {};
  const inference = {};

  for (const [sku, product] of Object.entries(data.products || {})) {
    const attr = product.attributes || {};
    const price = parseHourlyPrice(data.terms, sku);
    if (price === null || price === 0) continue;

    const instanceType = attr.instanceType || attr.instanceName;
    if (!instanceType) continue;

    const usage = attr.usagetype || "";
    const component = attr.component || "";

    if (usage.includes("Notebook") || component.includes("Notebook")) {
      notebooks[instanceType] = price;
    } else if (usage.includes("Training") || component.includes("Training")) {
      training[instanceType] = price;
    } else if (usage.includes("Host") || component.includes("Hosting") || usage.includes("Endpoint")) {
      inference[instanceType] = price;
    }
  }

  return { notebooks, training, inference };
}

// ─── Main fetch orchestrator ─────────────────────────────────────────

async function fetchAll(targetRegions, targetServices) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const allData = {
    meta: {
      fetchedAt: new Date().toISOString(),
      regions: {},
      type: "On-Demand",
    },
    ec2: {},
    lambda: {},
    s3: {},
    ebs: {},
    rds: {},
    aurora: {},
    elasticache: {},
    fargate: {},
    eks: {},
    sagemaker: {},
  };

  for (const region of targetRegions) {
    allData.meta.regions[region] = REGION_NAMES[region] || region;
    console.log(`\n═══ ${REGION_NAMES[region] || region} (${region}) ═══`);

    const services = targetServices || ["ec2", "lambda", "s3", "ebs", "rds", "aurora", "elasticache", "fargate", "eks", "sagemaker"];

    for (const svc of services) {
      try {
        switch (svc) {
          case "ec2":
            allData.ec2[region] = await fetchEC2(region);
            break;
          case "lambda":
            allData.lambda[region] = await fetchLambda(region);
            break;
          case "s3":
            allData.s3[region] = await fetchS3(region);
            break;
          case "ebs":
            allData.ebs[region] = await fetchEBS(region);
            break;
          case "rds":
            allData.rds[region] = await fetchRDS(region);
            break;
          case "aurora":
            allData.aurora[region] = await fetchAurora(region);
            break;
          case "elasticache":
            allData.elasticache[region] = await fetchElastiCache(region);
            break;
          case "fargate":
            allData.fargate[region] = await fetchFargate(region);
            break;
          case "eks":
            allData.eks[region] = await fetchEKS(region);
            break;
          case "sagemaker":
            allData.sagemaker[region] = await fetchSageMaker(region);
            break;
        }
      } catch (err) {
        console.error(`  ✗ ${svc}: ${err.message}`);
        allData[svc][region] = { error: err.message };
      }
    }
  }

  // Write individual service files for flexibility
  for (const [svc, regionData] of Object.entries(allData)) {
    if (svc === "meta") continue;
    const outPath = path.join(OUTPUT_DIR, `${svc}.json`);
    fs.writeFileSync(outPath, JSON.stringify(regionData, null, 2));
    const count = Object.keys(regionData).length;
    console.log(`\n  ✓ Wrote ${outPath} (${count} regions)`);
  }

  // Write meta
  fs.writeFileSync(path.join(OUTPUT_DIR, "meta.json"), JSON.stringify(allData.meta, null, 2));

  // Write combined file
  const combinedPath = path.join(OUTPUT_DIR, "all-pricing.json");
  fs.writeFileSync(combinedPath, JSON.stringify(allData, null, 2));
  console.log(`\n✓ Combined pricing written to ${combinedPath}`);
  console.log(`  Total size: ${(fs.statSync(combinedPath).size / 1024 / 1024).toFixed(1)} MB`);

  // Generate TypeScript/JS module
  generateModule(allData);
}

function generateModule(data) {
  const modulePath = path.join(OUTPUT_DIR, "index.js");
  const code = `// Auto-generated by fetch-pricing.mjs at ${data.meta.fetchedAt}
// Do not edit manually — re-run: npm run fetch-pricing
export const FETCHED_PRICING = ${JSON.stringify(data, null, 2)};
`;
  fs.writeFileSync(modulePath, code);
  console.log(`  ✓ Generated JS module: ${modulePath}`);
}

// ─── CLI ─────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
let regions = [...TARGET_REGIONS];
let services = null;

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--region" && args[i + 1]) {
    regions = [args[i + 1]];
    i++;
  }
  if (args[i] === "--service" && args[i + 1]) {
    services = [args[i + 1]];
    i++;
  }
}

console.log("╔══════════════════════════════════════════════╗");
console.log("║  AWS PriceWise — Pricing Data Fetcher       ║");
console.log("║  Source: AWS Public Bulk Pricing API         ║");
console.log("║  No credentials required                    ║");
console.log("╚══════════════════════════════════════════════╝");
console.log(`\nTarget regions: ${regions.join(", ")}`);
console.log(`Services: ${services ? services.join(", ") : "all"}`);
console.log(`Output: ${OUTPUT_DIR}\n`);

fetchAll(regions, services)
  .then(() => {
    console.log("\n✅ Pricing fetch complete!");
    console.log("   Run `npm run dev` to start the calculator.\n");
  })
  .catch((err) => {
    console.error("\n❌ Fatal error:", err);
    process.exit(1);
  });
