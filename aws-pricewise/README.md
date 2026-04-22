# AWS PriceWise

A zero-hallucination, offline-first AWS on-demand pricing calculator.

All pricing data is pre-downloaded and stored locally — **no external API calls at runtime**. If a price is not in the dataset, the app explicitly says: *"Pricing not available in current dataset."*

## Quick Start

```bash
npm install
npm run dev        # Start dev server on :3000
```

## Regions Covered

| Code | Region |
|------|--------|
| `us-east-1` | US East (N. Virginia) |
| `eu-west-1` | Europe (Ireland) |
| `eu-west-2` | Europe (London) |
| `eu-west-3` | Europe (Paris) |
| `eu-central-1` | Europe (Frankfurt) |
| `eu-central-2` | Europe (Zurich) |
| `eu-north-1` | Europe (Stockholm) |
| `eu-south-1` | Europe (Milan) |
| `eu-south-2` | Europe (Spain) |
| `ca-central-1` | Canada (Central) |
| `ca-west-1` | Canada West (Calgary) |

## Services Covered

| Category | Services |
|----------|----------|
| **Compute** | EC2 (all OS: Linux, Windows, RHEL, SUSE), Lambda |
| **Storage** | S3, EBS, EFS |
| **Database** | RDS, Aurora, DynamoDB, ElastiCache |
| **Networking** | VPC, CloudFront, Route 53 |
| **Container** | ECS, EKS, Fargate |
| **ML** | SageMaker |

## Fetching Latest Exact Pricing

The app ships with seed pricing data (verified March 2025). To download the **latest exact pricing** directly from AWS's public Bulk Pricing API:

```bash
npm run fetch-pricing
```

This requires no AWS credentials — it uses the public, unauthenticated AWS pricing API at `pricing.us-east-1.amazonaws.com`. It downloads and processes pricing for all 11 regions and all supported services.

**Options:**
```bash
# Fetch only one region
npm run fetch-pricing -- --region eu-west-1

# Fetch only one service
npm run fetch-pricing -- --service ec2
```

The fetcher writes processed JSON to `src/data/generated/` and generates a JS module that the app automatically imports when available.

**Note:** EC2 pricing files from AWS are large (100MB+ per region). The full fetch may take 10-20 minutes depending on bandwidth.

## EC2 Instance Coverage

The seed dataset includes these instance families:

- **Burstable:** t3, t3a
- **General Purpose:** m5, m6i, m6g, m7i
- **Compute Optimized:** c5, c6i, c6g, c7i
- **Memory Optimized:** r5, r6i, r6g
- **Storage Optimized:** i3, i4i
- **Accelerated (GPU):** g4dn, g5, p3

After running `npm run fetch-pricing`, **every** instance type available in each region will be included.

## Architecture

```
src/
├── main.jsx              # React entry
├── App.jsx               # Main calculator (all service configs)
├── App.css               # Dark engineering-tool theme
├── constants.js          # Regions, service metadata
└── data/
    ├── pricing.js        # Seed data + accessor helpers
    └── generated/        # Output from fetch-pricing.mjs (gitignored)

scripts/
└── fetch-pricing.mjs     # Downloads from AWS Bulk Pricing API
```

## Design Principles

1. **Zero hallucination**: Every displayed price comes from the embedded dataset. Missing = explicit warning.
2. **Offline-first**: No runtime network calls. All pricing is bundled or pre-fetched.
3. **Exact pricing**: Seed data from AWS pricing pages; `fetch-pricing` pulls from the canonical source.
4. **On-Demand only**: No Reserved Instance, Savings Plan, or Spot pricing to avoid confusion.

## Build for Production

```bash
npm run build
npm run preview   # Preview the build
```

Output goes to `dist/`.

## License

MIT
