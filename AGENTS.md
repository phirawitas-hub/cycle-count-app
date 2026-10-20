# Project release workflow

User instructions recorded on 2026-10-20:

- After completing and successfully testing requested changes, publish this project's changes to GitHub without asking for release confirmation again, unless the user explicitly requests preview-only or no deployment.
- Before publishing, inspect the remote head and preserve intervening changes. Do not force-push over someone else's work.
- Save a versioned HTML copy in `D:\Wap app count\Log Issue App\HTML` for each completed HTML revision. Verify it matches the tested source; do not overwrite older archived versions.
- Verify the published GitHub Pages assets and report the deployed version. If tests, permissions, or deployment fail, report the actual state rather than claiming success.
- Preserve pending device-local count data during updates. Do not clear browser storage or change live stock/count records as part of release verification.
