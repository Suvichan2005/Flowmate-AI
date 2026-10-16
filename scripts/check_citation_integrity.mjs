import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

console.log('[Citation Integrity Guard] Running research citation and experiment validation checks...');

let errorCount = 0;

function logError(msg) {
  console.error(`[Citation Integrity ERROR] ${msg}`);
  errorCount++;
}

const ciDir = path.join(rootDir, 'docs', 'competitive-intelligence');
if (!fs.existsSync(ciDir)) {
  console.log('======================================================================');
  console.log('[Citation Integrity Guard] Status: NOT APPLICABLE');
  console.log('  Reason: docs/competitive-intelligence omitted in public release candidate.');
  console.log('  Scope: 0 private research dossiers scanned.');
  console.log('  Classification: NOT APPLICABLE / SKIPPED (Not a citation PASS).');
  console.log('======================================================================');
  process.exit(0);
}

// 1. Authoritative canonical arXiv whitelist
const canonicalArxivMap = new Map([
  ['2310.08560', 'MemGPT: Towards LLMs as Operating Systems (Packer et al.)'],
  ['2405.14831', 'HippoRAG: Neurobiologically Inspired Long-Term Memory (Bernal et al.)'],
  ['2404.16130', 'From Local to Global: Graph RAG (Edge et al., Microsoft)'],
  ['2410.05779', 'LightRAG: Simple and Fast Retrieval-Augmented Generation (Guo et al.)'],
  ['2601.02845', 'TiMem: Temporal-Hierarchical Memory Consolidation (Zhang et al., ACL Findings 2026)'],
  ['2304.03442', 'Generative Agents: Interactive Simulacra of Human Behavior (Park et al.)'],
  ['2112.01488', 'ColBERTv2: Lightweight Late Interaction (Santhanam et al.)'],
  ['2304.09542', 'RankGPT: Listwise Reranker for IR (Sun et al.)'],
  ['2311.04934', 'Prompt Cache: Modular Attention Reuse (Gim et al.)'],
  ['2202.05262', 'Locating and Editing Factual Associations in GPT / ROME (Meng et al.)'],
  ['2409.05591', 'MemoRAG: Memory-Inspired Knowledge Discovery (Qian et al.)'],
  ['2505.24478', 'Optimizing Knowledge Graphs and LLMs / Cognee Benchmark (Marković et al.)'],
  ['2310.03052', 'Memoria: Resolving Fateful Forgetting (Park & Bak, ICML 2024 Spotlight)'],
  ['2007.11112', 'DBOS: A DBMS-Oriented Operating System (Stonebraker et al.)'],
  ['2501.13956', 'Graphiti: Dynamic Temporal Knowledge Graphs (Zep Research)'],
  ['2407.21075', 'Apple Intelligence Foundation Language Models (Apple Machine Learning Research)']
]);

// Banned / Hallucinated arXiv IDs discovered during forensic audit
const bannedArxivIds = [
  '2403.04567', // Boundary nucleation in physics (mislabeled as TiMem)
  '2310.03058', // Aphid populations in entomology (mislabeled as Memoria)
  '2502.04356', // Open foundation models in healthcare (mislabeled as Cognee)
  '2407.11985', // PaddleOCR marksheet parser (mislabeled as DBOS VLDB)
  '2406.18231', // Math recurrence (mislabeled as TiMem)
  '2410.05772'  // 3D forest stand canopy estimation (mislabeled as LightRAG)
];

// Helper to extract arXiv ID from string or URL (supporting HTML and DOI formats)
function extractArxivId(str) {
  if (!str) return null;
  const match = str.match(/arxiv\.org\/(?:abs|pdf|html)\/([0-9]{4}\.[0-9]{4,5})/i) ||
                str.match(/doi\.org\/10\.48550\/arXiv\.([0-9]{4}\.[0-9]{4,5})/i) ||
                str.match(/arXiv:\s*([0-9]{4}\.[0-9]{4,5})/i);
  return match ? match[1] : null;
}

