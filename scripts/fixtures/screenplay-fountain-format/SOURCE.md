# Fountain screenplay format test fixture

The adjacent `SKILL.md` and `LICENSE` are byte-for-byte copies of the upstream
files, used as third-party import and generation test data. This is not a built-in
application Skill or an instruction package installed for the development agent.

- Repository: https://github.com/nolanx-ai/nolanx.ai
- Commit: `595d86364377f654e24ddf2c9e875496d85e8246` (2026-05-26)
- Source: https://github.com/nolanx-ai/nolanx.ai/blob/595d86364377f654e24ddf2c9e875496d85e8246/.nolanx/skills/screenplay-fountain-format/SKILL.md
- License: MIT, Copyright (c) 2026 NolanX; see `LICENSE`.
- Skill name: `screenplay-fountain-format`
- `SKILL.md` Git blob: `3bb4837ac219f7feebed32999b4e18f30a48bf28`
- `SKILL.md` SHA-256: `aa2ccbd193e786b577100aa474fea8e0a1459d1f699b0e4862430d97dee33793`
- `LICENSE` Git blob: `e846f05eece58c434f92bbf4250bcf5eec630846`
- `LICENSE` SHA-256: `207872ca8a98ec049530932e768c30a34e7b225d709c92d22329c82b8c96778a`

The self-contained instructions specify Fountain scene headings, uppercase
character cues, dialogue immediately following character cues, concise filmable
action, and whitespace between beats. No script, external reference file, or
tool call is needed to apply these rules. The upstream `agents.allow` metadata is
preserved as data and does not grant application permissions.

The trial imports only the unchanged `SKILL.md` through the application and
compares the same fictional input with the Skill disabled and enabled. It checks
observable formatting and factual preservation, not literary quality. It does
not execute any upstream code or installer. The limited checks cover the
Fountain elements exercised by the sample, not full Fountain parser compliance.
