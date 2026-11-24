#!/usr/bin/env node
/**
 * Consolida os artefatos da Pipeline 2 (Auditoria Diaria de Seguranca e Atualizacoes)
 * e gera um relatorio com recomendacoes acionaveis para $GITHUB_STEP_SUMMARY e
 * para a Issue consolidada (label: security-audit).
 *
 * Sem dependencias externas (Node.js 24+ nativo).
 */

import fs from 'node:fs';
import path from 'node:path';

const ARTIFACTS_DIR = process.env.ARTIFACTS_DIR || './daily-artifacts';
const OUTPUT_SUMMARY = process.env.OUTPUT_SUMMARY || process.env.GITHUB_STEP_SUMMARY || '';
const OUTPUT_ISSUE_BODY = process.env.OUTPUT_ISSUE_BODY || './daily-issue.md';
const GITHUB_OUTPUT = process.env.GITHUB_OUTPUT || '';
const RUN_URL = process.env.RUN_URL || '';
const TODAY = new Date().toISOString().slice(0, 10);

function findFile(filename) {
  if (!fs.existsSync(ARTIFACTS_DIR)) return null;
  const stack = [ARTIFACTS_DIR];
  while (stack.length > 0) {
    const dir = stack.pop();
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.name === filename) return full;
    }
  }
  return null;
}