// Helper to extract all arXiv IDs from a larger text block
function extractAllArxivIds(text) {
  if (!text) return [];
  const ids = new Set();
  const urlRegex = /arxiv\.org\/(?:abs|pdf|html)\/([0-9]{4}\.[0-9]{4,5})/gi;
  const doiRegex = /doi\.org\/10\.48550\/arXiv\.([0-9]{4}\.[0-9]{4,5})/gi;
  const tagRegex = /arXiv:\s*([0-9]{4}\.[0-9]{4,5})/gi;
  let match;
  while ((match = urlRegex.exec(text)) !== null) {
    ids.add(match[1]);
  }
  while ((match = doiRegex.exec(text)) !== null) {
    ids.add(match[1]);
  }
  while ((match = tagRegex.exec(text)) !== null) {
    ids.add(match[1]);
  }
  return Array.from(ids);
}

// 2. Scan all Markdown files in docs/competitive-intelligence/ for positive whitelist & banned IDs
console.log('[1/4] Scanning Markdown documentation with positive arXiv whitelist validation...');
function scanMarkdownFiles(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // Skip the audit report itself as it documents historical bad citations for provenance
      if (entry.name === 'audits') continue;
      scanMarkdownFiles(fullPath);
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      const content = fs.readFileSync(fullPath, 'utf8');
      const foundIds = extractAllArxivIds(content);
      for (const id of foundIds) {
        if (bannedArxivIds.includes(id)) {
          logError(`Forbidden hallucinated arXiv ID ${id} found in ${path.relative(rootDir, fullPath)}`);
        } else if (!canonicalArxivMap.has(id)) {
          logError(`Unwhitelisted scholarly arXiv ID ${id} found in ${path.relative(rootDir, fullPath)} without canonical registration`);
        }
      }
    }
  }
}
scanMarkdownFiles(path.join(rootDir, 'docs', 'competitive-intelligence'));

// 3. Audit all 51 Target JSON files
console.log('[2/4] Auditing all 51 competitive intelligence target dossiers (claims & source records)...');
const targetsDir = path.join(rootDir, 'docs', 'competitive-intelligence', 'targets');
const targetFiles = fs.readdirSync(targetsDir).filter(f => f.endsWith('.json'));

if (targetFiles.length < 51) {
  logError(`Expected at least 51 target dossiers, found ${targetFiles.length}`);
}

let totalClaimsAudited = 0;
let verifiedClaims = 0;
let corroboratedClaims = 0;
let hypothesisClaims = 0;

for (const file of targetFiles) {
  const filePath = path.join(targetsDir, file);
  let target;
  try {
    target = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    logError(`Invalid JSON in target dossier ${file}: ${err.message}`);
    continue;
  }

  if (!target.target_id || !target.name) {
    logError(`Target dossier ${file} missing target_id or name`);
  }

  // Audit source_records
  const sourceRecords = target.source_records || [];
  for (const src of sourceRecords) {
    const arxivId = extractArxivId(src.url) || extractArxivId(src.title);
    if (arxivId) {
      if (bannedArxivIds.includes(arxivId)) {
        logError(`Source record in ${file} cites banned arXiv ID ${arxivId}`);
      } else if (!canonicalArxivMap.has(arxivId)) {
        logError(`Source record in ${file} cites unverified non-whitelisted arXiv ID ${arxivId}`);
      }
    }
  }

  // Audit claims
  const claims = target.claims || [];
  for (const claim of claims) {
    totalClaimsAudited++;
    const { claim_id, statement, exact_url, verification_status, excerpt } = claim;

    if (!claim_id || !claim_id.startsWith('CLM-')) {
      logError(`Malformed claim ID "${claim_id}" in ${file}`);
    }

    if (!statement || statement.length < 10) {
      logError(`Claim ${claim_id} in ${file} has insufficient statement text`);
    }

    if (!exact_url || (!exact_url.startsWith('http://') && !exact_url.startsWith('https://'))) {
      logError(`Claim ${claim_id} in ${file} lacks valid HTTP/HTTPS exact_url: "${exact_url}"`);
    }

    // Check if arXiv cited in claim
    const arxivId = extractArxivId(exact_url);
    if (arxivId) {
      if (bannedArxivIds.includes(arxivId)) {
        logError(`Claim ${claim_id} in ${file} cites banned/hallucinated arXiv ID ${arxivId}`);
      }
      if (!canonicalArxivMap.has(arxivId)) {
        logError(`Claim ${claim_id} in ${file} cites unverified non-whitelisted arXiv ID ${arxivId}`);
      }
    }

    // Status accounting & unobservable internal architecture enforcement
    if (verification_status === 'Verified') {
      verifiedClaims++;
      const lower = statement.toLowerCase();
      if ((lower.includes('internal tool call') ||
           lower.includes('transition from prompt prefix caching to chunked rag') ||
           lower.includes('in under 100ms') ||
           lower.includes('sub-2s response latency') ||
           lower.includes('sub-50ms synchronization latency')) &&
          !exact_url.includes('arxiv.org') && !exact_url.includes('github.com/')) {
        logError(`Claim ${claim_id} in ${file} makes unobservable internal architecture/SLA claim but is marked "Verified". Must be "Corroborated" or "Hypothesis".`);
      }
    } else if (verification_status === 'Corroborated') {
      corroboratedClaims++;
    } else if (verification_status === 'Hypothesis' || verification_status === 'Unverified') {
      hypothesisClaims++;
    } else {
      logError(`Claim ${claim_id} in ${file} has unrecognized verification_status: "${verification_status}"`);
    }
  }
}

