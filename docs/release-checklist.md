# Release Checklist

Use this before tagging or announcing a Pathmark release.

## Local Verification

```bash
npm ci
npm test
npm pack --dry-run
```

Confirm the tarball includes:

- `dist/index.js`
- `dist/setup.js`
- `dist/codex/cli.js`
- `dist/codex/capture.js`
- `dist/codex/hooks.js`

## Live Codex Verification

```bash
pathmark codex status
```

Expected:

```json
{
  "pathmarkHooksInstalled": true,
  "pathmarkMcpRegistered": true,
  "legacyHooksPresent": false
}
```

Confirm migrated memory remains present:

```bash
test -d ~/.pathmark/memory
wc -l ~/.pathmark/memory/memory.jsonl
```

## GitHub Release

```bash
git tag v0.1.0
git push origin v0.1.0
gh release create v0.1.0 --title "Pathmark v0.1.0" --notes-file docs/releases/v0.1.0.md
```

## npm Release

The `pathmark` npm package name was available on 2026-06-29, but publishing requires npm auth.

```bash
npm whoami
npm publish --access public
```
