---
name: python-security
description: "MUST be used whenever reviewing the uidss-sdk Python package (sdk/) for security issues, or before shipping any feature that handles credentials, tokens, or external data. Triggers: security, security review, security audit, vulnerability, credentials, secrets, secret, token, api key, hardcoded, logging secret, injection, dependency, CVE, pip-audit."
allowed-tools: Read, Glob, Grep, Bash, Write
metadata:
  argument-hint: "[file or directory under sdk/ to audit, or leave blank to audit the whole sdk/ package]"
---

# Security Audit (sdk/)

Perform a security review of **$ARGUMENTS** (or all of `sdk/` if no argument is given). Work
through every step in order and report findings with file paths and line numbers.

---

## Step 1 — Map the attack surface

Read these files:

- `sdk/src/uidss/config.py` — `UidssSettings`: how the `COGNITE_*` env vars / `.env` are loaded
- `sdk/src/uidss/auth.py` — `make_cognite_client()`: how the OAuth client-credentials token is
  acquired (Azure AD vs. Cognite-native IDP, decided by `is_azure_ad()`)
- `sdk/src/uidss/services/*.py` — every place a value crosses into a CDF request body
- `sdk/.env.template` — what secrets are expected
- `sdk/.gitignore` — what is excluded from version control

Identify: all places where secrets enter the process (env vars only — this SDK talks to CDF
directly via the official `cognite-sdk`, there is no separate external API to authenticate
against), all places where external/user data enters (mission folders being uploaded, `ssg.yaml`/
`metrics.yaml` contents, CSV measurement files), and all places data is written to CDF.

---

## Step 2 — Hardcoded credentials

```bash
grep -rn --include="*.py" --include="*.yaml" --include="*.yml" --include="*.toml" \
  -iE "(password|secret|api.?key|token|client.?secret)\s*=\s*['\"][^'\"]{4,}" \
  sdk/src/ sdk/tests/ sdk/scripts/
```

Flag every match. Credentials must come from environment variables via `pydantic-settings`
(`UidssSettings`). They must never be hard-coded in source files, `.env.template`, or
`pyproject.toml`. Note `tests/conftest.py`'s `minimal_env` fixture sets fake env vars
(`"test-value"`) for every test — that's intentional isolation, not a leak.

---

## Step 3 — SecretStr usage

```bash
grep -rn --include="*.py" -E "get_secret_value\(\)" sdk/src/
```

Per `sdk/AGENTS.md`, `client_secret` on `UidssSettings` must be `pydantic.SecretStr`.
`SecretStr.get_secret_value()` must only be called in the exact place the secret is used (built
into the OAuth token request body in `auth.py`). It must never be:
- Assigned to a variable and passed around
- Logged (even at DEBUG level)
- Included in a string that is logged

```python
# BAD
secret = settings.client_secret.get_secret_value()
log.info("requesting token", secret=secret)

# GOOD — used immediately in the request, never stored or logged
body = {"client_secret": settings.client_secret.get_secret_value(), ...}
```

---

## Step 4 — Credentials in logs

```bash
grep -rn --include="*.py" -iE "log.*secret|log.*token|log.*password|log.*key" sdk/src/
grep -rn --include="*.py" -E "log\.(info|debug|warning|error)\(.*secret" sdk/src/
```

Verify that `structlog` calls never include secret fields. `SecretStr` masks values in `repr()`
by default — confirm nothing calls `.get_secret_value()` and passes the result to `log.*`.

---

## Step 5 — `.env` hygiene

```bash
cat sdk/.gitignore | grep -E "\.env"
cat sdk/.env.template
```

Verify:
- `.env` appears in `sdk/.gitignore` (this repo's root `.gitignore` also excludes root-level
  `.env` — `sdk/` has its own, separate `.env`/`.env.template` pair, not shared with the root
  TS app's).
- `sdk/.env.template` contains only placeholder values, not real credentials.
- No `.env`/`.env.local` files under `sdk/` are tracked by git:
  `git ls-files sdk/ | grep -E "\.env$"` should return nothing.

---

## Step 6 — Unsafe code patterns

```bash
grep -rn --include="*.py" -E "subprocess\.(run|call|Popen).*shell=True" sdk/src/
grep -rn --include="*.py" -E "\beval\(|\bexec\(" sdk/src/
grep -rn --include="*.py" -E "import pickle|pickle\.loads" sdk/src/
```

Flag any match — these patterns must not appear in production code. Also check YAML loading:

```bash
grep -rn --include="*.py" -E "yaml\.load\(" sdk/src/
```

`ssg.yaml`/`metrics.yaml`/sensor-config YAML files come from a user-supplied mission folder —
they must be parsed with `yaml.safe_load()` (or the regex-based scalar extraction already used
in `drone_image_service.py`'s `parse_sensor_yaml()`), never plain `yaml.load()`, since that can
execute arbitrary Python objects embedded in the YAML.

---

## Step 7 — Dependency vulnerability scan

```bash
cd sdk && uv run pip-audit
```

If `pip-audit` is not installed: `uv add --dev pip-audit && uv run pip-audit`.

List every high/critical CVE with package name, severity, and recommended fix. If no
vulnerabilities are found at high/critical level, state that explicitly.

---

## Step 8 — Report findings

| Severity | File | Line | Issue | Recommendation |
|---|---|---|---|---|
| HIGH | `auth.py` | 22 | `secret = settings.client_secret.get_secret_value()` stored in a variable for the whole function | Use inline in the request body and discard immediately |
| MEDIUM | `.env.template` | 4 | Contains what looks like a real client secret rather than a placeholder | Replace with a placeholder value |
| LOW | `pyproject.toml` | — | A pinned dependency has a known CVE | Upgrade past the affected version |

If no issues are found in a step, state "No issues found" for that step. Do not skip steps
silently.

---

## Done

Summarize by severity. Any HIGH finding must be resolved before the next release.
