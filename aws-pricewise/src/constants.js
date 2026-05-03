// ═══════════════════════════════════════════════════════════════════════
// AWS PriceWise — Region & Service Constants
// ═══════════════════════════════════════════════════════════════════════

export const REGIONS = {
  "us-east-1":    { name: "US East (N. Virginia)",  shortName: "N. Virginia",  flag: "🇺🇸" },
  "ca-central-1": { name: "Canada (Central)",       shortName: "Canada",       flag: "🇨🇦" },
  "ca-west-1":    { name: "Canada West (Calgary)",  shortName: "Calgary",      flag: "🇨🇦" },
  "eu-west-1":    { name: "Europe (Ireland)",        shortName: "Ireland",      flag: "🇮🇪" },
  "eu-west-2":    { name: "Europe (London)",         shortName: "London",       flag: "🇬🇧" },
  "eu-west-3":    { name: "Europe (Paris)",          shortName: "Paris",        flag: "🇫🇷" },
  "eu-central-1": { name: "Europe (Frankfurt)",      shortName: "Frankfurt",    flag: "🇩🇪" },
  "eu-central-2": { name: "Europe (Zurich)",         shortName: "Zurich",       flag: "🇨🇭" },
  "eu-north-1":   { name: "Europe (Stockholm)",      shortName: "Stockholm",    flag: "🇸🇪" },
  "eu-south-1":   { name: "Europe (Milan)",          shortName: "Milan",        flag: "🇮🇹" },
  "eu-south-2":   { name: "Europe (Spain)",          shortName: "Spain",        flag: "🇪🇸" },
};

export const REGION_KEYS = Object.keys(REGIONS);

export const HOURS_PER_MONTH = 730;

export const SERVICE_KEYS = [
  "ec2", "lambda", "s3", "ebs", "efs",
  "rds", "aurora", "dynamodb", "elasticache",
  "vpc", "cloudfront", "route53",
  "ecs", "eks", "fargate", "sagemaker",
];

export const SERVICE_META = {
  ec2:          { label: "Amazon EC2",          category: "Compute"    },
  lambda:       { label: "AWS Lambda",          category: "Compute"    },
  s3:           { label: "Amazon S3",           category: "Storage"    },
  ebs:          { label: "Amazon EBS",          category: "Storage"    },
  efs:          { label: "Amazon EFS",          category: "Storage"    },
  rds:          { label: "Amazon RDS",          category: "Database"   },
  aurora:       { label: "Amazon Aurora",       category: "Database"   },
  dynamodb:     { label: "Amazon DynamoDB",     category: "Database"   },
  elasticache:  { label: "Amazon ElastiCache",  category: "Database"   },
  vpc:          { label: "Amazon VPC",          category: "Networking" },
  cloudfront:   { label: "Amazon CloudFront",   category: "Networking" },
  route53:      { label: "Amazon Route 53",     category: "Networking" },
  ecs:          { label: "Amazon ECS",          category: "Container"  },
  eks:          { label: "Amazon EKS",          category: "Container"  },
  fargate:      { label: "AWS Fargate",         category: "Container"  },
  sagemaker:    { label: "Amazon SageMaker",    category: "ML"         },
};

export const CATEGORY_ORDER = ["Compute", "Storage", "Database", "Networking", "Container", "ML"];

export const OS_OPTIONS = [
  { value: "linux",      label: "Linux" },
  { value: "windows",    label: "Windows" },
  { value: "rhel",       label: "RHEL" },
  { value: "suse",       label: "SUSE Linux" },
];
