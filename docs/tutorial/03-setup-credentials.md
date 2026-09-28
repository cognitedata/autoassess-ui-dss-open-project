# 3. Setup & credentials

You'll use the **shared CDF project** provisioned for the integration week:

| Setting | Value |
|---|---|
| Project | `autoassess-dev` |
| Cluster | `westeurope-1` (`https://westeurope-1.cognitedata.com`) |
| Organization / IdP | `cog-autoassess` (Cognite IdP) |
| Client ID / secret | handed out per partner by the AutoAssess team |

## Step 1 — Clone

```bash
git clone git@github.com:cognitedata/autoassess-ui-dss.git
cd autoassess-ui-dss
```

## Step 2 — Configure the SDK credentials

```bash
cd sdk
cp .env.template .env
```

Edit `sdk/.env`:

```dotenv
COGNITE_PROJECT=autoassess-dev
COGNITE_CLUSTER=westeurope-1
COGNITE_TENANT_ID=cog-autoassess
COGNITE_CLIENT_ID=<your client id>
COGNITE_CLIENT_SECRET=<your client secret>
```

> ⚠️ `.env` is gitignored. **Never commit it** and never paste the secret into code, issues or chat.

How auth works ([`sdk/src/uidss/auth.py`](../../sdk/src/uidss/auth.py)): if `COGNITE_TENANT_ID` is a **UUID**, the SDK uses Microsoft Entra ID (`login.microsoftonline.com`). Otherwise, as here, it treats it as a **Cognite IdP organization** and uses `https://auth.cognite.com/oauth2/token`. Both use OAuth client credentials, so there is no interactive login.

The settings are read from environment variables **or a `.env` file in the current working directory**. Run `dss` from inside `sdk/`, or export the variables in your shell or robot's environment.

## Step 3 — Install and smoke test the SDK

```bash
# still in sdk/
uv sync
uv run dss --help
uv run dss plan list
```

✅ You should see a vessel picker (arrow keys + Enter), then an area picker, then a table of inspection plans.

If you get an auth error, see [troubleshooting](08-gotchas-and-faq.md#troubleshooting).

## Step 4 — (Web track) Access the web app

The web viewer needs **no `.env`** to run. It gets its token from Fusion. You need:
1. A Fusion login for the `cog-autoassess` organization
2. Node 20+: `npm install` at the repo root

Full steps are in [chapter 5](05-web-viewer.md).

## Step 5 — (Optional) Root `.env` for TS data scripts

Only needed if you run `npm run setup-dm` / `npm run upload-3d` (normally **not** needed on the shared project):

```bash
cd ..            # repo root
cp .env.example .env
# same COGNITE_* values as sdk/.env
```

**Next:** [4. Ground station →](04-ground-station-sdk.md) · [5. Web viewer →](05-web-viewer.md) · [6. Analysis →](06-analysis-on-cdf-data.md)
