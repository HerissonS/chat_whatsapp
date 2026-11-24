# Política de Segurança

## Versões Suportadas

Mantemos correções de segurança ativas na branch principal (`main`) e nas imagens mais recentes publicadas no GitHub Container Registry (GHCR) a partir dela.

| Branch / Artefato | Suporte de Segurança |
| :--- | :--- |
| `main` (último commit e imagens assinadas no GHCR) | Sim |
| Releases / commits anteriores | Não |

## Como Reportar uma Vulnerabilidade

**Não abra uma Issue pública** para reportar vulnerabilidades de segurança ativas.

Utilize o recurso **Private Vulnerability Reporting** (aba **Security > Advisories > Report a vulnerability**) deste repositório no GitHub, incluindo:

1. Descrição clara do problema e impacto potencial;
2. Passos mínimos para reprodução ou prova de conceito;
3. Versão / commit SHA ou digest `@sha256` da imagem afetada;
4. Sugestão de mitigação, se houver.

Nos comprometemos a confirmar o recebimento em até **72 horas** e manter transparência até a correção e publicação das novas imagens assinadas.

## Verificação de Integridade das Imagens (Cosign + SBOM)

Todas as imagens oficiais deste projeto publicadas no GHCR (`backend`, `frontend` e `backup`) são:

- construídas em **multi-arquitetura** (`linux/amd64`, `linux/arm64`);
- versionadas de forma imutável por **SHA do commit e digest `@sha256`**;
- **assinadas digitalmente com Cosign keyless (Sigstore / OIDC)**;
- acompanhadas de **SBOM em formato CycloneDX** atestado na própria imagem.

### Verificar assinatura de uma imagem antes do deploy

Substitua `<OWNER>` e `<REPO>` pelo proprietário e nome do repositório no GitHub, e `<DIGEST>` pelo `@sha256:...` publicado pela pipeline:

```sh
cosign verify \
  --certificate-oidc-issuer="https://token.actions.githubusercontent.com" \
  --certificate-identity-regexp="^https://github\.com/<OWNER>/<REPO>/\.github/workflows/devsecops-pipeline\.yml@refs/heads/main$" \
  ghcr.io/<owner>/<repo>-backend@sha256:<DIGEST>
```

### Verificar atestação de SBOM (CycloneDX)

```sh
cosign verify-attestation \
  --type cyclonedx \
  --certificate-oidc-issuer="https://token.actions.githubusercontent.com" \
  --certificate-identity-regexp="^https://github\.com/<OWNER>/<REPO>/\.github/workflows/devsecops-pipeline\.yml@refs/heads/main$" \
  ghcr.io/<owner>/<repo>-backend@sha256:<DIGEST>
```

## Controles DevSecOps Automatizados

- **Pipeline de PR e Release (`.github/workflows/devsecops-pipeline.yml`)**: Gitleaks, testes unitários, Semgrep (SAST), Trivy FS + CycloneDX (SCA & SBOM), Trivy Config + Hadolint (Misconfiguration), Trivy Image, build multi-arch, publicação no GHCR, assinatura Cosign e relatório consolidado no GitHub Actions Job Summary.
- **Auditoria Diária (`.github/workflows/daily-security-audit.yml`)**: varredura diária de CVEs em dependências e imagens (GHCR e terceiros), checagem de novos digests `@sha256`, recomendações de atualização e abertura/atualização automática de Issue consolidada (`security-audit`).
- **Dependabot (`.github/dependabot.yml`)**: PRs automatizados de atualização para `npm`, `docker` e `github-actions` direcionados à branch `dev`.

Para detalhes técnicos sobre hardening da aplicação, rede, autenticação e containers, consulte [docs/SEGURANCA.md](docs/SEGURANCA.md).