function readJson(filename) {
  const p = findFile(filename);
  if (!p) return null;
  try {
    const raw = fs.readFileSync(p, 'utf8').trim();
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function parseTrivy(filename) {
  const data = readJson(filename);
  const res = { available: false, critical: 0, high: 0, medium: 0, low: 0, fixableHighCrit: [], unfixedHighCrit: 0 };
  if (!data || !Array.isArray(data.Results)) return res;
  res.available = true;
  for (const r of data.Results) {
    if (!Array.isArray(r.Vulnerabilities)) continue;
    for (const v of r.Vulnerabilities) {
      const sev = (v.Severity || '').toUpperCase();
      if (sev === 'CRITICAL') res.critical += 1;
      else if (sev === 'HIGH') res.high += 1;
      else if (sev === 'MEDIUM') res.medium += 1;
      else if (sev === 'LOW') res.low += 1;
      if (sev === 'CRITICAL' || sev === 'HIGH') {
        if (v.FixedVersion && String(v.FixedVersion).trim() !== '') {
          res.fixableHighCrit.push({
            id: v.VulnerabilityID,
            pkg: v.PkgName,
            installed: v.InstalledVersion,
            fixed: v.FixedVersion,
            severity: sev,
          });
        } else {
          res.unfixedHighCrit += 1;
        }
      }
    }
  }
  return res;
}

function parseNpmOutdated(filename) {
  const data = readJson(filename);
  if (!data || typeof data !== 'object' || Array.isArray(data)) return [];
  return Object.entries(data).map(([pkg, info]) => {
    const current = info.current || '—';
    const wanted = info.wanted || '—';
    const latest = info.latest || '—';
    let kind = 'patch/minor';
    const curMajor = String(current).split('.')[0];
    const latMajor = String(latest).split('.')[0];
    if (curMajor !== latMajor && curMajor !== '—' && latMajor !== '—') kind = 'major';
    return { pkg, current, wanted, latest, kind };
  });
}

const fsBackend = parseTrivy('daily-trivy-fs-backend.json');
const fsFrontend = parseTrivy('daily-trivy-fs-frontend.json');
const outdatedBackend = parseNpmOutdated('npm-outdated-backend.json');
const outdatedFrontend = parseNpmOutdated('npm-outdated-frontend.json');
const digestsCheck = readJson('digests-check.json') || [];

const imageTargets = [
  { label: 'GHCR: backend', file: 'daily-trivy-image-ghcr-backend.json', owned: true },
  { label: 'GHCR: frontend', file: 'daily-trivy-image-ghcr-frontend.json', owned: true },
  { label: 'GHCR: backup', file: 'daily-trivy-image-ghcr-backup.json', owned: true },
  { label: 'Terceiro: mariadb', file: 'daily-trivy-image-mariadb.json', owned: false },
  { label: 'Terceiro: postgres (evolution_db)', file: 'daily-trivy-image-postgres.json', owned: false },
  { label: 'Terceiro: redis', file: 'daily-trivy-image-redis.json', owned: false },
  { label: 'Terceiro: evolution-api', file: 'daily-trivy-image-evolution.json', owned: false },
];

const imageResults = imageTargets.map((t) => ({ ...t, scan: parseTrivy(t.file) }));

const outdatedDigests = Array.isArray(digestsCheck) ? digestsCheck.filter((d) => d.outdated) : [];
const ownedFixableCount =
  fsBackend.fixableHighCrit.length +
  fsFrontend.fixableHighCrit.length +
  imageResults
    .filter((i) => i.owned && i.scan.available)
    .reduce((acc, i) => acc + i.scan.fixableHighCrit.length, 0);

const needsIssue = ownedFixableCount > 0 || outdatedDigests.length > 0;

const lines = [];
lines.push(`# 📅 Auditoria Diária de Segurança e Atualizações — ${TODAY}`);
lines.push('');
if (RUN_URL) {
  lines.push(`- **Execução:** [Ver Workflow Run](${RUN_URL})`);
}
lines.push(
  `- **Status Geral:** ${
    needsIssue
      ? `⚠️ Atenção necessária (${ownedFixableCount} CVE(s) HIGH/CRITICAL corrigível(is) em componentes próprios; ${outdatedDigests.length} digest(s) de imagem com atualização disponível)`
      : '✅ Nenhuma vulnerabilidade HIGH/CRITICAL corrigível em componentes próprios e todos os digests fixados estão atualizados'
  }`
);
lines.push('');

lines.push('## 1. Vulnerabilidades nas Dependências da Aplicação (SCA)');
lines.push('');
lines.push('| Módulo | CRITICAL | HIGH | MEDIUM | LOW | HIGH/CRIT Corrigíveis |');
lines.push('| :--- | :---: | :---: | :---: | :---: | :---: |');
for (const [name, scan] of [
  ['`backend`', fsBackend],
  ['`frontend`', fsFrontend],
]) {
  lines.push(
    `| ${name} | ${scan.available ? scan.critical : '—'} | ${scan.available ? scan.high : '—'} | ${
      scan.available ? scan.medium : '—'
    } | ${scan.available ? scan.low : '—'} | ${
      !scan.available ? '—' : scan.fixableHighCrit.length === 0 ? '✅ 0' : `❌ ${scan.fixableHighCrit.length}`
    } |`
  );
}
lines.push('');

lines.push('## 2. Auditoria de Imagens (GHCR + Terceiros)');
lines.push('');
lines.push('| Imagem | CRITICAL | HIGH | MEDIUM | LOW | HIGH/CRIT Corrigíveis |');
lines.push('| :--- | :---: | :---: | :---: | :---: | :---: |');
for (const item of imageResults) {
  const s = item.scan;
  if (!s.available) {
    lines.push(`| ${item.label} | — | — | — | — | ℹ️ Ainda não publicada / indisponível |`);
  } else {
    const status =
      s.fixableHighCrit.length === 0
        ? '✅ 0'
        : item.owned
          ? `❌ ${s.fixableHighCrit.length}`
          : `⚠️ ${s.fixableHighCrit.length} *(upstream)*`;
    lines.push(`| ${item.label} | ${s.critical} | ${s.high} | ${s.medium} | ${s.low} | ${status} |`);
  }
}
lines.push('');

lines.push('## 3. Verificação de Digests (`@sha256`) das Imagens Fixadas');
lines.push('');
if (Array.isArray(digestsCheck) && digestsCheck.length > 0) {
  lines.push('| Imagem (Tag) | Status | Digest Atual | Digest Mais Recente |');
  lines.push('| :--- | :---: | :--- | :--- |');
  for (const d of digestsCheck) {
    const curShort = d.currentDigest ? `\`${d.currentDigest.slice(0, 19)}...\`` : '—';
    const latShort = d.latestDigest ? `\`${d.latestDigest.slice(0, 19)}...\`` : '—';
    const badge = d.error ? '⚠️ Erro consulta' : d.outdated ? '⬆️ Atualização disponível' : '✅ Atualizado';
    lines.push(`| \`${d.imageTag}\` | ${badge} | ${curShort} | ${latShort} |`);
  }
} else {
  lines.push('_Nenhum dado de verificação de digests coletado._');
}
lines.push('');

lines.push('## 4. Pacotes `npm` com Novas Versões Disponíveis');
lines.push('');
for (const [mod, list] of [
  ['backend', outdatedBackend],
  ['frontend', outdatedFrontend],
]) {
  lines.push(`### \`${mod}\` (${list.length} pacote(s))`);
  if (list.length === 0) {
    lines.push('✅ Todas as dependências estão nas versões mais recentes.');
  } else {
    lines.push('');
    lines.push('| Pacote | Atual | Recomendada (`wanted`) | Última (`latest`) | Tipo |');
    lines.push('| :--- | :---: | :---: | :---: | :---: |');
    for (const p of list.slice(0, 25)) {
      lines.push(`| \`${p.pkg}\` | \`${p.current}\` | \`${p.wanted}\` | \`${p.latest}\` | ${p.kind} |`);
    }
  }
  lines.push('');
}

lines.push('## 5. Ações Recomendadas');
lines.push('');
if (outdatedDigests.length > 0) {
  lines.push(
    '- **Atualizar digests das imagens base/terceiros:** execute `scripts/update-digests.sh` na branch `dev` e abra PR para `main` para reconstruir e assinar novas imagens no GHCR.'
  );
}
if (ownedFixableCount > 0) {
  lines.push(
    '- **Corrigir CVEs HIGH/CRITICAL em componentes próprios:** atualize os pacotes afetados em `backend/` ou `frontend/` (`npm update` / bump no `package.json`), valide com `npm test` na branch `dev` e abra PR para `main`.'
  );
}
if (outdatedBackend.length > 0 || outdatedFrontend.length > 0) {
  lines.push(
    '- **Revisar PRs do Dependabot:** verifique os Pull Requests abertos automaticamente na branch `dev` para atualizações de dependências `npm`, Dockerfiles e GitHub Actions.'
  );
}
if (!needsIssue && outdatedBackend.length === 0 && outdatedFrontend.length === 0) {
  lines.push('- ✅ Nenhuma ação urgente necessária hoje.');
}

const markdown = `${lines.join('\n')}\n`;

if (OUTPUT_SUMMARY) {
  fs.appendFileSync(OUTPUT_SUMMARY, markdown, 'utf8');
}
if (OUTPUT_ISSUE_BODY) {
  fs.writeFileSync(OUTPUT_ISSUE_BODY, markdown, 'utf8');
}
if (GITHUB_OUTPUT) {
  fs.appendFileSync(GITHUB_OUTPUT, `needs_issue=${needsIssue ? 'true' : 'false'}\n`, 'utf8');
  fs.appendFileSync(GITHUB_OUTPUT, `owned_fixable_count=${ownedFixableCount}\n`, 'utf8');
  fs.appendFileSync(GITHUB_OUTPUT, `outdated_digests_count=${outdatedDigests.length}\n`, 'utf8');
}
