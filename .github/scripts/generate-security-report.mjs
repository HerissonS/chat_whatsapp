#!/usr/bin/env node
/**
 * Consolida os artefatos JSON e SBOMs CycloneDX da Pipeline 1 (DevSecOps CI/CD)
 * e gera um relatorio executivo em Markdown para o GitHub Actions Job Summary
 * ($GITHUB_STEP_SUMMARY) e para comentario consolidado em Pull Requests.
 *
 * Sem dependencias externas (Node.js 24+ nativo). Sem upload SARIF.
 */

import fs from 'node:fs';
import path from 'node:path';

const ARTIFACTS_DIR = process.env.ARTIFACTS_DIR || './all-artifacts';
const OUTPUT_SUMMARY = process.env.OUTPUT_SUMMARY || process.env.GITHUB_STEP_SUMMARY || '';
const OUTPUT_PR_COMMENT = process.env.OUTPUT_PR_COMMENT || '';
const EVENT_NAME = process.env.EVENT_NAME || 'unknown';
const GIT_SHA = process.env.GIT_SHA || '';
const SHORT_SHA = GIT_SHA.slice(0, 7);
const GIT_REF = process.env.GIT_REF || '';
const REPO_FULL_NAME = process.env.REPO_FULL_NAME || '';
const RUN_URL = process.env.RUN_URL || '';

function findFile(filename) {
  if (!fs.existsSync(ARTIFACTS_DIR)) return null;
  const stack = [ARTIFACTS_DIR];
  while (stack.length > 0) {
    const dir = stack.pop();
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.name === filename) {
        return full;
      }
    }
  }
  return null;
}