console.log(`Audited ${totalClaimsAudited} claims across ${targetFiles.length} targets:`);
console.log(`  - Verified: ${verifiedClaims}`);
console.log(`  - Corroborated: ${corroboratedClaims}`);
console.log(`  - Hypothesis / Unverified: ${hypothesisClaims}`);

// 4. Audit Research Graph Paper & Experiment Records
console.log('[3/4] Auditing research_dataset.json and compiled graph...');
const datasetPath = path.join(rootDir, 'docs', 'competitive-intelligence', 'research_dataset.json');
if (!fs.existsSync(datasetPath)) {
  logError(`Missing research_dataset.json. Run node scripts/compile_research_graph.mjs first.`);
} else {
  const dataset = JSON.parse(fs.readFileSync(datasetPath, 'utf8'));

  // Validate Academic Papers
  const papers = dataset.researchPapers || dataset.academicPapers || [];
  if (papers.length < 16) {
    logError(`Expected at least 16 academic paper cards, found ${papers.length}`);
  }

  for (const paper of papers) {
    const arxivId = extractArxivId(paper.arxivOrUrl || paper.venue);
    if (arxivId) {
      if (bannedArxivIds.includes(arxivId)) {
        logError(`Paper card ${paper.id} (${paper.title}) contains banned arXiv ID ${arxivId}`);
      }
      if (!canonicalArxivMap.has(arxivId)) {
        logError(`Paper card ${paper.id} contains non-whitelisted arXiv ID ${arxivId}`);
      }
    }
  }

  // Validate Experiments
  const experiments = dataset.controlledExperiments || [];
  if (experiments.length < 10) {
    logError(`Expected at least 10 experiment records, found ${experiments.length}`);
  }

  for (const exp of experiments) {
    if (exp.status === 'PASS') {
      const harnessPath = path.join(rootDir, exp.harnessFile);
      if (!fs.existsSync(harnessPath)) {
        logError(`Experiment ${exp.id} marked PASS but harness file ${exp.harnessFile} does not exist on disk!`);
      }
      if (exp.harnessFile.includes('Pending') || exp.measuredResult.includes('Pending') || exp.measuredResult.includes('Proposed')) {
        logError(`Experiment ${exp.id} marked PASS but contains pending/proposed markers: ${exp.measuredResult}`);
      }
    } else if (exp.status === 'PROPOSED' || exp.status === 'UNVERIFIED') {
      // Correctly flagged pending harness
    } else {
      logError(`Experiment ${exp.id} has invalid status "${exp.status}". Must be PASS, PROPOSED, or UNVERIFIED.`);
    }

    // Specifically enforce EXP-08, EXP-09, EXP-10 cannot be PASS until benchmark suites are coded
    if (['EXP-08', 'EXP-09', 'EXP-10'].includes(exp.id) && exp.status === 'PASS') {
      logError(`Experiment ${exp.id} cannot be marked PASS without dedicated standalone benchmark harness! Must be PROPOSED.`);
    }
  }
}

// 5. Audit Results Summary
console.log('[4/4] Evaluating integrity gates...');
if (errorCount > 0) {
  console.error(`\n[Citation Integrity Guard] FAILED with ${errorCount} integrity violations!`);
  process.exit(1);
} else {
  console.log(`\n[Citation Integrity Guard] ALL CHECKS PASSED. 0 integrity violations across papers, claims, and experiments.`);
  process.exit(0);
}