function readJson(filename) {
  const filePath = findFile(filename);
  if (!filePath) return null;
  try {
    const raw = fs.readFileSync(filePath, 'utf8').trim();
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function statusBadge(result) {
  switch ((result || '').toLowerCase()) {
    case 'success':
      return '✅ Aprovado';
    case 'failure':
      return '❌ Falhou';
    case 'cancelled':
      return '🚫 Cancelado';
    case 'skipped':
      return '⏭️ Ignorado';
    default:
      return `ℹ️ ${result || 'N/A'}`;
  }
}

function summarizeTrivyVulns(report) {
  const counts = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, fixableHighCrit: 0, secrets: 0 };
  const topFindings = [];
  if (!report || !Array.isArray(report.Results)) return { counts, topFindings, available: false };

  for (const res of report.Results) {
    if (Array.isArray(res.Vulnerabilities)) {
      for (const v of res.Vulnerabilities) {
        const sev = (v.Severity || 'UNKNOWN').toUpperCase();
        if (sev in counts) counts[sev] += 1;
        const fixable = Boolean(v.FixedVersion && String(v.FixedVersion).trim() !== '');
        if (fixable && (sev === 'CRITICAL' || sev === 'HIGH')) {
          counts.fixableHighCrit += 1;
          topFindings.push({
            id: v.VulnerabilityID,
            pkg: v.PkgName,
            installed: v.InstalledVersion,
            fixed: v.FixedVersion,
            severity: sev,
            target: res.Target || '',
          });
        }
      }
    }
    if (Array.isArray(res.Secrets)) {
      counts.secrets += res.Secrets.length;
    }
  }
  return { counts, topFindings, available: true };
}

function summarizeTrivyConfig(report) {
  const counts = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
  const topFindings = [];
  if (!report || !Array.isArray(report.Results)) return { counts, topFindings, available: false };

  for (const res of report.Results) {
    if (!Array.isArray(res.Misconfigurations)) continue;
    for (const m of res.Misconfigurations) {
      if (m.Status && m.Status !== 'FAIL') continue;
      const sev = (m.Severity || 'UNKNOWN').toUpperCase();
      if (sev in counts) counts[sev] += 1;
      if (sev === 'CRITICAL' || sev === 'HIGH') {
        topFindings.push({
          id: m.ID || m.AVDID,
          title: m.Title,
          severity: sev,
          target: res.Target || '',
        });
      }
    }
  }
  return { counts, topFindings, available: true };
}

function summarizeSemgrep(report) {
  const counts = { ERROR: 0, WARNING: 0, INFO: 0 };
  const topFindings = [];
  if (!report || !Array.isArray(report.results)) return { counts, topFindings, available: false };

  for (const item of report.results) {
    const sev = (item.extra?.severity || 'INFO').toUpperCase();
    if (sev in counts) counts[sev] += 1;
    if (sev === 'ERROR' || sev === 'WARNING') {
      topFindings.push({
        rule: item.check_id,
        severity: sev,
        path: item.path,
        line: item.start?.line || 0,
        message: (item.extra?.message || '').replace(/\s+/g, ' ').slice(0, 140),
      });
    }
  }
  return { counts, topFindings, available: true };
}

function summarizeHadolint(filename) {
  const data = readJson(filename);
  const counts = { error: 0, warning: 0, info: 0, style: 0 };
  const findings = [];
  if (!Array.isArray(data)) return { counts, findings, available: false };
  for (const f of data) {
    const lvl = (f.level || 'info').toLowerCase();
    if (lvl in counts) counts[lvl] += 1;
    if (lvl === 'error' || lvl === 'warning') {
      findings.push({ code: f.code, level: lvl, line: f.line, message: f.message });
    }
  }
  return { counts, findings, available: true };
}

function summarizeSbom(filename) {
  const data = readJson(filename);
  if (!data) return null;
  return {
    specVersion: data.specVersion || 'N/A',
    components: Array.isArray(data.components) ? data.components.length : 0,
    serialNumber: data.serialNumber || 'N/A',
  };
}

// Coleta resultados
const gitleaksRaw = readJson('gitleaks-report.json');
const gitleaksCount = Array.isArray(gitleaksRaw) ? gitleaksRaw.length : null;

const semgrep = summarizeSemgrep(readJson('semgrep-report.json'));
const trivyFsBackend = summarizeTrivyVulns(readJson('trivy-fs-backend.json'));
const trivyFsFrontend = summarizeTrivyVulns(readJson('trivy-fs-frontend.json'));
const trivyConfig = summarizeTrivyConfig(readJson('trivy-config.json'));

const hadolint = {
  backend: summarizeHadolint('hadolint-backend.json'),
  frontend: summarizeHadolint('hadolint-frontend.json'),
  backup: summarizeHadolint('hadolint-backup.json'),
};

const imageScans = {
  backend: summarizeTrivyVulns(readJson('trivy-image-backend.json')),
  frontend: summarizeTrivyVulns(readJson('trivy-image-frontend.json')),
  backup: summarizeTrivyVulns(readJson('trivy-image-backup.json')),
};

const sboms = [
  { scope: 'App: backend (npm)', file: 'sbom-backend.cdx.json', info: summarizeSbom('sbom-backend.cdx.json') },
  { scope: 'App: frontend (npm)', file: 'sbom-frontend.cdx.json', info: summarizeSbom('sbom-frontend.cdx.json') },
  { scope: 'Image: backend', file: 'sbom-image-backend.cdx.json', info: summarizeSbom('sbom-image-backend.cdx.json') },
  { scope: 'Image: frontend', file: 'sbom-image-frontend.cdx.json', info: summarizeSbom('sbom-image-frontend.cdx.json') },
  { scope: 'Image: backup', file: 'sbom-image-backup.cdx.json', info: summarizeSbom('sbom-image-backup.cdx.json') },
];

const publishedImages = readJson('published-images.json');

const stages = [
  { id: '1', name: 'Secrets & Unit Tests (Gitleaks + Build + Tests)', status: process.env.JOB_STATUS_SECRETS },
  { id: '2', name: 'SAST — Análise Estática (Semgrep)', status: process.env.JOB_STATUS_SAST },
  { id: '3', name: 'SCA & SBOM (Trivy FS + CycloneDX)', status: process.env.JOB_STATUS_SCA },
  { id: '4', name: 'Misconfiguration & Lint (Trivy Config + Hadolint)', status: process.env.JOB_STATUS_MISCONFIG },
  { id: '5', name: 'Image Build & Scan (3 imagens + Trivy Image + SBOM)', status: process.env.JOB_STATUS_IMAGES },
  { id: '6', name: 'Publish Multi-Arch & Cosign Sign (GHCR — merge main)', status: process.env.JOB_STATUS_PUBLISH },
];

const lines = [];
lines.push('<!-- devsecops-security-report -->');
lines.push('# 🛡️ Relatório DevSecOps — `chat_whatsapp`');
lines.push('');
lines.push(`- **Evento:** \`${EVENT_NAME}\` | **Ref:** \`${GIT_REF}\` | **Commit:** \`${SHORT_SHA || 'N/A'}\``);
if (RUN_URL) {
  lines.push(`- **Execução completa e Artifacts (JSON + SBOM CycloneDX):** [Abrir Workflow Run](${RUN_URL})`);
}
lines.push('');

lines.push('## 1. Fluxo Encadeado da Pipeline');
lines.push('');
lines.push('| Etapa | Estágio | Status |');
lines.push('| :---: | :--- | :---: |');
for (const s of stages) {
  lines.push(`| ${s.id} | ${s.name} | ${statusBadge(s.status)} |`);
}
lines.push('');

lines.push('## 2. Resumo das Análises de Segurança');
lines.push('');
lines.push('| Camada | Ferramenta / Alvo | CRITICAL / ERROR | HIGH / WARN | MEDIUM | LOW / INFO | Gate (`HIGH/CRIT` corrigível) |');
lines.push('| :--- | :--- | :---: | :---: | :---: | :---: | :---: |');

lines.push(
  `| **Secrets** | Gitleaks (código e docs) | ${gitleaksCount === null ? '—' : gitleaksCount} | — | — | — | ${
    gitleaksCount === null ? '⏭️' : gitleaksCount === 0 ? '✅ 0 segredos' : `❌ ${gitleaksCount} segredo(s)`
  } |`
);

lines.push(
  `| **SAST** | Semgrep | ${semgrep.available ? semgrep.counts.ERROR : '—'} | ${
    semgrep.available ? semgrep.counts.WARNING : '—'
  } | — | ${semgrep.available ? semgrep.counts.INFO : '—'} | ${
    !semgrep.available ? '⏭️' : semgrep.counts.ERROR === 0 ? '✅ 0 erros' : `❌ ${semgrep.counts.ERROR} erro(s)`
  } |`
);

for (const [label, scan] of [
  ['Trivy FS — `backend`', trivyFsBackend],
  ['Trivy FS — `frontend`', trivyFsFrontend],
]) {
  lines.push(
    `| **SCA** | ${label} | ${scan.available ? scan.counts.CRITICAL : '—'} | ${
      scan.available ? scan.counts.HIGH : '—'
    } | ${scan.available ? scan.counts.MEDIUM : '—'} | ${scan.available ? scan.counts.LOW : '—'} | ${
      !scan.available
        ? '⏭️'
        : scan.counts.fixableHighCrit === 0
          ? '✅ 0 corrigíveis'
          : `❌ ${scan.counts.fixableHighCrit} corrigível(is)`
    } |`
  );
}

lines.push(
  `| **Misconfig** | Trivy Config (Dockerfiles, Compose, Nginx) | ${trivyConfig.available ? trivyConfig.counts.CRITICAL : '—'} | ${
    trivyConfig.available ? trivyConfig.counts.HIGH : '—'
  } | ${trivyConfig.available ? trivyConfig.counts.MEDIUM : '—'} | ${
    trivyConfig.available ? trivyConfig.counts.LOW : '—'
  } | ${
    !trivyConfig.available
      ? '⏭️'
      : trivyConfig.counts.CRITICAL + trivyConfig.counts.HIGH === 0
        ? '✅ 0 HIGH/CRIT'
        : `❌ ${trivyConfig.counts.CRITICAL + trivyConfig.counts.HIGH} achado(s)`
  } |`
);

const hadoErr =
  (hadolint.backend.counts.error || 0) +
  (hadolint.frontend.counts.error || 0) +
  (hadolint.backup.counts.error || 0);
const hadoWarn =
  (hadolint.backend.counts.warning || 0) +
  (hadolint.frontend.counts.warning || 0) +
  (hadolint.backup.counts.warning || 0);
const hadoAvail = hadolint.backend.available || hadolint.frontend.available || hadolint.backup.available;
lines.push(
  `| **Dockerfile Lint** | Hadolint (\`backend\`, \`frontend\`, \`backup\`) | ${hadoAvail ? hadoErr : '—'} | ${
    hadoAvail ? hadoWarn : '—'
  } | — | — | ${!hadoAvail ? '⏭️' : hadoErr === 0 ? '✅ 0 erros' : `❌ ${hadoErr} erro(s)`} |`
);

for (const svc of ['backend', 'frontend', 'backup']) {
  const scan = imageScans[svc];
  lines.push(
    `| **Container Image** | Trivy Image — \`${svc}\` | ${scan.available ? scan.counts.CRITICAL : '—'} | ${
      scan.available ? scan.counts.HIGH : '—'
    } | ${scan.available ? scan.counts.MEDIUM : '—'} | ${scan.available ? scan.counts.LOW : '—'} | ${
      !scan.available
        ? '⏭️'
        : scan.counts.fixableHighCrit === 0
          ? '✅ 0 corrigíveis'
          : `❌ ${scan.counts.fixableHighCrit} corrigível(is)`
    } |`
  );
}
lines.push('');

lines.push('## 3. Inventário SBOM (CycloneDX)');
lines.push('');
lines.push('| Escopo | Artifact | Spec CycloneDX | Componentes |');
lines.push('| :--- | :--- | :---: | :---: |');
for (const sbom of sboms) {
  if (sbom.info) {
    lines.push(`| ${sbom.scope} | \`${sbom.file}\` | v${sbom.info.specVersion} | ${sbom.info.components} |`);
  } else {
    lines.push(`| ${sbom.scope} | \`${sbom.file}\` | — | ⏭️ Não gerado |`);
  }
}
lines.push('');

// Detalhes colapsaveis se houver achados relevantes
const detailBlocks = [];

if (semgrep.topFindings.length > 0) {
  const rows = semgrep.topFindings.slice(0, 20).map(
    (f) => `| \`${f.severity}\` | \`${f.rule}\` | \`${f.path}:${f.line}\` | ${f.message} |`
  );
  detailBlocks.push(
    `<details>\n<summary>🔎 Achados Semgrep (${semgrep.topFindings.length})</summary>\n\n| Severidade | Regra | Local | Mensagem |\n| :---: | :--- | :--- | :--- |\n${rows.join('\n')}\n\n</details>`
  );
}

const allFixableVulns = [
  ...trivyFsBackend.topFindings.map((v) => ({ scope: 'FS backend', ...v })),
  ...trivyFsFrontend.topFindings.map((v) => ({ scope: 'FS frontend', ...v })),
  ...imageScans.backend.topFindings.map((v) => ({ scope: 'IMG backend', ...v })),
  ...imageScans.frontend.topFindings.map((v) => ({ scope: 'IMG frontend', ...v })),
  ...imageScans.backup.topFindings.map((v) => ({ scope: 'IMG backup', ...v })),
];

if (allFixableVulns.length > 0) {
  const rows = allFixableVulns.slice(0, 30).map(
    (v) => `| ${v.scope} | \`${v.severity}\` | \`${v.id}\` | \`${v.pkg}\` | \`${v.installed}\` → \`${v.fixed}\` |`
  );
  detailBlocks.push(
    `<details>\n<summary>🚨 Vulnerabilidades HIGH/CRITICAL corrigíveis (${allFixableVulns.length})</summary>\n\n| Escopo | Severidade | CVE | Pacote | Versão → Correção |\n| :--- | :---: | :--- | :--- | :--- |\n${rows.join('\n')}\n\n</details>`
  );
}

if (trivyConfig.topFindings.length > 0) {
  const rows = trivyConfig.topFindings.slice(0, 20).map(
    (m) => `| \`${m.severity}\` | \`${m.id}\` | \`${m.target}\` | ${m.title} |`
  );
  detailBlocks.push(
    `<details>\n<summary>⚙️ Misconfigurations HIGH/CRITICAL (${trivyConfig.topFindings.length})</summary>\n\n| Severidade | Regra | Arquivo | Descrição |\n| :---: | :--- | :--- | :--- |\n${rows.join('\n')}\n\n</details>`
  );
}

if (detailBlocks.length > 0) {
  lines.push('## 4. Detalhes dos Achados');
  lines.push('');
  lines.push(detailBlocks.join('\n\n'));
  lines.push('');
}

if (Array.isArray(publishedImages) && publishedImages.length > 0) {
  lines.push('## 5. Imagens Multi-Arch Publicadas no GHCR & Assinatura Cosign');
  lines.push('');
  lines.push('Arquiteturas publicadas: `linux/amd64`, `linux/arm64`');
  lines.push('');
  lines.push('| Serviço | Referência Imutável (Tag + Digest) | Cosign Verify | SBOM CycloneDX Atestado |');
  lines.push('| :--- | :--- | :---: | :---: |');
  for (const img of publishedImages) {
    lines.push(
      `| **${img.service}** | \`${img.image}:${img.shaTag}@${img.digest}\` | ${
        img.cosignVerified ? '✅ Verificada' : '❌ Falhou'
      } | ${img.sbomAttested ? '✅ Atestado' : '⚠️ Pendente'} |`
    );
  }
  lines.push('');

  const byService = Object.fromEntries(publishedImages.map((i) => [i.service, i]));

  lines.push('### Variáveis prontas para `.env` (`docker-compose.prod.yml`)');
  lines.push('');
  lines.push('```env');
  if (byService.backend) {
    lines.push(`BACKEND_IMAGE=${byService.backend.image}:${byService.backend.shaTag}@${byService.backend.digest}`);
  }
  if (byService.frontend) {
    lines.push(`FRONTEND_IMAGE=${byService.frontend.image}:${byService.frontend.shaTag}@${byService.frontend.digest}`);
  }
  if (byService.backup) {
    lines.push(`BACKUP_IMAGE=${byService.backup.image}:${byService.backup.shaTag}@${byService.backup.digest}`);
  }
  lines.push('```');
  lines.push('');

  if (byService.backend) {
    lines.push('### Comando de verificação criptográfica (`cosign verify`)');
    lines.push('');
    lines.push('```sh');
    lines.push('cosign verify \\');
    lines.push('  --certificate-oidc-issuer="https://token.actions.githubusercontent.com" \\');
    lines.push(
      `  --certificate-identity-regexp="^https://github\\.com/${REPO_FULL_NAME}/\\.github/workflows/devsecops-pipeline\\.yml@refs/heads/main$" \\`
    );
    lines.push(`  ${byService.backend.image}@${byService.backend.digest}`);
    lines.push('```');
    lines.push('');
  }
}

const markdown = `${lines.join('\n')}\n`;

if (OUTPUT_SUMMARY) {
  fs.appendFileSync(OUTPUT_SUMMARY, markdown, 'utf8');
}
if (OUTPUT_PR_COMMENT) {
  fs.writeFileSync(OUTPUT_PR_COMMENT, markdown, 'utf8');
}
if (!OUTPUT_SUMMARY && !OUTPUT_PR_COMMENT) {
  process.stdout.write(markdown);
}
